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
  // masks are sampled sparser than the video fps → HOLD the nearest mask across
  // the tracked span (snap-to-nearest), don't blank the in-between frames, or the
  // subject flickers out every few frames. Blank only OUTSIDE the tracked range.
  const firstT = withMasks[0].t_ms;
  const lastT = withMasks[withMasks.length - 1].t_ms;
  const gaps = withMasks.slice(1).map((f: any, i: number) => f.t_ms - withMasks[i].t_ms).filter((g: number) => g > 0).sort((a: number, b: number) => a - b);
  const interval = gaps.length ? gaps[gaps.length >> 1] : frameMs;
  const pad = interval; // let each end-mask cover up to one sampling interval
  const black = Buffer.alloc(mw * mh); // transparent
  const header = Buffer.from(`P5\n${mw} ${mh}\n255\n`, "ascii");
  const decoded = new Map<number, Buffer>(); // cache by mask index (reused across held frames)
  let mi = 0;
  for (let i = 0; i < total; i++) {
    const t = i * frameMs;
    while (mi + 1 < withMasks.length && Math.abs(withMasks[mi + 1].t_ms - t) <= Math.abs(withMasks[mi].t_ms - t)) mi++;
    const inSpan = t >= firstT - pad && t <= lastT + pad;
    let body = black;
    if (inSpan) {
      if (!decoded.has(mi)) decoded.set(mi, Buffer.from(decodeCocoRle(withMasks[mi].rle.counts, mh, mw)));
      body = decoded.get(mi)!;
    }
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

// Depth-aware OCCLUDER: everything that should cover inserted content = the
// subject mattes (clean edges, held across the tracked span) UNION everything
// the depth map says is at least as near as `nearZ` (poles, passers-by, any
// foreground the matte doesn't know about). Returns an RGBA .mov (original
// pixels where occluding, transparent elsewhere) to overlay on top of inserts.
function buildOccluder(ffmpeg: string, ref: Ref, idx: any, subjects: any[], nearZ: number): string {
  const { width: W, height: H, duration_ms: durMs, avg_fps: fps } = idx.probe;
  const dir = sidecarDir(ref.media);
  const work = join(tmpdir(), `occ-${basename(dir)}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const total = Math.max(1, Math.round((durMs / 1000) * fps));
  const frameMs = 1000 / fps;

  const dpath = join(dir, "assets", "depth-grids.json");
  const grids: any[] = existsSync(dpath) ? JSON.parse(readFileSync(dpath, "utf8")).frames ?? [] : [];
  const gridAt = (t: number) => grids.reduce((b, g) => (Math.abs(g.t_ms - t) < Math.abs(b.t_ms - t) ? g : b), grids[0]);
  const useDepth = grids.length > 0 && nearZ <= 1;

  // SOFT matte (person-seg anti-aliased alpha, every frame) → clean feathered
  // subject edges. Falls back to the binary tracklet masks if not present.
  const softMatte = subjects.map((s: any) => s.soft_matte).find(Boolean)
    ?? (existsSync(join(dir, "assets", "matte-person.mov")) ? join(dir, "assets", "matte-person.mov") : null);
  const softFps = subjects.map((s: any) => s.soft_matte_fps).find((f: any) => typeof f === "number") ?? fps;

  const occluder = join(work, "occluder.mov");
  const gw = grids[0]?.w ?? 0, gh = grids[0]?.h ?? 0;

  if (softMatte) {
    // depth-band PGMs at grid res (small); subject alpha comes from the .mov
    if (useDepth) {
      const dh = Buffer.from(`P5\n${gw} ${gh}\n255\n`, "ascii");
      for (let i = 0; i < total; i++) {
        const g = gridAt(i * frameMs); const buf = Buffer.from(g.f32, "base64");
        const band = Buffer.alloc(gw * gh);
        for (let j = 0; j < gw * gh; j++) if (buf.readFloatLE(j * 4) >= nearZ) band[j] = 255;
        writeFileSync(join(work, `d-${String(i).padStart(6, "0")}.pgm`), Buffer.concat([dh, band]));
      }
    }
    const inputs = ["-i", ref.media, "-i", softMatte];
    // subject matte stays CRISP (it's a real alpha); only the coarse depth band
    // gets softened, then unioned — no blur on the subject edge.
    let f = `[1:v]fps=${fps.toFixed(4)},scale=${W}:${H},format=gray[sm]`;
    if (useDepth) {
      inputs.push("-framerate", fps.toFixed(4), "-i", join(work, "d-%06d.pgm"));
      f += `;[2:v]scale=${W}:${H}:flags=bilinear,format=gray,gblur=sigma=1.2[dm];[sm][dm]blend=all_mode=lighten[a]`;
    } else { f += `;[sm]copy[a]`; }
    f += `;[0:v]scale=${W}:${H}[v];[v][a]alphamerge[out]`;
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs,
      "-filter_complex", f, "-map", "[out]", "-frames:v", String(total),
      "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an", occluder]);
    return occluder;
  }

  // fallback: binary subject masks ∪ depth, unioned per-pixel in JS
  const subj = subjects.map((t: any) => {
    const wm = (t.frames ?? []).filter((f: any) => f.rle);
    return { wm, first: wm[0]?.t_ms ?? 0, last: wm[wm.length - 1]?.t_ms ?? 0, cache: new Map<number, Uint8Array>(), mi: 0,
             mw: wm[0]?.rle?.size?.[1] ?? W, mh: wm[0]?.rle?.size?.[0] ?? H };
  }).filter((s: any) => s.wm.length);
  const header = Buffer.from(`P5\n${W} ${H}\n255\n`, "ascii");
  for (let i = 0; i < total; i++) {
    const t = i * frameMs; const occ = new Uint8Array(W * H);
    for (const s of subj) {
      while (s.mi + 1 < s.wm.length && Math.abs(s.wm[s.mi + 1].t_ms - t) <= Math.abs(s.wm[s.mi].t_ms - t)) s.mi++;
      const interval = s.wm.length > 1 ? (s.last - s.first) / (s.wm.length - 1) : frameMs;
      if (t < s.first - interval || t > s.last + interval) continue;
      if (!s.cache.has(s.mi)) s.cache.set(s.mi, decodeCocoRle(s.wm[s.mi].rle.counts, s.mh, s.mw));
      const m = s.cache.get(s.mi)!;
      for (let y = 0; y < H; y++) { const my = Math.min(s.mh - 1, (y * s.mh / H) | 0);
        for (let x = 0; x < W; x++) { if (m[my * s.mw + ((x * s.mw / W) | 0)]) occ[y * W + x] = 255; } }
    }
    if (useDepth) { const g = gridAt(t); const buf = Buffer.from(g.f32, "base64");
      for (let y = 0; y < H; y++) { const gy = Math.min(g.h - 1, (y * g.h / H) | 0);
        for (let x = 0; x < W; x++) { if (occ[y * W + x]) continue; const gx = Math.min(g.w - 1, (x * g.w / W) | 0);
          if (buf.readFloatLE((gy * g.w + gx) * 4) >= nearZ) occ[y * W + x] = 255; } } }
    writeFileSync(join(work, `o-${String(i).padStart(6, "0")}.pgm`), Buffer.concat([header, Buffer.from(occ)]));
  }
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y",
    "-i", ref.media, "-framerate", fps.toFixed(4), "-i", join(work, "o-%06d.pgm"),
    "-filter_complex", `[1:v]format=gray,gblur=sigma=1.6[a];[0:v]scale=${W}:${H}[v];[v][a]alphamerge[out]`,
    "-map", "[out]", "-frames:v", String(total), "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an", occluder]);
  return occluder;
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

// ── G2: z-composite — put content BEHIND the subject ─────────────────
// [original frame] → [inserted text/graphic] → [subject cutout on top]. The
// subject occludes the inserted layer, so a title reads as being *behind* the
// person. Split-screen/side-by-side are trivial special cases of layering.
function drawtextEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’").replace(/%/g, "\\%");
}
const SYS_FONT = "/System/Library/Fonts/Helvetica.ttc";

// drawtext needs libfreetype — the bundled static ffmpeg has it, dev homebrew
// often doesn't. Prefer whichever advertises drawtext.
function ffmpegWithDrawtext(): string {
  const cands = [join(PROJECT, "vendor", "ffmpeg", "ffmpeg"), resolveFfmpeg(PROJECT)].filter(Boolean) as string[];
  for (const ff of cands) {
    if (!existsSync(ff)) continue;
    const r = spawnSync(ff, ["-hide_banner", "-filters"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if ((r.stdout ?? "").includes(" drawtext ")) return ff;
  }
  throw new Error("no ffmpeg with drawtext (libfreetype) — the bundled static ffmpeg has it; run: just vendor-ffmpeg");
}

// Put content BEHIND the subject(s) — depth-aware. Occlusion = the subject
// mattes (clean edges) UNION everything the depth map says is at least as near
// as the subjects (poles, passers-by, foreground the matte doesn't track). No
// z-number: "behind the people" is the whole interface. trackId omitted or
// "people" → behind every detected subject.
export function composeBehind(
  ref: Ref,
  trackId?: string,
  opts: { text?: string; image?: string; out?: string; fontSize?: number; color?: string; pos?: string; depth?: string } = {},
): any {
  const ffmpeg = opts.text ? ffmpegWithDrawtext() : (resolveFfmpeg(PROJECT) as string);
  if (!ffmpeg) throw new Error("ffmpeg not found");
  if (!opts.text && !opts.image) throw new Error("behind needs --text \"…\" or --image <path>");
  const idx = readIndex(ref);
  const { width: W, height: H } = idx.probe;
  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });

  const all = readTracks(ref).filter((t: any) => (t.frames ?? []).some((f: any) => f.rle));
  const subjects = (trackId && trackId !== "people") ? all.filter((t: any) => t.id === trackId) : all;
  if (!subjects.length) throw new Error("no subject masks — run `video pass <ref> segment --run` (people) or `sam31 --box` (anything)");
  // The subject matte is clean on its own, so depth occlusion is OPT-IN
  // (--depth on) — it's only for catching foreground objects (poles, passers-by)
  // that the matte doesn't track. Default off = no depth speckle on the text.
  const hasDepth = opts.depth === "on" && existsSync(join(dir, "assets", "depth-grids.json"));
  const zs = subjects.map((t: any) => t.depth?.z).filter((z: any) => typeof z === "number");
  const zmed = zs.length ? [...zs].sort((a, b) => a - b)[zs.length >> 1] : 0.5;
  // only occlude things CLEARLY nearer than the subject (true foreground) — not
  // background at ~the subject's own depth, which is what speckled the text.
  const nearZ = hasDepth ? Math.min(1, zmed + 0.08) : 2.0; // 2.0 = depth term never fires
  const out = opts.out ?? join(dir, "assets", `behind.mp4`);
  const occluder = buildOccluder(ffmpeg, ref, idx, subjects, nearZ);

  const pos = opts.pos ?? "center";
  const yExpr = pos === "lower-third" ? "h*0.68-text_h/2" : pos === "upper-third" ? "h*0.30-text_h/2" : "(h-text_h)/2";
  const yImg = pos === "lower-third" ? "H*0.60" : pos === "upper-third" ? "H*0.10" : "(H-h)/2";
  const inputs = ["-i", ref.media, "-i", occluder];
  let mid: string;
  if (opts.image) {
    inputs.push("-i", opts.image);
    mid = `[2:v]scale=${Math.round(W * 0.5)}:-1[g];[0:v][g]overlay=(W-w)/2:${yImg}[mid]`;
  } else {
    const fs = opts.fontSize ?? Math.round(H / 7);
    mid = `[0:v]drawtext=fontfile='${SYS_FONT}':text='${drawtextEscape(opts.text!)}':fontsize=${fs}:fontcolor=${opts.color ?? "white"}:x=(w-text_w)/2:y=${yExpr}:borderw=2:bordercolor=black@0.4[mid]`;
  }
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs,
    "-filter_complex", `${mid};[mid][1:v]overlay=0:0:format=auto[vout]`, "-map", "[vout]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", out], { maxBuffer: 512 * 1024 * 1024 });
  rmSync(join(occluder, ".."), { recursive: true, force: true });
  return {
    behind: opts.text ? `text "${opts.text}"` : `image ${opts.image}`,
    subjects: subjects.map((s: any) => ({ track: s.id, concept: s.concept, z: s.depth?.z })),
    depth_aware: hasDepth, near_z: hasDepth ? Number(nearZ.toFixed(3)) : null, render: out,
  };
}

// ── G4/G5: depth-layer decomposition + arbitrary z-index compositing ──
// zCompose generalizes composeBehind: insert content at depth z (0=far…1=near);
// every subject NEARER than z (from the depth pass) composites on top of it, so
// the content is correctly occluded by nearer objects and covers farther ones.
// One subject at z=0.83 + insert z=0.5 → "behind the person". Two subjects at
// different depths + insert between them → content weaves between them.
export function zCompose(
  ref: Ref,
  opts: { text?: string; image?: string; z?: number; out?: string; fontSize?: number; color?: string; pos?: string } = {},
): any {
  const ffmpeg = opts.text ? ffmpegWithDrawtext() : resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found");
  if (!opts.text && !opts.image) throw new Error("zcompose needs --text or --image");
  const idx = readIndex(ref);
  const { width: W, height: H } = idx.probe;
  const insertZ = opts.z ?? 0.5;
  // subjects nearer than the insert depth → they occlude the content
  const front = readTracks(ref).filter((t: any) => (t.depth?.z ?? 1) >= insertZ && (t.frames ?? []).some((f: any) => f.rle));
  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const out = opts.out ?? join(dir, "assets", `zcompose.mp4`);

  const cutouts = front.map((t) => buildAlignedCutout(ffmpeg, ref, t, idx));
  const inputs: string[] = ["-i", ref.media];
  for (const c of cutouts) inputs.push("-i", c);

  const pos = opts.pos ?? "center";
  const yExpr = pos === "lower-third" ? "h*0.68-text_h/2" : pos === "upper-third" ? "h*0.30-text_h/2" : "(h-text_h)/2";
  const yImg = pos === "lower-third" ? "H*0.60" : pos === "upper-third" ? "H*0.10" : "(H-h)/2";
  let filter: string;
  if (opts.image) {
    inputs.push("-i", opts.image);
    filter = `[${1 + cutouts.length}:v]scale=${Math.round(W * 0.5)}:-1[g];[0:v][g]overlay=(W-w)/2:${yImg}[mid0]`;
  } else {
    const fs = opts.fontSize ?? Math.round(H / 7);
    filter = `[0:v]drawtext=fontfile='${SYS_FONT}':text='${drawtextEscape(opts.text!)}':fontsize=${fs}:fontcolor=${opts.color ?? "white"}:x=(w-text_w)/2:y=${yExpr}:borderw=2:bordercolor=black@0.4[mid0]`;
  }
  // overlay each front subject on top of the inserted content, in far→near order
  const ordered = front.map((t, i) => ({ i, z: t.depth?.z ?? 1 })).sort((a, b) => a.z - b.z);
  let prev = "mid0";
  ordered.forEach((o, k) => { const lbl = k === ordered.length - 1 ? "vout" : `mid${k + 1}`; filter += `;[${prev}][${o.i + 1}:v]overlay=0:0[${lbl}]`; prev = lbl; });
  if (!ordered.length) filter += `;[mid0]copy[vout]`;

  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", ...inputs,
    "-filter_complex", filter, "-map", "[vout]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", out,
  ], { maxBuffer: 512 * 1024 * 1024 });
  for (const c of cutouts) rmSync(join(c, ".."), { recursive: true, force: true });
  return {
    inserted: opts.text ? `text "${opts.text}"` : `image ${opts.image}`,
    at_z: insertZ, occluded_by: front.map((t) => ({ track: t.id, concept: t.concept, z: t.depth?.z })),
    render: out,
  };
}

// ── G6: authorable layer spec → render ───────────────────────────────
// A composable spec (agent- or HyperFrames-authored) of inserts at depths:
//   { "inserts": [ {"z":0.5,"text":"ESCAPE","pos":"center","fontSize":130},
//                  {"z":0.95,"image":"logo.png","pos":"lower-third"} ] }
// Rendered far→near: at each insert we overlay it, then re-overlay every subject
// nearer than it — so the whole stack (bg · far inserts · subjects · near
// inserts) composites with correct occlusion in one pass.
export function zRender(ref: Ref, spec: { inserts: any[]; out?: string }): any {
  const inserts = (spec.inserts ?? []).slice().sort((a, b) => (a.z ?? 0.5) - (b.z ?? 0.5));
  if (!inserts.length) throw new Error("spec has no inserts");
  const needsText = inserts.some((i) => i.text);
  const ffmpeg = needsText ? ffmpegWithDrawtext() : (resolveFfmpeg(PROJECT) as string);
  const idx = readIndex(ref);
  const { width: W, height: H } = idx.probe;
  const subjects = readTracks(ref)
    .filter((t: any) => (t.frames ?? []).some((f: any) => f.rle))
    .map((t: any) => ({ trk: t, z: t.depth?.z ?? 1 }));
  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const out = spec.out ?? join(dir, "assets", "zrender.mp4");

  const inputs: string[] = ["-i", ref.media];
  const cutouts = subjects.map((s) => buildAlignedCutout(ffmpeg, ref, s.trk, idx));
  for (const c of cutouts) inputs.push("-i", c);       // [1..S] subject cutouts
  const imgBase = 1 + cutouts.length;
  const imgInserts = inserts.filter((i) => i.image);
  for (const im of imgInserts) inputs.push("-i", im.image);  // [imgBase..] images

  const yT = (p: string) => (p === "lower-third" ? "h*0.68-text_h/2" : p === "upper-third" ? "h*0.30-text_h/2" : "(h-text_h)/2");
  const yI = (p: string) => (p === "lower-third" ? "H*0.60" : p === "upper-third" ? "H*0.10" : "(H-h)/2");
  let cur = "0:v"; let step = 0; let imgN = 0; const parts: string[] = [];
  for (const ins of inserts) {
    const insLbl = `s${step}`;
    if (ins.image) {
      const gi = imgBase + imgN++;
      parts.push(`[${gi}:v]scale=${Math.round(W * (ins.scale ?? 0.5))}:-1[g${step}]`);
      parts.push(`[${cur}][g${step}]overlay=(W-w)/2:${yI(ins.pos ?? "center")}[${insLbl}]`);
    } else {
      const fs = ins.fontSize ?? Math.round(H / 7);
      parts.push(`[${cur}]drawtext=fontfile='${SYS_FONT}':text='${drawtextEscape(ins.text)}':fontsize=${fs}:fontcolor=${ins.color ?? "white"}:x=(w-text_w)/2:y=${yT(ins.pos ?? "center")}:borderw=2:bordercolor=black@0.4[${insLbl}]`);
    }
    cur = insLbl; step++;
    // bring forward every subject nearer than this insert
    subjects.forEach((s, si) => {
      if (s.z >= (ins.z ?? 0.5)) { const l = `s${step}`; parts.push(`[${cur}][${si + 1}:v]overlay=0:0[${l}]`); cur = l; step++; }
    });
  }
  const filter = parts.join(";").replace(new RegExp(`\\[${cur}\\]$`), "[vout]");
  const finalFilter = parts.length ? `${parts.join(";")};[${cur}]copy[vout]` : "[0:v]copy[vout]";
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", finalFilter, "-map", "[vout]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", out], { maxBuffer: 512 * 1024 * 1024 });
  for (const c of cutouts) rmSync(join(c, ".."), { recursive: true, force: true });
  return { inserts: inserts.map((i) => ({ z: i.z, what: i.text ?? i.image })), subjects: subjects.map((s) => ({ track: s.trk.id, z: s.z })), render: out };
}
