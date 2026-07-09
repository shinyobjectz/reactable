// E3 — Reassemble self-labeling engine (docs/PLAN.editing-corpus.work).
// Take a FINISHED edit → detect its shots → shuffle → gold = restore the original
// (professional) order. Self-supervised, perception-LIGHT (needs only shot detection).
// Teaches sequencing/assembly from any edited video. Lands as a `reassemble` trajectory.
import { resolveRef } from "./video.ts";
import { decompile } from "./decompile.ts";
import { captureTrajectory } from "./trajectory.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function reassembleGold(clip: string, seed = 1): { clip: string; shots?: number; error?: string } {
  let skel: any; try { skel = decompile(resolveRef(clip)); } catch (e: any) { return { clip: clip.split("/").pop() || clip, error: e?.message }; }
  const shots = skel.timeline;
  if (shots.length < 3 || shots.length > 40) return { clip: clip.split("/").pop() || clip, error: `${shots.length} shots (need 3-40)` };

  // deterministic shuffle: shuffled position p shows original shot `order[p]`
  const order = shots.map((_: any, i: number) => i);
  const r = rng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const pos2shuf: Record<number, number> = {}; order.forEach((origIdx: number, shufIdx: number) => (pos2shuf[origIdx] = shufIdx));

  // context = the shots as PRESENTED (shuffled labels x0..xN with descriptors)
  const descOf = (s: any) => ((s.tags || []).slice(0, 2).join("|") || s.kind || "shot") + `,${Math.round((s.out_ms - s.in_ms) / 100) / 10}s` + ((s.camera_move ? `,${s.camera_move}` : ""));
  const digest = order.map((origIdx: number, shufIdx: number) => `x${shufIdx}:${descOf(shots[origIdx])}`).join(" ");

  // gold = keep the shuffled shots in the order that restores the ORIGINAL sequence
  const goldKeep = shots.map((s: any, origIdx: number) => ({ verb: "keep", shot: `x${pos2shuf[origIdx]}`, in_ms: s.in_ms, out_ms: s.out_ms }));

  captureTrajectory({
    sourceDigest: `SHUFFLED ${shots.length} shots [${digest}]`,
    intent: "Reassemble the shuffled shots into a coherent edit (the original professional order).",
    actions: goldKeep,
    producer: "reassemble-gold", label: "gold", task: "reassemble",
    sourceDurationMs: skel.source.duration_ms,
    override: { reward: 1, checks: { validity: 1, order_restored: 1 } },
  });
  return { clip: clip.split("/").pop() || clip, shots: shots.length };
}

export function reassembleBatch(clips: string[], perClip = 1): { minted: number; skipped: number } {
  let minted = 0, skipped = 0;
  for (const c of clips) for (let k = 0; k < perClip; k++) { const r = reassembleGold(c, 1 + k); r.error ? skipped++ : minted++; }
  return { minted, skipped };
}

// LIBRARY PUZZLE (Shane's idea): pool shots from many videos into a library with
// DISTRACTORS; the task is to SELECT the target edit's shots from the pool AND order
// them (not just reorder one clip). Runs on content-stripped skeletons → the model
// must use STRUCTURE, not surface cues (memorization-proofed by construction).
export function libraryPuzzleGold(target: string, pool: string[], seed = 1, nDistract = 8): { target: string; lib?: number; gold?: number; error?: string } {
  let tSkel: any; try { tSkel = decompile(resolveRef(target)); } catch (e: any) { return { target: target.split("/").pop() || target, error: e?.message }; }
  const gold = tSkel.timeline;
  if (gold.length < 3 || gold.length > 30) return { target: target.split("/").pop() || target, error: `${gold.length} shots` };

  // gather distractor shots from other pool clips
  const distract: any[] = [];
  for (const p of pool) { if (p === target) continue; try { const ps = decompile(resolveRef(p)); for (const sh of ps.timeline) distract.push(sh); } catch { } }
  const r = rng(seed);
  for (let i = distract.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [distract[i], distract[j]] = [distract[j], distract[i]]; }
  const chosen = distract.slice(0, nDistract);

  // library = gold shots (tagged) + distractors, shuffled, labelled z0..zM
  const lib = [...gold.map((s: any, i: number) => ({ s, gold: true, origIdx: i })), ...chosen.map((s: any) => ({ s, gold: false, origIdx: -1 }))];
  for (let i = lib.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lib[i], lib[j]] = [lib[j], lib[i]]; }
  const labeled = lib.map((it, j) => ({ ...it, label: `z${j}` }));

  const descOf = (s: any) => ((s.tags || []).slice(0, 2).join("|") || s.kind || "shot") + `,${Math.round((s.out_ms - s.in_ms) / 100) / 10}s` + (s.camera_move ? `,${s.camera_move}` : "");
  const digest = labeled.map((it) => `${it.label}:${descOf(it.s)}`).join(" ");
  const goldKeep = labeled.filter((it) => it.gold).sort((a, b) => a.origIdx - b.origIdx).map((it) => ({ verb: "keep", shot: it.label, in_ms: it.s.in_ms, out_ms: it.s.out_ms }));

  captureTrajectory({
    sourceDigest: `LIBRARY ${labeled.length} shots (${gold.length} belong, ${chosen.length} distractors) [${digest}]`,
    intent: `Assemble a coherent ${Math.round(tSkel.source.duration_ms / 1000)}s edit by SELECTING and ordering the right shots from this shot library.`,
    actions: goldKeep,
    producer: "library-puzzle-gold", label: "gold", task: "assemble",
    sourceDurationMs: tSkel.source.duration_ms,
    override: { reward: 1, checks: { validity: 1, selected_correct: 1, distractors: chosen.length } },
  });
  return { target: target.split("/").pop() || target, lib: labeled.length, gold: gold.length };
}
