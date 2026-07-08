// wavelet-ui wave 3 — UI state atoms (Remocn ports; sizes/radii/tokens verbatim
// from vendor/remocn/src, themed with lib/theme.ts oklch tokens). State atoms
// render a chosen `state`; enter/transition motion uses the source's tween
// values (18f ease-out default) as CSS keyframes.

import { centerFill, escapeHtml, freshId, sec } from "./lib/motion.ts";
import { theme as pickTheme } from "./lib/theme.ts";
import type { UIComponent } from "./components.ts";

const modeProp = { mode: { default: "dark", doc: "light|dark theme" } };

export const WAVE3: UIComponent[] = [
  // ── button — variants default|secondary|destructive|outline|ghost, sm|default|lg
  {
    name: "button",
    title: "Button",
    category: "ui",
    description: "shadcn-style button state atom with an optional press-in enter.",
    source: "button",
    props: {
      label: { default: "Continue", doc: "button text" },
      variant: { default: "default", doc: "default|secondary|destructive|outline|ghost" },
      size: { default: "default", doc: "sm|default|lg" },
      state: { default: "idle", doc: "idle|hover|press" },
      enter: { default: true, doc: "spring-scale enter animation" },
      ...modeProp,
    },
    demoProps: { label: "Get started" },
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("btn");
      const sizes: any = {
        sm: { h: 32, pad: "0 12px", fs: 13 },
        default: { h: 40, pad: "0 20px", fs: 15 },
        lg: { h: 48, pad: "0 28px", fs: 17 },
      };
      const s = sizes[p.size ?? "default"] ?? sizes.default;
      const variants: any = {
        default: { bg: t.primary, fg: t.primaryForeground, border: "transparent" },
        secondary: { bg: t.secondary, fg: t.secondaryForeground, border: "transparent" },
        destructive: { bg: t.destructive, fg: t.destructiveForeground, border: "transparent" },
        outline: { bg: "transparent", fg: t.foreground, border: t.border },
        ghost: { bg: "transparent", fg: t.foreground, border: "transparent" },
      };
      const v = variants[p.variant ?? "default"] ?? variants.default;
      const press = p.state === "press" ? "transform:scale(0.97);" : "";
      const hover = p.state === "hover" ? "filter:brightness(1.08);" : "";
      const enter = p.enter !== false
        ? `@keyframes ${id}-in { from { opacity:0; transform:scale(0.9); } to { opacity:1; transform:scale(1); } }
           .${id} { animation:${id}-in ${sec(12)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; }`
        : "";
      const css = [
        enter,
        `.${id} { display:inline-flex; align-items:center; justify-content:center; height:${s.h}px; padding:${s.pad}; font:600 ${s.fs}px/1 sans-serif; color:${v.fg}; background:${v.bg}; border:1px solid ${v.border}; border-radius:${t.radius}px; ${press}${hover} }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}">${escapeHtml(p.label ?? "")}</div>` });
    },
  },

  // ── input — field with typed value (ch-growth) + blinking caret
  {
    name: "input",
    title: "Input",
    category: "ui",
    description: "Text field that types its value with a live caret.",
    source: "input",
    props: {
      value: { default: "hello@example.com", doc: "typed text" },
      placeholder: { default: "", doc: "shown before typing (static)" },
      size: { default: "default", doc: "sm|default|lg" },
      charsPerSecond: { default: 18, doc: "typing speed" },
      width: { default: 320, doc: "field px" },
      ...modeProp,
    },
    demoProps: { value: "hello@reactable.app" },
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("inp");
      const sizes: any = { sm: { h: 36, pad: 12, fs: 13 }, default: { h: 40, pad: 14, fs: 15 }, lg: { h: 48, pad: 16, fs: 17 } };
      const s = sizes[p.size ?? "default"] ?? sizes.default;
      const val = String(p.value ?? "");
      const n = Array.from(val).length;
      const typeSecs = +(n / (p.charsPerSecond ?? 18)).toFixed(3);
      const total = +(typeSecs + 1.5).toFixed(3);
      const blink: string[] = [];
      for (let ts = 0; ts < total; ts += 0.5) {
        blink.push(`${((ts / total) * 100).toFixed(2)}% { opacity:${Math.round(ts / 0.5) % 2 === 0 ? 1 : 0}; }`);
      }
      const css = [
        `@keyframes ${id}-type { from { width:0ch; } to { width:${n}ch; } }`,
        `@keyframes ${id}-blink { ${blink.join(" ")} 100% { opacity:0; } }`,
        `.${id} { display:flex; align-items:center; width:${p.width ?? 320}px; height:${s.h}px; padding:0 ${s.pad}px; background:${t.background}; border:1px solid ${t.input}; border-radius:${t.radius}px; font:400 ${s.fs}px/1 ui-monospace, monospace; color:${t.foreground}; }`,
        `.${id} .val { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-type ${typeSecs}s steps(${Math.max(1, n)}, end) both; }`,
        `.${id} .caret { display:inline-block; width:1.5px; height:${Math.round(s.fs * 1.2)}px; background:${t.foreground}; margin-left:1px; animation:${id}-blink ${total}s steps(1,end) both; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="val">${escapeHtml(val)}</span><span class="caret"></span></div>` });
    },
  },

  // ── checkbox — box + check pop (scale 0→1, source checkScale)
  {
    name: "checkbox",
    title: "Checkbox",
    category: "ui",
    description: "Checkbox that pops its check on at a chosen time.",
    source: "checkbox",
    props: {
      label: { default: "Accept terms", doc: "label text" },
      size: { default: "default", doc: "sm|default|lg" },
      checkAtSeconds: { default: 0.6, doc: "when the check lands" },
      ...modeProp,
    },
    demoProps: { label: "Ship it" },
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("chk");
      const sizes: any = { sm: { box: 16, fs: 13, gap: 8 }, default: { box: 20, fs: 15, gap: 10 }, lg: { box: 24, fs: 17, gap: 12 } };
      const s = sizes[p.size ?? "default"] ?? sizes.default;
      const at = p.checkAtSeconds ?? 0.6;
      const css = [
        `@keyframes ${id}-bg { 0%, 99.9% { background:transparent; } 100% { background:${t.primary}; border-color:${t.primary}; } }`,
        `@keyframes ${id}-pop { from { opacity:0; transform:scale(0); } to { opacity:1; transform:scale(1); } }`,
        `.${id} { display:inline-flex; align-items:center; gap:${s.gap}px; font:500 ${s.fs}px/1.2 sans-serif; color:${t.foreground}; }`,
        `.${id} .box { width:${s.box}px; height:${s.box}px; border-radius:${Math.round(s.box * 0.28)}px; border:1px solid ${t.border}; display:flex; align-items:center; justify-content:center; animation:${id}-bg ${at}s steps(1,end) both; }`,
        `.${id} .mark { display:inline-block; width:${Math.round(s.box * 0.55)}px; height:${Math.round(s.box * 0.3)}px; border-left:2.5px solid ${t.primaryForeground}; border-bottom:2.5px solid ${t.primaryForeground}; transform-origin:40% 40%; rotate:-45deg; animation:${id}-pop ${sec(9)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay:${at}s; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="box"><span class="mark"></span></span>${escapeHtml(p.label ?? "")}</div>` });
    },
  },

  // ── switch — thumb slides across the track (source sizes verbatim)
  {
    name: "switch",
    title: "Switch",
    category: "ui",
    description: "Toggle that flips on at a chosen time — thumb slide + track tint.",
    source: "switch",
    props: {
      size: { default: "default", doc: "sm|default|lg" },
      toggleAtSeconds: { default: 0.6, doc: "when it flips" },
      label: { default: "", doc: "optional label" },
      ...modeProp,
    },
    demoProps: { size: "lg" },
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("sw");
      const sizes: any = {
        sm: { w: 36, h: 20, thumb: 16, pad: 2, fs: 13, gap: 8 },
        default: { w: 44, h: 24, thumb: 20, pad: 2, fs: 15, gap: 10 },
        lg: { w: 52, h: 28, thumb: 24, pad: 2, fs: 17, gap: 12 },
      };
      const s = sizes[p.size ?? "default"] ?? sizes.default;
      const travel = s.w - s.thumb - s.pad * 2;
      const at = p.toggleAtSeconds ?? 0.6;
      const css = [
        `@keyframes ${id}-track { 0%, 99.9% { background:${t.muted}; } 100% { background:${t.primary}; } }`,
        `@keyframes ${id}-thumb { from { transform:translateX(0); } to { transform:translateX(${travel}px); } }`,
        `.${id} { display:inline-flex; align-items:center; gap:${s.gap}px; font:500 ${s.fs}px/1.2 sans-serif; color:${t.foreground}; }`,
        `.${id} .track { width:${s.w}px; height:${s.h}px; border-radius:999px; padding:${s.pad}px; animation:${id}-track ${at}s steps(1,end) both; }`,
        `.${id} .thumb { width:${s.thumb}px; height:${s.thumb}px; border-radius:50%; background:${t.background}; box-shadow:0 1px 3px rgba(0,0,0,.4); animation:${id}-thumb ${sec(8)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${at}s; }`,
      ].join("\n");
      const label = p.label ? escapeHtml(p.label) : "";
      return centerFill({ css, html: `<div class="${id}"><span class="track"><span class="thumb"></span></span>${label}</div>` });
    },
  },

  // ── tabs — segmented control, indicator slides to the active segment
  {
    name: "tabs",
    title: "Tabs",
    category: "ui",
    description: "Segmented tabs whose pill indicator glides to the next tab.",
    source: "tabs",
    props: {
      labels: { default: ["Overview", "Metrics", "Logs"], doc: "tab labels" },
      from: { default: 0, doc: "starting tab index" },
      to: { default: 1, doc: "destination tab index" },
      switchAtSeconds: { default: 0.7, doc: "when the indicator glides" },
      width: { default: 360, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("tabs");
      const labels: string[] = p.labels ?? ["Overview", "Metrics", "Logs"];
      const W = p.width ?? 360;
      const pad = 4;
      const seg = (W - pad * 2) / labels.length;
      const at = p.switchAtSeconds ?? 0.7;
      const x0 = pad + (p.from ?? 0) * seg;
      const x1 = pad + (p.to ?? 1) * seg;
      const css = [
        `@keyframes ${id}-ind { from { transform:translateX(${x0.toFixed(1)}px); } to { transform:translateX(${x1.toFixed(1)}px); } }`,
        `.${id} { position:relative; width:${W}px; height:40px; background:${t.muted}; border-radius:${t.radius}px; }`,
        `.${id} .ind { position:absolute; left:0; top:${pad}px; width:${seg.toFixed(1)}px; height:${40 - pad * 2}px; background:${t.background}; border-radius:${t.radius - 3}px; box-shadow:0 1px 4px rgba(0,0,0,.35); animation:${id}-ind ${sec(11)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${at}s; }`,
        `.${id} .row { position:absolute; inset:0; display:flex; padding:${pad}px; }`,
        `.${id} .row span { flex:1; display:flex; align-items:center; justify-content:center; font:500 14px/1 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      const row = labels.map((l) => `<span>${escapeHtml(l)}</span>`).join("");
      return centerFill({ css, html: `<div class="${id}"><span class="ind"></span><div class="row">${row}</div></div>` });
    },
  },

  // ── tooltip — pops in near an anchor (scale .96, translate 4, source values)
  {
    name: "tooltip",
    title: "Tooltip",
    category: "ui",
    description: "Tooltip that pops in above its anchor.",
    source: "tooltip",
    props: {
      text: { default: "Copied!", doc: "tooltip text" },
      anchor: { default: "Hover me", doc: "anchor label" },
      showAtSeconds: { default: 0.5, doc: "when it appears" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("tip");
      const at = p.showAtSeconds ?? 0.5;
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translate(-50%, 4px) scale(0.96); } to { opacity:1; transform:translate(-50%, 0) scale(1); } }`,
        `.${id} { position:relative; display:inline-flex; }`,
        `.${id} .anchor { padding:10px 18px; border:1px solid ${t.border}; border-radius:${t.radius}px; font:500 15px/1 sans-serif; color:${t.foreground}; background:${t.card}; }`,
        `.${id} .tip { position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); background:${t.primary}; color:${t.primaryForeground}; font:500 13px/1 sans-serif; padding:7px 10px; border-radius:6px; white-space:nowrap; animation:${id}-in ${sec(9)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:${at}s; }`,
        `.${id} .arrow { position:absolute; top:100%; left:50%; margin-left:-4px; width:8px; height:8px; background:${t.primary}; transform:rotate(45deg); margin-top:-4px; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="anchor">${escapeHtml(p.anchor ?? "")}</span><span class="tip">${escapeHtml(p.text ?? "")}<span class="arrow"></span></span></div>` });
    },
  },

  // ── toast — notification card slides up in (y16 scale.97, source values)
  {
    name: "toast",
    title: "Toast",
    category: "ui",
    description: "Notification card that slides up and settles.",
    source: "toast",
    props: {
      title: { default: "Deploy complete", doc: "headline" },
      body: { default: "Production is live on v2.4.0", doc: "supporting line" },
      width: { default: 340, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("toast");
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(16px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `.${id} { width:${p.width ?? 340}px; padding:16px; display:flex; flex-direction:column; gap:4px; background:${t.card}; border:1px solid ${t.border}; border-radius:${t.radius}px; box-shadow:0 8px 30px rgba(0,0,0,.35); animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .t { font:600 14px/1.3 sans-serif; color:${t.cardForeground}; }`,
        `.${id} .b { font:400 13px/1.45 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="t">${escapeHtml(p.title ?? "")}</span><span class="b">${escapeHtml(p.body ?? "")}</span></div>` });
    },
  },

  // ── message-bubble — chat bubble enter (y12 scale.94, radius 24, source values)
  {
    name: "message-bubble",
    title: "Message Bubble",
    category: "ui",
    description: "Chat bubble that pops in — sent or received styling.",
    source: "message-bubble",
    props: {
      text: { default: "Hey! The new build is ready 🎉", doc: "message" },
      side: { default: "left", doc: "left (received) | right (sent)" },
      maxWidth: { default: 380, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("msg");
      const sent = (p.side ?? "left") === "right";
      const bg = sent ? t.primary : t.muted;
      const fg = sent ? t.primaryForeground : t.foreground;
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(12px) scale(0.94); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `.${id} { display:flex; width:100%; justify-content:${sent ? "flex-end" : "flex-start"}; }`,
        `.${id} .bubble { max-width:${p.maxWidth ?? 380}px; padding:10px 14px; border-radius:24px; border-bottom-${sent ? "right" : "left"}-radius:8px; background:${bg}; color:${fg}; font:400 15px/1.45 sans-serif; animation:${id}-in ${sec(12)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; transform-origin:${sent ? "100%" : "0%"} 100%; }`,
      ].join("\n");
      return centerFill({ css: css, html: `<div class="${id}"><span class="bubble">${escapeHtml(p.text ?? "")}</span></div>` }, "padding:0 10%;");
    },
  },

  // ── skeleton — multi-line loading block (composes skeleton-block sweep)
  {
    name: "skeleton",
    title: "Skeleton",
    category: "ui",
    description: "Card-shaped multi-line loading skeleton with sweeping bands.",
    source: "skeleton",
    props: {
      lines: { default: 3, doc: "text lines" },
      width: { default: 360, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("skel");
      const n = p.lines ?? 3;
      const base = t.muted;
      const hi = t.accentForeground === t.foreground ? t.border : t.accent;
      const css = [
        `@keyframes ${id} { from { background-position: 150% 0; } to { background-position: -150% 0; } }`,
        `.${id} { display:flex; flex-direction:column; gap:12px; width:${p.width ?? 360}px; }`,
        `.${id} .ln { height:14px; border-radius:6px; background: linear-gradient(100deg, ${base} 38%, ${t.border} 50%, ${base} 62%) 150% 0 / 220% 100% no-repeat, ${base}; animation:${id} 1.4s linear infinite; }`,
        `.${id} .ln.head { height:20px; width:55%; }`,
        `.${id} .ln.tail { width:70%; }`,
      ].join("\n");
      const rows = [`<div class="ln head"></div>`, ...Array.from({ length: n - 1 }, (_, i) => `<div class="ln${i === n - 2 ? " tail" : ""}"></div>`)].join("");
      return centerFill({ css, html: `<div class="${id}">${rows}</div>` });
    },
  },

  // ── spotlight-card — card with a positioned radial glow
  {
    name: "spotlight-card",
    title: "Spotlight Card",
    category: "ui",
    description: "Feature card with a soft radial spotlight glow.",
    source: "spotlight-card",
    props: {
      title: { default: "Deterministic renders", doc: "headline" },
      body: { default: "Same input, same pixels — every time.", doc: "supporting line" },
      glowX: { default: 30, doc: "% from left" },
      glowY: { default: 0, doc: "% from top" },
      width: { default: 380, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("spot");
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { position:relative; width:${p.width ?? 380}px; padding:26px; overflow:hidden; background:${t.card}; border:1px solid ${t.border}; border-radius:${t.radius + 4}px; animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .glow { position:absolute; left:${p.glowX ?? 30}%; top:${p.glowY ?? 0}%; width:320px; height:320px; margin:-160px 0 0 -160px; background:radial-gradient(circle, oklch(0.7 0.12 280 / 25%), transparent 65%); }`,
        `.${id} .t { position:relative; font:600 18px/1.3 sans-serif; color:${t.cardForeground}; margin-bottom:6px; }`,
        `.${id} .b { position:relative; font:400 14px/1.5 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="glow"></span><div class="t">${escapeHtml(p.title ?? "")}</div><div class="b">${escapeHtml(p.body ?? "")}</div></div>` });
    },
  },
];
