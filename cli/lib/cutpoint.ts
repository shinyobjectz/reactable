// E9 — cut-point head. Learns the MOTION-CONTEXT signature of real editor cut
// points (self-supervised: real cuts = positives, random within-shot = negatives)
// and scores candidate cut points in ANY footage. docs/PLAN.editing-corpus.work.
// Features are motion-context ONLY (windows offset from the point) — NOT the
// content-change spike — so the head learns cut QUALITY, transferable to raw footage.
// Pure-JS logistic regression: on-device, no torch. Spike confirmed the signal (~5σ).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveRef } from "./video.ts";
import { decompile } from "./decompile.ts";
import { editIntelDir } from "./edit-intel.ts";
import { join } from "node:path";

export type MSeries = { t: number[]; m: number[] };

export function motionSeries(clip: string): MSeries {
  let out = "";
  try {
    out = execFileSync("ffmpeg", ["-hide_banner", "-i", clip, "-vf", "fps=8,tblend=all_mode=difference,signalstats,metadata=print:file=-", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e: any) { out = e.stdout?.toString() || ""; }
  const t: number[] = [], m: number[] = [];
  let cur: number | null = null;
  for (const line of out.split("\n")) {
    const pt = line.match(/pts_time:([\d.]+)/); if (pt) cur = +pt[1] * 1000;
    const ya = line.match(/YAVG=([\d.]+)/); if (ya && cur != null) { t.push(cur); m.push(+ya[1]); cur = null; }
  }
  return { t, m };
}

const meanIn = (s: MSeries, a: number, b: number) => { let x = 0, n = 0; for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] <= b) { x += s.m[i]; n++; } return n ? x / n : 0; };
function slopeIn(s: MSeries, a: number, b: number): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] <= b) { xs.push(s.t[i]); ys.push(s.m[i]); }
  if (xs.length < 3) return 0;
  const n = xs.length, mx = xs.reduce((p, c) => p + c, 0) / n, my = ys.reduce((p, c) => p + c, 0) / n;
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

// motion-context feature vector at time t (clip-normalized, transition-frame excluded)
export function cutFeatures(s: MSeries, t: number, clipMean: number): number[] {
  const eps = 1e-3, cm = clipMean || 1;
  const mB = meanIn(s, t - 700, t - 150), mA = meanIn(s, t + 150, t + 700);
  const sB = slopeIn(s, t - 700, t - 150) * 1000, sA = slopeIn(s, t + 150, t + 700) * 1000;
  return [mB / cm, mA / cm, mA / (mB + eps), sA / cm, sB / cm, (sA - sB) / cm];
}
export const FEATURES = ["motion_before", "motion_after", "after/before", "slope_after", "slope_before", "accel"];

// ── logistic regression (standardized) ──
export function trainLogReg(X: number[][], y: number[], epochs = 600, lr = 0.3) {
  const d = X[0].length, N = X.length;
  const mean = Array(d).fill(0), std = Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / N;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / N;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Xs = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));
  let w = Array(d).fill(0), b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = Array(d).fill(0); let gb = 0;
    for (let i = 0; i < N; i++) {
      const z = b + Xs[i].reduce((s, v, j) => s + v * w[j], 0); const p = 1 / (1 + Math.exp(-z)); const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += (err * Xs[i][j]) / N; gb += err / N;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * gw[j]; b -= lr * gb;
  }
  return { w, b, mean, std };
}
export const predict = (model: any, x: number[]) => {
  const z = model.b + x.reduce((s: number, v: number, j: number) => s + ((v - model.mean[j]) / model.std[j]) * model.w[j], 0);
  return 1 / (1 + Math.exp(-z));
};
function auc(scores: number[], y: number[]): number {
  let pos = 0, neg = 0, ok = 0;
  for (let i = 0; i < y.length; i++) for (let j = 0; j < y.length; j++) if (y[i] === 1 && y[j] === 0) { pos++; if (scores[i] > scores[j]) ok++; else if (scores[i] === scores[j]) ok += 0.5; }
  for (const v of y) v === 1 ? pos : neg;
  return pos ? +(ok / (y.filter((v) => v === 1).length * y.filter((v) => v === 0).length)).toFixed(3) : 0;
}

// Build (features, label) from a clip: real cuts = positives, random within-shot = negatives.
function clipSamples(clip: string): { feat: number[]; y: number }[] {
  let skel: any; try { skel = decompile(resolveRef(clip)); } catch { return []; }
  if (skel.timeline.length < 3 || skel.timeline.length > 40) return [];
  const s = motionSeries(clip); if (s.t.length < 15) return [];
  const clipMean = s.m.reduce((p, c) => p + c, 0) / s.m.length;
  const dur = skel.source.duration_ms;
  const cuts = skel.timeline.slice(1).map((sh: any) => sh.in_ms).filter((t: number) => t > 800 && t < dur - 800);
  const out: { feat: number[]; y: number }[] = [];
  for (const c of cuts) out.push({ feat: cutFeatures(s, c, clipMean), y: 1 });
  // negatives: within-shot points >= 500ms from any cut, matched count
  const rnds: number[] = [];
  for (const sh of skel.timeline) { const mid = (sh.in_ms + sh.out_ms) / 2; if (sh.out_ms - sh.in_ms > 1600 && cuts.every((c: number) => Math.abs(c - mid) > 500)) rnds.push(mid); }
  for (const r of rnds.slice(0, cuts.length)) out.push({ feat: cutFeatures(s, r, clipMean), y: 0 });
  return out;
}

// Train + eval (split by clip to avoid leakage), save model.
export function trainCutHead(clips: string[]) {
  const perClip = clips.map((c) => ({ c, s: clipSamples(c) })).filter((x) => x.s.length >= 2);
  const nTest = Math.max(2, Math.floor(perClip.length * 0.3));
  const test = perClip.slice(0, nTest), train = perClip.slice(nTest);
  const trX = train.flatMap((x) => x.s.map((z) => z.feat)), trY = train.flatMap((x) => x.s.map((z) => z.y));
  const teX = test.flatMap((x) => x.s.map((z) => z.feat)), teY = test.flatMap((x) => x.s.map((z) => z.y));
  const model = trainLogReg(trX, trY);
  const teScores = teX.map((x) => predict(model, x)), trScores = trX.map((x) => predict(model, x));
  const acc = (sc: number[], y: number[]) => +(sc.filter((p, i) => (p > 0.5 ? 1 : 0) === y[i]).length / y.length).toFixed(3);
  const path = join(editIntelDir(), "cutpoint-head.json");
  writeFileSync(path, JSON.stringify({ model, features: FEATURES }, null, 1));
  return {
    clips: perClip.length, train_samples: trX.length, test_samples: teX.length,
    train_auc: auc(trScores, trY), test_auc: auc(teScores, teY),
    train_acc: acc(trScores, trY), test_acc: acc(teScores, teY),
    weights: Object.fromEntries(FEATURES.map((f, i) => [f, +model.w[i].toFixed(2)])),
    saved: path,
  };
}
