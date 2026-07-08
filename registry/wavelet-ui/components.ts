// wavelet-ui component registry — Remocn ports (github.com/Remocn/remocn),
// motion values carried over 1:1 from the source (frames @30fps, bezier
// easings verbatim). Each component = meta + generate(props) → {css, html}.
// Filter (blur) channels render in the Chrome/HyperFrames lane today; the
// wavelet-native filter pass is tracked as a known gap in the fidelity gate.

import {
  centerFill,
  demoPage,
  escapeHtml,
  freshId,
  type Fragment,
  kfBlock,
  sec,
  splitSpans,
  staggeredText,
  springKF,
} from "./lib/motion.ts";

export interface UIComponent {
  name: string;
  title: string;
  category: "text" | "reveal" | "transition" | "background" | "ui" | "scene";
  description: string;
  source: string; // remocn registry name
  props: Record<string, { default: unknown; doc: string }>;
  generate: (p: Record<string, any>) => Fragment;
  demoProps: Record<string, any>;
  filterDependent?: boolean; // animates CSS filter — mid-animation blur is a no-op in wavelet-native (end states match)
  gateGap?: string; // wavelet-native renders this wrong even at the settled end state — expected-fail in the gate
}

const textDefaults = {
  text: { default: "Ship it today", doc: "content to animate" },
  fontSize: { default: 72, doc: "px" },
  color: { default: "#f4f4f5", doc: "text color" },
  fontWeight: { default: 600, doc: "font weight" },
  speed: { default: 1, doc: "playback multiplier" },
};

const wrapper = (p: any, tracking = "-0.03em") =>
  `font-size:${p.fontSize}px; font-weight:${p.fontWeight}; color:${p.color}; letter-spacing:${tracking}; font-family:sans-serif;`;

export const COMPONENTS: UIComponent[] = [
  // ── soft-blur-in — per-char blur+rise, 27f, stagger 1f, bezier(.22,1,.36,1)
  {
    name: "soft-blur-in",
    title: "Soft Blur In",
    category: "text",
    description: "Per-character blur + rise reveal with a gentle overlapping stagger.",
    source: "soft-blur-in",
    props: { ...textDefaults, blur: { default: 12, doc: "start blur px" } },
    filterDependent: true,
    demoProps: { text: "Soft blur in" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "soft-blur-in",
          unit: "char",
          durationFrames: 27,
          staggerFrames: 1,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: "translateY(16px)", filter: `blur(${p.blur ?? 12}px)` } },
            { at: 1, style: { opacity: "1", transform: "translateY(0)", filter: "blur(0px)" } },
          ],
          spanStyle: "transform-origin:50% 55%;",
          wrapperStyle: wrapper(p, "-0.05em"),
        }, p.speed ?? 1),
      ),
  },

  // ── per-character-rise — 21f, stagger 1f, bezier(.2,.8,.2,1), rise 32px
  {
    name: "per-character-rise",
    title: "Per-Character Rise",
    category: "text",
    description: "Characters rise and fade in one after another.",
    source: "per-character-rise",
    props: { ...textDefaults, distance: { default: 32, doc: "rise px" } },
    demoProps: { text: "Per-character rise" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "pcr",
          unit: "char",
          durationFrames: 21,
          staggerFrames: 1,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `translateY(${p.distance ?? 32}px)` } },
            { at: 1, style: { opacity: "1", transform: "translateY(0)" } },
          ],
          wrapperStyle: wrapper(p),
        }, p.speed ?? 1),
      ),
  },

  // ── staggered-fade-up — words, 12f, stagger 4f, rise 20px
  {
    name: "staggered-fade-up",
    title: "Staggered Fade Up",
    category: "text",
    description: "Words fade up in sequence — the workhorse headline reveal.",
    source: "staggered-fade-up",
    props: { ...textDefaults, staggerDelay: { default: 4, doc: "frames between words" }, distance: { default: 20, doc: "rise px" } },
    demoProps: { text: "Staggered fade up" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "sfu",
          unit: "word",
          durationFrames: 12,
          staggerFrames: p.staggerDelay ?? 4,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `translateY(${p.distance ?? 20}px)` } },
            { at: 1, style: { opacity: "1", transform: "translateY(0)" } },
          ],
          wrapperStyle: wrapper(p),
        }, p.speed ?? 1),
      ),
  },

  // ── spring-scale-in — words, 11f, stagger 3f, overshoot bezier(.34,1.56,.64,1)
  {
    name: "spring-scale-in",
    title: "Spring Scale In",
    category: "text",
    description: "Words pop in with a springy overshoot.",
    source: "spring-scale-in",
    props: { ...textDefaults, staggerDelay: { default: 3, doc: "frames between words" }, scaleFrom: { default: 0.7, doc: "start scale" } },
    demoProps: { text: "Spring scale in" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "ssi",
          unit: "word",
          durationFrames: 11,
          staggerFrames: p.staggerDelay ?? 3,
          easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `scale(${p.scaleFrom ?? 0.7})` } },
            { at: 1, style: { opacity: "1", transform: "scale(1)" } },
          ],
          spanStyle: "transform-origin:50% 50%; margin-right:0.25em;",
          wrapperStyle: wrapper(p),
        }, p.speed ?? 1),
      ),
  },

  // ── top-down-letters / bottom-up-letters — chars, 12f, stagger 3f, 46px
  {
    name: "top-down-letters",
    title: "Top-Down Letters",
    category: "text",
    description: "Letters drop in from above, one at a time.",
    source: "top-down-letters",
    props: { ...textDefaults, staggerDelay: { default: 3, doc: "frames between chars" }, distance: { default: 46, doc: "drop px" } },
    demoProps: { text: "Top down" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "tdl",
          unit: "char",
          durationFrames: 12,
          staggerFrames: p.staggerDelay ?? 3,
          easing: "cubic-bezier(0.18, 1, 0.32, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `translateY(-${p.distance ?? 46}px)` } },
            { at: 1, style: { opacity: "1", transform: "translateY(0)" } },
          ],
          wrapperStyle: wrapper(p),
        }, p.speed ?? 1),
      ),
  },
  {
    name: "bottom-up-letters",
    title: "Bottom-Up Letters",
    category: "text",
    description: "Letters rise in from below, one at a time.",
    source: "bottom-up-letters",
    props: { ...textDefaults, staggerDelay: { default: 3, doc: "frames between chars" }, distance: { default: 46, doc: "rise px" } },
    demoProps: { text: "Bottom up" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "bul",
          unit: "char",
          durationFrames: 12,
          staggerFrames: p.staggerDelay ?? 3,
          easing: "cubic-bezier(0.18, 1, 0.32, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `translateY(${p.distance ?? 46}px)` } },
            { at: 1, style: { opacity: "1", transform: "translateY(0)" } },
          ],
          wrapperStyle: wrapper(p),
        }, p.speed ?? 1),
      ),
  },

  // ── micro-scale-fade — block, 18f, bezier(.32,.72,0,1), scale .96→1
  {
    name: "micro-scale-fade",
    title: "Micro Scale Fade",
    category: "reveal",
    description: "Subtle whole-block scale + fade — the quiet reveal.",
    source: "micro-scale-fade",
    props: { ...textDefaults, scaleFrom: { default: 0.96, doc: "start scale" } },
    demoProps: { text: "Micro scale fade" },
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "msf",
          unit: "block",
          durationFrames: 18,
          staggerFrames: 0,
          easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `scale(${p.scaleFrom ?? 0.96})` } },
            { at: 1, style: { opacity: "1", transform: "scale(1)" } },
          ],
          spanStyle: "transform-origin:50% 50%;",
          wrapperStyle: wrapper(p),
        }, p.speed ?? 1),
      ),
  },

  // ── blur-in — wrapper atom: blur+offset+opacity, 18f ease-out
  {
    name: "blur-in",
    title: "Blur In",
    category: "reveal",
    description: "Reveal any block with blur + directional offset + fade (18f ease-out).",
    source: "blur-in",
    props: {
      ...textDefaults,
      blur: { default: 8, doc: "start blur px" },
      direction: { default: "up", doc: "up|down|left|right" },
      distance: { default: 12, doc: "offset px" },
    },
    filterDependent: true,
    demoProps: { text: "Blur in" },
    generate: (p) => {
      const id = freshId("blur-in");
      const dir = p.direction ?? "up";
      const d = p.distance ?? 12;
      const [tx, ty] = dir === "left" ? [d, 0] : dir === "right" ? [-d, 0] : dir === "down" ? [0, -d] : [0, d];
      const css = [
        kfBlock(id, [
          { at: 0, style: { opacity: "0", filter: `blur(${p.blur ?? 8}px)`, transform: `translate(${tx}px, ${ty}px)` }, easing: "cubic-bezier(0, 0, 0.58, 1)" },
          { at: 1, style: { opacity: "1", filter: "blur(0px)", transform: "translate(0, 0)" } },
        ]),
        `.${id} { display:inline-block; animation:${id} ${sec(18, p.speed ?? 1)}s both; ${wrapper(p)} }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}">${escapeHtml(p.text)}</div>` });
    },
  },

  // ── blur-out-up — words enter 17f (rise 10, blur 6) then exit up 14f
  {
    name: "blur-out-up",
    title: "Blur Out Up",
    category: "text",
    description: "Words blur-rise in, hold, then lift away upward — enter and exit in one component.",
    source: "blur-out-up",
    props: { ...textDefaults, staggerDelay: { default: 1, doc: "frames between words" }, holdFrames: { default: 30, doc: "hold before exit" } },
    filterDependent: true,
    demoProps: { text: "Blur out up" },
    generate: (p) => {
      const id = freshId("bou");
      const speed = p.speed ?? 1;
      const enterDur = 17, exitDur = 14, hold = p.holdFrames ?? 30;
      const total = enterDur + hold + exitDur;
      const e1 = enterDur / total, e2 = (enterDur + hold) / total;
      const css = [
        kfBlock(id, [
          { at: 0, style: { opacity: "0", transform: "translateY(10px)", filter: "blur(6px)" }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: e1, style: { opacity: "1", transform: "translateY(0)", filter: "blur(0px)" }, easing: "linear" },
          { at: e2, style: { opacity: "1", transform: "translateY(0)", filter: "blur(0px)" }, easing: "cubic-bezier(0.64, 0, 0.78, 0)" },
          { at: 1, style: { opacity: "0", transform: "translateY(-14px)", filter: "blur(6px)" } },
        ]),
        `.${id} > span { display:inline-block; white-space:pre; animation:${id} ${sec(total, speed)}s both; }`,
        `.${id} { ${wrapper(p)} }`,
      ].join("\n");
      const words = splitSpans(p.text, "word");
      const html =
        `<span class="${id}">` +
        words.map((w, i) => `<span style="animation-delay:${sec(i * (p.staggerDelay ?? 1), speed)}s">${escapeHtml(i < words.length - 1 ? w + " " : w)}</span>`).join("") +
        `</span>`;
      return centerFill({ css, html });
    },
  },

  // ── tracking-in — letter-spacing .5em→-.03em + blur 12→0 + fade 15f
  {
    name: "tracking-in",
    title: "Tracking In",
    category: "text",
    description: "Wide letter-spacing contracts into place while blur resolves.",
    source: "tracking-in",
    props: { ...textDefaults, startTracking: { default: 0.5, doc: "em" }, startBlur: { default: 12, doc: "px" }, durationFrames: { default: 30, doc: "contraction length" } },
    filterDependent: true,
    demoProps: { text: "TRACKING IN", fontSize: 96, fontWeight: 700 },
    generate: (p) => {
      const id = freshId("tin");
      const dur = p.durationFrames ?? 30;
      const css = [
        kfBlock(id, [
          { at: 0, style: { opacity: "0", "letter-spacing": `${p.startTracking ?? 0.5}em`, filter: `blur(${p.startBlur ?? 12}px)` }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 0.5, style: { opacity: "1", "letter-spacing": `${((p.startTracking ?? 0.5) - 0.03) / 2}em`, filter: `blur(${(p.startBlur ?? 12) / 2}px)` }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 1, style: { opacity: "1", "letter-spacing": "-0.03em", filter: "blur(0px)" } },
        ]),
        `.${id} { display:inline-block; animation:${id} ${sec(dur, p.speed ?? 1)}s both; ${wrapper(p, `${p.startTracking ?? 0.5}em`)} }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}">${escapeHtml(p.text)}</div>` });
    },
  },

  // ── mask-reveal-up — lines rise out of an overflow mask, 23f, stagger 3f
  {
    name: "mask-reveal-up",
    title: "Mask Reveal Up",
    category: "text",
    description: "Lines slide up out of clipped masks — the classic title-card reveal.",
    source: "mask-reveal-up",
    props: { ...textDefaults, distance: { default: 30, doc: "rise px (also mask depth)" }, staggerDelay: { default: 3, doc: "frames between lines" } },
    demoProps: { text: "Masked lines\nreveal upward" },
    generate: (p) => {
      const id = freshId("mru");
      const speed = p.speed ?? 1;
      const css = [
        kfBlock(id, [
          { at: 0, style: { transform: `translateY(${Math.max(100, p.distance ?? 30)}%)`, opacity: "1" }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 1, style: { transform: "translateY(0)", opacity: "1" } },
        ]),
        `.${id} .mask { display:block; overflow:hidden; }`,
        `.${id} .line { display:block; animation:${id} ${sec(23, speed)}s both; }`,
        `.${id} { ${wrapper(p)} text-align:center; line-height:1.15; }`,
      ].join("\n");
      const lines = splitSpans(p.text, "line");
      const html =
        `<div class="${id}">` +
        lines.map((l, i) => `<span class="mask"><span class="line" style="animation-delay:${sec(i * (p.staggerDelay ?? 3), speed)}s">${escapeHtml(l)}</span></span>`).join("") +
        `</div>`;
      return centerFill({ css, html });
    },
  },

  // ── fade-through — exit 8f down-fade, enter 13f up-fade+scale .99
  {
    name: "fade-through",
    title: "Fade Through",
    category: "transition",
    description: "One block fades away as the next fades through it — two-phase swap.",
    source: "fade-through",
    props: {
      from: { default: "Before", doc: "outgoing text" },
      to: { default: "After", doc: "incoming text" },
      ...textDefaults,
    },
    demoProps: { from: "Fade", to: "Through" },
    generate: (p) => {
      const id = freshId("ft");
      const speed = p.speed ?? 1;
      const css = [
        kfBlock(`${id}-out`, [
          { at: 0, style: { opacity: "1", transform: "translateY(0)" }, easing: "cubic-bezier(0.4, 0, 1, 1)" },
          { at: 1, style: { opacity: "0", transform: "translateY(-4px)" } },
        ]),
        kfBlock(`${id}-in`, [
          { at: 0, style: { opacity: "0", transform: "translateY(6px) scale(0.99)" }, easing: "cubic-bezier(0.2, 0, 0, 1)" },
          { at: 1, style: { opacity: "1", transform: "translateY(0) scale(1)" } },
        ]),
        `.${id} { position:relative; display:grid; place-items:center; ${wrapper(p)} }`,
        `.${id} > span { grid-area:1/1; }`,
        `.${id} .out { animation:${id}-out ${sec(8, speed)}s both; }`,
        `.${id} .in { animation:${id}-in ${sec(13, speed)}s both; animation-delay:${sec(8 - 1 + 2, speed)}s; }`,
      ].join("\n");
      const html = `<div class="${id}"><span class="out">${escapeHtml(p.from ?? "Before")}</span><span class="in">${escapeHtml(p.to ?? "After")}</span></div>`;
      return centerFill({ css, html });
    },
  },

  // ── typewriter — chars appear at charsPerSecond via steps timing + caret
  {
    name: "typewriter",
    title: "Typewriter",
    category: "text",
    description: "Monospaced typing reveal with a blinking caret.",
    source: "typewriter",
    props: {
      ...textDefaults,
      charsPerSecond: { default: 22, doc: "typing speed" },
      caretColor: { default: "#f4f4f5", doc: "caret" },
    },
    demoProps: { text: "Typewriter effect", fontSize: 48 },
    generate: (p) => {
      const id = freshId("tw");
      const speed = p.speed ?? 1;
      const cps = (p.charsPerSecond ?? 22) * speed;
      const chars = Array.from(p.text as string);
      const n = chars.length;
      const typeSecs = +(n / cps).toFixed(3);
      const total = +(typeSecs + 1.2).toFixed(3);
      // Remotion parity: the revealed text GROWS (text.slice(0, n)) with the
      // caret riding the typing edge — width 0ch→Nch in steps(n) over a
      // monospace pre container, caret glued to its right edge.
      const blinkStops: string[] = [];
      for (let t = 0; t < total; t += 0.5) {
        const a = ((t / total) * 100).toFixed(2);
        blinkStops.push(`${a}% { opacity:${Math.round(t / 0.5) % 2 === 0 ? 1 : 0}; }`);
      }
      const css = [
        `@keyframes ${id}-type { from { width:0ch; } to { width:${n}ch; } }`,
        `@keyframes ${id}-blink { ${blinkStops.join(" ")} 100% { opacity:0; } }`,
        `.${id} { display:flex; align-items:center; font-family:ui-monospace, monospace; font-size:${p.fontSize ?? 48}px; font-weight:${p.fontWeight ?? 600}; color:${p.color ?? "#f4f4f5"}; }`,
        `.${id} .reveal { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-type ${typeSecs}s steps(${n}, end) both; }`,
        `.${id} .caret { display:inline-block; width:0.09em; height:1.05em; background:${p.caretColor ?? "#f4f4f5"}; margin-left:0.06em; animation:${id}-blink ${total}s steps(1,end) both; }`,
      ].join("\n");
      const html = `<div class="${id}"><span class="reveal">${escapeHtml(p.text)}</span><span class="caret"></span></div>`;
      return centerFill({ css, html });
    },
  },

  // ── shimmer-sweep — gradient highlight sweeps across text
  {
    name: "shimmer-sweep",
    title: "Shimmer Sweep",
    category: "text",
    description: "A light band sweeps across the text via animated background-position.",
    source: "shimmer-sweep",
    props: { ...textDefaults, sweepFrames: { default: 45, doc: "sweep length" }, base: { default: "#3f3f46", doc: "base color" }, highlight: { default: "#ffffff", doc: "sweep color" } },
    gateGap: "background-clip:text unsupported in blitz — gradient paints as a box (Chrome/HyperFrames lane renders fully)",
    demoProps: { text: "Shimmer sweep", fontSize: 96, fontWeight: 700 },
    generate: (p) => {
      const id = freshId("shs");
      const css = [
        `@keyframes ${id} { 0% { background-position: 150% 0; } 100% { background-position: -50% 0; } }`,
        `.${id} { display:inline-block; font-size:${p.fontSize ?? 96}px; font-weight:${p.fontWeight ?? 700}; letter-spacing:-0.03em; font-family:sans-serif;
           color:transparent; background:linear-gradient(100deg, ${p.base ?? "#3f3f46"} 42%, ${p.highlight ?? "#ffffff"} 50%, ${p.base ?? "#3f3f46"} 58%) 150% 0 / 200% 100% no-repeat, ${p.base ?? "#3f3f46"};
           -webkit-background-clip: text; background-clip: text; animation:${id} ${sec(p.sweepFrames ?? 45, p.speed ?? 1)}s cubic-bezier(0.4, 0, 0.2, 1) both; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}">${escapeHtml(p.text)}</div>` });
    },
  },
];

export const byName = new Map(COMPONENTS.map((c) => [c.name, c]));
export { demoPage } from "./lib/motion.ts";
export { springKF };
