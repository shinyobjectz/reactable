// wavelet take compiler — take (deck slides + events.jsonl) → ONE CSS-keyframe
// comp.html, rendered deterministically by `reactable-tools wavelet-render`.
// The stage track is REBUILT from data (slides, cursor, clicks, auto-zoom), so
// it re-renders lossless at any resolution/aspect; cam/mic stay real and keep
// their capture.* anchors. Everything is generated @keyframes + animation-delay
// — no JS — so the render-core clock (resolve(frame/fps)) steps it exactly.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiBase, takePath } from "./paths.ts";
import { readEvents, readTakeManifest } from "./take.ts";
import { toolsBinary } from "./tools.ts";

type Ev = { t: number; type: string; [k: string]: unknown };

// Deck typography, verbatim from present/index.work (the stage). TODO: serve as
// /reactable/deck-css so this copy can't drift.
const DECK_CSS = `
  html, body { margin:0; padding:0; width:100%; height:100%; background:#050508; overflow:hidden; }
  .work-prose { box-sizing:border-box; width:100%; color:#e8e8ec; font:20px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .work-prose .deck-h1 { font-size:clamp(2.4rem,5vw,3.75rem); font-weight:650; letter-spacing:-0.03em; line-height:1.08; margin:0 0 0.35em; color:#fff; }
  .work-prose .deck-h2 { font-size:clamp(1.5rem,3vw,2.25rem); font-weight:600; letter-spacing:-0.02em; line-height:1.15; margin:0 0 0.5em; color:#fff; }
  .work-prose .deck-h3 { font-size:1.25rem; font-weight:600; margin:0 0 0.4em; color:#f4f4f5; }
  .work-prose p { margin:0 0 1em; color:#a1a1aa; max-width:42rem; }
  .work-prose strong { color:#f4f4f5; font-weight:600; }
  .work-prose code, .work-prose .deck-code { font:0.86em ui-monospace, SFMono-Regular, Menlo, monospace !important; color:#c4b5fd !important; background:rgba(99,102,241,0.14) !important; border:1px solid rgba(129,140,248,0.35) !important; padding:0.12em 0.5em !important; border-radius:6px !important; }
  .work-prose .deck-list { margin:0.5em 0 1.25em; padding:0; list-style:none; max-width:44rem; }
  .work-prose .deck-list li { position:relative; padding:0.65em 0 0.65em 1.35em; border-bottom:1px solid rgba(255,255,255,.06); color:#a1a1aa; }
  .work-prose .deck-list li:last-child { border-bottom:0; }
  .work-prose .deck-list li::before { content:''; position:absolute; left:0; top:1.05em; width:6px; height:6px; border-radius:50%; background:#6366f1; }
  .work-prose.deck-title { min-height:100%; display:flex; flex-direction:column; justify-content:center; padding:8vh 10vw; background:radial-gradient(ellipse 80% 60% at 20% 0%, rgba(99,102,241,.22), transparent 55%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(168,85,247,.12), transparent 50%), #050508; }
  .work-prose.deck-section { min-height:100%; display:flex; flex-direction:column; justify-content:center; padding:8vh 10vw; background:#050508; border-top:3px solid #6366f1; }
  .work-prose.deck-body { padding:8vh 10vw; background:#050508; min-height:100%; }
`;

const pct = (t: number, total: number) => `${Math.max(0, Math.min(100, (t / total) * 100)).toFixed(4)}%`;

function mapPoint(ev: Ev, win: Record<string, number> | undefined, vw: number, vh: number) {
  let x = Number(ev.x ?? vw / 2);
  let y = Number(ev.y ?? vh / 2);
  if (win) {
    const s = Number(win.scale ?? 2);
    x = (x - Number(win.x ?? 0)) * s;
    y = (y - Number(win.yTop ?? 0)) * s;
  }
  return { x: Math.max(0, Math.min(vw, x)), y: Math.max(0, Math.min(vh, y)) };
}

export async function fetchDeckSlides(slug: string, port?: string) {
  const res = await fetch(`${apiBase(port)}/reactable/deck?slug=${encodeURIComponent(slug)}`);
  const json = (await res.json()) as { ok: boolean; slides?: { type?: string; body?: string; url?: string }[] };
  if (!json.ok || !json.slides) throw new Error(`deck fetch failed for ${slug}`);
  return json.slides;
}

export async function compileTakeComp(id: string, opts: { port?: string; root?: string } = {}) {
  const dir = takePath(id, opts.root);
  const manifest = readTakeManifest(id, opts.root) as Record<string, any>;
  const events = readEvents(id, opts.root) as Ev[];
  if (!events.length) throw new Error(`no events.jsonl in ${dir}`);

  const [vw, vh] = (manifest.resolution as [number, number]) ?? [1920, 1080];
  const win = manifest.capture_window as Record<string, number> | undefined;

  const stage = events.find((e) => e.type === "capture.stage");
  const t0 = Number(stage?.t ?? events[0].t);
  const tEnd = Number(events.find((e) => e.type === "record.stop")?.t ?? events[events.length - 1].t);
  const total = Math.max(0.5, tEnd - t0);
  const rel = (t: number) => Math.max(0, Number(t) - t0);

  // edit.json zoom prefs (recorder defaults: scale 1.5, hold 1.0s)
  let zoomPrefs = { enabled: true, scale: 1.5, duration: 1.0 };
  const editPath = join(dir, "edit.json");
  if (existsSync(editPath)) {
    try {
      zoomPrefs = { ...zoomPrefs, ...(JSON.parse(readFileSync(editPath, "utf8")).zoom ?? {}) };
    } catch {}
  }

  // ── slide track ──
  const slides = await fetchDeckSlides(String(manifest.deck ?? ""), opts.port);
  const slideEvents = events.filter((e) => e.type === "slide" || e.type === "event.slide");
  const windows: { idx: number; from: number; to: number }[] = [];
  slideEvents.forEach((e, i) => {
    const idx = Number((e as any).index ?? (e as any).idx ?? 0);
    const from = i === 0 ? 0 : rel(e.t);
    const to = i + 1 < slideEvents.length ? rel(slideEvents[i + 1].t) : total;
    windows.push({ idx, from, to });
  });
  if (!windows.length) windows.push({ idx: 0, from: 0, to: total });

  let slideSections = "";
  let slideKeyframes = "";
  windows.forEach((w, i) => {
    const slide = slides[w.idx] ?? slides[0] ?? { body: "" };
    const body =
      slide.type === "iframe" || slide.type === "dev" || slide.type === "youtube" || slide.type === "video"
        ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0a12;color:#71717a;font:16px ui-monospace,monospace">[pixel-fallback slide: ${slide.type} ${slide.url ?? ""}]</div>`
        : (slide.body ?? "");
    slideSections += `<section class="wl-slide" style="animation:wl-slide-${i} ${total}s steps(1,end) both">${body}</section>\n`;
    slideKeyframes += `@keyframes wl-slide-${i} { 0% { visibility:${w.from <= 0 ? "visible" : "hidden"}; } ${pct(w.from, total)} { visibility:visible; } ${w.to >= total ? "100% { visibility:visible; }" : `${pct(w.to, total)} { visibility:hidden; } 100% { visibility:hidden; }`} }\n`;
  });

  // ── cursor track ──
  const cursorEvents = events.filter((e) => e.type === "cursor");
  let cursorCss = "";
  let cursorDiv = "";
  if (cursorEvents.length > 1) {
    const maxStops = 600;
    const step = Math.max(1, Math.ceil(cursorEvents.length / maxStops));
    const stops = cursorEvents.filter((_, i) => i % step === 0);
    const frames = stops
      .map((e) => {
        const p = mapPoint(e, win, vw, vh);
        return `${pct(rel(e.t), total)} { transform: translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px); }`;
      })
      .join(" ");
    cursorCss = `@keyframes wl-cursor { ${frames} } .wl-cursor { position:absolute; left:-12px; top:-12px; width:24px; height:24px; border-radius:50%; background:rgba(255,255,255,.85); box-shadow:0 0 0 2px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.5); animation: wl-cursor ${total}s linear both; z-index:40; }`;
    cursorDiv = `<div class="wl-cursor"></div>`;
  }

  // ── click ripples ──
  const clicks = events.filter((e) => e.type === "click");
  let rippleCss = clicks.length
    ? `@keyframes wl-ripple { 0% { opacity:.7; transform:scale(.3); } 100% { opacity:0; transform:scale(2.2); } } .wl-ripple { position:absolute; width:56px; height:56px; margin:-28px 0 0 -28px; border-radius:50%; border:3px solid rgba(129,140,248,.9); opacity:0; z-index:39; }`
    : "";
  let rippleDivs = "";
  clicks.forEach((e, i) => {
    const p = mapPoint(e, win, vw, vh);
    rippleDivs += `<div class="wl-ripple" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;animation:wl-ripple .6s ease-out both;animation-delay:${rel(e.t).toFixed(3)}s"></div>\n`;
  });

  // ── auto-zoom (composite.py smoothstep port: ramp .6s → hold → ramp .6s,
  //    scale toward the click point; ease-in-out ≈ smoothstep) ──
  let zoomCss = "";
  if (zoomPrefs.enabled && clicks.length) {
    const ramp = 0.6;
    const hold = Math.max(0.27, Number(zoomPrefs.duration));
    const z = Number(zoomPrefs.scale);
    const stops: string[] = [`0% { transform:scale(1); transform-origin:50% 50%; }`];
    let cursor = 0;
    for (const e of clicks) {
      const p = mapPoint(e, win, vw, vh);
      const start = rel(e.t);
      if (start < cursor) continue; // overlapping zoom — keep the first
      const end = Math.min(total, start + ramp + hold + ramp);
      const ox = ((p.x / vw) * 100).toFixed(2);
      const oy = ((p.y / vh) * 100).toFixed(2);
      stops.push(
        `${pct(start, total)} { transform:scale(1); transform-origin:${ox}% ${oy}%; animation-timing-function:ease-in-out; }`,
        `${pct(start + ramp, total)} { transform:scale(${z}); transform-origin:${ox}% ${oy}%; }`,
        `${pct(end - ramp, total)} { transform:scale(${z}); transform-origin:${ox}% ${oy}%; animation-timing-function:ease-in-out; }`,
        `${pct(end, total)} { transform:scale(1); transform-origin:${ox}% ${oy}%; }`,
      );
      cursor = end;
    }
    stops.push(`100% { transform:scale(1); }`);
    zoomCss = `@keyframes wl-zoom { ${stops.join(" ")} } .wl-stage { animation: wl-zoom ${total}s linear both; }`;
  }

  const html = `<!doctype html>
<!-- generated by reactable wavelet take compiler — take ${id}, deck ${manifest.deck} -->
<html><head><style>
${DECK_CSS}
.wl-stage { position:absolute; inset:0; overflow:hidden; }
.wl-slide { position:absolute; inset:0; visibility:hidden; }
${slideKeyframes}
${cursorCss}
${rippleCss}
${zoomCss}
</style></head>
<body>
<div class="wl-stage">
${slideSections}
${rippleDivs}
${cursorDiv}
</div>
</body></html>
`;

  const outDir = join(dir, "wavelet");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "comp.html");
  writeFileSync(outPath, html);
  return { comp: outPath, duration: total, width: vw, height: vh, slides: windows.length, clicks: clicks.length, cursorStops: cursorEvents.length };
}

export async function renderWaveletTake(
  id: string,
  opts: { port?: string; root?: string; fps?: number; lossless?: boolean; w?: number; h?: number } = {},
) {
  const bin = toolsBinary();
  if (!bin) throw new Error("reactable-tools binary not found (cargo build --release in tools/)");
  const meta = await compileTakeComp(id, opts);
  const out = join(takePath(id, opts.root), "out", `wavelet${opts.lossless ? "-lossless" : ""}.mp4`);
  mkdirSync(join(takePath(id, opts.root), "out"), { recursive: true });
  const args = [
    "wavelet-render", meta.comp, out,
    "--w", String(opts.w ?? meta.width),
    "--h", String(opts.h ?? meta.height),
    "--fps", String(opts.fps ?? 30),
    "--duration", meta.duration.toFixed(3),
  ];
  if (opts.lossless) args.push("--lossless");
  const proc = Bun.spawnSync([bin, ...args], { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) throw new Error(`wavelet-render exited ${proc.exitCode}`);
  return { ...meta, output: out };
}
