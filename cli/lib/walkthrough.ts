// P3 — agent walkthrough → video, zero screen recording.
// A walkthrough dir is structured data an agent writes while driving a browser:
//   steps.jsonl  — {"type":"step","title","snapshot":"step-0.html","dwell":3,
//                   "click":{"x","y"},"vw","vh"} per step (viewport coords)
//   step-N.html  — self-contained DOM snapshot (inlined CSS, scripts stripped)
// Each step renders as its OWN comp segment (snapshot + title chip + synthetic
// cursor gliding to the click + ripple) via `reactable-tools wavelet-render`,
// then ffmpeg concats segments into walkthrough.mp4. Per-step isolation means
// snapshot CSS can never collide across steps.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { toolsBinary, } from "./tools.ts";

export type WalkStep = {
  type: "step";
  title?: string;
  snapshot: string;
  dwell?: number; // seconds on this step (default 3)
  click?: { x: number; y: number }; // viewport px — cursor glides here, ripple fires
  vw?: number;
  vh?: number;
};

function readSteps(dir: string): WalkStep[] {
  const p = join(dir, "steps.jsonl");
  if (!existsSync(p)) throw new Error(`no steps.jsonl in ${dir}`);
  return readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((s: WalkStep) => s.type === "step");
}

// One segment comp: the snapshot fills the stage; a title chip fades in; the
// cursor glides from a neutral position to the click point, ripples, dwells.
function stepComp(dir: string, step: WalkStep, i: number, w: number, h: number, dwell: number): string {
  const snapPath = resolve(dir, step.snapshot);
  const snapshot = readFileSync(snapPath, "utf8");
  // scale the snapshot's viewport onto the render resolution
  const vw = step.vw ?? w;
  const vh = step.vh ?? h;
  const scale = Math.min(w / vw, h / vh);

  const click = step.click;
  const startX = vw * 0.5;
  const startY = vh * 0.82;
  const glideEnd = Math.min(1.2, dwell * 0.45);
  const cursor = click
    ? `<div class="wl-cursor" style="animation: wl-glide ${dwell}s linear both"></div>`
    : "";
  const cursorCss = click
    ? `@keyframes wl-glide {
        0% { transform: translate(${startX.toFixed(1)}px, ${startY.toFixed(1)}px); animation-timing-function: ease-in-out; }
        ${((glideEnd / dwell) * 100).toFixed(2)}% { transform: translate(${click.x.toFixed(1)}px, ${click.y.toFixed(1)}px); }
        100% { transform: translate(${click.x.toFixed(1)}px, ${click.y.toFixed(1)}px); }
      }
      .wl-cursor { position:absolute; left:-11px; top:-11px; width:22px; height:22px; border-radius:50%;
        background:rgba(255,255,255,.9); box-shadow:0 0 0 2px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.5); z-index:60; }
      @keyframes wl-ripple { 0%,${(((glideEnd) / dwell) * 100).toFixed(2)}% { opacity:0; transform:scale(.3); }
        ${(((glideEnd + 0.05) / dwell) * 100).toFixed(2)}% { opacity:.75; transform:scale(.35); }
        ${(((Math.min(glideEnd + 0.65, dwell)) / dwell) * 100).toFixed(2)}% { opacity:0; transform:scale(2.4); } 100% { opacity:0; } }
      .wl-ripple { position:absolute; left:${(click.x - 26).toFixed(1)}px; top:${(click.y - 26).toFixed(1)}px;
        width:52px; height:52px; border-radius:50%; border:3px solid rgba(129,140,248,.95); opacity:0; z-index:59;
        animation: wl-ripple ${dwell}s linear both; }`
    : "";
  const ripple = click ? `<div class="wl-ripple"></div>` : "";

  const chip = step.title
    ? `<div class="wl-chip" style="animation: wl-chip ${dwell}s linear both">${step.title}</div>`
    : "";
  const chipCss = step.title
    ? `@keyframes wl-chip { 0% { opacity:0; transform:translateY(14px); animation-timing-function:ease-out; }
        ${((Math.min(0.5, dwell * 0.2) / dwell) * 100).toFixed(2)}% { opacity:1; transform:translateY(0); } 100% { opacity:1; } }
      .wl-chip { position:absolute; left:50%; bottom:4.5%; transform:translateX(-50%); z-index:70;
        font:600 ${Math.round(h / 42)}px/1.3 sans-serif; letter-spacing:.01em; color:#fff; background:rgba(10,10,16,.82);
        border:1px solid rgba(129,140,248,.4); border-radius:999px; padding:.55em 1.3em;
        box-shadow:0 8px 30px rgba(0,0,0,.45); white-space:nowrap; }`
    : "";

  return `<!doctype html>
<!-- walkthrough step ${i} — generated; snapshot inlined below in an isolated frame -->
<html><head><style>
  html, body { margin:0; padding:0; width:${w}px; height:${h}px; background:#0a0a0f; overflow:hidden; }
  .wl-viewport { position:absolute; left:${((w - vw * scale) / 2).toFixed(1)}px; top:${((h - vh * scale) / 2).toFixed(1)}px;
    width:${vw}px; height:${vh}px; transform:scale(${scale.toFixed(4)}); transform-origin:top left; overflow:hidden; }
  ${cursorCss}
  ${chipCss}
</style></head>
<body>
  <div class="wl-viewport">
    <iframe-substitute>
${snapshot}
    </iframe-substitute>
    ${ripple}
    ${cursor}
  </div>
  ${chip}
</body></html>`;
}

// Blitz has no <iframe>; the snapshot is a full html document we must nest.
// Strategy: strip its outer <html>/<head>/<body> shells, hoist its <style>
// blocks scoped under the step viewport, and inline the body content.
function inlineSnapshot(comp: string): string {
  const m = comp.match(/<iframe-substitute>([\s\S]*)<\/iframe-substitute>/);
  if (!m) return comp;
  let snap = m[1];
  const styles = [...snap.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].map((x) => x[0]).join("\n");
  const bodyMatch = snap.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : snap.replace(/<\/?(!doctype|html|head|body)[^>]*>/gi, "");
  return comp.replace(m[0], `${styles}\n<div class="wl-snap" style="position:absolute;inset:0">${content}</div>`);
}

export function compileWalkthrough(dir: string, opts: { w?: number; h?: number } = {}) {
  const steps = readSteps(dir);
  if (!steps.length) throw new Error("no steps in walkthrough");
  const w = opts.w ?? 1920;
  const h = opts.h ?? 1080;
  const outDir = join(dir, "wavelet");
  mkdirSync(outDir, { recursive: true });
  const comps: { comp: string; dwell: number }[] = [];
  steps.forEach((s, i) => {
    const dwell = Math.max(1, s.dwell ?? 3);
    const comp = inlineSnapshot(stepComp(dir, s, i, w, h, dwell));
    const p = join(outDir, `step-${i}.comp.html`);
    writeFileSync(p, comp);
    comps.push({ comp: p, dwell });
  });
  return { comps, w, h };
}

export function renderWalkthrough(dir: string, opts: { w?: number; h?: number; fps?: number; lossless?: boolean } = {}) {
  const bin = toolsBinary();
  if (!bin) throw new Error("reactable-tools binary not found (cargo build --release in tools/)");
  const { comps, w, h } = compileWalkthrough(dir, opts);
  const fps = opts.fps ?? 30;
  const outDir = join(dir, "wavelet");
  const segs: string[] = [];
  comps.forEach(({ comp, dwell }, i) => {
    const seg = join(outDir, `step-${i}.mp4`);
    const args = [
      "wavelet-render", comp, seg,
      "--w", String(w), "--h", String(h), "--fps", String(fps), "--duration", dwell.toFixed(3),
    ];
    if (opts.lossless) args.push("--lossless");
    const proc = Bun.spawnSync([bin, ...args], { stdout: "inherit", stderr: "inherit" });
    if (proc.exitCode !== 0) throw new Error(`wavelet-render step ${i} exited ${proc.exitCode}`);
    segs.push(seg);
  });
  const list = join(outDir, "concat.txt");
  writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n") + "\n");
  const out = join(dir, "walkthrough.mp4");
  const ff = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  if (ff.exitCode !== 0) {
    throw new Error(`ffmpeg concat failed: ${new TextDecoder().decode(ff.stderr)}`);
  }
  rmSync(list);
  return { output: out, steps: segs.length, w, h, fps };
}
