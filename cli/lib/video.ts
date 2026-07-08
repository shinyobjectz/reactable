// Footage intelligence — the <asset>.intel/ sidecar (schema footage-intel/1).
// Spec: docs/PLAN.footage-intel.work. Market intel (.reactable/intel/) is a
// different lane — this file is perception of the pixels.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { DATA_ROOT, PROJECT, takePath } from "./paths.ts";
import { runTools, resolveFfmpeg } from "./tools.ts";

export const SCHEMA = "footage-intel/1";
const MEDIA_EXT = new Set([".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi"]);
const SHOT_THRESHOLD = 0.3;
const MIN_SHOT_MS = 800;

// ── refs ──────────────────────────────────────────────────────────────

export type Ref = {
  media: string; // absolute path to the video file
  take?: string; // take id when ref was a take
  events?: string; // absolute path to events.jsonl when present
};

export function resolveRef(ref: string, root = DATA_ROOT): Ref {
  if (ref.startsWith("take-")) {
    const dir = takePath(ref, root);
    const media = join(dir, "stage.mov");
    if (!existsSync(media)) {
      throw new Error(`take ${ref} has no stage.mov — record first, or pass a media path`);
    }
    const events = join(dir, "events.jsonl");
    return { media, take: ref, events: existsSync(events) ? events : undefined };
  }
  const media = resolve(root, ref);
  if (!existsSync(media)) throw new Error(`no such file: ${media}`);
  if (!MEDIA_EXT.has(extname(media).toLowerCase())) {
    throw new Error(`not a video file: ${media}`);
  }
  const events = join(dirname(media), "events.jsonl");
  return { media, events: existsSync(events) ? events : undefined };
}

export function sidecarDir(media: string): string {
  const base = basename(media, extname(media));
  return join(dirname(media), `${base}.intel`);
}

export function readIndex(ref: Ref): any {
  const p = join(sidecarDir(ref.media), "index.json");
  if (!existsSync(p)) {
    throw new Error(
      `not indexed — reactable video index ${ref.take ?? relative(DATA_ROOT, ref.media)}`,
    );
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

// ── timecode ──────────────────────────────────────────────────────────

export function msToSmpte(ms: number, fps: number, dropFrame = false): string {
  const rate = Math.round(fps);
  let frame = Math.round((ms / 1000) * fps);
  if (dropFrame && (rate === 30 || rate === 60)) {
    const dropPerMin = rate === 30 ? 2 : 4;
    const framesPerMin = rate * 60 - dropPerMin;
    const framesPer10Min = framesPerMin * 10 + dropPerMin;
    const d = Math.floor(frame / framesPer10Min);
    let m = frame % framesPer10Min;
    if (m < dropPerMin) m = dropPerMin;
    frame += dropPerMin * 9 * d + dropPerMin * Math.floor((m - dropPerMin) / framesPerMin);
  }
  const f = frame % rate;
  const totalSec = Math.floor(frame / rate);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const sep = dropFrame ? ";" : ":";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(f)}`;
}

function msToClock(ms: number): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

// SMPTE frame numbers are only meaningful for CFR at a standard rate; screen
// captures are VFR (frames only on change), so fall back to HH:MM:SS.mmm.
function tc(ms: number, idx: any): string {
  const fps = idx?.probe?.avg_fps || 30;
  const standard = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].some((r) => Math.abs(fps - r) < 0.02);
  if (idx?.probe?.vfr || !standard) return msToClock(ms);
  return msToSmpte(ms, fps, idx?.probe?.drop_frame || false);
}

// ── T0: probe · shots · transcript · ocr ──────────────────────────────

function ffprobeJson(ffprobe: string, media: string): any {
  const out = execFileSync(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", media],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function parseRate(r?: string): number {
  if (!r) return 0;
  const [a, b] = r.split("/").map(Number);
  return b ? a / b : a;
}

function sha256Head(path: string): string {
  // hash first 8MB + size — content identity without reading multi-GB files
  const fd = readFileSync(path).subarray(0, 8 * 1024 * 1024);
  const h = createHash("sha256");
  h.update(fd);
  h.update(String(statSync(path).size));
  return h.digest("hex");
}

function detectShots(ffmpeg: string, media: string, durationMs: number): { in_ms: number; out_ms: number }[] {
  const r = spawnSync(
    ffmpeg,
    ["-hide_banner", "-i", media, "-vf", `select='gt(scene,${SHOT_THRESHOLD})',metadata=print:file=-`, "-an", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const cuts: number[] = [];
  for (const line of (r.stdout || "").split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) cuts.push(Math.round(parseFloat(m[1]) * 1000));
  }
  const bounds = [0, ...cuts.filter((c) => c > MIN_SHOT_MS && c < durationMs - MIN_SHOT_MS), durationMs];
  const shots: { in_ms: number; out_ms: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] < MIN_SHOT_MS && shots.length) {
      shots[shots.length - 1].out_ms = bounds[i + 1];
    } else {
      shots.push({ in_ms: bounds[i], out_ms: bounds[i + 1] });
    }
  }
  return shots.length ? shots : [{ in_ms: 0, out_ms: durationMs }];
}

function extractKeyframes(ffmpeg: string, media: string, shots: { in_ms: number; out_ms: number }[], assetsDir: string): string[] {
  mkdirSync(assetsDir, { recursive: true });
  const files: string[] = [];
  shots.forEach((s, i) => {
    const mid = (s.in_ms + s.out_ms) / 2000;
    const out = join(assetsDir, `kf-s${i}.jpg`);
    spawnSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", mid.toFixed(3), "-i", media,
      "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", out,
    ], { encoding: "utf8" });
    files.push(existsSync(out) ? out : "");
  });
  return files;
}

function transcribe(ffmpeg: string, media: string, probe: any, workDir: string): any {
  if (!probe?.audio) return null;
  const wav = join(workDir, "audio-16k.wav");
  spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", media, "-ac", "1", "-ar", "16000", wav], { encoding: "utf8" });
  if (!existsSync(wav)) return null;

  const ggml = process.env.REACTABLE_WHISPER_MODEL;
  if (ggml && existsSync(ggml)) {
    // exact word timing via whisper.cpp token timestamps
    const r = spawnSync("whisper-cli", ["-m", ggml, "-f", wav, "-ojf", "-of", join(workDir, "whisper"), "-np"], { encoding: "utf8" });
    const p = join(workDir, "whisper.json");
    if (r.status === 0 && existsSync(p)) {
      const w = JSON.parse(readFileSync(p, "utf8"));
      const words: any[] = [];
      const segments: any[] = [];
      for (const seg of w.transcription ?? []) {
        segments.push({ in_ms: seg.offsets.from, out_ms: seg.offsets.to, text: seg.text.trim() });
        for (const t of seg.tokens ?? []) {
          const txt = (t.text || "").trim();
          if (!txt || txt.startsWith("[_")) continue;
          words.push({ w: txt, in_ms: t.offsets.from, out_ms: t.offsets.to, p: t.p });
        }
      }
      return { model: `whisper.cpp/${basename(ggml)}`, timing: "exact", lang: w.result?.language ?? "en", words, segments };
    }
  }

  const r = runTools(["transcribe", wav], PROJECT, true);
  const p = wav.replace(/\.wav$/, ".transcript.json");
  if (r.status !== 0 || !existsSync(p)) return null;
  const t = JSON.parse(readFileSync(p, "utf8"));
  const words = (t.words ?? []).map((w: any) => ({
    w: w.word ?? w.text ?? w.w,
    in_ms: Math.round((w.start ?? 0) * 1000),
    out_ms: Math.round((w.end ?? 0) * 1000),
  }));
  // synthesize segments from word runs (~8s buckets at word boundaries)
  const segments: any[] = [];
  let cur: any = null;
  for (const w of words) {
    if (!cur || w.in_ms - cur.in_ms > 8000) {
      cur = { in_ms: w.in_ms, out_ms: w.out_ms, text: w.w };
      segments.push(cur);
    } else {
      cur.out_ms = w.out_ms;
      cur.text += ` ${w.w}`;
    }
  }
  return { model: t.engine ?? "moonshine", timing: "approx", lang: "en", words, segments };
}

function ocrKeyframes(keyframes: string[], shots: { in_ms: number; out_ms: number }[]): any[] {
  const imgs = keyframes.filter(Boolean);
  if (!imgs.length) return [];
  // Prefer the compiled native tool (Vision, no swift-interpreter dep); fall
  // back to the swift-script only if the binary isn't built yet.
  const vbin = nativeVisionBin();
  let r;
  if (vbin) {
    r = spawnSync(vbin, ["ocr", ...imgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } else {
    const script = join(PROJECT, "scripts", "ocr-frames.swift");
    if (!existsSync(script)) return [];
    r = spawnSync("swift", [script, ...imgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  }
  if (r.status !== 0) return [];
  let parsed: any[];
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return [];
  }
  const byFile = new Map(parsed.map((e: any) => [e.file, e.items]));
  const out: any[] = [];
  keyframes.forEach((kf, i) => {
    const items = byFile.get(kf);
    if (items?.length) out.push({ t_ms: Math.round((shots[i].in_ms + shots[i].out_ms) / 2), shot: `s${i}`, items });
  });
  return out;
}

// ── index (T0) ────────────────────────────────────────────────────────

export function indexT0(ref: Ref, root = DATA_ROOT): any {
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found — brew install ffmpeg");
  const ffprobe = join(dirname(ffmpeg), "ffprobe");

  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "embeddings"), { recursive: true });

  const raw = ffprobeJson(existsSync(ffprobe) ? ffprobe : "ffprobe", ref.media);
  const v = raw.streams.find((s: any) => s.codec_type === "video");
  const a = raw.streams.find((s: any) => s.codec_type === "audio");
  if (!v) throw new Error(`no video stream in ${ref.media}`);
  const durationMs = Math.round(parseFloat(raw.format.duration ?? v.duration ?? "0") * 1000);
  const avgFps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 30;
  const probe = {
    duration_ms: durationMs,
    width: v.width,
    height: v.height,
    avg_fps: Number(avgFps.toFixed(3)),
    nominal_fps: v.r_frame_rate,
    vfr: v.avg_frame_rate !== v.r_frame_rate,
    drop_frame: Math.abs(avgFps - 29.97) < 0.01 || Math.abs(avgFps - 59.94) < 0.01,
    time_base: v.time_base,
    start_pts: v.start_pts ?? 0,
    audio: a ? { sample_rate: Number(a.sample_rate), channels: a.channels } : null,
  };

  const shotsRaw = detectShots(ffmpeg, ref.media, durationMs);
  const keyframes = extractKeyframes(ffmpeg, ref.media, shotsRaw, join(dir, "assets"));
  const shots = shotsRaw.map((s, i) => ({
    id: `s${i}`,
    in_ms: s.in_ms,
    out_ms: s.out_ms,
    keyframe: keyframes[i] ? join("assets", basename(keyframes[i])) : null,
    caption: null,
    caption_model: null,
  }));

  const transcript = transcribe(ffmpeg, ref.media, probe, dir);
  const ocr = ocrKeyframes(keyframes, shotsRaw);

  const index = {
    schema: SCHEMA,
    source: {
      file: relative(dir, ref.media),
      sha256: sha256Head(ref.media),
      bytes: statSync(ref.media).size,
    },
    probe,
    shots,
    transcript,
    ocr,
    events: ref.events ? { source: relative(dir, ref.events), clock_offset_ms: 0 } : null,
    passes: {
      t0: {
        at: new Date().toISOString(),
        tools: { shots: `ffmpeg scene>${SHOT_THRESHOLD}`, transcript: transcript?.model ?? null, ocr: ocr.length ? "apple-vision" : null },
      },
      t1: null,
      sam31: null,
      depth: null,
    },
  };
  writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}

// ── T1: embeddings (native MobileCLIP on the ANE, or uv/torch fallback) ─
// Native is the default: reactable-vision embed/embed-text. The uv/torch
// SigLIP path (footage-embed.py) is the fallback for non-Apple-Silicon.

const UV_ARGS = ["run", "--with", "torch", "--with", "torchvision", "--with", "transformers", "--with", "pillow", "--with", "numpy", join(PROJECT, "scripts", "footage-embed.py")];

function runEmbedTool(args: string[]): any {
  const r = spawnSync("uv", [...UV_ARGS, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`footage-embed failed: ${(r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" · ")}`);
  }
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
  const out = JSON.parse(line);
  if (out.error) throw new Error(out.error);
  return out;
}

export function indexT1(ref: Ref): any {
  const dir = sidecarDir(ref.media);
  readIndex(ref); // t0 must exist
  const vbin = nativeVisionBin();
  if (vbin && appleSilicon()) {
    const r = spawnSync(vbin, ["embed", dir], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.status === 0) {
      const line = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
      return { ...JSON.parse(line), lane: "native-ane" };
    }
    console.error(`native embed failed (${r.status}); trying uv/torch fallback…`);
  }
  return runEmbedTool(["t1", dir]);
}

// Which embedding backend is present (native mobileclip vs uv siglip2)?
function embedBackend(dir: string): "native" | "siglip" | null {
  if (existsSync(join(dir, "embeddings", "mobileclip.meta.json"))) return "native";
  if (existsSync(join(dir, "embeddings", "siglip2.meta.json"))) return "siglip";
  return null;
}

function embedQuery(ref: Ref, query: string, topk = 5): any[] {
  const dir = sidecarDir(ref.media);
  const backend = embedBackend(dir);
  if (!backend) return [];
  try {
    if (backend === "native") {
      const vbin = nativeVisionBin();
      if (!vbin) return [];
      const r = spawnSync(vbin, ["embed-text", dir, query, "--topk", String(topk)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      if (r.status !== 0) return [];
      return (JSON.parse(r.stdout).hits ?? []);
    }
    return runEmbedTool(["query", dir, query, String(topk)]).hits ?? [];
  } catch {
    return [];
  }
}

// ── queries ───────────────────────────────────────────────────────────

export function find(ref: Ref, query: string, opts: { visual?: boolean } = {}): any {
  const idx = readIndex(ref);
  const q = query.toLowerCase();
  const hits: any[] = [];

  if (opts.visual !== false) {
    for (const h of embedQuery(ref, query)) {
      if (h.score < 0.05) continue; // siglip sigmoid space — scores are low; keep it conservative
      hits.push({ t_ms: h.t_ms, tc: tc(h.t_ms, idx), source: "visual", score: h.score, shot: h.shot });
    }
  }

  for (const seg of idx.transcript?.segments ?? []) {
    if (seg.text?.toLowerCase().includes(q)) {
      hits.push({ t_ms: seg.in_ms, tc: tc(seg.in_ms, idx), source: "transcript", quote: seg.text.trim(), timing: idx.transcript.timing });
    }
  }
  for (const frame of idx.ocr ?? []) {
    for (const item of frame.items) {
      if (item.text.toLowerCase().includes(q)) {
        hits.push({ t_ms: frame.t_ms, tc: tc(frame.t_ms, idx), source: "ocr", quote: item.text, shot: frame.shot });
      }
    }
  }
  for (const shot of idx.shots ?? []) {
    if (shot.caption?.toLowerCase().includes(q)) {
      hits.push({ t_ms: shot.in_ms, tc: tc(shot.in_ms, idx), source: "caption", quote: shot.caption, shot: shot.id });
    }
  }
  for (const trk of readTracks(ref)) {
    if (trk.concept?.toLowerCase().includes(q)) {
      hits.push({ t_ms: trk.in_ms, tc: tc(trk.in_ms, idx), source: `track/${trk.pass}`, quote: trk.concept, track: trk.id });
    }
  }
  // motion layer: camera-move labels + cut-on-action points
  const motion = idx.passes?.motion;
  if (motion) {
    for (const cm of motion.camera_moves ?? []) {
      if (cameraMoveMatches(q, cm.move)) {
        const sh = (idx.shots ?? []).find((s: any) => s.id === cm.shot);
        hits.push({ t_ms: sh?.in_ms ?? 0, tc: tc(sh?.in_ms ?? 0, idx), source: "motion/camera", quote: cm.move, shot: cm.shot });
      }
    }
    if (/\b(action|motion|cut|peak|movement|moment)\b/.test(q)) {
      for (const c of motion.cut_points ?? []) {
        hits.push({ t_ms: c.t_ms, tc: tc(c.t_ms, idx), source: "motion/action", quote: `motion peak (${c.mag})` });
      }
    }
  }
  hits.sort((x, y) => x.t_ms - y.t_ms);
  return { query, media: idx.source.file, hits, searched: searchedLayers(idx) };
}

// match a text query against a camera-move label ("pan-left" etc.)
function cameraMoveMatches(q: string, move: string): boolean {
  if (!move) return false;
  const words = move.replace("-", " ");
  if (q.includes(move) || q.includes(words)) return true;
  if (q === "camera" || q === "camera move" || q === "camera movement") return move !== "static";
  for (const fam of ["pan", "tilt", "zoom"]) if (q.includes(fam) && move.startsWith(fam)) return true;
  if ((q === "shaky" || q === "shake" || q === "handheld") && move === "shaky") return true;
  if ((q === "static" || q === "still" || q === "locked") && move === "static") return true;
  return false;
}

function searchedLayers(idx: any): string[] {
  const layers = ["shots"];
  if (idx.transcript) layers.push("transcript");
  if (idx.ocr?.length) layers.push("ocr");
  if (idx.passes?.t1) layers.push("captions", "visual");
  else layers.push("captions+visual:missing — reactable video index <ref> --tier t1");
  if (idx.passes?.motion) layers.push("motion (camera-moves + cut-on-action)");
  return layers;
}

export function at(ref: Ref, ms: number): any {
  const idx = readIndex(ref);
  const shot = (idx.shots ?? []).find((s: any) => ms >= s.in_ms && ms < s.out_ms) ?? null;
  const segment = (idx.transcript?.segments ?? []).find((s: any) => ms >= s.in_ms && ms <= s.out_ms) ?? null;
  const ocr = (idx.ocr ?? []).find((f: any) => shot && f.shot === shot.id) ?? null;
  const tracks = readTracks(ref).filter((t) => ms >= t.in_ms && ms <= t.out_ms);

  let events: any[] = [];
  if (ref.events && idx.events) {
    const offset = idx.events.clock_offset_ms ?? 0;
    events = readFileSync(ref.events, "utf8")
      .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => typeof e.t === "number" && Math.abs(e.t * 1000 + offset - ms) <= 1000);
  }
  const motion = idx.passes?.motion;
  const cameraMove = motion && shot ? (motion.camera_moves ?? []).find((cm: any) => cm.shot === shot.id) ?? null : null;
  const cutPoint = motion ? (motion.cut_points ?? []).find((c: any) => Math.abs(c.t_ms - ms) <= 500) ?? null : null;
  return { t_ms: ms, tc: tc(ms, idx), shot, segment, ocr, tracks, camera_move: cameraMove, cut_point: cutPoint, events };
}

export function readTracks(ref: Ref): any[] {
  const p = join(sidecarDir(ref.media), "tracks.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── sweep: index everything un-indexed in the project ────────────────

export function sweep(root = DATA_ROOT): { indexed: string[]; skipped: number; failed: { media: string; error: string }[] } {
  const candidates: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.endsWith(".intel") || e.name.startsWith(".") || e.name === "node_modules" || e.name === "hyperframes" || e.name === "out") continue;
        walk(p, depth + 1);
      } else if (MEDIA_EXT.has(extname(e.name).toLowerCase())) {
        candidates.push(p);
      }
    }
  };
  walk(join(root, "takes"), 0);
  walk(join(root, "assets"), 0);

  const indexed: string[] = [];
  const failed: { media: string; error: string }[] = [];
  let skipped = 0;
  for (const media of candidates) {
    const idxPath = join(sidecarDir(media), "index.json");
    if (existsSync(idxPath) && statSync(idxPath).mtimeMs >= statSync(media).mtimeMs) {
      skipped++;
      continue;
    }
    try {
      const events = join(dirname(media), "events.jsonl");
      indexT0({ media, events: existsSync(events) ? events : undefined });
      indexed.push(relative(root, media));
    } catch (e: any) {
      failed.push({ media: relative(root, media), error: String(e?.message ?? e) });
    }
  }
  return { indexed, skipped, failed };
}

// ── passes (GPU lane lands in P2 — queue + honest error) ──────────────

const PASS_KINDS = new Set(["sam31", "depth", "matte", "motion", "vjepa"]);

export function estimatePass(ref: Ref, kind: string): any {
  const idx = readIndex(ref);
  const durS = idx.probe.duration_ms / 1000;
  const frames = Math.round(durS * idx.probe.avg_fps);
  const cap = kind === "sam31" ? 90 : kind === "motion" ? 300 : 120;
  // native ANE lane (depth): runs on the Neural Engine — free + cool, no gate.
  if (nativeVisionBin() && appleSilicon() && NATIVE_ANE_KINDS.has(kind) && process.env.REACTABLE_FOOTAGE_CLOUD !== "1") {
    return {
      kind, duration_s: Math.round(durS), frames, gpu: "Apple Neural Engine", lane: "native-ane",
      est_usd: 0, basis: "on-device", sampled_frames: Math.min(cap, frames),
      note: "runs on the ANE (~10% CPU, cool, no per-call cost)",
    };
  }
  if (localMlxUsable()) {
    const { freeGib } = localFree();
    // Runs on the Mac GPU (MLX/MPS) — no per-call cost, capped + low-priority.
    return {
      kind, duration_s: Math.round(durS), frames, gpu: "Apple GPU (MLX)", lane: "local",
      est_usd: 0, basis: "local",
      sampled_frames: Math.min(cap, frames), free_gib: Number(freeGib.toFixed(1)),
      note: `runs on the Mac GPU, ≤${cap} frames, low priority`,
    };
  }
  // On-device app: no cloud lane. Report that the pass can't run here yet.
  return {
    kind, duration_s: Math.round(durS), frames, gpu: "on-device only", lane: "unavailable",
    est_usd: 0, basis: "unavailable",
    note: appleSilicon()
      ? (NATIVE_ANE_KINDS.has(kind) ? "native ANE tool not built (just vision)" : "local MLX runner not set up (just mlx-setup)")
      : "needs Apple Silicon",
  };
}

export function requestPass(ref: Ref, kind: string, params: Record<string, unknown>, run = false): any {
  if (!PASS_KINDS.has(kind)) throw new Error(`unknown pass "${kind}" — sam31 · depth · matte`);
  const est = estimatePass(ref, kind); // throws the teaching error when unindexed
  if (!run) {
    const req = { kind, params, estimate: est, requested_at: new Date().toISOString(), status: "queued" };
    appendFileSync(join(sidecarDir(ref.media), "passes-queue.jsonl"), JSON.stringify(req) + "\n");
    return { ...req, note: "queued — add --run to dispatch to the GPU lane now (cost above is rough)" };
  }
  return runPass(ref, kind, params, est);
}

// Footage passes run ON-DEVICE only: native CoreML/ANE first, then the guarded
// local-MLX (GPU) lane. This is a native Apple-Silicon app — there is no cloud
// GPU lane in the product. (Modal is a dev-only spike tool, never shipped.)
function localMlxPython(): string | null {
  const env = process.env.REACTABLE_MLX_PYTHON;
  if (env && existsSync(env)) return env;
  for (const p of [
    join(PROJECT, ".venv-mlx", "bin", "python"),
    join(PROJECT, "tools", ".venv-mlx", "bin", "python"),
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const appleSilicon = () => process.platform === "darwin" && process.arch === "arm64";

// Free-RAM floor for the local-MLX lane (GiB). SAM3-MLX is ~3.2GB resident +
// working set; below this we refuse rather than thrash the user's machine.
const LOCAL_MIN_FREE_GIB = 6;

// macOS *available* memory (free + speculative + inactive + purgeable), NOT
// os.freemem() — that returns only truly-idle pages (~0 on macOS) and lies.
function availableGib(): number {
  if (process.platform !== "darwin") {
    const os = require("node:os") as typeof import("node:os");
    return os.freemem() / 1024 ** 3;
  }
  try {
    const out = execFileSync("vm_stat", [], { encoding: "utf8" });
    let page = 4096;
    const pages: Record<string, number> = {};
    for (const ln of out.split("\n")) {
      const pm = ln.match(/page size of (\d+) bytes/);
      if (pm) page = Number(pm[1]);
      const m = ln.match(/^Pages (free|speculative|inactive|purgeable):\s+(\d+)/i);
      if (m) pages[m[1].toLowerCase()] = Number(m[2]);
    }
    const avail = (pages.free ?? 0) + (pages.speculative ?? 0) + (pages.inactive ?? 0) + (pages.purgeable ?? 0);
    return (avail * page) / 1024 ** 3;
  } catch {
    return Infinity; // can't measure → don't block the local lane on it
  }
}

function localFree(): { ok: boolean; freeGib: number } {
  const freeGib = availableGib();
  return { ok: freeGib >= LOCAL_MIN_FREE_GIB, freeGib };
}

// The guarded local-MLX (GPU) lane is usable when: Apple Silicon, a venv is
// present, and enough RAM is free (or the user forces it).
function localMlxUsable(): boolean {
  if (!appleSilicon() || !localMlxPython()) return false;
  if (process.env.REACTABLE_FOOTAGE_LOCAL === "1") return true; // force, skip RAM gate
  return localFree().ok;
}

// The native CoreML/ANE tool — the laptop-kind lane (runs on the Neural
// Engine, ~10% CPU, no Python). Depth today; SAM2 next.
function nativeVisionBin(): string | null {
  const env = process.env.REACTABLE_VISION_BIN;
  if (env && existsSync(env)) return env;
  for (const p of [
    join(PROJECT, "native", "vision", ".build", "release", "reactable-vision"),
    join(dirname(resolveFfmpeg(PROJECT) ?? ""), "reactable-vision"),
  ]) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

// depth (Depth-Anything) + sam31 (EdgeTAM box-tracking) + motion (Vision
// optical flow) + vjepa (V-JEPA 2 clip embeddings) all run natively on-device
// (ANE/GPU) — no download, no gate. vjepa uses CPU+GPU (too big for the ANE).
const NATIVE_ANE_KINDS = new Set(["depth", "sam31", "motion", "vjepa"]);

function runPass(ref: Ref, kind: string, params: Record<string, unknown>, est: any): any {
  if (kind === "matte") throw new Error("matte pass lands in footage-intel P3 — run sam31 first");
  const dir = sidecarDir(ref.media);
  const outPath = join(dir, `pass-${kind}-result.json`);

  // 1. native ANE (coolest, no deps) for the kinds we've ported
  const vbin = nativeVisionBin();
  if (vbin && appleSilicon() && NATIVE_ANE_KINDS.has(kind)) {
    try {
      return runPassAne(ref, kind, vbin, outPath, params);
    } catch (e: any) {
      console.error(`native ANE ${kind} unavailable (${e?.message ?? e}); trying local MLX…`);
    }
  }
  // 2. guarded local MLX (GPU) for kinds not yet on the ANE
  if (localMlxUsable()) {
    const py = localMlxPython()!;
    return runPassLocal(ref, kind, params, py, outPath);
  }
  // No cloud lane — this is an on-device app. Be honest about why.
  throw new Error(
    !appleSilicon()
      ? `${kind} needs Apple Silicon (on-device only — no cloud GPU lane)`
      : NATIVE_ANE_KINDS.has(kind)
        ? `${kind} native ANE tool not built — run: just vision`
        : `${kind} needs the local MLX runner (run: just mlx-setup) and ≥${LOCAL_MIN_FREE_GIB} GiB free RAM`,
  );
}

function runPassAne(ref: Ref, kind: string, bin: string, outPath: string, params: Record<string, unknown>): any {
  let args: string[];
  if (kind === "sam31") {
    // EdgeTAM box-tracking: user boxes the subject on the first frame; we
    // follow it forward (click/box UX, not text concepts — that was SAM3).
    const box = String(params.box ?? "");
    if (box.split(",").length !== 4) {
      throw new Error('sam31 tracking (EdgeTAM) needs --box "x,y,w,h" — the subject on the first frame (source px)');
    }
    const label = String(params.label ?? params.concept ?? "tracked");
    args = ["edgetam", ref.media, "--box", box, "--label", label, "--out", outPath];
    if (params["sample-fps"]) args.push("--sample-fps", String(params["sample-fps"]));
    if (params["max-frames"]) args.push("--max-frames", String(params["max-frames"]));
  } else if (kind === "vjepa") {
    // one clip embedding per shot (fall back to auto 5s windows if unshot)
    const shots = readIndex(ref).shots ?? [];
    args = ["vjepa", ref.media, "--out", outPath];
    if (shots.length) args.push("--windows", shots.map((s: any) => `${s.in_ms}:${s.out_ms}`).join(","));
  } else {
    args = [kind, ref.media, "--out", outPath];
  }
  console.error(`running ${kind} natively on the Neural Engine (ANE)…`);
  const r = spawnSync(bin, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0 || !existsSync(outPath)) throw new Error(`native ANE ${kind} exited ${r.status}`);
  const result = foldPass(ref, kind, JSON.parse(readFileSync(outPath, "utf8")));
  return { ...result, lane: "native-ane" };
}

function runPassLocal(ref: Ref, kind: string, params: Record<string, unknown>, py: string, outPath: string): any {
  const script = join(PROJECT, "scripts", "footage-mlx.py");
  if (!existsSync(script)) throw new Error("footage-mlx.py missing");
  const { freeGib } = localFree();
  const args = [script, kind === "sam31" ? "sam3" : kind, ref.media, "--out", outPath, "--min-gib", String(LOCAL_MIN_FREE_GIB - 1)];
  if (kind === "sam31") {
    const concept = String(params.concept ?? "");
    if (!concept) throw new Error('sam31 needs --concept "a,b"');
    args.push("--concepts", concept);
  }
  console.error(`running ${kind} locally on the Mac GPU (MLX) — ${freeGib.toFixed(1)} GiB free, capped + low-priority…`);
  const r = spawnSync(py, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 512 * 1024 * 1024 });
  // exit 3 = the runner's own RAM guard tripped → let the caller fall back
  if (r.status === 3) throw new Error("insufficient free RAM for local MLX");
  if (r.status !== 0 || !existsSync(outPath)) {
    throw new Error(`local MLX ${kind} exited ${r.status}`);
  }
  const result = foldPass(ref, kind, JSON.parse(readFileSync(outPath, "utf8")));
  return { ...result, lane: "local-mlx" };
}

function foldPass(ref: Ref, kind: string, result: any): any {
  const dir = sidecarDir(ref.media);
  const idx = readIndex(ref);
  if (kind === "sam31") {
    const incoming = result.tracklets ?? [];
    const incomingConcepts = new Set(incoming.map((t: any) => t.concept));
    // re-runs replace tracklets for the same concepts instead of duplicating
    const kept = readTracks(ref).filter((t) => t.pass !== "sam31" || !incomingConcepts.has(t.concept));
    const all = [...kept, ...incoming];
    writeFileSync(join(dir, "tracks.jsonl"), all.map((t) => JSON.stringify(t)).join("\n") + (all.length ? "\n" : ""));
    idx.passes.sam31 = { at: new Date().toISOString(), model: result.model, concepts: result.concepts, timing: result.timing };
    writeFileSync(join(dir, "index.json"), JSON.stringify(idx, null, 2));
    // depth ran first? zone the fresh tracklets against its grids
    const gridsPath = join(dir, "assets", "depth-grids.json");
    const zoned = existsSync(gridsPath) ? zoneTracklets(ref, JSON.parse(readFileSync(gridsPath, "utf8"))) : 0;
    return { pass: kind, tracklets: incoming.length, concepts: result.concepts, tracks_total: all.length, tracklets_zoned: zoned };
  }
  if (kind === "depth") {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "depth-grids.json"), JSON.stringify(result));
    idx.passes.depth = { at: new Date().toISOString(), model: result.model, sample_fps: result.sample_fps };
    writeFileSync(join(dir, "index.json"), JSON.stringify(idx, null, 2));
    const zoned = zoneTracklets(ref, result);
    return { pass: kind, samples: result.frames.length, model: result.model, tracklets_zoned: zoned };
  }
  if (kind === "motion") {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "motion.json"), JSON.stringify(result));
    const cameraMoves = classifyCameraMoves(idx.shots ?? [], result.frames);
    const cuts = findCutPoints(result.frames);
    const matchCuts = findMatchCuts(cameraMoves);
    idx.passes.motion = {
      at: new Date().toISOString(), model: result.model, sample_fps: result.sample_fps,
      camera_moves: cameraMoves, cut_points: cuts, match_cuts: matchCuts,
    };
    writeFileSync(join(dir, "index.json"), JSON.stringify(idx, null, 2));
    return { pass: kind, signals: result.frames.length, model: result.model, camera_moves: cameraMoves, cut_points: cuts.length, match_cuts: matchCuts.length };
  }
  if (kind === "vjepa") {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "vjepa-clips.json"), JSON.stringify(result));
    idx.passes.vjepa = { at: new Date().toISOString(), model: result.model, dim: result.dim, clips: result.clips.length };
    writeFileSync(join(dir, "index.json"), JSON.stringify(idx, null, 2));
    return { pass: kind, clips: result.clips.length, dim: result.dim, model: result.model };
  }
  return result;
}

// "find clips like this one" — cosine over stored V-JEPA clip embeddings.
// target = a shot id (s0…) or a timestamp in ms.
export function similar(ref: Ref, target: string, opts: { k?: number } = {}): any {
  const dir = sidecarDir(ref.media);
  const p = join(dir, "assets", "vjepa-clips.json");
  if (!existsSync(p)) throw new Error("no vjepa pass — run: reactable video pass <ref> vjepa --run");
  const idx = readIndex(ref);
  const clips: any[] = JSON.parse(readFileSync(p, "utf8")).clips ?? [];
  let q: any;
  if (/^\d+$/.test(target)) {
    const ms = Number(target);
    q = clips.find((c) => ms >= c.in_ms && ms < c.out_ms);
  } else {
    const sh = (idx.shots ?? []).find((s: any) => s.id === target);
    if (sh) q = clips.find((c) => sh.in_ms >= c.in_ms && sh.in_ms < c.out_ms) ?? clips.find((c) => c.in_ms === sh.in_ms);
  }
  if (!q) throw new Error(`no clip for "${target}" — use a shot id (s0…) or a timestamp in ms`);
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const ranked = clips
    .filter((c) => c !== q)
    .map((c) => ({ in_ms: c.in_ms, out_ms: c.out_ms, tc: tc(c.in_ms, idx), score: +cos(q.emb, c.emb).toFixed(3) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.k ?? 5);
  return { query: { in_ms: q.in_ms, out_ms: q.out_ms, tc: tc(q.in_ms, idx) }, model: "V-JEPA 2 (temporal similarity)", similar: ranked };
}

interface MotionFrame { t_ms: number; mag: number; gx: number; gy: number; div: number }

// classify each shot's dominant camera move from its optical-flow signals
function classifyCameraMoves(shots: any[], frames: MotionFrame[]): any[] {
  const out: any[] = [];
  for (const sh of shots) {
    const seg = frames.filter((f) => f.t_ms >= sh.in_ms && f.t_ms < sh.out_ms);
    if (!seg.length) continue;
    const n = seg.length;
    const mag = seg.reduce((a, f) => a + f.mag, 0) / n;
    const gx = seg.reduce((a, f) => a + f.gx, 0) / n;
    const gy = seg.reduce((a, f) => a + f.gy, 0) / n;
    const div = seg.reduce((a, f) => a + f.div, 0) / n;
    // directional jitter: variance of per-frame global vector vs the mean
    const jitter = Math.sqrt(seg.reduce((a, f) => a + (f.gx - gx) ** 2 + (f.gy - gy) ** 2, 0) / n);
    let move = "static";
    if (mag < 0.9) move = "static";
    else if (jitter > 2 * (Math.hypot(gx, gy) + 0.5)) move = "shaky";
    else if (Math.abs(div) > 0.6 && Math.abs(div) > 0.5 * Math.hypot(gx, gy)) move = div > 0 ? "zoom-in" : "zoom-out";
    else if (Math.abs(gx) >= Math.abs(gy)) move = gx < 0 ? "pan-left" : "pan-right";
    else move = gy < 0 ? "tilt-up" : "tilt-down";
    out.push({ shot: sh.id, move, mag: +mag.toFixed(2), gx: +gx.toFixed(2), gy: +gy.toFixed(2), div: +div.toFixed(2) });
  }
  return out;
}

// match-cut candidates: shot pairs sharing a camera move + similar direction
// (motion continuity across a cut reads as a match-cut). Within one clip.
function findMatchCuts(moves: any[]): any[] {
  const dynamic = moves.filter((m) => m.move !== "static");
  const pairs: any[] = [];
  for (let i = 0; i < dynamic.length; i++) {
    for (let j = i + 1; j < dynamic.length; j++) {
      const a = dynamic[i], b = dynamic[j];
      if (a.move !== b.move) continue;
      // direction agreement for pans/tilts; for zoom/shaky the class match is enough
      const dirOk = a.move.startsWith("pan") || a.move.startsWith("tilt")
        ? (a.gx * b.gx + a.gy * b.gy) > 0 && Math.hypot(a.gx - b.gx, a.gy - b.gy) < 3
        : true;
      if (!dirOk) continue;
      pairs.push({ a: a.shot, b: b.shot, move: a.move, score: +(1 / (1 + Math.hypot(a.gx - b.gx, a.gy - b.gy))).toFixed(3) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, 8);
}

// cut-on-action candidates: local maxima of the motion-energy curve that stand
// out from the running median (peaks = "the action is here")
function findCutPoints(frames: MotionFrame[]): any[] {
  if (frames.length < 3) return [];
  const mags = frames.map((f) => f.mag);
  const sorted = [...mags].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const thresh = Math.max(median * 2.5, median + 3);
  const peaks: any[] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    if (mags[i] > thresh && mags[i] >= mags[i - 1] && mags[i] >= mags[i + 1]) {
      peaks.push({ t_ms: frames[i].t_ms, mag: +mags[i].toFixed(2) });
    }
  }
  return peaks.sort((a, b) => b.mag - a.mag).slice(0, 12).sort((a, b) => a.t_ms - b.t_ms);
}

// an ffmpeg that actually has libvidstab. The bundled static build does; the
// dev homebrew one often doesn't — so probe, and fall back to the vendored one.
function ffmpegWithVidstab(): string {
  const cands = [resolveFfmpeg(PROJECT), join(PROJECT, "vendor", "ffmpeg", "ffmpeg")].filter(Boolean) as string[];
  for (const ff of cands) {
    if (!existsSync(ff)) continue;
    const r = spawnSync(ff, ["-hide_banner", "-filters"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if ((r.stdout ?? "").includes("vidstabtransform")) return ff;
  }
  throw new Error("no ffmpeg with libvidstab — the bundled static ffmpeg has it (just vendor-ffmpeg); dev homebrew ffmpeg usually doesn't");
}

// Two-pass ffmpeg vidstab stabilization. Uses the motion pass (if present) to
// report which shots were flagged shaky. On-device, no model.
export function stabilize(ref: Ref, opts: { out?: string; shakiness?: number; smoothing?: number } = {}): any {
  const idx = readIndex(ref);
  const ffmpeg = ffmpegWithVidstab();
  const dir = sidecarDir(ref.media);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const trf = join(dir, "assets", "stabilize.trf");
  const out = opts.out ?? join(dir, "assets", "stabilized.mp4");
  const shakiness = Math.min(10, Math.max(1, opts.shakiness ?? 6));
  const smoothing = Math.max(1, opts.smoothing ?? 12);

  const p1 = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", ref.media,
    "-vf", `vidstabdetect=shakiness=${shakiness}:accuracy=15:result=${trf}`, "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (p1.status !== 0 || !existsSync(trf)) throw new Error(`vidstabdetect failed: ${p1.stderr ?? p1.status}`);

  const p2 = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", ref.media,
    "-vf", `vidstabtransform=input=${trf}:smoothing=${smoothing}:zoom=0:optzoom=1,unsharp=5:5:0.8:3:3:0.4`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", out],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (p2.status !== 0 || !existsSync(out)) throw new Error(`vidstabtransform failed: ${p2.stderr ?? p2.status}`);

  const shaky = (idx.passes?.motion?.camera_moves ?? []).filter((c: any) => c.move === "shaky").map((c: any) => c.shot);
  return {
    stabilized: out, shakiness, smoothing, transforms: trf,
    shaky_shots: shaky,
    note: idx.passes?.motion
      ? (shaky.length ? `motion pass flagged ${shaky.length} shaky shot(s): ${shaky.join(", ")}` : "motion pass found no shaky shots — stabilized anyway")
      : "no motion pass — stabilized the whole clip (run: reactable video pass <ref> motion --run to target shaky shots)",
  };
}

/// fg/mid/bg per tracklet frame from the depth grids (near=1 … far=0)
function zoneTracklets(ref: Ref, depthResult: any): number {
  const tracks = readTracks(ref);
  if (!tracks.length) return 0;
  const idx = readIndex(ref);
  const { width, height } = idx.probe;
  const grids = depthResult.frames ?? [];
  if (!grids.length) return 0;
  const gridAt = (t_ms: number) =>
    grids.reduce((best: any, g: any) => (Math.abs(g.t_ms - t_ms) < Math.abs(best.t_ms - t_ms) ? g : best), grids[0]);
  for (const trk of tracks) {
    const series: any[] = [];
    for (const f of trk.frames ?? []) {
      const g = gridAt(f.t_ms);
      const buf = Buffer.from(g.f32, "base64");
      const [x, y, w, h] = f.bbox;
      const gx0 = Math.max(0, Math.floor((x / width) * g.w));
      const gx1 = Math.min(g.w - 1, Math.ceil(((x + w) / width) * g.w));
      const gy0 = Math.max(0, Math.floor((y / height) * g.h));
      const gy1 = Math.min(g.h - 1, Math.ceil(((y + h) / height) * g.h));
      let sum = 0;
      let n = 0;
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          sum += buf.readFloatLE((gy * g.w + gx) * 4);
          n++;
        }
      }
      const mean = n ? sum / n : 0;
      series.push({ t_ms: f.t_ms, zone: mean > 0.66 ? "fg" : mean > 0.33 ? "mid" : "bg", mean: Number(mean.toFixed(3)) });
    }
    if (series.length) trk.depth = { zone_series: series };
  }
  writeFileSync(
    join(sidecarDir(ref.media), "tracks.jsonl"),
    tracks.map((t) => JSON.stringify(t)).join("\n") + "\n",
  );
  return tracks.filter((t) => t.depth).length;
}
