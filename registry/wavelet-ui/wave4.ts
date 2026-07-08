// wavelet-ui wave 4 — highlight/decode effects + camera-language transitions
// (Remocn ports; interpolate stops → keyframe percents, beziers verbatim).
// Scramble/glitch randomness is SEEDED AT GENERATE TIME (mulberry32) so output
// stays deterministic. Full-frame blur transitions are filterDependent —
// transforms/opacity run everywhere, the blur channel needs the Chrome lane.

import { centerFill, escapeHtml, freshId, kfBlock, sec, splitSpans } from "./lib/motion.ts";
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashSeed = (s: string) => Array.from(s).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// two-panel transition scaffold: .from and .to stacked full-bleed
function panels(id: string, fromHtml: string, toHtml: string, extraCss: string): { css: string; html: string } {
  const css = [
    `.${id} { position:absolute; inset:0; overflow:hidden; }`,
    `.${id} .panel { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }`,
    extraCss,
  ].join("\n");
  return { css, html: `<div class="${id}"><div class="panel from">${fromHtml}</div><div class="panel to">${toHtml}</div></div>` };
}
const panelText = (p: any, text: string) => `<span style="${wrapper(p)}">${escapeHtml(text)}</span>`;
const transitionProps = {
  from: { default: "Before", doc: "outgoing text" },
  to: { default: "After", doc: "incoming text" },
  durationFrames: { default: 36, doc: "whole transition length" },
  ...textDefaults,
};

export const WAVE4: UIComponent[] = [
  // ── per-word-crossfade — exit 15f/st1 (.7,0,.84,0) ↔ enter 21f/st2 (.16,1,.3,1), overlap 5, micro 2
  {
    name: "per-word-crossfade",
    title: "Per-Word Crossfade",
    category: "transition",
    description: "Old words fade out as new words fade in, word by word.",
    source: "per-word-crossfade",
    props: { from: { default: "Old headline", doc: "outgoing" }, to: { default: "New headline", doc: "incoming" }, ...textDefaults },
    demoProps: { from: "Per word", to: "Crossfade" },
    generate: (p) => {
      const id = freshId("pwc");
      const speed = p.speed ?? 1;
      const exitDur = 15, enterDur = 21, exitStagger = 1, enterStagger = 2, overlap = 5, micro = 2;
      const fromWords = splitSpans(p.from ?? "", "word");
      const toWords = splitSpans(p.to ?? "", "word");
      const exitTotal = exitDur + (fromWords.length - 1) * exitStagger;
      const enterBase = exitTotal - overlap + micro;
      const css = [
        `@keyframes ${id}-out { from { opacity:1; } to { opacity:0; } }`,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { position:relative; display:grid; place-items:center; ${wrapper(p)} }`,
        `.${id} > span { grid-area:1/1; white-space:nowrap; }`,
        `.${id} .out > span { display:inline-block; white-space:pre; animation:${id}-out ${sec(exitDur, speed)}s cubic-bezier(0.7, 0, 0.84, 0) both; }`,
        `.${id} .in > span { display:inline-block; white-space:pre; animation:${id}-in ${sec(enterDur, speed)}s cubic-bezier(0.16, 1, 0.3, 1) both; }`,
      ].join("\n");
      const row = (words: string[], cls: string, base: number, st: number) =>
        `<span class="${cls}">` + words.map((w, i) =>
          `<span style="animation-delay:${sec(base + i * st, speed)}s;${i < words.length - 1 ? "margin-right:0.28em;" : ""}">${escapeHtml(w)}</span>`).join("") + `</span>`;
      return centerFill({ css, html: `<div class="${id}">${row(fromWords, "out", 0, exitStagger)}${row(toWords, "in", enterBase, enterStagger)}</div>` });
    },
  },

  // ── line-by-line-slide — lines rise in 27f/st4 (.22,1,.36,1)
  {
    name: "line-by-line-slide",
    title: "Line-by-Line Slide",
    category: "text",
    description: "Stacked lines slide up into place one after another.",
    source: "line-by-line-slide",
    props: { ...textDefaults, staggerDelay: { default: 4, doc: "frames between lines" } },
    demoProps: { text: "First line\nSecond line\nThird line", fontSize: 56 },
    generate: (p) => {
      const id = freshId("lbl");
      const speed = p.speed ?? 1;
      const lines = splitSpans(p.text, "line");
      const css = [
        `@keyframes ${id} { from { opacity:0; transform:translateY(26px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { display:flex; flex-direction:column; gap:0.18em; text-align:center; ${wrapper(p)} line-height:1.15; }`,
        `.${id} span { display:block; animation:${id} ${sec(27, speed)}s cubic-bezier(0.22, 1, 0.36, 1) both; }`,
      ].join("\n");
      const html = `<div class="${id}">` + lines.map((l, i) =>
        `<span style="animation-delay:${sec(i * (p.staggerDelay ?? 4), speed)}s">${escapeHtml(l)}</span>`).join("") + `</div>`;
      return centerFill({ css, html });
    },
  },

  // ── inline-highlight — one phrase snaps to an accent color
  {
    name: "inline-highlight",
    title: "Inline Highlight",
    category: "text",
    description: "A phrase inside a sentence flips to an accent color.",
    source: "inline-highlight",
    props: {
      before: { default: "Ship features ", doc: "text before" },
      highlight: { default: "twice as fast", doc: "highlighted phrase" },
      after: { default: " with confidence", doc: "text after" },
      highlightColor: { default: "#ff5e3a", doc: "accent" },
      highlightAtSeconds: { default: 0.5, doc: "when it flips" },
      ...textDefaults,
    },
    demoProps: { fontSize: 54 },
    generate: (p) => {
      const id = freshId("ihl");
      const at = p.highlightAtSeconds ?? 0.5;
      const css = [
        `@keyframes ${id} { 0%, 99.9% { color:${p.color ?? "#f4f4f5"}; } 100% { color:${p.highlightColor ?? "#ff5e3a"}; } }`,
        `.${id} { ${wrapper(p)} }`,
        `.${id} .hl { display:inline-block; animation:${id} ${at}s steps(1,end) both; }`,
      ].join("\n");
      const html = `<span class="${id}">${escapeHtml(p.before ?? "")}<span class="hl">${escapeHtml(p.highlight ?? "")}</span>${escapeHtml(p.after ?? "")}</span>`;
      return centerFill({ css, html });
    },
  },

  // ── marker-highlight — marker band sweeps behind a phrase (scaleX 0→1)
  {
    name: "marker-highlight",
    title: "Marker Highlight",
    category: "text",
    description: "A marker stroke sweeps behind a phrase; the text dips to ink color.",
    source: "marker-highlight",
    props: {
      before: { default: "The ", doc: "text before" },
      highlight: { default: "one command", doc: "marked phrase" },
      after: { default: " deploy", doc: "text after" },
      markerColor: { default: "#fde047", doc: "marker" },
      inkColor: { default: "#171717", doc: "text over marker" },
      sweepAtSeconds: { default: 0.4, doc: "sweep start" },
      ...textDefaults,
    },
    demoProps: { fontSize: 54 },
    generate: (p) => {
      const id = freshId("mkh");
      const at = p.sweepAtSeconds ?? 0.4;
      const css = [
        `@keyframes ${id}-band { from { transform:scaleX(0); } to { transform:scaleX(1); } }`,
        `@keyframes ${id}-ink { 0%, 99.9% { color:${p.color ?? "#f4f4f5"}; } 100% { color:${p.inkColor ?? "#171717"}; } }`,
        `.${id} { ${wrapper(p)} }`,
        `.${id} .wrap { position:relative; display:inline-block; padding:0 0.12em; }`,
        `.${id} .band { position:absolute; left:0; right:0; top:8%; bottom:2%; background:${p.markerColor ?? "#fde047"}; transform:scaleX(0); transform-origin:0 50%; animation:${id}-band ${sec(11)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${at}s; }`,
        `.${id} .txt { position:relative; animation:${id}-ink ${(at + 0.18).toFixed(3)}s steps(1,end) both; }`,
      ].join("\n");
      const html = `<span class="${id}">${escapeHtml(p.before ?? "")}<span class="wrap"><span class="band"></span><span class="txt">${escapeHtml(p.highlight ?? "")}</span></span>${escapeHtml(p.after ?? "")}</span>`;
      return centerFill({ css, html });
    },
  },

  // ── strikethrough-replace — line draws through old word, replacement rises
  {
    name: "strikethrough-replace",
    title: "Strikethrough Replace",
    category: "text",
    description: "A word gets struck through and its replacement rises in beside it.",
    source: "strikethrough-replace",
    props: {
      from: { default: "hours", doc: "struck word" },
      to: { default: "minutes", doc: "replacement" },
      accent: { default: "#f87171", doc: "strike color" },
      ...textDefaults,
    },
    demoProps: { fontSize: 60 },
    generate: (p) => {
      const id = freshId("str");
      const speed = p.speed ?? 1;
      const css = [
        `@keyframes ${id}-line { from { width:0%; } to { width:100%; } }`,
        `@keyframes ${id}-dim { from { opacity:1; } to { opacity:0.45; } }`,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { display:inline-flex; gap:0.35em; align-items:baseline; ${wrapper(p)} }`,
        `.${id} .old { position:relative; display:inline-block; animation:${id}-dim ${sec(10, speed)}s ease-out both; animation-delay:${sec(14, speed)}s; }`,
        `.${id} .old .line { position:absolute; left:0; top:50%; height:0.08em; width:0%; background:${p.accent ?? "#f87171"}; transform:translateY(-50%); animation:${id}-line ${sec(12, speed)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${sec(4, speed)}s; }`,
        `.${id} .new { display:inline-block; color:${p.accent ?? "#f87171"}; animation:${id}-in ${sec(12, speed)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:${sec(16, speed)}s; }`,
      ].join("\n");
      const html = `<span class="${id}"><span class="old">${escapeHtml(p.from ?? "")}<span class="line"></span></span><span class="new">${escapeHtml(p.to ?? "")}</span></span>`;
      return centerFill({ css, html });
    },
  },

  // ── matrix-decode — chars scramble then resolve L→R over revealDuration 60f
  {
    name: "matrix-decode",
    title: "Matrix Decode",
    category: "text",
    description: "Text resolves out of scramble noise, left to right (seeded, deterministic).",
    source: "matrix-decode",
    props: {
      ...textDefaults,
      charset: { default: "!@#$%^&*()_+-=<>?/\\\\|", doc: "scramble glyphs" },
      revealFrames: { default: 60, doc: "total decode length" },
      seed: { default: "decode", doc: "scramble seed" },
    },
    demoProps: { text: "DECODED", fontSize: 84, fontWeight: 700 },
    generate: (p) => {
      const id = freshId("mtx");
      const speed = p.speed ?? 1;
      const chars = Array.from(p.text as string);
      const charset: string = p.charset ?? "!@#$%^&*()_+-=<>?/\\\\|";
      const reveal = p.revealFrames ?? 60;
      const total = sec(reveal + 10, speed);
      const rand = mulberry32(hashSeed(String(p.seed ?? "decode") + p.text));
      const SCRAM = 5; // scramble glyph swaps per char before it resolves
      const css: string[] = [
        `.${id} { ${wrapper(p, "0.04em")} font-family:ui-monospace, monospace; }`,
        `.${id} .c { position:relative; display:inline-block; white-space:pre; }`,
        `.${id} .g { grid-area:1/1; }`,
        `.${id} .c > span { display:inline-grid; }`,
      ];
      const spans = chars.map((ch, i) => {
        const at = (i / Math.max(chars.length, 1)) * reveal; // resolve frame
        const layers: string[] = [];
        for (let k = 0; k <= SCRAM; k++) {
          const isFinal = k === SCRAM;
          const glyph = isFinal ? ch : charset[Math.floor(rand() * charset.length)];
          const t0 = (at * k) / SCRAM;
          const t1 = isFinal ? reveal + 10 : (at * (k + 1)) / SCRAM;
          const kf = `${id}-c${i}k${k}`;
          const a0 = Math.min(99.8, (t0 / (reveal + 10)) * 100).toFixed(2);
          const a1 = Math.min(99.9, (t1 / (reveal + 10)) * 100).toFixed(2);
          css.push(kfBlock(kf, [
            { at: 0, style: { opacity: "0" } },
            { at: +a0 / 100, style: { opacity: "1" } },
            ...(isFinal ? [{ at: 1, style: { opacity: "1" } }] : [{ at: +a1 / 100, style: { opacity: "0" } }, { at: 1, style: { opacity: "0" } }]),
          ]));
          layers.push(`<span class="g" style="animation:${kf} ${total}s steps(1,end) both">${escapeHtml(glyph)}</span>`);
        }
        return `<span class="c"><span>${layers.join("")}</span></span>`;
      });
      return centerFill({ css: css.join("\n"), html: `<span class="${id}">${spans.join("")}</span>` });
    },
  },

  // ── rgb-glitch-text — RGB-split jitter burst at glitchAt for glitchDuration
  {
    name: "rgb-glitch-text",
    title: "RGB Glitch Text",
    category: "text",
    description: "Chromatic-split glitch burst — red/cyan copies jitter for a few frames (seeded).",
    source: "rgb-glitch-text",
    props: {
      ...textDefaults,
      glitchAtFrames: { default: 20, doc: "burst start frame" },
      glitchFrames: { default: 8, doc: "burst length" },
      magnitude: { default: 5, doc: "jitter px" },
      seed: { default: "glitch", doc: "jitter seed" },
    },
    demoProps: { text: "GLITCH", fontSize: 96, fontWeight: 800 },
    generate: (p) => {
      const id = freshId("rgb");
      const speed = p.speed ?? 1;
      const at = p.glitchAtFrames ?? 20;
      const dur = p.glitchFrames ?? 8;
      const total = at + dur + 10;
      const rand = mulberry32(hashSeed(String(p.seed ?? "glitch") + p.text));
      const mag = p.magnitude ?? 5;
      const jitterKF = (chan: string) => {
        const stops = [`0% { transform:translate(0,0); }`, `${((at / total) * 100).toFixed(2)}% { transform:translate(0,0); }`];
        for (let f = 0; f < dur; f++) {
          const x = ((rand() * 2 - 1) * mag).toFixed(1);
          const y = ((rand() * 2 - 1) * mag * 0.5).toFixed(1);
          stops.push(`${(((at + f) / total) * 100 + 0.01).toFixed(2)}% { transform:translate(${x}px, ${y}px); }`);
        }
        stops.push(`${(((at + dur) / total) * 100).toFixed(2)}% { transform:translate(0,0); }`, `100% { transform:translate(0,0); }`);
        return `@keyframes ${id}-${chan} { ${stops.join(" ")} }`;
      };
      const css = [
        jitterKF("r"), jitterKF("c"),
        `.${id} { position:relative; display:grid; place-items:center; ${wrapper(p, "-0.01em")} }`,
        `.${id} span { grid-area:1/1; white-space:nowrap; }`,
        `.${id} .r { color:#ff2d55; opacity:0.8; animation:${id}-r ${sec(total, speed)}s steps(1,end) both; }`,
        `.${id} .c { color:#22d3ee; opacity:0.8; animation:${id}-c ${sec(total, speed)}s steps(1,end) both; }`,
        `.${id} .w { color:${p.color ?? "#f4f4f5"}; }`,
      ].join("\n");
      const t = escapeHtml(p.text);
      return centerFill({ css, html: `<div class="${id}"><span class="r">${t}</span><span class="c">${t}</span><span class="w">${t}</span></div>` });
    },
  },

  // ── rolling-number — odometer digits roll up into place, right-to-left stagger
  {
    name: "rolling-number",
    title: "Rolling Number",
    category: "text",
    description: "Digits roll up into their final value, odometer style.",
    source: "rolling-number",
    props: {
      value: { default: "42,318", doc: "final number string" },
      ...textDefaults,
    },
    demoProps: { value: "42,318", fontSize: 92, fontWeight: 700 },
    generate: (p) => {
      const id = freshId("rol");
      const speed = p.speed ?? 1;
      const chars = Array.from(String(p.value ?? ""));
      const css: string[] = [
        `.${id} { display:inline-flex; overflow:hidden; ${wrapper(p, "0.01em")} font-variant-numeric:tabular-nums; }`,
        `.${id} .d { display:inline-block; }`,
      ];
      const spans = chars.map((ch, i) => {
        if (!/[0-9]/.test(ch)) return `<span class="d">${escapeHtml(ch)}</span>`;
        const digit = Number(ch);
        const strip = "0123456789".slice(0, digit + 1).split("").join("</span><span>");
        const kf = `${id}-d${i}`;
        css.push(`@keyframes ${kf} { from { transform:translateY(0); } to { transform:translateY(-${digit}em); } }`);
        const delay = sec((chars.length - 1 - i) * 2, speed);
        return `<span class="d" style="height:1em; line-height:1em; overflow:hidden;"><span style="display:inline-flex; flex-direction:column; animation:${kf} ${sec(20, speed)}s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay:${delay}s;"><span>${strip}</span></span></span>`;
      });
      return centerFill({ css: css.join("\n"), html: `<span class="${id}">${spans.join("")}</span>` });
    },
  },

  // ── whip-pan — full-frame smash pan with smear (blur channel = Chrome lane)
  {
    name: "whip-pan",
    title: "Whip Pan",
    category: "transition",
    description: "Camera whips sideways: outgoing smears off, incoming smears in.",
    source: "whip-pan",
    filterDependent: true,
    props: { ...transitionProps, direction: { default: "left", doc: "left|right|up|down" } },
    demoProps: { from: "Scene A", to: "Scene B" },
    generate: (p) => {
      const id = freshId("whp");
      const speed = p.speed ?? 1;
      const dur = p.durationFrames ?? 36;
      const dirn = p.direction ?? "left";
      const axis = dirn === "up" || dirn === "down" ? "Y" : "X";
      const sign = dirn === "left" || dirn === "up" ? -1 : 1;
      const smear = axis === "X" ? "scaleX(1.35)" : "scaleY(1.35)";
      const css = [
        kfBlock(`${id}-out`, [
          { at: 0, style: { transform: `translate${axis}(0) scale(1)`, filter: "blur(0px)" }, easing: "cubic-bezier(0.7, 0, 0.2, 1)" },
          { at: 0.5, style: { transform: `translate${axis}(${sign * 60}%) ${smear}`, filter: "blur(14px)", opacity: "1" } },
          { at: 0.55, style: { opacity: "0", transform: `translate${axis}(${sign * 100}%) ${smear}` } },
          { at: 1, style: { opacity: "0", transform: `translate${axis}(${sign * 100}%)` } },
        ]),
        kfBlock(`${id}-in`, [
          { at: 0, style: { opacity: "0", transform: `translate${axis}(${-sign * 100}%) ${smear}`, filter: "blur(14px)" } },
          { at: 0.45, style: { opacity: "1", transform: `translate${axis}(${-sign * 55}%) ${smear}`, filter: "blur(14px)" }, easing: "cubic-bezier(0.7, 0, 0.2, 1)" },
          { at: 1, style: { opacity: "1", transform: `translate${axis}(0) scale(1)`, filter: "blur(0px)" } },
        ]),
        `.${id} .from { animation:${id}-out ${sec(dur, speed)}s linear both; }`,
        `.${id} .to { animation:${id}-in ${sec(dur, speed)}s linear both; }`,
      ].join("\n");
      return panels(id, panelText(p, p.from ?? ""), panelText(p, p.to ?? ""), css);
    },
  },

  // ── push-through — camera pushes through the outgoing scene into the next
  {
    name: "push-through",
    title: "Push Through",
    category: "transition",
    description: "Zoom straight through the outgoing scene; the next resolves behind it.",
    source: "push-through",
    filterDependent: true,
    props: { ...transitionProps, zoom: { default: 2.4, doc: "punch-through scale" } },
    demoProps: { from: "Push", to: "Through" },
    generate: (p) => {
      const id = freshId("pth");
      const speed = p.speed ?? 1;
      const dur = p.durationFrames ?? 36;
      const z = p.zoom ?? 2.4;
      const css = [
        kfBlock(`${id}-out`, [
          { at: 0, style: { opacity: "1", transform: "scale(1)", filter: "blur(0px)" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.4, style: { opacity: "1", filter: "blur(8px)", transform: `scale(${1 + (z - 1) * 0.6})` }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.62, style: { opacity: "0", transform: `scale(${z})`, filter: "blur(14px)" } },
          { at: 1, style: { opacity: "0", transform: `scale(${z})` } },
        ]),
        kfBlock(`${id}-in`, [
          { at: 0, style: { opacity: "0", transform: "scale(0.68)", filter: "blur(10px)" } },
          { at: 0.3, style: { opacity: "0", transform: "scale(0.68)", filter: "blur(10px)" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 0.5, style: { opacity: "1" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 0.88, style: { transform: "scale(1.02)", filter: "blur(0px)" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 1, style: { opacity: "1", transform: "scale(1)" } },
        ]),
        `.${id} .from { animation:${id}-out ${sec(dur, speed)}s linear both; }`,
        `.${id} .to { animation:${id}-in ${sec(dur, speed)}s linear both; }`,
      ].join("\n");
      return panels(id, panelText(p, p.from ?? ""), panelText(p, p.to ?? ""), css);
    },
  },

  // ── ripple-zoom — outgoing scales away as rings carry the incoming up
  {
    name: "ripple-zoom",
    title: "Ripple Zoom",
    category: "transition",
    description: "Expanding rings wash the old scene out; the new one scales up through them.",
    source: "ripple-zoom",
    props: { ...transitionProps, accent: { default: "#818cf8", doc: "ring color" } },
    demoProps: { from: "Ripple", to: "Zoom" },
    generate: (p) => {
      const id = freshId("rip");
      const speed = p.speed ?? 1;
      const dur = p.durationFrames ?? 40;
      const css = [
        kfBlock(`${id}-out`, [
          { at: 0, style: { opacity: "1", transform: "scale(1)" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.35, style: { opacity: "1" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.55, style: { opacity: "0", transform: "scale(1.6)" } },
          { at: 1, style: { opacity: "0", transform: "scale(1.6)" } },
        ]),
        kfBlock(`${id}-in`, [
          { at: 0, style: { opacity: "0", transform: "scale(0.2)" } },
          { at: 0.42, style: { opacity: "0", transform: "scale(0.2)" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 0.62, style: { opacity: "1" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 0.97, style: { transform: "scale(1)" } },
          { at: 1, style: { opacity: "1", transform: "scale(1)" } },
        ]),
        kfBlock(`${id}-ring`, [
          { at: 0, style: { opacity: "0", transform: "scale(0.2)" } },
          { at: 0.2, style: { opacity: "0.6" }, easing: "cubic-bezier(0.7, 0, 0.3, 1)" },
          { at: 1, style: { opacity: "0", transform: `scale(3)` } },
        ]),
        `.${id} .from { animation:${id}-out ${sec(dur, speed)}s linear both; }`,
        `.${id} .to { animation:${id}-in ${sec(dur, speed)}s linear both; }`,
        `.${id} .ring { position:absolute; left:50%; top:50%; width:40vmin; height:40vmin; margin:-20vmin 0 0 -20vmin; border-radius:50%; border:2px solid ${p.accent ?? "#818cf8"}; opacity:0; }`,
        `.${id} .r1 { animation:${id}-ring ${sec(dur * 0.8, speed)}s linear both; animation-delay:${sec(dur * 0.15, speed)}s; }`,
        `.${id} .r2 { animation:${id}-ring ${sec(dur * 0.8, speed)}s linear both; animation-delay:${sec(dur * 0.28, speed)}s; }`,
      ].join("\n");
      const frag = panels(id, panelText(p, p.from ?? ""), panelText(p, p.to ?? ""), css);
      frag.html = frag.html.replace("</div></div>", `</div><span class="ring r1"></span><span class="ring r2"></span></div>`);
      return frag;
    },
  },

  // ── focus-pull — rack focus: outgoing blurs+brightens away, incoming sharpens
  {
    name: "focus-pull",
    title: "Focus Pull",
    category: "transition",
    description: "Rack-focus swap — the old scene falls out of focus as the new one resolves.",
    source: "focus-pull",
    filterDependent: true,
    props: { ...transitionProps, blur: { default: 16, doc: "max defocus px" } },
    demoProps: { from: "Focus", to: "Pull" },
    generate: (p) => {
      const id = freshId("fcp");
      const speed = p.speed ?? 1;
      const dur = p.durationFrames ?? 36;
      const b = p.blur ?? 16;
      const css = [
        kfBlock(`${id}-out`, [
          { at: 0, style: { opacity: "1", transform: "scale(1)", filter: "blur(0px) brightness(1)" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.42, style: { opacity: "1", filter: `blur(${b * 0.8}px) brightness(1.25)` }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.68, style: { opacity: "0", transform: "scale(1.05)", filter: `blur(${b}px) brightness(1.3)` } },
          { at: 1, style: { opacity: "0", transform: "scale(1.05)" } },
        ]),
        kfBlock(`${id}-in`, [
          { at: 0, style: { opacity: "0", transform: "scale(0.97)", filter: `blur(${b * 0.75}px)` } },
          { at: 0.32, style: { opacity: "0" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 0.52, style: { opacity: "1" }, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
          { at: 1, style: { opacity: "1", transform: "scale(1)", filter: "blur(0px)" } },
        ]),
        `.${id} .from { animation:${id}-out ${sec(dur, speed)}s linear both; }`,
        `.${id} .to { animation:${id}-in ${sec(dur, speed)}s linear both; }`,
      ].join("\n");
      return panels(id, panelText(p, p.from ?? ""), panelText(p, p.to ?? ""), css);
    },
  },

  // ── focus-blur-resolve — one block resolves from heavy defocus
  {
    name: "focus-blur-resolve",
    title: "Focus Blur Resolve",
    category: "reveal",
    description: "A block resolves from heavy defocus into crisp focus.",
    source: "focus-blur-resolve",
    filterDependent: true,
    props: { ...textDefaults, blur: { default: 18, doc: "start defocus px" }, durationFrames: { default: 26, doc: "resolve length" } },
    demoProps: { text: "In focus", fontSize: 84 },
    generate: (p) => {
      const id = freshId("fbr");
      const css = [
        kfBlock(id, [
          { at: 0, style: { opacity: "0", filter: `blur(${p.blur ?? 18}px)`, transform: "scale(1.04)" }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 0.35, style: { opacity: "1" }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 1, style: { opacity: "1", filter: "blur(0px)", transform: "scale(1)" } },
        ]),
        `.${id} { display:inline-block; animation:${id} ${sec(p.durationFrames ?? 26, p.speed ?? 1)}s linear both; ${wrapper(p)} }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}">${escapeHtml(p.text)}</div>` });
    },
  },

  // ── wave-wipe — incoming rises with overshoot as outgoing lifts away
  {
    name: "wave-wipe",
    title: "Wave Wipe",
    category: "transition",
    description: "The next scene surges up with a soft overshoot as the old one lifts off.",
    source: "wave-wipe",
    props: transitionProps,
    demoProps: { from: "Wave", to: "Wipe" },
    generate: (p) => {
      const id = freshId("wvw");
      const speed = p.speed ?? 1;
      const dur = p.durationFrames ?? 40;
      const css = [
        kfBlock(`${id}-out`, [
          { at: 0, style: { opacity: "1", transform: "translateY(0)" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.3, style: { opacity: "1" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 0.5, style: { opacity: "0", transform: "translateY(-46%)" } },
          { at: 0.7, style: { opacity: "0", transform: "translateY(-70%)" } },
          { at: 1, style: { opacity: "0", transform: "translateY(-70%)" } },
        ]),
        kfBlock(`${id}-in`, [
          { at: 0, style: { transform: "translateY(100%)" } },
          { at: 0.4, style: { transform: "translateY(100%)" }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 0.82, style: { transform: "translateY(-3.5%)" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 1, style: { transform: "translateY(0)" } },
        ]),
        `.${id} .from { animation:${id}-out ${sec(dur, speed)}s linear both; }`,
        `.${id} .to { animation:${id}-in ${sec(dur, speed)}s linear both; }`,
      ].join("\n");
      return panels(id, panelText(p, p.from ?? ""), panelText(p, p.to ?? ""), css);
    },
  },
];
