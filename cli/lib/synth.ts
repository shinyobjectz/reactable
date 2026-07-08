// Edit intel — synthetic-pair generator (Engine A, P2 v0). Procedurally author
// timelines with KNOWN ground-truth structure, render them deterministically,
// then round-trip (index → decompile) to prove the encoder recovers what we
// authored — and mint exact (sidecar ↔ skeleton) training pairs.
// docs/PLAN.omni-editing-model.work §6 Engine A, §9-P2.
//
// v0 covers the TEMPORAL spine (shots + cut timing) with a self-contained
// ffmpeg render (solid-color segments, hard cuts) — exact ground truth, fully
// local, no OCR/track/audio dependency. Layering on top (documented follow-ups):
//   - text/region round-trip (OCR-recoverable overlays),
//   - audio round-trip (TTS speech windows → transcript),
//   - "Engine A full": compose the 135 wavelet-ui components for
//     byte-deterministic renders (lives in the reactable-wasmvideo worktree).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT } from "./paths.ts";
import { resolveFfmpeg } from "./tools.ts";
import { resolveRef, indexT0, sidecarDir } from "./video.ts";
import { decompile, SKELETON_SCHEMA } from "./decompile.ts";
import { captureEpisode, editIntelDir } from "./edit-intel.ts";

const W = 1280;
const H = 720;
const FPS = 30;
// Alternating dark/light palettes: each shot flips luma vs the previous one, so
// every hard cut produces a large frame delta that reliably clears ffmpeg's
// scene-detect threshold (flat frames score low — a plain-color cut measured
// only ~0.13 vs the 0.30 gate, so contrast has to be forced).
const DARK = ["0x0a0a12", "0x101828", "0x1a0f0f", "0x0c1a12", "0x151015"];
const LIGHT = ["0xf2f2f2", "0xffe08a", "0x8ae0ff", "0xffb0c0", "0xc8ffb0"];
const pick = (arr: string[], r: number) => arr[Math.floor(r * arr.length) % arr.length];

// mulberry32 — deterministic RNG so a seed always reproduces the same clip
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Box = { c: string; x: number; y: number; w: number; h: number }; // normalized
type Seg = { in_ms: number; out_ms: number; color: string; box: Box };
export type SynthSpec = { seed: number; segs: Seg[]; duration_ms: number };

export function genSpec(seed: number): SynthSpec {
  const rand = rng(seed);
  const n = 2 + Math.floor(rand() * 3); // 2..4 shots
  const segs: Seg[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const dur = 2500 + Math.floor(rand() * 2500); // 2.5–5.0s (> MIN_SHOT_MS)
    const darkBg = i % 2 === 0; // flip luma each shot → max scene-delta at the cut
    const color = pick(darkBg ? DARK : LIGHT, rand());
    // box takes the OPPOSITE luma of its bg (and of the previous shot's bg)
    const box: Box = { c: pick(darkBg ? LIGHT : DARK, rand()), x: 0.05 + rand() * 0.3, y: 0.05 + rand() * 0.3, w: 0.35 + rand() * 0.25, h: 0.35 + rand() * 0.25 };
    segs.push({ in_ms: t, out_ms: t + dur, color, box });
    t += dur;
  }
  return { seed, segs, duration_ms: t };
}

// The authored ground truth (what we rendered from) in edit-skeleton/1 shape.
export function authoredSkeleton(spec: SynthSpec): any {
  return {
    schema: SKELETON_SCHEMA,
    source: { sha256: null, kind: "synthetic", ref: `synth-${spec.seed}`, duration_ms: spec.duration_ms, width: W, height: H, aspect: "16:9", fps: FPS, vfr: false },
    stripped: { footage: true, ocr_text: true, transcript_text: true, captions: true, source_filename: false },
    timeline: spec.segs.map((s, i) => ({ id: `seg${i}`, shot: `s${i}`, in_ms: s.in_ms, out_ms: s.out_ms, kind: "scene", transition_in: i === 0 ? null : "cut", layers: [] })),
    audio: null,
    provenance: { synthetic: true, seed: spec.seed },
  };
}

export function renderSynth(spec: SynthSpec, outDir: string): string {
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found — brew install ffmpeg");
  mkdirSync(outDir, { recursive: true });
  const inputs: string[] = [];
  for (const s of spec.segs) {
    inputs.push("-f", "lavfi", "-t", ((s.out_ms - s.in_ms) / 1000).toFixed(3), "-i", `color=c=${s.color}:s=${W}x${H}:r=${FPS}`);
  }
  const pre = spec.segs
    .map((s, i) => {
      const bx = Math.round(s.box.x * W), by = Math.round(s.box.y * H);
      const bw = Math.round(s.box.w * W), bh = Math.round(s.box.h * H);
      return `[${i}:v]drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=${s.box.c}@1:t=fill,setsar=1,format=yuv420p[c${i}]`;
    })
    .join(";");
  const concat = spec.segs.map((_, i) => `[c${i}]`).join("") + `concat=n=${spec.segs.length}:v=1:a=0[v]`;
  const out = join(outDir, `synth-${spec.seed}.mp4`);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", `${pre};${concat}`, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), out], { maxBuffer: 64 * 1024 * 1024 });
  return out;
}

// Compare authored (ground truth) vs decompiled (recovered) timelines.
export function compareTimelines(authored: any, decompiled: any): any {
  const A = authored.timeline ?? [];
  const D = decompiled.timeline ?? [];
  const k = Math.min(A.length, D.length);
  let err = 0;
  for (let i = 0; i < k; i++) err += Math.abs(A[i].in_ms - D[i].in_ms) + Math.abs(A[i].out_ms - D[i].out_ms);
  return {
    segment_count: { authored: A.length, decompiled: D.length, match: A.length === D.length },
    boundary_mae_ms: k ? Math.round(err / (k * 2)) : null,
  };
}

export function synthDir(): string {
  return join(editIntelDir(), "synth");
}

// One pair: author → render → index → decompile → compare → mint into corpus.
export function synthPair(seed: number): any {
  const spec = genSpec(seed);
  const dir = synthDir();
  const clip = renderSynth(spec, dir);
  const authored = authoredSkeleton(spec);
  writeFileSync(join(dir, `synth-${spec.seed}.authored.json`), JSON.stringify(authored, null, 2));

  const ref = resolveRef(clip);
  indexT0(ref);
  const decompiled = decompile(ref);
  const fidelity = compareTimelines(authored, decompiled);

  captureEpisode({
    source: "synthetic",
    media: clip,
    sidecar: join(sidecarDir(clip), "index.json"),
    editSpec: authored, // the training target: the timeline we rendered from
    render: clip,
    summary: `synth seed ${seed}: ${spec.segs.length} shots, ${(spec.duration_ms / 1000).toFixed(1)}s`,
    label: "gold",
    gate: { valid: fidelity.segment_count.match, boundary_mae_ms: fidelity.boundary_mae_ms } as any,
  });

  return { seed, clip, shots: spec.segs.length, fidelity };
}

export function synthBatch(startSeed: number, n: number): any {
  const results = [];
  for (let i = 0; i < n; i++) results.push(synthPair(startSeed + i));
  const matched = results.filter((r) => r.fidelity.segment_count.match).length;
  const maes = results.map((r) => r.fidelity.boundary_mae_ms).filter((m): m is number => m != null);
  return {
    pairs: results.length,
    segment_count_match: `${matched}/${results.length}`,
    boundary_mae_ms: maes.length ? Math.round(maes.reduce((a, b) => a + b, 0) / maes.length) : null,
    corpus: synthDir(),
    results,
  };
}
