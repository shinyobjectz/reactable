// Edit intel — the training flywheel (P0). Every edit we produce — ground-truth
// `autoedit`, `compose`, or (later) agent-authored — is logged as a tuple
//   { sidecar ref, intent, edit-spec, render, score }
// into `<project>/edit-intel/` so the editor model has a corpus + a reward
// signal. See docs/PLAN.omni-editing-model.work (§3 flywheel, §9-P0).
//
// Design rules:
// - Capture is BEST-EFFORT: it must never break the user's edit command.
// - The edit-spec (the training target) is stored out-of-line under specs/;
//   the episodes.jsonl index stays small and greppable.
// - Ground-truth edits are labelled "gold" (verified-correct by construction —
//   they ARE the target). Model-produced edits (P3+) are "model" and carry a
//   gate/checker score for RL/rejection-sampling.
// - Disable with REACTABLE_EDIT_INTEL=0.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { DATA_ROOT } from "./paths.ts";

export const EDIT_INTEL_SCHEMA = "edit-intel/1";

export function editIntelDir(root = DATA_ROOT): string {
  return join(root, "edit-intel");
}

const enabled = () => process.env.REACTABLE_EDIT_INTEL !== "0";

// Content identity for a render without keeping the whole file: sha256 of the
// first 8 MB + byte size. Mirrors video.ts::sha256Head so identity is
// comparable across lanes.
function fingerprint(path?: string | null): { bytes: number; sha256: string } | null {
  if (!path || !existsSync(path)) return null;
  try {
    const size = statSync(path).size;
    const h = createHash("sha256");
    h.update(readFileSync(path).subarray(0, 8 * 1024 * 1024));
    h.update(String(size));
    return { bytes: size, sha256: h.digest("hex") };
  } catch {
    return null;
  }
}

export type EditIntelScore = {
  produced: boolean; // an edit-spec was emitted
  rendered: boolean; // a render landed on disk
  render: { bytes: number; sha256: string } | null;
  label: "gold" | "model";
  // Gate/checker verdict — null for gold (ground-truth is the target, nothing
  // to compare against). Filled by the reward fn in P3+ for model outputs.
  gate: { ssim?: number; deterministic?: boolean; valid?: boolean } | null;
};

export type CaptureInput = {
  source: string; // "autoedit" | "compose" | "agent" | …
  take?: string | null; // take id when applicable
  media?: string | null; // absolute path to the source clip
  sidecar?: string | null; // absolute path to the footage-intel index.json
  intent?: string | null; // NL instruction (null for pure ground-truth)
  summary?: string | null; // human-readable label of the edit
  editSpec: unknown; // the edit plan/spec (the training target)
  render?: string | null; // absolute path to the rendered proof
  label?: "gold" | "model";
  gate?: EditIntelScore["gate"];
};

// Append one episode to the corpus. Returns the episode id (or null when
// disabled / on any failure — capture never throws).
export function captureEpisode(input: CaptureInput): { id: string; path: string } | null {
  if (!enabled()) return null;
  try {
    const dir = editIntelDir();
    const specsDir = join(dir, "specs");
    mkdirSync(specsDir, { recursive: true });

    const specJson = JSON.stringify(input.editSpec ?? null, null, 2);
    const digest = createHash("sha1").update(specJson).digest("hex").slice(0, 8);
    const id = `ep-${Date.now().toString(36)}-${digest}`;
    writeFileSync(join(specsDir, `${id}.json`), specJson);

    const renderOk = !!(input.render && existsSync(input.render));
    const score: EditIntelScore = {
      produced: input.editSpec != null,
      rendered: renderOk,
      render: renderOk ? fingerprint(input.render) : null,
      label: input.label ?? "gold",
      gate: input.gate ?? null,
    };

    const rel = (p?: string | null) => (p && existsSync(p) ? relative(DATA_ROOT, p) : null);
    const episode = {
      schema: EDIT_INTEL_SCHEMA,
      id,
      at: new Date().toISOString(),
      source: input.source,
      take: input.take ?? null,
      media: rel(input.media),
      sidecar: rel(input.sidecar),
      intent: input.intent ?? null,
      summary: input.summary ?? null,
      spec: relative(dir, join(specsDir, `${id}.json`)),
      render: rel(input.render),
      score,
    };
    appendFileSync(join(dir, "episodes.jsonl"), JSON.stringify(episode) + "\n");
    return { id, path: join(dir, "episodes.jsonl") };
  } catch (e: any) {
    // Flywheel capture is best-effort — never break the user's edit.
    console.error(`edit-intel capture skipped: ${e?.message ?? e}`);
    return null;
  }
}

export type EditIntelStats = {
  episodes: number;
  rendered: number;
  gold: number;
  model: number;
  sources: Record<string, number>;
  corpus: string;
};

export function editIntelStats(root = DATA_ROOT): EditIntelStats {
  const p = join(editIntelDir(root), "episodes.jsonl");
  const stats: EditIntelStats = {
    episodes: 0,
    rendered: 0,
    gold: 0,
    model: 0,
    sources: {},
    corpus: relative(root, editIntelDir(root)),
  };
  if (!existsSync(p)) return stats;
  for (const line of readFileSync(p, "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const e = JSON.parse(line);
      stats.episodes++;
      if (e.render) stats.rendered++;
      if (e.score?.label === "model") stats.model++;
      else stats.gold++;
      stats.sources[e.source] = (stats.sources[e.source] ?? 0) + 1;
    } catch {
      /* skip malformed line */
    }
  }
  return stats;
}
