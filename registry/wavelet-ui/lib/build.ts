#!/usr/bin/env bun
// wavelet-ui builder — regenerates everything derived from components.ts:
//   tests/fidelity/registry/<name>.html   gate demo comps (end-state parity)
//   skill/verbs/wavelet-ui.md             per-component skill reference
//   registry/wavelet-ui/PORT-STATUS.json  Remocn coverage ledger (135 comps)
// Run after any component change:  bun registry/wavelet-ui/lib/build.ts

import { mkdirSync, readdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMPONENTS, demoPage } from "../components.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const GATE_DIR = join(ROOT, "tests", "fidelity", "registry");
const SKILL_REF = join(ROOT, "skill", "verbs", "wavelet-ui.md");
const STATUS = join(ROOT, "registry", "wavelet-ui", "PORT-STATUS.json");
const VENDOR_R = join(ROOT, "vendor", "remocn", "r");

mkdirSync(GATE_DIR, { recursive: true });

// ── gate demos ──
for (const c of COMPONENTS) {
  const frag = c.generate({ ...defaults(c), ...c.demoProps });
  writeFileSync(join(GATE_DIR, `${c.name}.html`), demoPage(frag, { title: c.title }));
}
function defaults(c: (typeof COMPONENTS)[number]) {
  return Object.fromEntries(Object.entries(c.props).map(([k, v]) => [k, v.default]));
}

// ── skill reference ──
const byCat = new Map<string, typeof COMPONENTS>();
for (const c of COMPONENTS) {
  byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
}
const skill = [
  "# wavelet-ui — animated components for decks and comps",
  "",
  "Remocn ports (motion values 1:1) rendered by the deterministic wavelet lane.",
  "Every component emits self-contained CSS keyframes — no JS at render time.",
  "",
  "## Verbs",
  "```",
  "reactable ui list                 # all components (name · category · title)",
  "reactable ui show <name>          # props + defaults + description",
  "reactable ui demo <name> [out]    # write a standalone demo comp html",
  "reactable ui add <name> --props '{...}' [out]   # emit a fragment/page with your props",
  "```",
  "Render any emitted page: `reactable-tools wavelet-render <page.html> out.mp4 --duration 2.5`.",
  "Components marked *filter-dependent* use CSS `filter:` — full fidelity in the",
  "Chrome/HyperFrames lane; wavelet-native paints them without the blur channel",
  "until the render-core filter pass lands (tracked in the fidelity gate).",
  "",
  ...[...byCat.entries()].flatMap(([cat, comps]) => [
    `## ${cat}`,
    "",
    ...comps.flatMap((c) => [
      `### ${c.name}${c.filterDependent ? " *(filter-dependent)*" : ""}`,
      c.description,
      "",
      "| prop | default | doc |",
      "|---|---|---|",
      ...Object.entries(c.props).map(([k, v]) => `| ${k} | \`${JSON.stringify(v.default)}\` | ${v.doc} |`),
      "",
    ]),
  ]),
].join("\n");
writeFileSync(SKILL_REF, skill + "\n");

// ── port-status ledger ──
const all = existsSync(VENDOR_R) ? readdirSync(VENDOR_R).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
const ported = new Set(COMPONENTS.map((c) => c.source));
// registry plumbing (not visual components) + sub-items covered by a parent port
for (const k of ["registry", "remocn-ui", "dropdown-menu-item", "command-menu-item", "cursor"]) ported.add(k);
const status = {
  source: "github.com/Remocn/remocn",
  total: all.length,
  ported: [...ported].sort(),
  pending: all.filter((n) => !ported.has(n)).sort(),
};
writeFileSync(STATUS, JSON.stringify(status, null, 2) + "\n");

console.log(`wavelet-ui build: ${COMPONENTS.length} components → ${GATE_DIR}`);
console.log(`skill ref → ${SKILL_REF}`);
console.log(`port status: ${status.ported.length}/${status.total} ported, ${status.pending.length} pending`);
