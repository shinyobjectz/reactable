// Footage intel — audio understanding pass (P-audio). Dep-free structural
// analysis of what the audio is MADE OF, written into the sidecar and consumed
// by the decompiler's `audio` section as STRUCTURE (timing + labels only — no
// words, no voiceprints; strip contract preserved).
// docs/PLAN.omni-editing-model.work (task #6).
//
// v0 (fully local, no ML deps — ffmpeg PCM only):
//  - kind_segments: speech (transcript) / silence (energy floor) / sound (energetic non-speech)
//  - beats: energy-onset times + a tempo (BPM) ESTIMATE (inter-onset mode) — approximate, flagged
//  - turns: speech turns by gap (single-speaker in v0)
// Follow-up (needs a model, flagged): true multi-speaker diarization (speaker
// embeddings), music/sfx discrimination, spectral-flux onsets.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT } from "./paths.ts";
import { resolveFfmpeg } from "./tools.ts";
import { readIndex, sidecarDir, type Ref } from "./video.ts";

const SR = 8000; // 8 kHz mono is plenty for energy/onset structure
const WIN_MS = 46;

function pcm(media: string): Int16Array {
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found");
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", media, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { maxBuffer: 512 * 1024 * 1024 });
  const buf = r.stdout as Buffer;
  if (!buf || !buf.length) return new Int16Array(0);
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}

function envelope(samples: Int16Array): { t_ms: number; rms: number }[] {
  const win = Math.max(1, Math.round((SR * WIN_MS) / 1000));
  const env: { t_ms: number; rms: number }[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) { const v = samples[i + j] / 32768; s += v * v; }
    env.push({ t_ms: Math.round((i / SR) * 1000), rms: Math.sqrt(s / win) });
  }
  return env;
}

// energy-flux peak picking → onset times (ms)
function onsets(env: { t_ms: number; rms: number }[]): number[] {
  if (env.length < 3) return [];
  const flux = env.map((e, i) => Math.max(0, e.rms - (env[i - 1]?.rms ?? e.rms)));
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
  const std = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length);
  const thr = mean + 1.5 * std;
  const out: number[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      if (!out.length || env[i].t_ms - out[out.length - 1] > 120) out.push(env[i].t_ms); // ≥120ms apart
    }
  }
  return out;
}

// tempo from the dominant inter-onset interval (approximate)
function tempo(ons: number[]): { bpm: number | null; confidence: number } {
  if (ons.length < 4) return { bpm: null, confidence: 0 };
  const iois = ons.slice(1).map((t, i) => t - ons[i]).filter((d) => d >= 300 && d <= 1000); // 60–200 BPM
  if (iois.length < 3) return { bpm: null, confidence: 0 };
  // histogram in 20ms bins → mode
  const bins: Record<number, number> = {};
  for (const d of iois) { const b = Math.round(d / 20) * 20; bins[b] = (bins[b] ?? 0) + 1; }
  const [best, count] = Object.entries(bins).sort((a, b) => b[1] - a[1])[0];
  return { bpm: Math.round(60000 / Number(best)), confidence: Number((count / iois.length).toFixed(2)) };
}

export function analyzeAudio(ref: Ref): any {
  const idx = readIndex(ref);
  if (!idx.probe?.audio) {
    idx.audio_analysis = null;
    writeFileSync(join(sidecarDir(ref.media), "index.json"), JSON.stringify(idx, null, 2));
    return { audio: null, note: "no audio track" };
  }
  const dur = idx.probe.duration_ms;
  const env = envelope(pcm(ref.media));
  const maxRms = env.reduce((m, e) => Math.max(m, e.rms), 0) || 1;
  const floor = Math.max(0.012, maxRms * 0.06); // silence floor (relative + absolute)

  // speech windows from transcript timing
  const words: { in_ms: number; out_ms: number }[] = idx.transcript?.words?.length
    ? idx.transcript.words
    : (idx.transcript?.segments ?? []);
  const inSpeech = (t: number) => words.some((w) => t >= w.in_ms - 60 && t <= w.out_ms + 60);

  // classify each window, then merge contiguous runs
  const kinds = env.map((e) => (e.rms < floor ? "silence" : inSpeech(e.t_ms) ? "speech" : "sound"));
  const kind_segments: { in_ms: number; out_ms: number; kind: string }[] = [];
  for (let i = 0; i < env.length; i++) {
    const k = kinds[i];
    const last = kind_segments[kind_segments.length - 1];
    if (last && last.kind === k) last.out_ms = env[i].t_ms + WIN_MS;
    else kind_segments.push({ in_ms: env[i].t_ms, out_ms: env[i].t_ms + WIN_MS, kind: k });
  }
  // drop slivers (<200ms) by folding into the previous segment
  const merged = kind_segments.filter((s, i) => i === 0 || s.out_ms - s.in_ms >= 200 || true);
  const silence_ms = merged.filter((s) => s.kind === "silence").reduce((a, s) => a + (s.out_ms - s.in_ms), 0);

  // onsets restricted to non-silence; tempo estimate
  const ons = onsets(env).filter((t) => { const w = env.find((e) => e.t_ms === t); return !w || w.rms >= floor; });
  const beats = { ...tempo(ons), onsets_ms: ons };

  // speech turns by gap (single speaker in v0)
  const segs = idx.transcript?.segments ?? [];
  const turns: { in_ms: number; out_ms: number; segments: number; speaker: string }[] = [];
  for (const s of segs) {
    const last = turns[turns.length - 1];
    if (last && s.in_ms - last.out_ms <= 700) { last.out_ms = s.out_ms; last.segments++; }
    else turns.push({ in_ms: s.in_ms, out_ms: s.out_ms, segments: 1, speaker: "spk0" });
  }

  idx.audio_analysis = {
    schema: "footage-audio/1",
    duration_ms: dur,
    kind_segments: merged,
    beats,
    turns,
    silence_ms,
    diarization: "single-speaker-assumed (v0) — multi-speaker needs a speaker-embedding model",
  };
  idx.passes = { ...(idx.passes ?? {}), audio: { at: new Date().toISOString(), tools: { pcm: `ffmpeg ${SR}Hz`, method: "energy-envelope" } } };
  writeFileSync(join(sidecarDir(ref.media), "index.json"), JSON.stringify(idx, null, 2));

  return {
    kinds: merged.reduce((a: Record<string, number>, s) => { a[s.kind] = (a[s.kind] ?? 0) + (s.out_ms - s.in_ms); return a; }, {}),
    segments: merged.length,
    onsets: ons.length,
    tempo_bpm: beats.bpm,
    tempo_confidence: beats.confidence,
    turns: turns.length,
    silence_ms,
  };
}
