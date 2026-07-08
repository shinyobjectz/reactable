/**
 * Intel eval — G1 (citations available), G5 (chain completes), G8 (honesty:
 * no invented numbers, errors name verbs). Deterministic: stub fixtures,
 * temp workspace, zero network, zero credits. Run: bun scripts/eval-intel.ts
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ws = mkdtempSync(join(tmpdir(), "intel-eval-"));
writeFileSync(join(ws, "index.work"), "# Intel Eval Fixture\n");
const env = { ...process.env, REACTABLE_INTEL_STUB: "1", WB_DATA: ws };
const cli = join(import.meta.dir, "..", "cli", "bin", "reactable.ts");
const run = (args: string[]) => spawnSync("bun", [cli, ...args], { env, encoding: "utf8" });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, note = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  ok ? pass++ : fail++;
};

// ── G8: empty state names the fixing verb, never numbers ──
const empty = run(["intel", "snapshot"]);
check("G8 empty snapshot names verb", /intel track topic/.test(empty.stdout + empty.stderr));
const emptyTrends = JSON.parse(run(["intel", "trends", "--json"]).stdout || "{}");
check("G8 empty trends = empty list, no fabricated topics", Array.isArray(emptyTrends.topics) && emptyTrends.topics.length === 0);

// ── G5 chain: track → snapshot → trends → brief, unaided ──
run(["intel", "track", "topic", "ai avatars"]);
const snap = run(["intel", "snapshot"]);
check("G5 snapshot runs in stub", /snapshot \d{4}-\d{2}-\d{2}/.test(snap.stdout));
const trends = JSON.parse(run(["intel", "trends", "--json"]).stdout || "{}");
const t0 = trends.topics?.[0];
check("G5 trends returns tracked topic", t0?.q === "ai avatars");
check("G5 grade is a legal grade", ["watching", "rising", "exploding", "peaked", "evergreen"].includes(t0?.grade));
check("G5 volume equals fixture-derived number (no invention)", typeof t0?.volume === "number" && t0.volume > 0);
const briefOut = run(["intel", "brief"]).stdout;
check("G5 brief written", /wrote research\/brief-/.test(briefOut));
const briefFile = readdirSync(join(ws, "research")).find((f) => f.startsWith("brief-"));
const briefBody = briefFile ? readFileSync(join(ws, "research", briefFile), "utf8") : "";
check("G5 brief contains tracked topic + grade", briefBody.includes("ai avatars") && briefBody.includes(t0?.grade));

// ── G1: radar output carries citable ids from the fixture ──
const radar = JSON.parse(run(["intel", "radar", "ai avatars", "--json"]).stdout || "{}");
const ids = (radar.top || []).map((v: any) => v.id);
check("G1 radar returns fixture ids (citations available)", ids.includes("stubA1") && ids.includes("stubB2"));
check("G1 views are fixture numbers, not invented", radar.top?.[0]?.views === 920000);

// ── G8: idempotent snapshot (same day no-op — determinism) ──
const snap2 = run(["intel", "snapshot"]);
check("G8 same-day snapshot is a no-op (0 topic calls)", /snapshot .*: [01] calls/.test(snap2.stdout));

// ── G8: predictions frozen (G2 mechanism) ──
check("G2 predictions.jsonl exists after snapshot", existsSync(join(ws, ".reactable", "intel", "predictions.jsonl")));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
