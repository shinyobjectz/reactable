// Trajectory contract — the OUT keystone (docs/SPEC.action-space.work).
// Every edit any producer makes is logged as {context, actions, outcome:{reward},
// producer, label} to edit-intel/trajectories.jsonl. The §4 verifier-as-reward is
// the SAME function RLVR / Best-of-N / serve-time best-of-k all consume.
// Best-effort: must never break the user's edit. Disable with REACTABLE_EDIT_INTEL=0.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { editIntelDir } from "./edit-intel.ts";

export const TRAJECTORY_SCHEMA = "trajectory/1";
const enabled = () => process.env.REACTABLE_EDIT_INTEL !== "0";

export type Constraints = {
  target_duration_ms?: number;
  must_end_on?: string;
  max_shots?: number;
  reorder_allowed?: boolean;
};

// NL intent → checkable predicates (SPEC §3). CONSERVATIVE — only emit a
// constraint when the intent clearly states it. Do NOT invent constraints
// (that was the S2 over-editing regression).
export function deriveConstraints(intent: string): Constraints {
  const c: Constraints = {};
  const t = (intent || "").toLowerCase();
  const dur = t.match(/(\d+(?:\.\d+)?)\s*[-\s]?(seconds?|sec|s\b|minutes?|min|m\b)/);
  if (dur) c.target_duration_ms = Math.round(parseFloat(dur[1]) * (dur[2].startsWith("m") ? 60000 : 1000));
  const end = t.match(/end(?:s|ing)?\s+on\s+(?:a\s+|the\s+|clear\s+)*([a-z][a-z-]*)/);
  if (end) c.must_end_on = end[1];
  const ms = t.match(/(?:max|at most|no more than|only)\s+(\d+)\s+shots?/);
  if (ms) c.max_shots = parseInt(ms[1], 10);
  if (/reorder|rearrange|any order/.test(t)) c.reorder_allowed = true;
  return c;
}

// keep-plan → action vocabulary (SPEC §2)
export function planToActions(plan: any): any[] {
  const acts: any[] = [];
  for (const k of plan?.keep ?? []) {
    acts.push({ verb: "keep", shot: k.shot ?? null, in_ms: k.in_ms, out_ms: k.out_ms });
    if (k.zoom) acts.push({ verb: "punch", cx: k.zoom.cx, cy: k.zoom.cy, scale: k.zoom.scale });
  }
  return acts;
}

// §4 verifier-as-reward: gated composition in [0,1].
export function rewardTrajectory(
  actions: any[],
  constraints: Constraints,
  opts: { sourceDurationMs?: number; lastShotTags?: string[] } = {},
): { reward: number; checks: Record<string, number> } {
  const keeps = actions.filter((a) => a.verb === "keep");
  const checks: Record<string, number> = {};
  // 1. VALIDITY gate (hard) — this is what gemma failed on the complex clips.
  const valid = keeps.length > 0 && keeps.every(
    (k) => k.in_ms < k.out_ms && k.in_ms >= 0 && (!opts.sourceDurationMs || k.out_ms <= opts.sourceDurationMs + 1),
  );
  checks.validity = valid ? 1 : 0;
  if (!valid) return { reward: 0, checks };
  const durMs = keeps.reduce((a, k) => a + (k.out_ms - k.in_ms), 0);
  // 2. CONSTRAINT satisfaction
  const terms: number[] = [];
  if (constraints.target_duration_ms) {
    checks.duration = +Math.max(0, 1 - Math.abs(durMs - constraints.target_duration_ms) / constraints.target_duration_ms).toFixed(3);
    terms.push(checks.duration);
  }
  if (constraints.must_end_on && opts.lastShotTags) {
    const want = constraints.must_end_on;
    checks.ends_on = opts.lastShotTags.some((x) => x.includes(want) || want.includes(x)) ? 1 : 0;
    terms.push(checks.ends_on);
  }
  if (constraints.max_shots) {
    checks.max_shots = keeps.length <= constraints.max_shots ? 1 : 0;
    terms.push(checks.max_shots);
  }
  const constraintScore = terms.length ? terms.reduce((a, b) => a + b, 0) / terms.length : 1;
  // 3. PARSIMONY / craft — penalize a degenerate single shot for a montage-length target.
  const degenerate = !!constraints.target_duration_ms && constraints.target_duration_ms > 8000 && keeps.length <= 1;
  checks.parsimony = degenerate ? 0.3 : 1;
  const reward = +(0.7 * constraintScore + 0.3 * checks.parsimony).toFixed(3);
  return { reward, checks };
}

export type TrajectoryInput = {
  sourceDigest: string;
  intent: string;
  plan?: any; // keep-plan { keep: [...] } — OR pass `actions` directly
  actions?: any[]; // pre-encoded actions (for non-cut-down tasks like reframe)
  render?: string | null;
  producer: string; // "minimax" | "gemma-local" | "autoedit" | "reframe-gold" | ...
  label: "gold" | "model";
  task?: string; // "cut-down" (default) | "reframe" | "tighten" | "reassemble" | ...
  sourceDurationMs?: number;
  lastShotTags?: string[];
  override?: { reward: number; checks: Record<string, number> }; // task-specific verifier result
};

// One-call: derive constraints, encode actions, score, append the trajectory.
export function captureTrajectory(input: TrajectoryInput): { reward: number; checks: Record<string, number> } | null {
  if (!enabled()) return null;
  try {
    const constraints = deriveConstraints(input.intent);
    const actions = input.actions ?? planToActions(input.plan);
    const { reward, checks } = input.override ?? rewardTrajectory(actions, constraints, {
      sourceDurationMs: input.sourceDurationMs,
      lastShotTags: input.lastShotTags,
    });
    const rec = {
      schema: TRAJECTORY_SCHEMA,
      ts: new Date().toISOString(),
      task: input.task ?? "cut-down",
      context: { source_digest: input.sourceDigest, intent: input.intent, constraints },
      actions,
      outcome: { render: input.render ? input.render.split("/").pop() : null, checks, reward },
      producer: input.producer,
      label: input.label,
    };
    const dir = editIntelDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "trajectories.jsonl"), JSON.stringify(rec) + "\n");
    return { reward, checks };
  } catch {
    return null; // never break the edit
  }
}
