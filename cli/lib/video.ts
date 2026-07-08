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

function tc(ms: number, idx: any): string {
  return msToSmpte(ms, idx?.probe?.avg_fps || 30, idx?.probe?.drop_frame || false);
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
  const script = join(PROJECT, "scripts", "ocr-frames.swift");
  const imgs = keyframes.filter(Boolean);
  if (!imgs.length || !existsSync(script)) return [];
  const r = spawnSync("swift", [script, ...imgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

// ── T1: embeddings + captions (local python via uv, MPS) ─────────────

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
  return runEmbedTool(["t1", dir]);
}

function embedQuery(ref: Ref, query: string, topk = 5): any[] {
  const dir = sidecarDir(ref.media);
  if (!existsSync(join(dir, "embeddings", "siglip2.meta.json"))) return [];
  try {
    const out = runEmbedTool(["query", dir, query, String(topk)]);
    return out.hits ?? [];
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
  hits.sort((x, y) => x.t_ms - y.t_ms);
  return { query, media: idx.source.file, hits, searched: searchedLayers(idx) };
}

function searchedLayers(idx: any): string[] {
  const layers = ["shots"];
  if (idx.transcript) layers.push("transcript");
  if (idx.ocr?.length) layers.push("ocr");
  if (idx.passes?.t1) layers.push("captions", "visual");
  else layers.push("captions+visual:missing — reactable video index <ref> --tier t1");
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
  return { t_ms: ms, tc: tc(ms, idx), shot, segment, ocr, tracks, events };
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

const PASS_KINDS = new Set(["sam31", "depth", "matte"]);

export function requestPass(ref: Ref, kind: string, params: Record<string, unknown>): any {
  if (!PASS_KINDS.has(kind)) throw new Error(`unknown pass "${kind}" — sam31 · depth · matte`);
  readIndex(ref); // must be indexed first; throws the teaching error if not
  const req = { kind, params, requested_at: new Date().toISOString(), status: "queued" };
  appendFileSync(join(sidecarDir(ref.media), "passes-queue.jsonl"), JSON.stringify(req) + "\n");
  return {
    ...req,
    note: "recorded — GPU pass runner is not configured yet (footage-intel P2); queue is at <sidecar>/passes-queue.jsonl",
  };
}
