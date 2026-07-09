// E1 — Reframe self-labeling engine (docs/PLAN.editing-corpus.work).
// Reframe is a COMPOSITION decision for aspect conversion, not just a crop-follow:
//   • 1 dominant subject  → crop-follow (track + crop)
//   • 2 comparable subjects, far apart → SPLIT-SCREEN stack (both speakers)
//   • wide/many subjects or action across frame → letterbox (keep full frame)
// Gold = derive the composition from each shot's subject regions (deterministic,
// self-labeling). Lands as a `reframe` trajectory in the action-space contract.
import { resolveRef, indexT0 } from "./video.ts";
import { decompile } from "./decompile.ts";
import { captureTrajectory } from "./trajectory.ts";

export const ASPECT: Record<string, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

type Region = { x: number; y: number; w: number; h: number };
const cx = (r: Region) => r.x + r.w / 2;
const cy = (r: Region) => r.y + r.h / 2;
const area = (r: Region) => r.w * r.h;

// Subject-ish regions in a shot (drop text/logo/caption overlays).
function subjectsOf(shot: any): Region[] {
  return (shot.layers ?? [])
    .filter((l: any) => Array.isArray(l.bbox) && !/text|logo|caption|title/i.test(l.role || ""))
    .map((l: any) => ({ x: l.bbox[0], y: l.bbox[1], w: l.bbox[2], h: l.bbox[3] }))
    .filter((r: Region) => area(r) > 0.01)
    .sort((a: Region, b: Region) => area(b) - area(a));
}

// Decide the composition for one shot at a target aspect.
export function composeShot(shot: any, aspect: string, srcW: number, srcH: number): any {
  const At = ASPECT[aspect];
  const wNorm = Math.min(1, (srcH * At) / srcW); // full-height vertical-crop width, normalized
  const clampX = (x: number) => Math.max(wNorm / 2, Math.min(1 - wNorm / 2, x));
  const subs = subjectsOf(shot);

  if (subs.length === 0) return { verb: "crop", cx: 0.5, cy: 0.5, w: +wNorm.toFixed(3), why: "no subject → center" };
  // very wide subject or 3+ comparable → can't crop without losing content
  if (subs[0].w > 0.75 || (subs.length >= 3 && area(subs[2]) / area(subs[0]) > 0.4)) {
    return { verb: "letterbox", why: "action/subjects span the frame" };
  }
  // single dominant subject
  if (subs.length === 1 || area(subs[1]) / area(subs[0]) < 0.4) {
    return { verb: "crop", cx: +clampX(cx(subs[0])).toFixed(3), cy: 0.5, w: +wNorm.toFixed(3), why: "1 subject → track-crop" };
  }
  // two comparable subjects
  const [a, b] = [subs[0], subs[1]].sort((p, q) => cx(p) - cx(q));
  if (Math.abs(cx(a) - cx(b)) > wNorm) {
    return { verb: "stack", cells: [
      { cx: +clampX(cx(a)).toFixed(3), cy: +cy(a).toFixed(3), w: +wNorm.toFixed(3) },
      { cx: +clampX(cx(b)).toFixed(3), cy: +cy(b).toFixed(3), w: +wNorm.toFixed(3) },
    ], why: "2 speakers far apart → split-screen" };
  }
  return { verb: "crop", cx: +clampX((cx(a) + cx(b)) / 2).toFixed(3), cy: 0.5, w: +wNorm.toFixed(3), why: "2 subjects fit → center between" };
}

function skeletonFor(ref: any): any {
  try { return decompile(ref); } catch { indexT0(ref); return decompile(ref); }
}

// One reframe: source clip + target aspect → gold composition trajectory.
export function reframeGold(clip: string, aspect: string): { clip: string; aspect: string; shots: number; comp: Record<string, number>; coverage: number } {
  const ref = resolveRef(clip);
  const skel = skeletonFor(ref);
  const { width, height } = skel.source;

  const actions: any[] = [{ verb: "reframe", aspect }];
  const comp: Record<string, number> = {};
  let framed = 0;
  for (const shot of skel.timeline) {
    const c = composeShot(shot, aspect, width, height);
    comp[c.verb] = (comp[c.verb] || 0) + 1;
    // coverage: does the composition retain the shot's subject(s)?
    const subs = subjectsOf(shot);
    const ok = c.verb === "letterbox" || c.verb === "stack" || subs.length === 0 ||
      Math.abs(cx(subs[0]) - c.cx) <= c.w / 2 + 0.02;
    if (ok) framed++;
    actions.push({ t_ms: shot.in_ms, ...c });
  }
  const coverage = +(framed / Math.max(1, skel.timeline.length)).toFixed(3);

  captureTrajectory({
    sourceDigest: `${width}x${height} ${skel.timeline.length}sh → ${aspect}`,
    intent: `Reframe to ${aspect}, composing each shot to keep the subject(s) in frame (split-screen two speakers, letterbox wide action).`,
    actions,
    render: null,
    producer: "reframe-gold",
    label: "gold",
    task: "reframe",
    sourceDurationMs: skel.source.duration_ms,
    override: { reward: coverage, checks: { validity: 1, subject_coverage: coverage, compositions: Object.keys(comp).length } },
  });

  return { clip: clip.split("/").pop() || clip, aspect, shots: skel.timeline.length, comp, coverage };
}

export function reframeBatch(clips: string[], aspects = ["9:16", "1:1", "4:5"]): any[] {
  const out: any[] = [];
  for (const clip of clips) for (const a of aspects) { try { out.push(reframeGold(clip, a)); } catch (e: any) { out.push({ clip, aspect: a, error: e?.message }); } }
  return out;
}
