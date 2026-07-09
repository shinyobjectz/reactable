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
  // motion layer: camera moves · subject direction · cut-on-motion · match-cuts
  const motion = idx.passes?.motion;
  if (motion) {
    const wantDir = ["right", "left", "up", "down"].find((d) => new RegExp(`\\b${d}\\b|moving ${d}|going ${d}`).test(q));
    for (const cm of motion.camera_moves ?? []) {
      const sh = (idx.shots ?? []).find((s: any) => s.id === cm.shot);
      const at = { t_ms: sh?.in_ms ?? 0, tc: tc(sh?.in_ms ?? 0, idx), shot: cm.shot };
      if (cameraMoveMatches(q, cm.move)) hits.push({ ...at, source: "motion/camera", quote: cm.move });
      // subject moving in a queried direction ("moving right", "walking left")
      if (wantDir && (cm.subject?.dir?.includes(wantDir) || cm.primary_dir?.includes(wantDir))) {
        hits.push({ ...at, source: "motion/direction", quote: `${cm.subject?.dir ? "subject" : "motion"} ${cm.subject?.dir ?? cm.primary_dir}` });
      }
    }
    if (/\b(action|motion|cut|peak|movement|moment)\b/.test(q)) {
      for (const c of motion.cut_points ?? []) {
        hits.push({ t_ms: c.t_ms, tc: tc(c.t_ms, idx), source: "motion/action", quote: `motion peak (${c.mag})${c.dir ? ", " + c.dir : ""}` });
      }
    }
    // match-cut candidates ("match cut", "cut on motion")
    if (/match.?cut|carry|continu/.test(q)) {
      for (const mc of motion.match_cuts ?? []) {
        const sh = (idx.shots ?? []).find((s: any) => s.id === mc.from);
        hits.push({ t_ms: sh?.out_ms ?? 0, tc: tc(sh?.out_ms ?? 0, idx), source: "motion/match-cut", quote: `${mc.from}→${mc.to} carries ${mc.dir ?? "motion"} (${mc.score})` });
      }
    }
  }
  // action text-query layer (MobileViCLIP): "find where X happens" by meaning
  if (idx.passes?.mvc) {
    for (const h of mvcActionHits(ref, query)) hits.push({ ...h, quote: query });
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
  if (idx.passes?.motion) layers.push("motion (camera + subject direction · cut-on-motion · match-cuts)");
  if (idx.passes?.mvc) layers.push("action (MobileViCLIP text→video)");
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

const PASS_KINDS = new Set(["sam31", "segment", "rvm", "depth", "matte", "motion", "mvc"]);

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

// BiRefNet (MIT) production matte — torch/MPS pass (CoreML blocked by
// deform_conv). Writes the sidecar's soft matte-person.mov + person tracklet.
export function matteHq(ref: Ref, opts: { fps?: number } = {}): any {
  const script = join(PROJECT, "gpu", "birefnet_matte.py");
  if (!existsSync(script)) throw new Error("gpu/birefnet_matte.py missing");
  const deps = ["torch", "torchvision", "transformers>=4.40", "timm", "einops", "kornia", "av", "pillow", "numpy"];
  const args = ["run", "--python", "3.11", ...deps.flatMap((d) => ["--with", d]), "python3", script, ref.media, sidecarDir(ref.media), String(opts.fps ?? 0)];
  console.error("running BiRefNet matte (torch/MPS) — production quality, ~2s/frame…");
  const r = spawnSync("uv", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`birefnet matte failed (${r.status})`);
  const lines = (r.stdout || "").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
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

// depth · sam31 (EdgeTAM) · segment (native person-seg matte) · motion (optical
// flow) · mvc (MobileViCLIP) all run natively on-device (ANE/GPU) — no gate.
const NATIVE_ANE_KINDS = new Set(["depth", "sam31", "segment", "rvm", "motion", "mvc"]);

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
  } else if (kind === "mvc") {
    // one clip embedding per shot (fall back to auto 5s windows if unshot)
    const shots = readIndex(ref).shots ?? [];
    args = [kind, ref.media, "--out", outPath];
    if (shots.length) args.push("--windows", shots.map((s: any) => `${s.in_ms}:${s.out_ms}`).join(","));
  } else if (kind === "rvm") {
    // RVM native temporal matte → crisp soft matte-person.mov + tracklet
    const adir = join(sidecarDir(ref.media), "assets"); mkdirSync(adir, { recursive: true });
    args = ["rvm", ref.media, "--out", outPath, "--matte-out", join(adir, "matte-person.mov")];
  } else if (kind === "segment") {
    // also emit the SOFT alpha as a matte .mov → clean feathered compositing edges
    const adir = join(sidecarDir(ref.media), "assets");
    mkdirSync(adir, { recursive: true });
    args = ["segment", ref.media, "--out", outPath, "--matte-out", join(adir, "matte-person.mov")];
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
  // segment (native person-seg) produces the same tracklet shape as sam31
  if (kind === "sam31" || kind === "segment" || kind === "rvm") {
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
  if (kind === "mvc") {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "mvc-clips.json"), JSON.stringify(result));
    idx.passes.mvc = { at: new Date().toISOString(), model: result.model, dim: result.dim, clips: result.clips.length };
    writeFileSync(join(dir, "index.json"), JSON.stringify(idx, null, 2));
    return { pass: kind, clips: result.clips.length, dim: result.dim, model: result.model };
  }
  return result;
}

// text→embedding via MobileViCLIP (native). Shared by action queries (find)
// and closed-vocab shot tagging (the skeleton's semantic `tags`).
export function mvcTextEmbed(query: string): number[] | null {
  const vbin = nativeVisionBin();
  if (!vbin) return null;
  try {
    const r = spawnSync(vbin, ["mvc-text", query], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) return null;
    return JSON.parse(r.stdout).emb ?? null;
  } catch {
    return null;
  }
}

// action text-query: MobileViCLIP text embedding (via reactable-vision mvc-text)
// → cosine (×100 logit scale) vs stored clip embeddings → the moments where the
// described action happens. This is the "find where X happens" tier.
function mvcActionHits(ref: Ref, query: string): any[] {
  const dir = sidecarDir(ref.media);
  const p = join(dir, "assets", "mvc-clips.json");
  const vbin = nativeVisionBin();
  if (!existsSync(p) || !vbin) return [];
  let textEmb: number[];
  try {
    const r = spawnSync(vbin, ["mvc-text", query], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) return [];
    textEmb = JSON.parse(r.stdout).emb;
  } catch { return []; }
  const clips: any[] = JSON.parse(readFileSync(p, "utf8")).clips ?? [];
  const idx = readIndex(ref);
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  return clips
    .map((c) => ({ t_ms: c.in_ms, tc: tc(c.in_ms, idx), source: "action", score: +(cos(textEmb, c.emb) * 100).toFixed(2) }))
    .filter((h) => h.score > 1.5) // logit-scaled; keep clips the action actually matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// "find clips like this one" — cosine over stored MobileViCLIP clip embeddings
// (same video encoder that powers text→video search, so similarity is semantic).
// target = a shot id (s0…) or a timestamp in ms.
export function similar(ref: Ref, target: string, opts: { k?: number } = {}): any {
  const dir = sidecarDir(ref.media);
  const p = join(dir, "assets", "mvc-clips.json");
  if (!existsSync(p)) throw new Error("no mvc pass — run: reactable video pass <ref> mvc --run");
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
  return { query: { in_ms: q.in_ms, out_ms: q.out_ms, tc: tc(q.in_ms, idx) }, model: "MobileViCLIP (semantic similarity)", similar: ranked };
}

interface MotionFrame { t_ms: number; mag: number; gx: number; gy: number; div: number; sx: number; sy: number; smag: number; scov: number }

// on-screen motion vector → 8-way compass label ("right", "up-left"…), or null
// if the motion is too weak to have a direction.
const DIRS8: [string, number, number][] = [
  ["right", 1, 0], ["up-right", 1, -1], ["up", 0, -1], ["up-left", -1, -1],
  ["left", -1, 0], ["down-left", -1, 1], ["down", 0, 1], ["down-right", 1, 1],
];
function dirLabel(x: number, y: number, minMag = 0.8): string | null {
  if (Math.hypot(x, y) < minMag) return null;
  let best = DIRS8[0], bestDot = -Infinity;
  for (const d of DIRS8) {
    const dot = (x * d[1] + y * d[2]) / Math.hypot(d[1], d[2]);
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best[0];
}
const avg = (seg: MotionFrame[], k: keyof MotionFrame) => seg.reduce((a, f) => a + (f[k] as number), 0) / Math.max(1, seg.length);

// dominant on-screen motion of a segment: the SUBJECT's motion if something is
// moving independently of the camera in enough frames, else the camera's.
function dominantVec(seg: MotionFrame[]): { x: number; y: number; kind: string } {
  const subj = seg.filter((f) => f.smag > 0);
  if (subj.length >= Math.max(1, Math.ceil(seg.length * 0.3))) {
    return { x: avg(subj, "sx"), y: avg(subj, "sy"), kind: "subject" };
  }
  return { x: avg(seg, "gx"), y: avg(seg, "gy"), kind: "camera" };
}

// per-shot motion: camera move + independent subject motion + the in/out
// vectors used to test match-cut continuity across a cut.
function classifyCameraMoves(shots: any[], frames: MotionFrame[]): any[] {
  const out: any[] = [];
  for (const sh of shots) {
    const seg = frames.filter((f) => f.t_ms >= sh.in_ms && f.t_ms < sh.out_ms);
    if (!seg.length) continue;
    const mag = avg(seg, "mag"), gx = avg(seg, "gx"), gy = avg(seg, "gy"), div = avg(seg, "div");
    const jitter = Math.sqrt(seg.reduce((a, f) => a + (f.gx - gx) ** 2 + (f.gy - gy) ** 2, 0) / seg.length);
    let move = "static";
    if (mag < 0.9) move = "static";
    else if (jitter > 2 * (Math.hypot(gx, gy) + 0.5)) move = "shaky";
    else if (Math.abs(div) > 0.6 && Math.abs(div) > 0.5 * Math.hypot(gx, gy)) move = div > 0 ? "zoom-in" : "zoom-out";
    else if (Math.abs(gx) >= Math.abs(gy)) move = gx < 0 ? "pan-left" : "pan-right";
    else move = gy < 0 ? "tilt-up" : "tilt-down";
    // independent subject motion (present in ≥30% of frames)
    const subjF = seg.filter((f) => f.smag > 0);
    const subject = subjF.length >= Math.max(2, Math.ceil(seg.length * 0.3))
      ? { dir: dirLabel(avg(subjF, "sx"), avg(subjF, "sy")), sx: +avg(subjF, "sx").toFixed(2), sy: +avg(subjF, "sy").toFixed(2), mag: +avg(subjF, "smag").toFixed(2), coverage: +avg(subjF, "scov").toFixed(2) }
      : null;
    const third = Math.max(1, Math.floor(seg.length / 3));
    const inV = dominantVec(seg.slice(0, third)), outV = dominantVec(seg.slice(-third));
    const dom = dominantVec(seg);
    out.push({
      shot: sh.id, move, mag: +mag.toFixed(2), gx: +gx.toFixed(2), gy: +gy.toFixed(2), div: +div.toFixed(2),
      subject, primary_dir: dirLabel(dom.x, dom.y) ?? (["pan-left", "pan-right", "tilt-up", "tilt-down"].includes(move) ? move.split("-")[1] : null),
      in: { x: +inV.x.toFixed(2), y: +inV.y.toFixed(2), kind: inV.kind },
      out: { x: +outV.x.toFixed(2), y: +outV.y.toFixed(2), kind: outV.kind },
    });
  }
  return out;
}

// match-cut candidates: motion *continuity* across a cut — shot A's outgoing
// motion direction lines up with shot B's incoming motion, so the eye carries
// through the cut ("walking right → cut → still moving right").
function findMatchCuts(perShot: any[]): any[] {
  const pairs: any[] = [];
  for (let i = 0; i < perShot.length; i++) {
    for (let j = 0; j < perShot.length; j++) {
      if (i === j) continue;
      const ao = perShot[i].out, bi = perShot[j].in;
      const am = Math.hypot(ao.x, ao.y), bm = Math.hypot(bi.x, bi.y);
      if (am < 0.9 || bm < 0.9) continue;         // both sides need real motion
      const cosang = (ao.x * bi.x + ao.y * bi.y) / (am * bm);
      if (cosang < 0.6) continue;                  // directions must line up
      pairs.push({ from: perShot[i].shot, to: perShot[j].shot, dir: dirLabel(ao.x, ao.y), carry: `${ao.kind}→${bi.kind}`, score: +cosang.toFixed(3) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, 10);
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
      // cut-on-motion: which way is the motion headed at the peak (subject-first)
      const f = frames[i];
      const dir = f.smag > 0 ? dirLabel(f.sx, f.sy) : dirLabel(f.gx, f.gy);
      peaks.push({ t_ms: f.t_ms, mag: +mags[i].toFixed(2), dir });
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
// compact COCO-RLE decode (matches matte.ts) → binary mask, for sampling depth
// inside the actual subject silhouette (not the bbox, which includes bg).
function decodeRleLocal(countsB64: string, h: number, w: number): Uint8Array {
  const s = Buffer.from(countsB64, "base64").toString("latin1");
  const counts: number[] = []; let i = 0;
  while (i < s.length) {
    let x = 0, k = 0, more = true;
    while (more) { const c = s.charCodeAt(i) - 48; x |= (c & 0x1f) << (5 * k); more = (c & 0x20) !== 0; i++; k++; if (!more && c & 0x10) x |= -1 << (5 * k); }
    if (counts.length > 2) x += counts[counts.length - 2];
    counts.push(x);
  }
  const mask = new Uint8Array(h * w); let pos = 0, val = 0;
  for (const run of counts) { for (let j = 0; j < run; j++) { const col = Math.floor(pos / h), row = pos % h; if (val) mask[row * w + col] = 1; pos++; } val = 1 - val; }
  return mask;
}

// G3: per-object depth + z-order. Depth is sampled INSIDE each subject's mask
// (median, robust) → a real z per object per frame; the tracklet's median z is
// its depth, and objects in a shot get a front-to-back z_order.
function zoneTracklets(ref: Ref, depthResult: any): number {
  const tracks = readTracks(ref);
  if (!tracks.length) return 0;
  const idx = readIndex(ref);
  const { width, height } = idx.probe;
  const grids = depthResult.frames ?? [];
  if (!grids.length) return 0;
  const gridAt = (t_ms: number) =>
    grids.reduce((best: any, g: any) => (Math.abs(g.t_ms - t_ms) < Math.abs(best.t_ms - t_ms) ? g : best), grids[0]);
  const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  for (const trk of tracks) {
    const series: any[] = [];
    for (const f of trk.frames ?? []) {
      const g = gridAt(f.t_ms);
      const buf = Buffer.from(g.f32, "base64");
      const vals: number[] = [];
      if (f.rle?.counts) {
        // sample depth only where the mask is set (map grid cell → mask pixel)
        const [mh, mw] = f.rle.size;
        const mask = decodeRleLocal(f.rle.counts, mh, mw);
        for (let gy = 0; gy < g.h; gy++) {
          for (let gx = 0; gx < g.w; gx++) {
            const mx = Math.min(mw - 1, Math.floor(((gx + 0.5) / g.w) * mw));
            const my = Math.min(mh - 1, Math.floor(((gy + 0.5) / g.h) * mh));
            if (mask[my * mw + mx]) vals.push(buf.readFloatLE((gy * g.w + gx) * 4));
          }
        }
      }
      if (!vals.length) {
        // fall back to bbox mean if no mask
        const [x, y, w, h] = f.bbox;
        const gx0 = Math.max(0, Math.floor((x / width) * g.w)), gx1 = Math.min(g.w - 1, Math.ceil(((x + w) / width) * g.w));
        const gy0 = Math.max(0, Math.floor((y / height) * g.h)), gy1 = Math.min(g.h - 1, Math.ceil(((y + h) / height) * g.h));
        for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) vals.push(buf.readFloatLE((gy * g.w + gx) * 4));
      }
      const z = med(vals); // 0 = far … 1 = near
      series.push({ t_ms: f.t_ms, z: Number(z.toFixed(3)), zone: z > 0.66 ? "fg" : z > 0.33 ? "mid" : "bg" });
    }
    if (series.length) {
      const zMed = med(series.map((s) => s.z));
      trk.depth = { z: Number(zMed.toFixed(3)), zone: zMed > 0.66 ? "fg" : zMed > 0.33 ? "mid" : "bg", z_series: series };
    }
  }
  // per-shot z-order: objects present in a shot, ranked near→far
  const zOrder: any[] = [];
  for (const sh of idx.shots ?? []) {
    const present = tracks.filter((t) => t.depth && t.in_ms < sh.out_ms && t.out_ms > sh.in_ms)
      .map((t) => ({ track: t.id, concept: t.concept, z: t.depth.z }))
      .sort((a, b) => b.z - a.z); // nearest first
    if (present.length) zOrder.push({ shot: sh.id, order: present });
  }
  idx.passes.depth = { ...(idx.passes.depth ?? {}), z_order: zOrder };
  writeFileSync(join(sidecarDir(ref.media), "index.json"), JSON.stringify(idx, null, 2));
  writeFileSync(join(sidecarDir(ref.media), "tracks.jsonl"), tracks.map((t) => JSON.stringify(t)).join("\n") + "\n");
  return tracks.filter((t) => t.depth).length;
}
