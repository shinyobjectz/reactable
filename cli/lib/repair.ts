// E4 — Degrade→Repair self-labeling engine (docs/PLAN.editing-corpus.work).
// Take a finished edit → inject a RECOVERABLE flaw (stray trailing clip, swapped
// adjacent shots, duplicated shot) → gold = the fix (restore the original).
// Directly trains the self-correction the bake-off (S2) showed was weak.
// Self-supervised, perception-light. Lands as a `repair` trajectory.
import { resolveRef } from "./video.ts";
import { decompile } from "./decompile.ts";
import { captureTrajectory } from "./trajectory.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FLAWS = ["stray-trailing", "swap-adjacent", "duplicate"];

export function repairGold(clip: string, seed = 1): { clip: string; flaw?: string; error?: string } {
  let skel: any; try { skel = decompile(resolveRef(clip)); } catch (e: any) { return { clip: clip.split("/").pop() || clip, error: e?.message }; }
  const shots = skel.timeline;
  if (shots.length < 3 || shots.length > 40) return { clip: clip.split("/").pop() || clip, error: `${shots.length} shots` };
  const r = rng(seed);

  // items carry origIdx (position in the good edit) or extra=true (should be removed)
  let items = shots.map((s: any, i: number) => ({ origIdx: i, s, extra: false }));
  const flaw = FLAWS[Math.floor(r() * FLAWS.length)];
  if (flaw === "stray-trailing") {
    const src = shots[Math.floor(r() * shots.length)];
    items.push({ origIdx: 1e9, s: src, extra: true });
  } else if (flaw === "swap-adjacent") {
    const i = Math.floor(r() * (items.length - 1));[items[i], items[i + 1]] = [items[i + 1], items[i]];
  } else { // duplicate
    const i = Math.floor(r() * items.length);
    items.splice(i + 1, 0, { origIdx: items[i].origIdx, s: items[i].s, extra: true });
  }

  const descOf = (s: any) => ((s.tags || []).slice(0, 2).join("|") || s.kind || "shot") + `,${Math.round((s.out_ms - s.in_ms) / 100) / 10}s`;
  const labeled = items.map((it, j) => ({ ...it, label: `y${j}` }));
  const digest = labeled.map((it) => `${it.label}:${descOf(it.s)}`).join(" ");

  // gold = keep the non-extra items in original order (drops strays/dups, un-swaps)
  const goldKeep = labeled.filter((it) => !it.extra).sort((a, b) => a.origIdx - b.origIdx)
    .map((it) => ({ verb: "keep", shot: it.label, in_ms: it.s.in_ms, out_ms: it.s.out_ms }));

  captureTrajectory({
    sourceDigest: `FLAWED edit (${flaw}) [${digest}]`,
    intent: "This edit has a flaw (a stray/duplicate shot or a wrong order). Fix it — output the clean edit.",
    actions: goldKeep,
    producer: "repair-gold", label: "gold", task: "repair",
    sourceDurationMs: skel.source.duration_ms,
    override: { reward: 1, checks: { validity: 1, flaw_fixed: 1 } },
  });
  return { clip: clip.split("/").pop() || clip, flaw };
}

export function repairBatch(clips: string[], perClip = 1): { minted: number; skipped: number; by_flaw: Record<string, number> } {
  let minted = 0, skipped = 0; const by_flaw: Record<string, number> = {};
  for (const [ci, c] of clips.entries()) for (let k = 0; k < perClip; k++) { const r = repairGold(c, 7 + k * 13 + ci * 101); if (r.error) skipped++; else { minted++; by_flaw[r.flaw!] = (by_flaw[r.flaw!] || 0) + 1; } }
  return { minted, skipped, by_flaw };
}
