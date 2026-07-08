// wavelet-ui wave 2 — motion atoms, transitions, backgrounds (Remocn ports,
// values verbatim from vendor/remocn/src). See components.ts for the contract.

import {
  centerFill,
  escapeHtml,
  freshId,
  sec,
  splitSpans,
  staggeredText,
} from "./lib/motion.ts";
import type { UIComponent } from "./components.ts";

const textDefaults = {
  text: { default: "Ship it today", doc: "content to animate" },
  fontSize: { default: 72, doc: "px" },
  color: { default: "#f4f4f5", doc: "text color" },
  fontWeight: { default: 600, doc: "font weight" },
  speed: { default: 1, doc: "playback multiplier" },
};

const wrapper = (p: any, tracking = "-0.03em") =>
  `font-size:${p.fontSize}px; font-weight:${p.fontWeight}; color:${p.color}; letter-spacing:${tracking}; font-family:sans-serif;`;

export const WAVE2: UIComponent[] = [
  // ── spinner — 6°/frame rotation = 2s/rev linear infinite (CSS ring arc)
  {
    name: "spinner",
    title: "Spinner",
    category: "ui",
    description: "Continuous rotating arc — the loading motion atom.",
    source: "spinner",
    props: {
      size: { default: 20, doc: "px" },
      color: { default: "#f4f4f5", doc: "arc color" },
      strokeWidth: { default: 2.5, doc: "ring thickness px" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { size: 64, strokeWidth: 6 },
    generate: (p) => {
      const id = freshId("spin");
      const s = p.size ?? 20;
      const rev = +(2 / (p.speed ?? 1)).toFixed(3);
      const css = [
        `@keyframes ${id} { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`,
        `.${id} { width:${s}px; height:${s}px; border-radius:50%; border:${p.strokeWidth ?? 2.5}px solid transparent; border-top-color:${p.color ?? "#f4f4f5"}; border-right-color:${p.color ?? "#f4f4f5"}; animation:${id} ${rev}s linear infinite; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"></div>` });
    },
  },

  // ── typing-indicator — dots bob on a sine wave, phase-staggered
  {
    name: "typing-indicator",
    title: "Typing Indicator",
    category: "ui",
    description: "Dots bobbing in a phased sine wave — chat 'typing…'.",
    source: "typing-indicator",
    props: {
      dotCount: { default: 3, doc: "dots" },
      color: { default: "#a1a1aa", doc: "dot color" },
      size: { default: 8, doc: "dot px" },
      gap: { default: 5, doc: "px between dots" },
      amplitude: { default: 6, doc: "bob px" },
      cyclesPerSecond: { default: 1.2, doc: "wave speed" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { size: 14, gap: 9, amplitude: 10 },
    generate: (p) => {
      const id = freshId("tyi");
      const n = p.dotCount ?? 3;
      const amp = p.amplitude ?? 6;
      const period = +(1 / ((p.cyclesPerSecond ?? 1.2) * (p.speed ?? 1))).toFixed(3);
      // wave = (sin+1)/2 sampled at quarter-cycle; ease-in-out ≈ sine arcs
      const wave = (w: number) => `opacity:${(0.45 + 0.55 * w).toFixed(3)}; transform:translateY(${(-amp * w).toFixed(2)}px)`;
      const css = [
        `@keyframes ${id} { 0% { ${wave(0.5)}; animation-timing-function:ease-in-out; } 25% { ${wave(1)}; animation-timing-function:ease-in-out; } 50% { ${wave(0.5)}; animation-timing-function:ease-in-out; } 75% { ${wave(0)}; animation-timing-function:ease-in-out; } 100% { ${wave(0.5)}; } }`,
        `.${id} { display:flex; gap:${p.gap ?? 5}px; align-items:center; }`,
        `.${id} span { display:inline-block; width:${p.size ?? 8}px; height:${p.size ?? 8}px; border-radius:50%; background:${p.color ?? "#a1a1aa"}; animation:${id} ${period}s linear infinite; }`,
      ].join("\n");
      const dots = Array.from({ length: n }, (_, i) => {
        const stagger = period / (n * 2);
        const delay = +(((period - (i * stagger)) % period)).toFixed(3);
        return `<span style="animation-delay:${delay}s"></span>`;
      }).join("");
      return centerFill({ css, html: `<div class="${id}">${dots}</div>` });
    },
  },

  // ── caret — blinking input caret
  {
    name: "caret",
    title: "Caret",
    category: "ui",
    description: "Blinking text caret block.",
    source: "caret",
    props: {
      height: { default: 40, doc: "px" },
      color: { default: "#f4f4f5", doc: "caret color" },
      blinkSeconds: { default: 1, doc: "blink cycle" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { height: 72 },
    generate: (p) => {
      const id = freshId("crt");
      const cyc = +((p.blinkSeconds ?? 1) / (p.speed ?? 1)).toFixed(3);
      const css = [
        `@keyframes ${id} { 0%, 49% { opacity:1; } 50%, 100% { opacity:0; } }`,
        `.${id} { display:inline-block; width:${Math.max(2, Math.round((p.height ?? 40) * 0.08))}px; height:${p.height ?? 40}px; background:${p.color ?? "#f4f4f5"}; animation:${id} ${cyc}s steps(1,end) infinite; }`,
      ].join("\n");
      return centerFill({ css, html: `<span class="${id}"></span>` });
    },
  },

  // ── skeleton-block — sweep band positionX 100→-100 (source math)
  {
    name: "skeleton-block",
    title: "Skeleton Block",
    category: "ui",
    description: "Loading placeholder with a sweeping highlight band.",
    source: "skeleton-block",
    props: {
      width: { default: 320, doc: "px" },
      height: { default: 20, doc: "px" },
      radius: { default: 6, doc: "px" },
      base: { default: "#26262e", doc: "base color" },
      highlight: { default: "#3f3f49", doc: "band color" },
      sweepSeconds: { default: 1.4, doc: "sweep cycle" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { width: 420, height: 28 },
    generate: (p) => {
      const id = freshId("skb");
      const cyc = +((p.sweepSeconds ?? 1.4) / (p.speed ?? 1)).toFixed(3);
      const css = [
        `@keyframes ${id} { from { background-position: 150% 0; } to { background-position: -150% 0; } }`,
        `.${id} { width:${p.width ?? 320}px; height:${p.height ?? 20}px; border-radius:${p.radius ?? 6}px; background: linear-gradient(100deg, ${p.base} 38%, ${p.highlight} 50%, ${p.base} 62%) 150% 0 / 220% 100% no-repeat, ${p.base}; animation:${id} ${cyc}s linear infinite; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"></div>` });
    },
  },

  // ── short-slide-right — line slides from left 16f, words fade 6f stagger 3f
  {
    name: "short-slide-right",
    title: "Short Slide Right",
    category: "text",
    description: "The whole line glides rightward into place while words fade in sequence.",
    source: "short-slide-right",
    props: { ...textDefaults, distance: { default: 24, doc: "slide px" }, staggerDelay: { default: 3, doc: "frames between words" } },
    demoProps: { text: "Short slide right" },
    generate: (p) => {
      const id = freshId("ssr");
      const speed = p.speed ?? 1;
      const css = [
        `@keyframes ${id}-line { from { transform:translateX(-${p.distance ?? 24}px); } to { transform:translateX(0); } }`,
        `@keyframes ${id}-w { from { opacity:0; } to { opacity:1; } }`,
        `.${id} { display:inline-block; animation:${id}-line ${sec(16, speed)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; ${wrapper(p)} }`,
        `.${id} > span { display:inline-block; white-space:pre; animation:${id}-w ${sec(6, speed)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
      ].join("\n");
      const words = splitSpans(p.text, "word");
      const html = `<span class="${id}">` + words.map((w, i) =>
        `<span style="animation-delay:${sec(i * (p.staggerDelay ?? 3), speed)}s;${i < words.length - 1 ? "margin-right:0.28em;" : ""}">${escapeHtml(w)}</span>`).join("") + `</span>`;
      return centerFill({ css, html });
    },
  },

  // ── shared-axis-y — words: exit up 4f/stagger 2, enter from below 5f/stagger 2, micro 1f
  {
    name: "shared-axis-y",
    title: "Shared Axis Y",
    category: "transition",
    description: "Material shared-axis vertical swap — outgoing words lift away, incoming rise in, per-word staggers.",
    source: "shared-axis-y",
    props: {
      from: { default: "Before state", doc: "outgoing text" },
      to: { default: "After state", doc: "incoming text" },
      ...textDefaults,
    },
    demoProps: { from: "Shared axis", to: "Y transition" },
    generate: (p) => {
      const id = freshId("say");
      const speed = p.speed ?? 1;
      const exitDur = 4, enterDur = 5, exitStagger = 2, enterStagger = 2, micro = 1;
      const fromWords = splitSpans(p.from ?? "", "word");
      const toWords = splitSpans(p.to ?? "", "word");
      const css = [
        `@keyframes ${id}-out { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(-14px); } }`,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { position:relative; display:grid; place-items:center; ${wrapper(p)} }`,
        `.${id} > span { grid-area:1/1; white-space:nowrap; }`,
        `.${id} .out > span { display:inline-block; white-space:pre; animation:${id}-out ${sec(exitDur, speed)}s cubic-bezier(0.4, 0, 1, 1) both; }`,
        `.${id} .in > span { display:inline-block; white-space:pre; animation:${id}-in ${sec(enterDur, speed)}s cubic-bezier(0.2, 0, 0, 1) both; }`,
      ].join("\n");
      const row = (words: string[], cls: string, base: number, stagger: number) =>
        `<span class="${cls}">` + words.map((w, i) =>
          `<span style="animation-delay:${sec(base + i * stagger, speed)}s;${i < words.length - 1 ? "margin-right:0.28em;" : ""}">${escapeHtml(w)}</span>`).join("") + `</span>`;
      const html = `<div class="${id}">${row(fromWords, "out", 0, exitStagger)}${row(toWords, "in", exitDur + micro, enterStagger)}</div>`;
      return centerFill({ css, html });
    },
  },

  // ── shared-axis-z — exit scale 1→1.06 over 11f, enter 0.96→1 over 16f, overlap 3f
  {
    name: "shared-axis-z",
    title: "Shared Axis Z",
    category: "transition",
    description: "Material shared-axis depth swap — outgoing grows and fades, incoming settles from slightly small.",
    source: "shared-axis-z",
    props: {
      from: { default: "Before state", doc: "outgoing text" },
      to: { default: "After state", doc: "incoming text" },
      ...textDefaults,
    },
    demoProps: { from: "Shared axis", to: "Z transition" },
    generate: (p) => {
      const id = freshId("saz");
      const speed = p.speed ?? 1;
      const css = [
        `@keyframes ${id}-out { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(1.06); } }`,
        `@keyframes ${id}-in { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }`,
        `.${id} { position:relative; display:grid; place-items:center; ${wrapper(p)} }`,
        `.${id} > span { grid-area:1/1; white-space:nowrap; }`,
        `.${id} .out { animation:${id}-out ${sec(11, speed)}s cubic-bezier(0.4, 0, 1, 1) both; }`,
        `.${id} .in { animation:${id}-in ${sec(16, speed)}s cubic-bezier(0.2, 0, 0, 1) both; animation-delay:${sec(11 - 3 + 1, speed)}s; }`,
      ].join("\n");
      const html = `<div class="${id}"><span class="out">${escapeHtml(p.from ?? "")}</span><span class="in">${escapeHtml(p.to ?? "")}</span></div>`;
      return centerFill({ css, html });
    },
  },

  // ── infinite-marquee — duplicated track, pixelsPerFrame drift, seamless loop
  {
    name: "infinite-marquee",
    title: "Infinite Marquee",
    category: "background",
    description: "Seamless looping text band (duplicated track, linear drift).",
    source: "infinite-marquee",
    props: {
      text: { default: "ship · build · animate · ", doc: "repeated segment" },
      fontSize: { default: 120, doc: "px" },
      color: { default: "#f4f4f5", doc: "text color" },
      fontWeight: { default: 900, doc: "weight" },
      pixelsPerFrame: { default: 4, doc: "drift speed" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { fontSize: 96 },
    generate: (p) => {
      const id = freshId("mrq");
      const fs = p.fontSize ?? 120;
      const text = p.text ?? "ship · build · animate · ";
      const approx = Math.round(text.length * fs * 0.55);
      const secsPerLoop = +((approx / ((p.pixelsPerFrame ?? 4) * 30)) / (p.speed ?? 1)).toFixed(3);
      const css = [
        `@keyframes ${id} { from { transform:translateX(0); } to { transform:translateX(-${approx}px); } }`,
        `.${id} { position:absolute; inset:0; display:flex; align-items:center; overflow:hidden; }`,
        `.${id} .track { display:flex; white-space:pre; animation:${id} ${secsPerLoop}s linear infinite; font-size:${fs}px; font-weight:${p.fontWeight ?? 900}; color:${p.color ?? "#f4f4f5"}; letter-spacing:-0.02em; font-family:sans-serif; }`,
        `.${id} .track span { display:inline-block; min-width:${approx}px; flex:none; }`,
      ].join("\n");
      const seg = escapeHtml(text);
      const html = `<div class="${id}"><div class="track"><span>${seg}</span><span>${seg}</span></div></div>`;
      return { css, html };
    },
  },

  // ── dynamic-grid — drifting line grid (DOM lines; tiled-gradient
  //    backgrounds don't paint in blitz — skeleton's single no-repeat works)
  {
    name: "dynamic-grid",
    title: "Dynamic Grid",
    category: "background",
    description: "Slow-drifting line grid backdrop.",
    source: "dynamic-grid",
    gateGap: "SSIM unreliable on full-frame 1px lattices (sub-pixel phase/AA jitter dominates; a no-lines render scored HIGHER than the correct one) — verified by eyeball + determinism instead",
    props: {
      cellSize: { default: 40, doc: "px" },
      lineColor: { default: "#27272a", doc: "grid lines" },
      background: { default: "#0a0a0a", doc: "backdrop" },
      speed: { default: 0.5, doc: "px per frame drift" },
      direction: { default: "diagonal", doc: "diagonal|horizontal|vertical" },
      viewport: { default: [1280, 800], doc: "[w,h] line coverage" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("grid");
      const cell = p.cellSize ?? 40;
      const [vw, vh] = p.viewport ?? [1280, 800];
      const drift = +(cell / ((p.speed ?? 0.5) * 30)).toFixed(3);
      const dir = p.direction ?? "diagonal";
      const dx = dir === "vertical" ? 0 : cell;
      const dy = dir === "horizontal" ? 0 : cell;
      const cols = Math.ceil(vw / cell) + 2;
      const rows = Math.ceil(vh / cell) + 2;
      const css = [
        `@keyframes ${id} { from { transform:translate(-${cell}px, -${cell}px); } to { transform:translate(${dx - cell}px, ${dy - cell}px); } }`,
        `.${id} { position:absolute; inset:0; background:${p.background ?? "#0a0a0a"}; overflow:hidden; }`,
        `.${id} .sheet { position:absolute; left:0; top:0; width:${(cols + 1) * cell}px; height:${(rows + 1) * cell}px; animation:${id} ${drift}s linear infinite; }`,
        `.${id} .v { position:absolute; top:0; bottom:0; width:1px; background:${p.lineColor ?? "#27272a"}; }`,
        `.${id} .h { position:absolute; left:0; right:0; height:1px; background:${p.lineColor ?? "#27272a"}; }`,
      ].join("\n");
      const lines =
        Array.from({ length: cols + 1 }, (_, i) => `<div class="v" style="left:${i * cell}px"></div>`).join("") +
        Array.from({ length: rows + 1 }, (_, i) => `<div class="h" style="top:${i * cell}px"></div>`).join("");
      return { css, html: `<div class="${id}"><div class="sheet">${lines}</div></div>` };
    },
  },

  // ── slot-machine-roll — chars roll down 1.1em into place
  {
    name: "slot-machine-roll",
    title: "Slot Machine Roll",
    category: "text",
    description: "Characters roll vertically into place like slot reels.",
    source: "slot-machine-roll",
    props: { ...textDefaults, staggerDelay: { default: 2, doc: "frames between chars" }, durationFrames: { default: 14, doc: "roll length" } },
    demoProps: { text: "128,540" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "slot",
          unit: "char",
          durationFrames: p.durationFrames ?? 14,
          staggerFrames: p.staggerDelay ?? 2,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: "translateY(-1.1em)" } },
            { at: 1, style: { opacity: "1", transform: "translateY(0)" } },
          ],
          wrapperStyle: wrapper(p) + "overflow:hidden; display:inline-block;",
        }, p.speed ?? 1),
      ),
  },
];
