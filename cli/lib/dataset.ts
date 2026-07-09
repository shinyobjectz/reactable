// Edit intel — P4 dataset exporter. Turns the edit-intel corpus into an SFT
// chat dataset for the reconstruction task (serialized footage-intel scene
// graph → edit-skeleton/1 JSON), reusing the EXACT P3 prompt so the fine-tune
// targets the same task we baselined. docs/PLAN.omni-editing-model.work §7 SFT,
// §9-P4.
//
// One row per unique indexed clip in the corpus:
//   messages: [ {system: reconstruct rules}, {user: scene graph}, {assistant: skeleton} ]
// Targets are the DETERMINISTIC decompiler output (post tracklet-merge → clean).
// Deterministic train/val split (no RNG — reproducible).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DATA_ROOT } from "./paths.ts";
import { readIndex, readTracks, resolveRef } from "./video.ts";
import { decompile, mvcGroups, mvcTags } from "./decompile.ts";
import { serializeSidecar, RECONSTRUCT_SYSTEM } from "./baseline.ts";
import { editIntelDir } from "./edit-intel.ts";

export function datasetDir(): string {
  return join(editIntelDir(), "dataset");
}

export function exportDataset(opts: { valFrac?: number } = {}): any {
  const corpus = join(editIntelDir(), "episodes.jsonl");
  const seen = new Set<string>();
  const rows: any[] = [];
  const skipped: Record<string, number> = {};
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

  if (existsSync(corpus)) {
    for (const line of readFileSync(corpus, "utf8").trim().split("\n").filter(Boolean)) {
      let e: any;
      try { e = JSON.parse(line); } catch { bump("bad_json"); continue; }
      const media = e.media ? resolve(DATA_ROOT, e.media) : null;
      if (!media || !existsSync(media)) { bump("no_media"); continue; }
      if (seen.has(media)) { bump("dupe_clip"); continue; }
      seen.add(media);
      try {
        const ref = resolveRef(media);
        const idx = readIndex(ref);
        const tracks = readTracks(ref);
        const input = serializeSidecar(idx, tracks, mvcGroups(ref, idx.shots ?? []), mvcTags(ref, idx.shots ?? []));
        const target = decompile(ref); // clean skeleton (tracklet-merged)
        rows.push({
          messages: [
            { role: "system", content: RECONSTRUCT_SYSTEM },
            { role: "user", content: input },
            { role: "assistant", content: JSON.stringify(target) },
          ],
          meta: { clip: e.media, source: e.source, segments: target.timeline.length },
        });
      } catch (err: any) {
        bump("unindexed_or_error");
      }
    }
  }

  // Deterministic split: every stride-th row → val (no RNG → reproducible).
  const valFrac = opts.valFrac ?? 0.2;
  const stride = valFrac > 0 ? Math.max(2, Math.round(1 / valFrac)) : 0;
  const train: any[] = [], val: any[] = [];
  rows.forEach((r, i) => (stride && i % stride === 0 ? val : train).push(r));

  const dir = datasetDir();
  mkdirSync(dir, { recursive: true });
  const write = (name: string, xs: any[]) => writeFileSync(join(dir, name), xs.map((r) => JSON.stringify(r)).join("\n") + (xs.length ? "\n" : ""));
  write("train.jsonl", train);
  write("val.jsonl", val);

  const targetChars = rows.map((r) => r.messages[2].content.length);
  return {
    pairs: rows.length,
    train: train.length,
    val: val.length,
    dir,
    by_source: rows.reduce((a: Record<string, number>, r) => { a[r.meta.source] = (a[r.meta.source] ?? 0) + 1; return a; }, {}),
    avg_target_chars: rows.length ? Math.round(targetChars.reduce((a, b) => a + b, 0) / rows.length) : 0,
    est_tokens_per_pair: rows.length ? Math.round((RECONSTRUCT_SYSTEM.length + targetChars.reduce((a, b) => a + b, 0) / rows.length) / 4) : 0,
    skipped,
    note: rows.length < 200 ? "corpus is small — scale synth pairs + real takes before a real fine-tune (§7: 2–5k for ~80% of value)" : undefined,
  };
}
