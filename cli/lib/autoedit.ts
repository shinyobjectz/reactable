// Footage intel — authored auto-edit. Turns a take's GROUND-TRUTH capture
// events (cursor, click, slide) into an edit plan: punch-ins toward where
// the presenter is pointing, and silence trims from the mic track. No vision
// inference — authored content already told us what happened.
// docs/PLAN.footage-intel.work.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROJECT, takePath } from "./paths.ts";
import { resolveFfmpeg } from "./tools.ts";

type Ev = { t: number; type: string; [k: string]: any };

function readEvents(dir: string): Ev[] {
  const p = join(dir, "events.jsonl");
  if (!existsSync(p)) throw new Error(`no events.jsonl in ${dir} — not a recorded take`);
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// cut-on-action: if the take's stage was motion-indexed, its .intel sidecar
// holds optical-flow cut_points. Surface them as advisory action cuts so the
// authored edit can land cuts on the visual action, not just cursor/silence.
function motionCutsForTake(dir: string): { t_ms: number; mag: number }[] {
  const intel = readdirSync(dir).filter((n) => n.endsWith(".intel"));
  for (const d of intel) {
    const idxPath = join(dir, d, "index.json");
    if (!existsSync(idxPath)) continue;
    try {
      const idx = JSON.parse(readFileSync(idxPath, "utf8"));
      const cuts = idx?.passes?.motion?.cut_points;
      if (Array.isArray(cuts) && cuts.length) return cuts;
    } catch { /* ignore malformed sidecar */ }
  }
  return [];
}

// Screen rect of the captured region → normalized video coords for a
// screen-space cursor/click point (both top-left origin).
function makeMapper(events: Ev[]): ((x: number, y: number) => [number, number]) | null {
  const cap = events.find((e) => e.type === "capture.stage" && e.window);
  const w = cap?.window;
  if (!w || !w.w || !w.h) return null;
  return (x: number, y: number) => {
    const nx = Math.min(1, Math.max(0, (x - w.x) / w.w));
    const ny = Math.min(1, Math.max(0, (y - w.yTop) / w.h));
    return [nx, ny];
  };
}

// ── punch-ins from cursor activity ────────────────────────────────────
// Clicks are strong focus signals; dense cursor motion is a weak one. Group
// activity within `gapMs` into a window and punch toward its centroid.

function punchesFromActivity(events: Ev[], durMs: number, opts: { gapMs?: number; minMs?: number; zoom?: number } = {}) {
  const map = makeMapper(events);
  if (!map) return { punches: [], reason: "no capture.stage geometry — cannot map cursor to frame" };
  const gapMs = opts.gapMs ?? 1500;
  const minMs = opts.minMs ?? 900;
  const zoom = opts.zoom ?? 1.7;

  // activity = clicks (weight 3) + throttled cursor moves (weight 1)
  const acts = events
    .filter((e) => e.type === "click" || e.type === "cursor")
    .map((e) => {
      const [nx, ny] = map(e.x, e.y);
      return { t_ms: Math.round(e.t * 1000), nx, ny, w: e.type === "click" ? 3 : 1 };
    });
  if (!acts.length) return { punches: [], reason: "no cursor/click events" };

  const clusters: { in_ms: number; out_ms: number; sx: number; sy: number; sw: number; clicks: number }[] = [];
  let cur: any = null;
  for (const a of acts) {
    if (cur && a.t_ms - cur.out_ms <= gapMs) {
      cur.out_ms = a.t_ms;
      cur.sx += a.nx * a.w;
      cur.sy += a.ny * a.w;
      cur.sw += a.w;
      if (a.w === 3) cur.clicks++;
    } else {
      cur = { in_ms: a.t_ms, out_ms: a.t_ms, sx: a.nx * a.w, sy: a.ny * a.w, sw: a.w, clicks: a.w === 3 ? 1 : 0 };
      clusters.push(cur);
    }
  }

  const punches = clusters
    .filter((c) => c.out_ms - c.in_ms >= minMs || c.clicks > 0)
    .map((c) => ({
      in_ms: Math.max(0, c.in_ms - 300),
      out_ms: Math.min(durMs, c.out_ms + 600),
      cx: Number((c.sx / c.sw).toFixed(3)),
      cy: Number((c.sy / c.sw).toFixed(3)),
      zoom,
      trigger: c.clicks > 0 ? `${c.clicks} click(s)` : "cursor dwell",
    }));
  return { punches, reason: null };
}

// ── silence trims from the mic track (deterministic signal analysis) ──

function silenceTrims(dir: string, durMs: number, opts: { noiseDb?: number; minSilenceMs?: number; padMs?: number } = {}) {
  const mic = ["mic-clean.wav", "mic.wav"].map((n) => join(dir, n)).find(existsSync);
  if (!mic) return { keep: [{ in_ms: 0, out_ms: durMs }], removed_ms: 0, reason: "no mic track — nothing trimmed" };
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found");
  const noiseDb = opts.noiseDb ?? -34;
  const minSil = (opts.minSilenceMs ?? 700) / 1000;
  const pad = opts.padMs ?? 150;

  // ffmpeg writes silencedetect to stderr and exits 0 — capture stderr on
  // success (spawnSync), not just on throw.
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", mic, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSil}`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const stderr = r.stderr ?? "";
  const sil: { start: number; end: number }[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const en = line.match(/silence_end:\s*([\d.]+)/);
    if (s) pendingStart = parseFloat(s[1]);
    if (en && pendingStart != null) {
      sil.push({ start: Math.round(pendingStart * 1000), end: Math.round(parseFloat(en[1]) * 1000) });
      pendingStart = null;
    }
  }
  if (pendingStart != null) sil.push({ start: Math.round(pendingStart * 1000), end: durMs });

  // keep = complement of padded silence, dropping tiny slivers
  const keep: { in_ms: number; out_ms: number }[] = [];
  let cursor = 0;
  let removed = 0;
  for (const g of sil) {
    const gs = Math.min(durMs, g.start + pad);
    const ge = Math.max(0, g.end - pad);
    if (ge - gs <= 0) continue;
    if (gs - cursor > 250) keep.push({ in_ms: cursor, out_ms: gs });
    removed += ge - gs;
    cursor = ge;
  }
  if (durMs - cursor > 250) keep.push({ in_ms: cursor, out_ms: durMs });
  if (!keep.length) keep.push({ in_ms: 0, out_ms: durMs });
  return { keep, removed_ms: removed, reason: null };
}

// ── plan ──────────────────────────────────────────────────────────────

export function autoEdit(takeId: string, opts: { render?: boolean } = {}) {
  const dir = takePath(takeId);
  if (!existsSync(dir)) throw new Error(`no take ${takeId}`);
  const events = readEvents(dir);
  const stop = events.find((e) => e.type === "record.stop");
  const durMs = stop ? Math.round(stop.t * 1000) : Math.round((events[events.length - 1]?.t ?? 0) * 1000);

  const slides = events.filter((e) => e.type === "slide" || e.type === "scene").map((e) => ({ t_ms: Math.round(e.t * 1000), id: e.id ?? e.ref ?? null, title: e.title ?? null }));
  const { punches, reason: punchReason } = punchesFromActivity(events, durMs);
  const { keep, removed_ms, reason: silReason } = silenceTrims(dir, durMs);
  const actionCuts = motionCutsForTake(dir);

  const plan = {
    schema: "footage-intel/autoedit-1",
    take: takeId,
    duration_ms: durMs,
    source: "ground-truth events (cursor/click/slide) + mic silence — no inference",
    chapters: slides,
    punches,
    keep_segments: keep,
    trimmed_ms: removed_ms,
    action_cuts: actionCuts,
    notes: [punchReason, silReason, actionCuts.length ? `${actionCuts.length} cut-on-action points from the motion pass` : "no motion pass — run: reactable video pass <stage> motion --run"].filter(Boolean),
  };
  const out = join(dir, "autoedit.json");
  writeFileSync(out, JSON.stringify(plan, null, 2));

  let render: string | null = null;
  if (opts.render) render = renderAutoEdit(takeId, plan);
  return { ...plan, plan: out, ...(render ? { render } : {}) };
}

// Render a quick proof: concat the keep-segments of stage.mov and apply the
// punch-in zooms. Editorial-grade output belongs in HyperFrames; this proves
// the plan is real.
function largestStage(dir: string): string | null {
  const segs = readdirSync(dir)
    .filter((n) => /^stage(-\d+)?\.mov$/.test(n))
    .map((n) => ({ n, size: statSync(join(dir, n)).size }))
    .sort((a, b) => b.size - a.size);
  return segs.length ? join(dir, segs[0].n) : null;
}

function renderAutoEdit(takeId: string, plan: any): string {
  const dir = takePath(takeId);
  const stage = largestStage(dir);
  if (!stage) throw new Error("no stage*.mov to render");
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found");
  const ffprobe = join(dirname(ffmpeg), "ffprobe");
  const probe = JSON.parse(
    execFileSync(existsSync(ffprobe) ? ffprobe : "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", stage], { encoding: "utf8" }),
  );
  const st = probe.streams[0];
  // Screen captures are VFR (frames only on change) — normalize to CFR so
  // output frame numbers map linearly to time for the punch windows.
  const fps = 30;
  const W = st.width;
  const H = st.height;

  // 1. keep-segments (silence cuts) → CFR → concat on one timeline. Track how
  //    each source-ms maps to output-ms so punch windows land correctly.
  const segFilters: string[] = [];
  const segLabels: string[] = [];
  let outCursor = 0;
  const remap: { srcIn: number; srcOut: number; outIn: number }[] = [];
  plan.keep_segments.forEach((seg: any, i: number) => {
    segFilters.push(`[0:v]trim=${(seg.in_ms / 1000).toFixed(3)}:${(seg.out_ms / 1000).toFixed(3)},fps=${fps},setpts=PTS-STARTPTS[k${i}]`);
    segLabels.push(`[k${i}]`);
    remap.push({ srcIn: seg.in_ms, srcOut: seg.out_ms, outIn: outCursor });
    outCursor += seg.out_ms - seg.in_ms;
  });
  const cut = `${segLabels.join("")}concat=n=${segLabels.length}:v=1:a=0[cut]`;

  // 2. punch windows, remapped to the post-cut timeline → time-windowed
  //    zoompan expression (zoom only during each window; identity elsewhere).
  const toOut = (srcMs: number): number | null => {
    for (const r of remap) if (srcMs >= r.srcIn && srcMs <= r.srcOut) return r.outIn + (srcMs - r.srcIn);
    return null;
  };
  const windows = plan.punches
    .map((p: any) => {
      const oi = toOut(p.in_ms);
      const oo = toOut(p.out_ms);
      if (oi == null || oo == null) return null;
      return { inF: Math.round((oi / 1000) * fps), outF: Math.round((oo / 1000) * fps), cx: p.cx, cy: p.cy, zoom: p.zoom };
    })
    .filter(Boolean);

  const out = join(dir, "autoedit-proof.mp4");
  if (!windows.length) {
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", stage, "-filter_complex", `${segFilters.join(";")};${cut}`, "-map", "[cut]", "-c:v", "libx264", "-pix_fmt", "yuv420p", out], { maxBuffer: 128 * 1024 * 1024 });
    return out;
  }
  const ramp = Math.max(1, Math.round(0.4 * fps));
  // nested-if zoom expression across all windows
  let zExpr = "1";
  let xExpr = "0";
  let yExpr = "0";
  for (const w of windows as any[]) {
    const dz = (w.zoom - 1).toFixed(3);
    const zin = `1+${dz}*(on-${w.inF})/${ramp}`;
    const zout = `${w.zoom}-${dz}*(on-${w.outF - ramp})/${ramp}`;
    const zwin = `if(lt(on,${w.inF + ramp}),${zin},if(lt(on,${w.outF - ramp}),${w.zoom},${zout}))`;
    zExpr = `if(between(on,${w.inF},${w.outF}),${zwin},${zExpr})`;
    xExpr = `if(between(on,${w.inF},${w.outF}),iw*${w.cx.toFixed(3)}-(iw/zoom)/2,${xExpr})`;
    yExpr = `if(between(on,${w.inF},${w.outF}),ih*${w.cy.toFixed(3)}-(ih/zoom)/2,${yExpr})`;
  }
  const pz = `[cut]zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${W}x${H}:fps=${fps.toFixed(3)}[vout]`;
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", stage, "-filter_complex", `${segFilters.join(";")};${cut};${pz}`, "-map", "[vout]", "-c:v", "libx264", "-pix_fmt", "yuv420p", out], { maxBuffer: 256 * 1024 * 1024 });
  return out;
}
