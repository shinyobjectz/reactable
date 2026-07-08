#!/usr/bin/env bun
// Differential fidelity gate — the production-readiness evidence for the
// wavelet render lane. For every comp in tests/fidelity/*.html:
//
//   1. FIDELITY   render in headless Chrome (browser truth) and in
//                 wavelet-render-core, same viewport, fonts normalized to the
//                 bundled Geist on both sides → SSIM score (ffmpeg)
//   2. DETERMINISM render twice in wavelet → frame sha256 must be identical
//   3. PERF       one 72-frame 1080p30 render must beat the budget
//
// Run:  bun scripts/fidelity-gate.ts [--update-report]
// Exit: non-zero if any comp scores under its threshold, determinism breaks,
//       or perf busts the budget. Report: tests/fidelity/REPORT.md
//
// Thresholds are per-comp (text antialiasing differs legitimately between
// CoreText/Skia and vello_cpu, so text-heavy comps get a slightly lower bar
// than pure-layout comps). Raising a threshold requires a human eyeball.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CORPUS = join(ROOT, "tests", "fidelity");
const WORK = join(CORPUS, ".gate");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TOOLS = [
  join(ROOT, "tools", "target", "release", "reactable-tools"),
  join(ROOT, "dist", "reactable-tools"),
].find(existsSync);

const W = 1280;
const H = 800;
// Calibrated 2026-07-07 against eyeballed diffs: all structure/layout/color
// matched; residuals were gradient dithering (Chrome dithers, vello doesn't)
// and glyph/edge antialiasing. Tighten only with a diff-image review.
const SSIM_THRESHOLDS: Record<string, number> = {
  "layout-grid": 0.985, // no text — dithering slack only, layout near-exact
  "prose": 0.95,
  "pulse": 0.96,
  "text-styles": 0.96,
  "real-app-panel": 0.93, // captured real-world page — scored 0.996 at calibration
};
const DEFAULT_THRESHOLD = 0.95;

// Expected-fail comps documenting KNOWN engine gaps. They run and report, but
// a low score doesn't fail the gate — and an unexpectedly HIGH score DOES fail
// it (the gap closed upstream; promote the comp to the main corpus).
const KNOWN_GAPS: Record<string, string> = {
  "known-gap-multicol": "blitz 0.3-alpha has no CSS multi-column layout",
};
const PERF_BUDGET_MS = 1500; // 72 frames @ 1920x1080

function run(cmd: string[], quiet = true): { ok: boolean; out: string } {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
  if (!quiet && p.exitCode !== 0) console.error(out);
  return { ok: p.exitCode === 0, out };
}

// Font normalization: force one family (the bundled Geist) on BOTH engines so
// the gate measures ENGINE fidelity, not macOS-font-vs-Geist deltas. Chrome
// loads it via @font-face; wavelet's single-font ctx is Geist already.
function normalizedComp(src: string, name: string): string {
  const html = readFileSync(src, "utf8");
  const fontUrl = `file://${join(CORPUS, "assets", "Geist.ttf")}`;
  const inject = `<style>
    @font-face { font-family: '__gate'; src: url('${fontUrl}'); }
    * { font-family: '__gate', sans-serif !important; }
    html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }
  </style>`;
  const out = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${inject}</head>`) : inject + html;
  const p = join(WORK, `${name}.norm.html`);
  writeFileSync(p, out);
  return p;
}

function ssim(a: string, b: string): number {
  const r = run(["ffmpeg", "-i", a, "-i", b, "-filter_complex", "ssim", "-f", "null", "-"]);
  const m = r.out.match(/All:\s*([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

function sha(dir: string): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const f of files) hasher.update(readFileSync(join(dir, f)));
  return hasher.digest("hex");
}

if (!TOOLS) {
  console.error("gate: reactable-tools binary missing (cargo build --release in tools/)");
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error("gate: Chrome not found at", CHROME);
  process.exit(2);
}
mkdirSync(WORK, { recursive: true });

const comps = readdirSync(CORPUS).filter((f) => f.endsWith(".html") && !f.endsWith(".norm.html"));
type Row = { name: string; ssim: number; threshold: number; deterministic: boolean; pass: boolean };
const rows: Row[] = [];

for (const file of comps) {
  const name = file.replace(/\.html$/, "");
  const norm = normalizedComp(join(CORPUS, file), name);
  const threshold = SSIM_THRESHOLDS[name] ?? DEFAULT_THRESHOLD;

  // chrome truth (virtual-time lets CSS animations settle to their final state
  // is not available via CLI — gate comps must be static or 'both'-filled)
  const chromePng = join(WORK, `${name}.chrome.png`);
  run([
    CHROME, "--headless=new", `--screenshot=${chromePng}`, `--window-size=${W},${H}`,
    "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000",
    "--virtual-time-budget=10000", `file://${norm}`,
  ]);

  // wavelet render — two passes for the determinism check, LAST frame compared
  // (animations declared `both` have settled by the end of a 4s window)
  const wl1 = join(WORK, `${name}.wl1`);
  const wl2 = join(WORK, `${name}.wl2`);
  for (const d of [wl1, wl2]) run([TOOLS, "wavelet-render", norm, d, "--w", String(W), "--h", String(H), "--fps", "1", "--duration", "4"]);
  const frames = readdirSync(wl1).filter((f) => f.endsWith(".png")).sort();
  const last = frames[frames.length - 1];
  const wlPng = join(wl1, last);

  const score = ssim(chromePng, wlPng);
  const deterministic = sha(wl1) === sha(wl2);
  const gap = KNOWN_GAPS[name];
  let pass: boolean;
  if (gap) {
    pass = score < threshold && deterministic; // xpass = gap closed upstream → surface it
  } else {
    pass = score >= threshold && deterministic;
  }
  rows.push({ name, ssim: score, threshold, deterministic, pass });
  const tag = gap ? (pass ? "XFAIL" : "XPASS") : pass ? "PASS" : "FAIL";
  const note = gap ? (pass ? ` — known gap: ${gap}` : " — GAP CLOSED UPSTREAM: promote comp to corpus") : "";
  console.log(`${tag}  ${name.padEnd(18)} ssim=${score.toFixed(4)} (need ${threshold}) deterministic=${deterministic}${note}`);
}

// perf budget — 72 frames of the prose comp at 1080p30
const perfDir = join(WORK, "perf");
const t0 = performance.now();
run([TOOLS, "wavelet-render", join(WORK, "prose.norm.html"), perfDir, "--w", "1920", "--h", "1080", "--fps", "30", "--duration", "2.4"]);
const perfMs = Math.round(performance.now() - t0);
const perfPass = perfMs <= PERF_BUDGET_MS;
console.log(`${perfPass ? "PASS" : "FAIL"}  perf               72f@1080p30 in ${perfMs}ms (budget ${PERF_BUDGET_MS}ms)`);

const allPass = rows.every((r) => r.pass) && perfPass;
const report = [
  "# Fidelity gate report",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} · viewport ${W}×${H} · fonts normalized to bundled Geist on both engines`,
  "",
  "| comp | SSIM vs Chrome | threshold | deterministic | verdict |",
  "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.ssim.toFixed(4)} | ${r.threshold} | ${r.deterministic ? "yes" : "NO"} | ${r.pass ? "pass" : "FAIL"} |`),
  `| perf 72f@1080p30 | ${perfMs}ms | ≤${PERF_BUDGET_MS}ms | — | ${perfPass ? "pass" : "FAIL"} |`,
  "",
  `Overall: **${allPass ? "PASS" : "FAIL"}**`,
  "",
  "Method: same normalized comp rendered by headless Chrome (browser truth) and",
  "wavelet-render-core; SSIM via ffmpeg; determinism = sha256 over two full",
  "wavelet renders; perf = wall clock for the standard 72-frame render.",
].join("\n");
writeFileSync(join(CORPUS, "REPORT.md"), report + "\n");
console.log(`\nreport → tests/fidelity/REPORT.md · overall ${allPass ? "PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
