// Edit intel — frozen-base go/no-go (P3). Feed a frozen off-the-shelf model
// (MiniMax) the serialized footage-intel scene graph and ask it to emit an
// edit-skeleton/1 JSON — the same transform the deterministic decompiler does.
// Score the best-of-k against the decompiler's output. This is the DECISION
// GATE before any GPU/training: is the sidecar enough context, is the IR
// expressible by a frozen model, and where does it fail (= the training set)?
// docs/PLAN.omni-editing-model.work §9-P3.
import { join } from "node:path";
import { readIndex, readTracks, sidecarDir, type Ref } from "./video.ts";
import { decompile, SKELETON_SCHEMA } from "./decompile.ts";
import { captureEpisode } from "./edit-intel.ts";
import { minimaxChat } from "./minimax.ts";

// ── serialize the sidecar as a compact structured-text scene graph (Track A) ─

export function serializeSidecar(idx: any, tracks: any[]): string {
  const p = idx.probe;
  const L: string[] = [];
  L.push(`video: ${p.width}x${p.height}, ${p.avg_fps}fps, duration ${p.duration_ms}ms, vfr=${!!p.vfr}`);
  L.push(`shots (${(idx.shots ?? []).length}):`);
  for (const s of idx.shots ?? []) {
    const ocr = (idx.ocr ?? []).find((f: any) => f.shot === s.id);
    const trk = tracks.filter((t) => t.out_ms > s.in_ms && t.in_ms < s.out_ms);
    const parts = [`  ${s.id} [${s.in_ms}..${s.out_ms}]`];
    for (const it of ocr?.items ?? []) parts.push(`text "${it.text}"@[${it.bbox.join(",")}]px`);
    for (const t of trk) parts.push(`track class=${t.concept ?? "?"} depth=${dominant(t)}`);
    L.push(parts.join("  "));
  }
  const segs = idx.transcript?.segments ?? [];
  if (segs.length) L.push(`transcript: ${segs.length} segments, ${segs.map((s: any) => `[${s.in_ms}..${s.out_ms}] ${(s.text || "").split(/\s+/).filter(Boolean).length}w`).join(" ")}`);
  return L.join("\n");
}

function dominant(trk: any): string | null {
  const s = trk.depth?.zone_series ?? [];
  if (!s.length) return null;
  const c: Record<string, number> = {};
  for (const z of s) c[z.zone] = (c[z.zone] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

export const RECONSTRUCT_SYSTEM = `You are a video-edit decompiler. Given a footage-intel SCENE GRAPH, output ONLY one JSON object conforming to schema "${SKELETON_SCHEMA}". No prose, no code fences.

Shape:
{"schema":"${SKELETON_SCHEMA}",
 "source":{"duration_ms":N,"width":W,"height":H,"fps":F},
 "timeline":[{"id":"seg0","shot":"s0","in_ms":N,"out_ms":N,"kind":"ui|scene|figure","transition_in":null|"cut","layers":[...]}],
 "audio":{"speech_segments":[{"in_ms":N,"out_ms":N,"word_count":N}],"silence_ms":N}|null}

Rules (STRUCTURE ONLY — never emit the literal source text):
- one timeline segment per shot, in order; in_ms<out_ms; transition_in=null for the first segment else "cut".
- kind: "ui" if the shot has text/OCR, else "scene".
- text region layer: {"role":"heading|caption|logo-region|text-block","bbox":[x,y,w,h],"text_shape":{"len":"short|med|long","lines":N,"case":"upper|title|mixed"}}. role by geometry: y<0.15 & w>0.4 → heading; y>0.8 → caption; small corner → logo-region; else text-block. text_shape.len: ≤12 chars short, ≤40 med, else long. DO NOT include the text string.
- subject layer (from a track): {"role":"subject","class":<generic noun>,"depth":"fg|mid|bg"|null,"bbox":[x,y,w,h]}.
- ALL bbox coordinates NORMALIZED to [0,1]: divide x,w by width and y,h by height.`;

// ── parse + validate + score ─────────────────────────────────────────────

function parseJson(reply: string): any | null {
  if (!reply) return null;
  let s = reply.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j < 0 || j < i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

function validity(cand: any): { parsed: boolean; timeline: boolean; monotonic: boolean; coords_in_range: boolean; valid: boolean } {
  const parsed = cand != null;
  const tl = Array.isArray(cand?.timeline) ? cand.timeline : null;
  const timeline = !!tl && tl.length > 0;
  let monotonic = timeline;
  let prev = -1;
  if (tl) for (const s of tl) { if (!(s.in_ms < s.out_ms) || s.in_ms < prev) monotonic = false; prev = s.out_ms; }
  let coords = true;
  for (const s of tl ?? []) for (const l of s.layers ?? []) for (const v of l.bbox ?? []) if (typeof v !== "number" || v < -0.01 || v > 1.01) coords = false;
  return { parsed, timeline, monotonic, coords_in_range: coords, valid: parsed && timeline && monotonic && coords };
}

function fidelity(cand: any, gt: any): { segment_count: any; boundary_mae_ms: number | null; layer_recall: number | null } {
  const A = gt.timeline ?? [], D = cand?.timeline ?? [];
  const k = Math.min(A.length, D.length);
  let err = 0;
  for (let i = 0; i < k; i++) err += Math.abs((A[i].in_ms ?? 0) - (D[i].in_ms ?? 0)) + Math.abs((A[i].out_ms ?? 0) - (D[i].out_ms ?? 0));
  const gtL = A.reduce((a: number, s: any) => a + (s.layers?.length ?? 0), 0);
  const cL = D.reduce((a: number, s: any) => a + (s.layers?.length ?? 0), 0);
  return {
    segment_count: { ground_truth: A.length, model: D.length, match: A.length === D.length },
    boundary_mae_ms: k ? Math.round(err / (k * 2)) : null,
    layer_recall: gtL ? Number(Math.min(1, cL / gtL).toFixed(2)) : null,
  };
}

// ── the run ────────────────────────────────────────────────────────────

export async function baselineRun(ref: Ref, opts: { k?: number; model?: string } = {}): Promise<any> {
  const k = opts.k ?? 3;
  const idx = readIndex(ref);
  const tracks = readTracks(ref);
  const gt = decompile(ref); // deterministic ground truth
  const sceneGraph = serializeSidecar(idx, tracks);

  const cands: any[] = [];
  let model = "";
  let lastErr = "";
  for (let i = 0; i < k; i++) {
    const r = await minimaxChat(sceneGraph, { system: RECONSTRUCT_SYSTEM, model: opts.model });
    if (!r.ok) { lastErr = r.error ?? "call failed"; continue; }
    model = r.model ?? model;
    const cand = parseJson(r.reply ?? "");
    const v = validity(cand);
    const f = v.valid ? fidelity(cand, gt) : null;
    cands.push({ cand, valid: v, fidelity: f, ms: r.ms });
  }
  if (!cands.length) return { ref: ref.take ?? ref.media, error: `no model output — ${lastErr}` };

  // best = valid first, then segment-count match, then lowest boundary MAE
  const rank = (c: any) => (c.valid.valid ? 0 : 1000) + (c.fidelity?.segment_count.match ? 0 : 100) + (c.fidelity?.boundary_mae_ms ?? 999);
  cands.sort((a, b) => rank(a) - rank(b));
  const best = cands[0];

  captureEpisode({
    source: "baseline",
    take: ref.take ?? null,
    media: ref.media,
    sidecar: join(sidecarDir(ref.media), "index.json"),
    intent: "reconstruct edit-skeleton from footage-intel scene graph (frozen base, no training)",
    editSpec: best.cand,
    summary: `baseline ${model}: valid=${best.valid.valid} seg=${best.fidelity?.segment_count.match} mae=${best.fidelity?.boundary_mae_ms}ms`,
    label: "model",
    gate: { valid: best.valid.valid, ...(best.fidelity ?? {}) } as any,
  });

  return {
    ref: ref.take ?? ref.media,
    model,
    k,
    valid_rate: `${cands.filter((c) => c.valid.valid).length}/${cands.length}`,
    ground_truth: { segments: gt.timeline.length, layers: gt.timeline.reduce((a: number, s: any) => a + s.layers.length, 0) },
    best: { validity: best.valid, fidelity: best.fidelity },
    sidecar_chars: sceneGraph.length,
  };
}
