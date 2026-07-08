import { gradeTopic } from "../cli/lib/intel.ts";
const day = (i: number) => new Date(Date.now() - (30 - i) * 86400000).toISOString().slice(0, 10);
const mk = (vals: number[][]) => ({ firstSeen: new Date(Date.now() - 40 * 86400000).toISOString(),
  series: vals.map((v, i) => ({ d: day(i), src: { tiktok: v[0], youtube: v[1] } })) });
const flat = mk(Array.from({ length: 30 }, () => [100, 100]));
const rising = mk(Array.from({ length: 30 }, (_, i) => [100 + i * 4, 100 + i * 3]));
const exploding = mk(Array.from({ length: 30 }, (_, i) => [100 + (i > 22 ? (i - 22) * 90 : i), 100 + (i > 22 ? (i - 22) * 70 : i)]));
const peaked = mk(Array.from({ length: 30 }, (_, i) => [i < 20 ? 100 + i * 50 : 1100 - (i - 20) * 60, 500]));
const vols = [200, 240, 1500, 1060];
const checks: [string, string, string][] = [
  ["flat", gradeTopic(flat, vols), "watching"],
  ["rising", gradeTopic(rising, vols), "rising"],
  ["exploding", gradeTopic(exploding, vols), "exploding"],
  ["peaked", gradeTopic(peaked, vols), "peaked"],
];
let fail = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
}
// determinism: same input twice
if (gradeTopic(exploding, vols) !== gradeTopic(exploding, vols)) { fail++; console.log("✗ determinism"); }
process.exit(fail ? 1 : 0);
