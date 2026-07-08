// Footage intel P3 — perception artifacts become edit assets.
// track → motion keyframes (punch-in/follow for HyperFrames comps)
// mask  → luma matte / RGBA cutout video (ffmpeg, straight from SAM RLE —
//         model-refined mattes are gated on the matting-license ruling)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PROJECT } from "./paths.ts";
import { resolveFfmpeg } from "./tools.ts";
import { readIndex, readTracks, sidecarDir, type Ref } from "./video.ts";

// ── COCO compressed RLE (pycocotools "counts" string) ────────────────

function decodeCocoRle(countsB64: string, h: number, w: number): Uint8Array {
  const s = Buffer.from(countsB64, "base64").toString("latin1");
  const counts: number[] = [];
  let i = 0;
  while (i < s.length) {
    let x = 0;
    let k = 0;
    let more = true;
    while (more) {
      const c = s.charCodeAt(i) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = (c & 0x20) !== 0;
      i++;
      k++;
      if (!more && c & 0x10) x |= -1 << (5 * k);
    }
    if (counts.length > 2) x += counts[counts.length - 2];
    counts.push(x);
  }
  // column-major runs, starting with zeros
  const mask = new Uint8Array(h * w);
  let pos = 0;
  let val = 0;
  for (const run of counts) {
    for (let j = 0; j < run; j++) {
      const col = Math.floor(pos / h);
      const row = pos % h;
      if (val) mask[row * w + col] = 255;
      pos++;
    }
    val = 1 - val;
  }
  return mask;
}

function findTrack(ref: Ref, trackId: string): any {
  const trk = readTracks(ref).find((t) => t.id === trackId);
  if (!trk) {
    throw new Error(`no tracklet "${trackId}" — reactable video tracks <ref> --json lists them`);
  }
  return trk;
}

function trackFps(trk: any): number {
  const f = trk.frames;
  if (f.length < 2) return 30;
  const deltas = f.slice(1).map((x: any, i: number) => x.t_ms - f[i].t_ms).filter((d: number) => d > 0);
  deltas.sort((a: number, b: number) => a - b);
  const med = deltas[Math.floor(deltas.length / 2)] || 33;
  return Math.round(1000 / med);
}

// ── mask → matte ──────────────────────────────────────────────────────

export function renderMatte(ref: Ref, trackId: string, opts: { apply?: boolean } = {}): any {
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found — brew install ffmpeg");
  const idx = readIndex(ref);
  const trk = findTrack(ref, trackId);
  const withMasks = trk.frames.filter((f: any) => f.rle);
  if (!withMasks.length) throw new Error(`tracklet ${trackId} has no masks — re-run the sam31 pass`);

  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const work = join(tmpdir(), `matte-${basename(dir)}-${trackId}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const [h, w] = withMasks[0].rle.size;
  withMasks.forEach((f: any, i: number) => {
    const mask = decodeCocoRle(f.rle.counts, h, w);
    const header = Buffer.from(`P5\n${w} ${h}\n255\n`, "ascii");
    writeFileSync(join(work, `m-${String(i).padStart(5, "0")}.pgm`), Buffer.concat([header, Buffer.from(mask)]));
  });

  const fps = trackFps(trk);
  const mattePath = join(dir, "assets", `matte-${trackId}.mov`);
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", String(fps), "-i", join(work, "m-%05d.pgm"),
    "-c:v", "prores_ks", "-profile:v", "3", mattePath,
  ]);

  let cutoutPath: string | null = null;
  if (opts.apply) {
    cutoutPath = join(dir, "assets", `cutout-${trackId}.mov`);
    execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", (trk.in_ms / 1000).toFixed(3), "-t", ((trk.out_ms - trk.in_ms) / 1000 || 0.04).toFixed(3),
      "-i", ref.media,
      "-framerate", String(fps), "-i", join(work, "m-%05d.pgm"),
      "-filter_complex", "[1:v]format=gray[a];[0:v][a]alphamerge[out]",
      "-map", "[out]", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
      "-an", cutoutPath,
    ]);
  }
  rmSync(work, { recursive: true, force: true });

  // record on the tracklet
  const tracks = readTracks(ref).map((t) => {
    if (t.id === trackId) {
      t.assets = { ...(t.assets ?? {}), matte: `assets/matte-${trackId}.mov`, ...(cutoutPath ? { cutout: `assets/cutout-${trackId}.mov` } : {}) };
    }
    return t;
  });
  writeFileSync(join(dir, "tracks.jsonl"), tracks.map((t) => JSON.stringify(t)).join("\n") + "\n");

  return {
    track: trackId,
    concept: trk.concept,
    frames: withMasks.length,
    fps,
    matte: mattePath,
    ...(cutoutPath ? { cutout: cutoutPath } : {}),
    note: "matte is raw SAM masks (luma). Model-refined edges land after the matting-license ruling.",
    source_res: [idx.probe.width, idx.probe.height],
  };
}

// ── track → motion keyframes ──────────────────────────────────────────

export function motionPlan(
  ref: Ref,
  trackId: string,
  opts: { style?: string; maxZoom?: number } = {},
): any {
  const idx = readIndex(ref);
  const trk = findTrack(ref, trackId);
  const { width: W, height: H } = idx.probe;
  const style = opts.style ?? "punch-in";
  const maxZoom = opts.maxZoom ?? 2.2;

  // smooth centers with a small moving average, then decimate to keyframes
  const win = 7;
  const smoothed = trk.frames.map((f: any, i: number) => {
    const lo = Math.max(0, i - Math.floor(win / 2));
    const seg = trk.frames.slice(lo, lo + win);
    const cx = seg.reduce((s: number, g: any) => s + g.bbox[0] + g.bbox[2] / 2, 0) / seg.length;
    const cy = seg.reduce((s: number, g: any) => s + g.bbox[1] + g.bbox[3] / 2, 0) / seg.length;
    const bw = seg.reduce((s: number, g: any) => s + g.bbox[2], 0) / seg.length;
    const bh = seg.reduce((s: number, g: any) => s + g.bbox[3], 0) / seg.length;
    // fill ~55% of the frame with the subject, clamped
    const zoom = Math.min(maxZoom, Math.max(1, 0.55 / Math.max(bw / W, bh / H)));
    return { t_ms: f.t_ms, cx, cy, zoom };
  });

  const keyframes: any[] = [];
  for (const p of smoothed) {
    const last = keyframes[keyframes.length - 1];
    if (
      !last ||
      Math.abs(p.cx - last.cx) > W * 0.02 ||
      Math.abs(p.cy - last.cy) > H * 0.02 ||
      Math.abs(p.zoom - last.zoom) > 0.08
    ) {
      keyframes.push({ t_ms: p.t_ms, cx: Math.round(p.cx), cy: Math.round(p.cy), zoom: Number(p.zoom.toFixed(3)) });
    }
  }
  const tail = smoothed[smoothed.length - 1];
  if (keyframes[keyframes.length - 1]?.t_ms !== tail.t_ms) {
    keyframes.push({ t_ms: tail.t_ms, cx: Math.round(tail.cx), cy: Math.round(tail.cy), zoom: Number(tail.zoom.toFixed(3)) });
  }
  if (style === "punch-in") {
    // hold a single zoom (median) — punch, don't chase
    const zooms = keyframes.map((k) => k.zoom).sort((a, b) => a - b);
    const z = zooms[Math.floor(zooms.length / 2)];
    for (const k of keyframes) k.zoom = z;
  }

  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const plan = {
    schema: "footage-intel/motion-1",
    track: trackId,
    concept: trk.concept,
    style,
    source_res: [W, H],
    in_ms: trk.in_ms,
    out_ms: trk.out_ms,
    ease: "cubic-in-out",
    keyframes,
  };
  const out = join(dir, "assets", `motion-${trackId}.json`);
  writeFileSync(out, JSON.stringify(plan, null, 2));

  const tracks = readTracks(ref).map((t) => {
    if (t.id === trackId) t.assets = { ...(t.assets ?? {}), motion: `assets/motion-${trackId}.json` };
    return t;
  });
  writeFileSync(join(dir, "tracks.jsonl"), tracks.map((t) => JSON.stringify(t)).join("\n") + "\n");

  return { track: trackId, style, keyframes: keyframes.length, plan: out };
}

// ── compose: cutout over new bg + punch-in when subject is foreground ──
// The finished-render endpoint. Given a tracklet, auto-derives the
// foreground window from its depth zone_series, cuts the subject out, lays
// it over a new background, and punches in during that window. This is what
// the agent runs for "isolate the product, swap the background, punch in
// when it's foreground" — no manual masks, no manual keyframes.

function foregroundWindow(trk: any): { in_ms: number; out_ms: number } | null {
  const series = trk.depth?.zone_series;
  if (!series?.length) return null;
  // longest contiguous run of fg (fall back to mid+fg if no pure-fg run)
  const pick = (zones: string[]) => {
    let best: { in_ms: number; out_ms: number } | null = null;
    let run: any[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const w = { in_ms: run[0].t_ms, out_ms: run[run.length - 1].t_ms };
        if (!best || w.out_ms - w.in_ms > best.out_ms - best.in_ms) best = w;
      }
      run = [];
    };
    for (const s of series) {
      if (zones.includes(s.zone)) run.push(s);
      else flush();
    }
    flush();
    return best;
  };
  return pick(["fg"]) ?? pick(["fg", "mid"]);
}

// Full-source-timeline cutout: the subject sits at its real source-time
// position with transparent frames everywhere it isn't present. Unlike the
// trimmed `renderMatte` asset, this aligns 1:1 with a full-duration
// background and with source-time punch windows.
function buildAlignedCutout(ffmpeg: string, ref: Ref, trk: any, idx: any): string {
  const { width: W, height: H, duration_ms: durMs, avg_fps: fps } = idx.probe;
  const withMasks = trk.frames.filter((f: any) => f.rle);
  if (!withMasks.length) throw new Error(`tracklet ${trk.id} has no masks — re-run the sam31 pass`);
  const [mh, mw] = withMasks[0].rle.size;

  const dir = sidecarDir(ref.media);
  const work = join(tmpdir(), `compose-${basename(dir)}-${trk.id}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const total = Math.max(1, Math.round((durMs / 1000) * fps));
  const frameMs = 1000 / fps;
  const tol = frameMs; // a mask counts for a frame if within one frame interval
  const black = Buffer.alloc(mw * mh); // transparent
  const header = Buffer.from(`P5\n${mw} ${mh}\n255\n`, "ascii");
  let mi = 0;
  for (let i = 0; i < total; i++) {
    const t = i * frameMs;
    // advance the mask pointer to the nearest at/after t
    while (mi + 1 < withMasks.length && Math.abs(withMasks[mi + 1].t_ms - t) <= Math.abs(withMasks[mi].t_ms - t)) mi++;
    const m = withMasks[mi];
    const body = Math.abs(m.t_ms - t) <= tol ? Buffer.from(decodeCocoRle(m.rle.counts, mh, mw)) : black;
    writeFileSync(join(work, `m-${String(i).padStart(6, "0")}.pgm`), Buffer.concat([header, body]));
  }

  const cutout = join(work, "cutout.mov");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", ref.media,
    "-framerate", fps.toFixed(4), "-i", join(work, "m-%06d.pgm"),
    "-filter_complex", `[1:v]scale=${W}:${H}:flags=neighbor,format=gray[a];[0:v]scale=${W}:${H}[v];[v][a]alphamerge[out]`,
    "-map", "[out]", "-frames:v", String(total),
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an", cutout,
  ]);
  return cutout; // caller cleans up `work`
}

export function compose(
  ref: Ref,
  trackId: string,
  opts: { bg?: string; out?: string; punchZoom?: number } = {},
): any {
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found — brew install ffmpeg");
  const idx = readIndex(ref);
  const trk = findTrack(ref, trackId);
  const { width: W, height: H } = idx.probe;
  const durMs = idx.probe.duration_ms;

  // 1. isolate the product on the full source timeline (aligned cutout)
  const dir = sidecarDir(ref.media);
  const cutout = buildAlignedCutout(ffmpeg, ref, trk, idx);
  const cutoutWork = join(tmpdir(), `compose-${basename(dir)}-${trackId}`);
  // also refresh the standalone trimmed cutout asset for the editor
  const cutoutRel = `assets/cutout-${trackId}.mov`;
  if (!existsSync(join(dir, cutoutRel))) renderMatte(ref, trackId, { apply: true });

  // 2. derive the foreground window (when to punch in)
  const fg = foregroundWindow(trk);
  const punchZoom = opts.punchZoom ?? 1.6;

  // 3. background: a data-driven gradient unless a media path is given
  const bg = opts.bg;
  const bgIsMedia = bg && /\.(mp4|mov|png|jpg|jpeg)$/i.test(bg);

  // 4. build the filtergraph.
  //   [bg] scaled to WxH → overlay [cutout] → punch-in zoompan on fg window
  const parts: string[] = [];
  const inputs: string[] = ["-i", cutout];
  if (bgIsMedia) {
    inputs.unshift("-i", bg!);
    // media bg is input 0, cutout input 1
    parts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg]`);
    parts.push(`[1:v]setsar=1[fg]`);
  } else {
    const grad = bg || "gradients=c0=0x1a1a2e:c1=0x16213e";
    inputs.unshift("-f", "lavfi", "-i", `${grad}:s=${W}x${H}:d=${(durMs / 1000).toFixed(2)}:r=${idx.probe.avg_fps.toFixed(2)}`);
    parts.push(`[0:v]setsar=1[bg]`);
    parts.push(`[1:v]setsar=1[fg]`);
  }
  parts.push(`[bg][fg]overlay=0:0:shortest=1[comp]`);

  // punch-in: linear zoom to punchZoom over the fg window, hold, zoom back.
  // zoompan works in output frames — convert ms → frame index.
  const fps = idx.probe.avg_fps;
  let finalLabel = "comp";
  if (fg) {
    const inF = Math.round((fg.in_ms / 1000) * fps);
    const outF = Math.round((fg.out_ms / 1000) * fps);
    const ramp = Math.max(1, Math.round(0.5 * fps)); // 0.5s ease
    // subject center (avg bbox center over the window), normalized
    const win = (trk.frames as any[]).filter((f) => f.t_ms >= fg.in_ms && f.t_ms <= fg.out_ms);
    const cx = win.reduce((s, f) => s + (f.bbox[0] + f.bbox[2] / 2), 0) / (win.length || 1) / W;
    const cy = win.reduce((s, f) => s + (f.bbox[1] + f.bbox[3] / 2), 0) / (win.length || 1) / H;
    // z(n): 1 before window, ramp to punchZoom, hold, ramp back
    const z = `if(lt(on,${inF}),1,if(lt(on,${inF + ramp}),1+${(punchZoom - 1).toFixed(3)}*(on-${inF})/${ramp},if(lt(on,${outF - ramp}),${punchZoom},if(lt(on,${outF}),${punchZoom}-${(punchZoom - 1).toFixed(3)}*(on-${outF - ramp})/${ramp},1))))`;
    parts.push(
      `[comp]zoompan=z='${z}':x='iw*${cx.toFixed(3)}-(iw/zoom)/2':y='ih*${cy.toFixed(3)}-(ih/zoom)/2':d=1:s=${W}x${H}:fps=${fps.toFixed(2)}[pz]`,
    );
    finalLabel = "pz";
  }

  const outPath = opts.out || join(dir, "assets", `compose-${trackId}.mp4`);
  const filter = parts.join(";");
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", `[${finalLabel}]`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", fps.toFixed(2),
    outPath,
  ];
  execFileSync(ffmpeg, args, { maxBuffer: 64 * 1024 * 1024 });
  rmSync(cutoutWork, { recursive: true, force: true });

  return {
    track: trackId,
    concept: trk.concept,
    cutout: cutoutRel,
    background: bgIsMedia ? bg : `gradient(${bg || "default"})`,
    foreground_window: fg ? { in_ms: fg.in_ms, out_ms: fg.out_ms, punch_zoom: punchZoom } : null,
    render: outPath,
    note: fg
      ? `punched in ${(fg.in_ms / 1000).toFixed(1)}–${(fg.out_ms / 1000).toFixed(1)}s (subject foreground per depth pass)`
      : "no foreground window in depth data — composited without punch-in (run the depth pass)",
  };
}
