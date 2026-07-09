// Edit intel — the skeletonizing decompiler (Engine B / the encoder, P1).
// Reverse any indexed clip into an ABSTRACT EDIT SKELETON: the timeline IR the
// world model reasons over. See docs/PLAN.omni-editing-model.work (§6 Engine B,
// §9-P1).
//
// The load-bearing contract: KEEP STRUCTURE, STRIP CONTENT.
//   keep  — timing, cuts/transitions, layout geometry (normalized), layer
//           roles + generic classes, depth zones, motion curves, aspect/fps,
//           speech/silence *timing*.
//   strip — the source pixels, verbatim OCR/brand strings, transcript words,
//           scene captions, and (for imported clips) the source filename.
// A skeleton is a structural transcription, not a reconstruction — so training
// on it learns *editing grammar*, not anyone's copyrighted expression. The
// `--verify` leak check proves no stripped string survives in the output.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readIndex, readTracks, sidecarDir, mvcTextEmbed, type Ref } from "./video.ts";
import { editIntelDir } from "./edit-intel.ts";

export const SKELETON_SCHEMA = "edit-skeleton/1";

// ── small helpers ───────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
function aspect(w: number, h: number): string {
  if (!w || !h) return "?";
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
}
const r3 = (n: number) => Number(n.toFixed(3));

// normalized [x,y,w,h] from source-pixel bbox
function norm(bbox: number[], W: number, H: number): [number, number, number, number] {
  const [x, y, w, h] = bbox;
  return [r3(x / W), r3(y / H), r3(w / W), r3(h / H)];
}

// text STRUCTURE (never the string): coarse length bucket, line count, case
function textShape(s: string): { len: "short" | "med" | "long"; lines: number; case: "upper" | "title" | "mixed" } {
  const t = (s || "").trim();
  const len = t.length <= 12 ? "short" : t.length <= 40 ? "med" : "long";
  const lines = Math.max(1, t.split(/\n/).length);
  const words = t.split(/\s+/).filter(Boolean);
  const upper = t.length > 0 && t === t.toUpperCase() && /[A-Z]/.test(t);
  const title = !upper && words.length > 0 && words.every((w) => /^[^a-z]/.test(w));
  return { len, lines, case: upper ? "upper" : title ? "title" : "mixed" };
}

// role of a text region from its normalized geometry (position + size)
function textRole(b: [number, number, number, number]): string {
  const [x, y, w, h] = b;
  if (y < 0.15 && w > 0.4) return "heading";
  if (y > 0.8) return "caption";
  if (w < 0.22 && h < 0.12 && (x < 0.15 || x > 0.68)) return "logo-region";
  return "text-block";
}

function dominantZone(trk: any): string | null {
  const series = trk.depth?.zone_series ?? [];
  if (!series.length) return null;
  const counts: Record<string, number> = {};
  for (const s of series) counts[s.zone] = (counts[s.zone] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function mode(xs: string[]): string | null {
  if (!xs.length) return null;
  const c: Record<string, number> = {};
  for (const x of xs) c[x] = (c[x] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

// mean normalized center of a tracklet's frames
function centroidN(frames: any[], W: number, H: number): [number, number] | null {
  const fs = (frames ?? []).filter((f) => Array.isArray(f.bbox));
  if (!fs.length) return null;
  let cx = 0, cy = 0;
  for (const f of fs) { cx += (f.bbox[0] + f.bbox[2] / 2) / W; cy += (f.bbox[1] + f.bbox[3] / 2) / H; }
  return [cx / fs.length, cy / fs.length];
}

// Shot grouping — cluster shots by MobileViCLIP clip-embedding cosine so
// recurring / visually-similar shots share a group id (callbacks, A/B cutaways).
// Semantic STRUCTURE (group ids, not vectors). V-JEPA2 dropped (2026-07-08): MVC
// embeddings subsume clip similarity, so one model covers the whole semantic
// tier. Returns shotId → group index.
export function mvcGroups(ref: Ref, shots: any[]): Map<string, number> {
  const map = new Map<string, number>();
  const p = join(sidecarDir(ref.media), "assets", "mvc-clips.json");
  if (!existsSync(p)) return map;
  let clips: any[];
  try { clips = JSON.parse(readFileSync(p, "utf8")).clips ?? []; } catch { return map; }
  if (!clips.length) return map;
  const clipFor = (s: any) => clips.find((c) => s.in_ms >= c.in_ms && s.in_ms < c.out_ms) ?? clips.find((c) => c.in_ms === s.in_ms);
  const norm = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0) / (norm(a) * norm(b));
  const reps: { emb: number[]; g: number }[] = [];
  let g = 0;
  for (const sh of shots) {
    const c = clipFor(sh);
    if (!c?.emb) continue;
    let best: any = null, bs = 0.85; // cosine threshold for "same visual group"
    for (const r of reps) { const sc = cos(c.emb, r.emb); if (sc > bs) { bs = sc; best = r; } }
    if (best) map.set(sh.id, best.g);
    else { reps.push({ emb: c.emb, g }); map.set(sh.id, g); g++; }
  }
  return map;
}

// Closed action/semantic vocabulary (ad/creator-editing relevant). Closed-vocab
// → content-safe even for procured clips (our labels, not source text).
const ACTION_VOCAB = [
  "person talking to camera", "close-up of a face", "product close-up",
  "hands using a product", "unboxing a product", "text on screen", "logo",
  "before and after comparison", "food or drink", "people outdoors",
  "lifestyle scene", "fast motion action", "wide establishing shot",
  "crowd of people", "walking", "driving a car",
];

// vocab text-embeddings, cached to edit-intel/mvc-vocab.json (embed once, reuse)
function loadVocabEmb(): Record<string, number[]> {
  const cachePath = join(editIntelDir(), "mvc-vocab.json");
  let cached: Record<string, number[]> = {};
  if (existsSync(cachePath)) { try { cached = JSON.parse(readFileSync(cachePath, "utf8")); } catch { /* rebuild */ } }
  let dirty = false;
  for (const term of ACTION_VOCAB) {
    if (!cached[term]) { const e = mvcTextEmbed(term); if (e) { cached[term] = e; dirty = true; } }
  }
  if (dirty) { try { mkdirSync(editIntelDir(), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cached)); } catch { /* best effort */ } }
  return cached;
}

// MobileViCLIP text→action tags: score the closed vocab against each shot's MVC
// clip embedding → the labels the shot actually matches. Semantic STRUCTURE
// (closed labels, not free text). Returns shotId → tags[].
export function mvcTags(ref: Ref, shots: any[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const p = join(sidecarDir(ref.media), "assets", "mvc-clips.json");
  if (!existsSync(p)) return map;
  let clips: any[];
  try { clips = JSON.parse(readFileSync(p, "utf8")).clips ?? []; } catch { return map; }
  if (!clips.length) return map;
  const vocab = Object.entries(loadVocabEmb());
  if (!vocab.length) return map;
  const clipFor = (s: any) => clips.find((c) => s.in_ms >= c.in_ms && s.in_ms < c.out_ms) ?? clips.find((c) => c.in_ms === s.in_ms);
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  for (const sh of shots) {
    const c = clipFor(sh);
    if (!c?.emb) continue;
    const tags = vocab
      .map(([label, emb]) => ({ label, score: cos(c.emb, emb) * 100 }))
      .filter((t) => t.score > 2.0) // logit-scaled; keep confident matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((t) => t.label);
    if (tags.length) map.set(sh.id, tags);
  }
  return map;
}

// Merge co-moving tracklets → one subject layer per entity. Trackers fragment a
// single object into many short tracklets; without this the skeleton emits
// dozens of near-duplicate "subject" layers (noise that would poison training
// targets — see PLAN §12 P3 caveat). Greedy centroid clustering within a
// concept; genuinely separate instances stay apart.
function mergeSubjects(tracks: any[], W: number, H: number, dist = 0.15): any[] {
  const byConcept: Record<string, any[]> = {};
  for (const t of tracks) (byConcept[t.concept ?? "?"] ||= []).push(t);
  const subjects: any[] = [];
  for (const [concept, group] of Object.entries(byConcept)) {
    const clusters: { cx: number; cy: number; n: number; members: any[] }[] = [];
    for (const t of group) {
      const c = centroidN(t.frames, W, H);
      if (!c) continue;
      let best: any = null, bd = dist;
      for (const cl of clusters) { const d = Math.hypot(cl.cx - c[0], cl.cy - c[1]); if (d < bd) { bd = d; best = cl; } }
      if (best) { best.cx = (best.cx * best.n + c[0]) / (best.n + 1); best.cy = (best.cy * best.n + c[1]) / (best.n + 1); best.n++; best.members.push(t); }
      else clusters.push({ cx: c[0], cy: c[1], n: 1, members: [t] });
    }
    for (const cl of clusters) {
      const frames = cl.members.flatMap((m) => m.frames ?? []).filter((f: any) => Array.isArray(f.bbox)).sort((a: any, b: any) => a.t_ms - b.t_ms);
      const depth = mode(cl.members.map(dominantZone).filter((z): z is string => !!z));
      subjects.push({
        role: "subject",
        class: concept === "?" ? null : concept,
        depth,
        bbox: frames[0]?.bbox ? norm(frames[0].bbox, W, H) : null,
        motion: motionCurve(frames, W, H),
        merged_from: cl.members.length,
      });
    }
  }
  return subjects;
}

// decimate a bbox trajectory to ≤ maxPts keyframes (normalized)
function motionCurve(frames: any[], W: number, H: number, maxPts = 24): { t_ms: number; bbox: number[] }[] | null {
  const fs = (frames ?? []).filter((f) => Array.isArray(f.bbox));
  if (fs.length < 2) return null;
  const step = Math.max(1, Math.floor(fs.length / maxPts));
  const pts: { t_ms: number; bbox: number[] }[] = [];
  for (let i = 0; i < fs.length; i += step) pts.push({ t_ms: fs[i].t_ms, bbox: norm(fs[i].bbox, W, H) });
  const last = fs[fs.length - 1];
  if (pts[pts.length - 1]?.t_ms !== last.t_ms) pts.push({ t_ms: last.t_ms, bbox: norm(last.bbox, W, H) });
  return pts;
}

// ── decompile ─────────────────────────────────────────────────────────

export function decompile(ref: Ref, opts: { verify?: boolean } = {}): any {
  const idx = readIndex(ref); // throws the teaching "index first" error when unindexed
  const tracks = readTracks(ref);
  const W = idx.probe.width;
  const H = idx.probe.height;
  const imported = !ref.take;
  const motion = idx.passes?.motion; // camera_moves · cut_points · match_cuts
  const groups = mvcGroups(ref, idx.shots ?? []); // shotId → visual group id (MobileViCLIP)
  const tagMap = mvcTags(ref, idx.shots ?? []); // shotId → MobileViCLIP action tags

  // segments = shots. kind is a COARSE content-type cue, never an identity.
  const timeline = (idx.shots ?? []).map((shot: any, i: number) => {
    const ocrFrame = (idx.ocr ?? []).find((f: any) => f.shot === shot.id);
    const shotTracks = tracks.filter((t) => t.out_ms > shot.in_ms && t.in_ms < shot.out_ms);
    const kind = ocrFrame?.items?.length ? "ui" : shotTracks.length ? "scene" : "scene";

    const layers: any[] = [];
    // text regions (OCR) → role + geometry + shape; string STRIPPED
    for (const item of ocrFrame?.items ?? []) {
      const b = norm(item.bbox, W, H);
      layers.push({ role: textRole(b), depth: null, bbox: b, text_shape: textShape(item.text) });
    }
    // tracked entities → subject layers, MERGING co-moving tracklets of the
    // same concept (one entity = one layer, not one-per-fragment). Windowed to
    // the shot.
    const windowed = shotTracks
      .map((t) => ({ ...t, frames: (t.frames ?? []).filter((f: any) => f.t_ms >= shot.in_ms && f.t_ms <= shot.out_ms) }))
      .filter((t) => t.frames.length);
    for (const subj of mergeSubjects(windowed, W, H)) layers.push(subj);

    // temporal: camera move (from optical-flow motion pass) + whether this
    // cut lands on an action beat (a cut_point near the shot boundary).
    const cm = (motion?.camera_moves ?? []).find((c: any) => c.shot === shot.id);
    const onAction = i > 0 && (motion?.cut_points ?? []).some((c: any) => Math.abs(c.t_ms - shot.in_ms) <= 400);
    return {
      id: `seg${i}`,
      shot: shot.id,
      in_ms: shot.in_ms,
      out_ms: shot.out_ms,
      kind,
      camera_move: cm?.move ?? null, // pan/tilt/zoom/shaky/static (label only)
      transition_in: i === 0 ? null : onAction ? "cut-on-action" : "cut",
      visual_group: groups.get(shot.id) ?? null, // MobileViCLIP recurrence/grouping
      tags: tagMap.get(shot.id) ?? [], // semantic action tags (MobileViCLIP text→action)
      layers,
    };
  });

  // match-cut candidates (shot pairs with continuous motion across the cut)
  const match_cuts = (motion?.match_cuts ?? []).map((m: any) => ({ a: m.a, b: m.b, move: m.move }));

  // audio: STRUCTURE only — timing + labels, never the words. Uses the audio
  // pass (kind_segments / beats / turns) when present, else transcript timing.
  let audio: any = null;
  const speech = (idx.transcript?.segments ?? []).map((s: any) => ({ in_ms: s.in_ms, out_ms: s.out_ms, word_count: (s.text || "").split(/\s+/).filter(Boolean).length }));
  const aa = idx.audio_analysis;
  if (aa) {
    audio = {
      kind_segments: aa.kind_segments ?? [], // speech | silence | sound (timing + label)
      beats: aa.beats ? { bpm: aa.beats.bpm, confidence: aa.beats.confidence, onsets_ms: aa.beats.onsets_ms } : null,
      turns: aa.turns ?? [], // speaker turns (spk0/spk1 labels, not identities)
      speech_segments: speech,
      silence_ms: aa.silence_ms ?? null,
    };
  } else if (speech.length) {
    const spoken = speech.reduce((a: number, s: any) => a + (s.out_ms - s.in_ms), 0);
    audio = { speech_segments: speech, silence_ms: Math.max(0, idx.probe.duration_ms - spoken) };
  }

  const skeleton = {
    schema: SKELETON_SCHEMA,
    source: {
      sha256: idx.source?.sha256 ?? null, // provenance only — never the footage or (for imports) the filename
      kind: imported ? "imported" : "take",
      ref: imported ? null : ref.take,
      duration_ms: idx.probe.duration_ms,
      width: W,
      height: H,
      aspect: aspect(W, H),
      fps: idx.probe.avg_fps,
      vfr: !!idx.probe.vfr,
    },
    stripped: { footage: true, ocr_text: true, transcript_text: true, captions: true, source_filename: imported },
    timeline,
    match_cuts,
    audio,
    provenance: {
      indexed_passes: Object.entries(idx.passes ?? {}).filter(([, v]) => v).map(([k]) => k),
      decompiled_at: new Date().toISOString(),
    },
  };

  const result: any = { ...skeleton };
  if (opts.verify) result.leak_check = contentLeakCheck(skeleton, idx, imported);
  return result;
}

// The skeleton's OWN structural vocabulary — schema keys + enum values that
// legitimately appear as string values. Excluded from needles so common source
// words that coincide with structure ("time" in "timeline", "shape", booleans)
// don't false-positive.
const STRUCT_VOCAB = new Set([
  "edit", "skeleton", "heading", "caption", "logo", "region", "text", "block", "subject",
  "scene", "figure", "transition", "upper", "title", "mixed", "short", "sound", "silence",
  "speech", "synthetic", "take", "imported", "segment", "kind", "role", "depth", "class",
  "shape", "lines", "case", "true", "false", "null", "time", "timeline", "source", "audio",
  "beats", "turns", "onsets", "tempo", "confidence", "width", "height", "duration", "aspect",
  "provenance", "stripped", "footage", "transcript", "captions", "bbox", "motion", "spk0", "spk1",
]);

function collectStrings(o: any, out: string[]): void {
  if (typeof o === "string") out.push(o.toLowerCase());
  else if (Array.isArray(o)) for (const x of o) collectStrings(x, out);
  else if (o && typeof o === "object") for (const v of Object.values(o)) collectStrings(v, out);
}

// Prove the strip contract: no verbatim OCR/transcript/caption word (or, for
// imports, the source filename) survives in the skeleton's string VALUES.
// Scans values only (not keys/booleans), words ≥5 chars, minus STRUCT_VOCAB.
export function contentLeakCheck(skeleton: any, idx: any, imported: boolean): { ok: boolean; leaks: string[]; checked: number } {
  const vals: string[] = [];
  collectStrings(skeleton, vals);
  const hay = ` ${vals.join("  ")} `;
  const needles = new Set<string>();
  const add = (s: string) => { for (const w of String(s || "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 5 && !STRUCT_VOCAB.has(w)) needles.add(w); };
  for (const f of idx.ocr ?? []) for (const it of f.items ?? []) add(it.text);
  for (const w of idx.transcript?.words ?? []) add(w.w);
  for (const s of idx.transcript?.segments ?? []) add(s.text);
  for (const shot of idx.shots ?? []) if (shot.caption) add(shot.caption);
  if (imported && idx.source?.file) add(String(idx.source.file).replace(/\.[a-z0-9]+$/i, ""));

  const leaks: string[] = [];
  for (const n of needles) if (hay.includes(n)) leaks.push(n);
  return { ok: leaks.length === 0, leaks: leaks.slice(0, 20), checked: needles.size };
}

export function writeSkeleton(ref: Ref, skeleton: any): string {
  const out = join(sidecarDir(ref.media), "skeleton.json");
  writeFileSync(out, JSON.stringify(skeleton, null, 2));
  return out;
}
