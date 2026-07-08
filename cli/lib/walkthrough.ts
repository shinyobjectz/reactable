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

// One segment comp: the SNAPSHOT DOCUMENT IS the comp — we inject overlay
// styles + divs (title chip, cursor glide, click ripple) before </body>. The
// snapshot's own <body> classes/state selectors (e.g. body.pick) stay intact.
// Rendered at the snapshot's viewport size; concat scales to the target.
function stepComp(dir: string, step: WalkStep, i: number, dwell: number): { html: string; vw: number; vh: number } {
  const snapPath = resolve(dir, step.snapshot);
  let snapshot = readFileSync(snapPath, "utf8");
  const vw = step.vw ?? 1280;
  const vh = step.vh ?? 720;

  const click = step.click;
  const startX = vw * 0.5;
  const startY = vh * 0.82;
  const glideEnd = Math.min(1.2, dwell * 0.45);
  const cursorCss = click
    ? `@keyframes wl-glide {
        0% { transform: translate(${startX.toFixed(1)}px, ${startY.toFixed(1)}px); animation-timing-function: ease-in-out; }
        ${((glideEnd / dwell) * 100).toFixed(2)}% { transform: translate(${click.x.toFixed(1)}px, ${click.y.toFixed(1)}px); }
        100% { transform: translate(${click.x.toFixed(1)}px, ${click.y.toFixed(1)}px); }
      }
      .wl-cursor { position: fixed; left:-11px; top:-11px; width:22px; height:22px; border-radius:50%;
        background:rgba(255,255,255,.9); box-shadow:0 0 0 2px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.5); z-index:2147483000;
        animation: wl-glide ${dwell}s linear both; }
      @keyframes wl-ripple { 0%,${((glideEnd / dwell) * 100).toFixed(2)}% { opacity:0; transform:scale(.3); }
        ${(((glideEnd + 0.05) / dwell) * 100).toFixed(2)}% { opacity:.75; transform:scale(.35); }
        ${((Math.min(glideEnd + 0.65, dwell) / dwell) * 100).toFixed(2)}% { opacity:0; transform:scale(2.4); } 100% { opacity:0; } }
      .wl-ripple { position: fixed; left:${(click.x - 26).toFixed(1)}px; top:${(click.y - 26).toFixed(1)}px;
        width:52px; height:52px; border-radius:50%; border:3px solid rgba(129,140,248,.95); opacity:0; z-index:2147482999;
        animation: wl-ripple ${dwell}s linear both; }`
    : "";

  const chipFont = Math.max(15, Math.round(vh / 42));
  const chipCss = step.title
    ? `@keyframes wl-chip { 0% { opacity:0; transform:translate(-50%, 14px); animation-timing-function:ease-out; }
        ${((Math.min(0.5, dwell * 0.2) / dwell) * 100).toFixed(2)}% { opacity:1; transform:translate(-50%, 0); } 100% { opacity:1; transform:translate(-50%, 0); } }
      .wl-chip { position: fixed; left:50%; bottom:4.5%; z-index:2147483001;
        font:600 ${chipFont}px/1.3 sans-serif; letter-spacing:.01em; color:#fff; background:rgba(10,10,16,.85);
        border:1px solid rgba(129,140,248,.4); border-radius:999px; padding:.55em 1.3em;
        box-shadow:0 8px 30px rgba(0,0,0,.45); white-space:nowrap;
        animation: wl-chip ${dwell}s linear both; }`
    : "";

  const overlay = `<style>${cursorCss}\n${chipCss}</style>` +
    (click ? `<div class="wl-ripple"></div><div class="wl-cursor"></div>` : "") +
    (step.title ? `<div class="wl-chip">${step.title}</div>` : "");

  if (/<\/body>/i.test(snapshot)) {
    snapshot = snapshot.replace(/<\/body>/i, `${overlay}</body>`);
  } else {
    snapshot += overlay;
  }
  return { html: snapshot, vw, vh };
}

export function compileWalkthrough(dir: string, opts: { w?: number; h?: number } = {}) {
  const steps = readSteps(dir);
  if (!steps.length) throw new Error("no steps in walkthrough");
  const outDir = join(dir, "wavelet");
  mkdirSync(outDir, { recursive: true });
  const comps: { comp: string; dwell: number; vw: number; vh: number }[] = [];
  steps.forEach((s, i) => {
    const dwell = Math.max(1, s.dwell ?? 3);
    const { html, vw, vh } = stepComp(dir, s, i, dwell);
    const p = join(outDir, `step-${i}.comp.html`);
    writeFileSync(p, html);
    comps.push({ comp: p, dwell, vw, vh });
  });
  const vw = comps[0].vw;
  const vh = comps[0].vh;
  if (comps.some((c) => c.vw !== vw || c.vh !== vh)) throw new Error("all steps must share one viewport size");
  return { comps, vw, vh, w: opts.w ?? 1920, h: opts.h ?? 1080 };
}

export function renderWalkthrough(dir: string, opts: { w?: number; h?: number; fps?: number; lossless?: boolean } = {}) {
  const bin = toolsBinary();
  if (!bin) throw new Error("reactable-tools binary not found (cargo build --release in tools/)");
  const { comps, vw, vh, w, h } = compileWalkthrough(dir, opts);
  const fps = opts.fps ?? 30;
  const outDir = join(dir, "wavelet");
  const segs: string[] = [];
  comps.forEach(({ comp, dwell }, i) => {
    const seg = join(outDir, `step-${i}.mp4`);
    // Render at the SNAPSHOT viewport (CSS px) so responsive layout matches the
    // captured page exactly; the concat pass scales to the delivery size.
    const args = [
      "wavelet-render", comp, seg,
      "--w", String(vw), "--h", String(vh), "--fps", String(fps), "--duration", dwell.toFixed(3),
    ];
    if (opts.lossless) args.push("--lossless");
    const proc = Bun.spawnSync([bin, ...args], { stdout: "inherit", stderr: "inherit" });
    if (proc.exitCode !== 0) throw new Error(`wavelet-render step ${i} exited ${proc.exitCode}`);
    segs.push(seg);
  });
  const list = join(outDir, "concat.txt");
  writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n") + "\n");
  const out = join(dir, "walkthrough.mp4");
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=#0a0a0f`;
  const enc = opts.lossless ? ["-qp", "0", "-pix_fmt", "yuv444p"] : ["-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  const ff = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libx264", ...enc, out]);
  if (ff.exitCode !== 0) {
    throw new Error(`ffmpeg concat failed: ${new TextDecoder().decode(ff.stderr)}`);
  }
  rmSync(list);
  return { output: out, steps: segs.length, vw, vh, w, h, fps };
}
