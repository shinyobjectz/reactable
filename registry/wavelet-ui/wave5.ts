// wavelet-ui wave 5 — overlays, menus, form primitives, particles, cursor.
// Remocn ports; overlay geometry (widths/alphas) verbatim; menu cascades use
// the house 18f ease-out tween. Confetti/cursor sample seeded physics/bezier
// paths into keyframes at generate time — deterministic, no JS at render.

import { centerFill, escapeHtml, freshId, kfBlock, sec } from "./lib/motion.ts";
import { theme as pickTheme } from "./lib/theme.ts";
import type { UIComponent } from "./components.ts";

const modeProp = { mode: { default: "dark", doc: "light|dark theme" } };

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

// overlay scaffold: dimming backdrop (alpha 0→.5) + a panel with its own enter
function overlay(id: string, panelCss: string, panelHtml: string, t: any, enterDelay = 0.3): { css: string; html: string } {
  const css = [
    `@keyframes ${id}-dim { from { opacity:0; } to { opacity:1; } }`,
    `.${id} { position:absolute; inset:0; }`,
    `.${id} .dim { position:absolute; inset:0; background:rgba(0,0,0,0.5); animation:${id}-dim ${sec(10)}s ease-out both; animation-delay:${enterDelay}s; }`,
    `.${id} .center { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }`,
    panelCss,
  ].join("\n");
  return { css, html: `<div class="${id}"><div class="dim"></div><div class="center">${panelHtml}</div></div>` };
}

const dialogBody = (t: any, title: string, body: string, actions: string) => `
  <div class="head">${escapeHtml(title)}</div>
  <div class="body">${escapeHtml(body)}</div>
  <div class="row">${actions}</div>`;

const btnCss = (t: any) =>
  `.btn { height:36px; padding:0 16px; display:inline-flex; align-items:center; border-radius:${t.radius - 2}px; font:600 13px/1 sans-serif; }
   .btn.primary { background:${t.primary}; color:${t.primaryForeground}; }
   .btn.ghost { background:transparent; color:${t.foreground}; border:1px solid ${t.border}; }
   .btn.destructive { background:${t.destructive}; color:${t.destructiveForeground}; }`;

export const WAVE5: UIComponent[] = [
  // ── dialog — overlay .5 + 440px popup rises/settles (source constants)
  {
    name: "dialog",
    title: "Dialog",
    category: "ui",
    description: "Modal dialog entering over a dimming backdrop.",
    source: "dialog",
    props: {
      title: { default: "Rename project", doc: "headline" },
      body: { default: "Give this project a name your team will recognize.", doc: "copy" },
      confirm: { default: "Save changes", doc: "primary label" },
      cancel: { default: "Cancel", doc: "ghost label" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      // NB: not "dlg" — stock headless Chrome content-hides elements whose class
      // matches wl-dlg-N (built-in cosmetic/abusive-experience heuristic, found
      // empirically: identical file renders when the token is renamed)
      const id = freshId("dialog");
      const panelCss = [
        `@keyframes ${id}-pop { from { opacity:0; } to { opacity:1; } }`,
        `.${id} .panel { width:440px; padding:22px; background:${t.card}; border:1px solid ${t.border}; border-radius:${t.radius + 2}px; box-shadow:0 20px 60px rgba(0,0,0,.45); animation:${id}-pop ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.4s; }`,
        `.${id} .head { font:600 16px/1.3 sans-serif; color:${t.cardForeground}; margin-bottom:6px; }`,
        `.${id} .body { font:400 13.5px/1.5 sans-serif; color:${t.mutedForeground}; margin-bottom:18px; }`,
        `.${id} .row { display:flex; justify-content:flex-end; gap:8px; }`,
        btnCss(t),
      ].join("\n");
      const html = `<div class="panel">${dialogBody(t, p.title, p.body, `<span class="btn ghost">${escapeHtml(p.cancel)}</span><span class="btn primary">${escapeHtml(p.confirm)}</span>`)}</div>`;
      return overlay(id, panelCss, html, t, 0.3);
    },
  },

  // ── alert-dialog — destructive confirm variant
  {
    name: "alert-dialog",
    title: "Alert Dialog",
    category: "ui",
    description: "Destructive confirmation dialog.",
    source: "alert-dialog",
    props: {
      title: { default: "Delete workspace?", doc: "headline" },
      body: { default: "This permanently removes the workspace and all takes.", doc: "copy" },
      confirm: { default: "Delete", doc: "destructive label" },
      cancel: { default: "Keep it", doc: "ghost label" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("adlg");
      const panelCss = [
        `@keyframes ${id}-pop { from { opacity:0; } to { opacity:1; } }`,
        `.${id} .panel { width:440px; padding:22px; background:${t.card}; border:1px solid ${t.border}; border-radius:${t.radius + 2}px; box-shadow:0 20px 60px rgba(0,0,0,.45); animation:${id}-pop ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.4s; }`,
        `.${id} .head { font:600 16px/1.3 sans-serif; color:${t.cardForeground}; margin-bottom:6px; }`,
        `.${id} .body { font:400 13.5px/1.5 sans-serif; color:${t.mutedForeground}; margin-bottom:18px; }`,
        `.${id} .row { display:flex; justify-content:flex-end; gap:8px; }`,
        btnCss(t),
      ].join("\n");
      const html = `<div class="panel">${dialogBody(t, p.title, p.body, `<span class="btn ghost">${escapeHtml(p.cancel)}</span><span class="btn destructive">${escapeHtml(p.confirm)}</span>`)}</div>`;
      return overlay(id, panelCss, html, t, 0.3);
    },
  },

  // ── drawer — 320px bottom panel slides up (source constant)
  {
    name: "drawer",
    title: "Drawer",
    category: "ui",
    description: "Bottom drawer sliding up over a dimmed backdrop.",
    source: "drawer",
    props: {
      title: { default: "Filters", doc: "headline" },
      body: { default: "Refine the take list by deck, status, and date.", doc: "copy" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("drw");
      const panelCss = [
        `@keyframes ${id}-up { from { transform:translateY(100%); } to { transform:translateY(0); } }`,
        `.${id} .center { display:block; } .${id} .panel { position:absolute; left:0; right:0; bottom:0; height:320px; padding:20px 24px; background:${t.card}; border-top:1px solid ${t.border}; border-radius:${t.radius + 6}px ${t.radius + 6}px 0 0; animation:${id}-up ${sec(16)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:0.35s; }`,
        `.${id} .grab { width:44px; height:5px; border-radius:999px; background:${t.border}; margin:0 auto 14px; }`,
        `.${id} .head { font:600 16px/1.3 sans-serif; color:${t.cardForeground}; margin-bottom:6px; }`,
        `.${id} .body { font:400 13.5px/1.5 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      const html = `<div class="panel"><div class="grab"></div><div class="head">${escapeHtml(p.title)}</div><div class="body">${escapeHtml(p.body)}</div></div>`;
      return overlay(id, panelCss, html, t, 0.25);
    },
  },

  // ── sheet — 400px side panel slides in (source constant)
  {
    name: "sheet",
    title: "Sheet",
    category: "ui",
    description: "Right-side sheet sliding in over a dimmed backdrop.",
    source: "sheet",
    props: {
      title: { default: "Take details", doc: "headline" },
      body: { default: "Duration, events, anchors, and export lanes for this take.", doc: "copy" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("sht");
      const panelCss = [
        `@keyframes ${id}-in { from { transform:translateX(100%); } to { transform:translateX(0); } }`,
        `.${id} .center { display:block; } .${id} .panel { position:absolute; top:0; bottom:0; right:0; width:400px; padding:24px; background:${t.card}; border-left:1px solid ${t.border}; animation:${id}-in ${sec(16)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:0.3s; }`,
        `.${id} .head { font:600 16px/1.3 sans-serif; color:${t.cardForeground}; margin-bottom:8px; }`,
        `.${id} .body { font:400 13.5px/1.55 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      const html = `<div class="panel"><div class="head">${escapeHtml(p.title)}</div><div class="body">${escapeHtml(p.body)}</div></div>`;
      return overlay(id, panelCss, html, t, 0.25);
    },
  },

  // ── popover — anchored card pops (scale .97, translate 6 — source values)
  {
    name: "popover",
    title: "Popover",
    category: "ui",
    description: "Anchored popover card popping in below its trigger.",
    source: "popover",
    props: {
      trigger: { default: "Share", doc: "trigger label" },
      title: { default: "Share this take", doc: "popover headline" },
      body: { default: "Anyone with the link can watch the render.", doc: "copy" },
      width: { default: 288, doc: "popover px (source default)" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("pop");
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translate(-50%, -6px) scale(0.97); } to { opacity:1; transform:translate(-50%, 0) scale(1); } }`,
        `.${id} { position:relative; display:inline-flex; flex-direction:column; align-items:center; }`,
        `.${id} .trigger { padding:9px 18px; border:1px solid ${t.border}; border-radius:${t.radius}px; font:600 14px/1 sans-serif; color:${t.foreground}; background:${t.card}; }`,
        `.${id} .card { position:absolute; top:calc(100% + 10px); left:50%; width:${p.width ?? 288}px; padding:16px; background:${t.popover ?? t.card}; border:1px solid ${t.border}; border-radius:${t.radius}px; box-shadow:0 14px 40px rgba(0,0,0,.4); animation:${id}-in ${sec(11)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.45s; }`,
        `.${id} .h { font:600 14px/1.3 sans-serif; color:${t.cardForeground}; margin-bottom:4px; }`,
        `.${id} .b { font:400 12.5px/1.5 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="trigger">${escapeHtml(p.trigger)}</span><span class="card"><span class="h">${escapeHtml(p.title)}</span><span class="b">${escapeHtml(p.body)}</span></span></div>`, }, "padding-bottom:120px;");
    },
  },

  // ── progress — track fills to a value (12px track, source)
  {
    name: "progress",
    title: "Progress",
    category: "ui",
    description: "Progress bar filling to a target percentage.",
    source: "progress",
    props: {
      value: { default: 72, doc: "target %" },
      width: { default: 320, doc: "px" },
      fillFrames: { default: 24, doc: "fill length" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("prg");
      const css = [
        `@keyframes ${id} { from { width:0%; } to { width:${p.value ?? 72}%; } }`,
        `.${id} { width:${p.width ?? 320}px; height:12px; border-radius:999px; background:${t.muted}; overflow:hidden; }`,
        `.${id} .fill { height:100%; border-radius:999px; background:${t.primary}; animation:${id} ${sec(p.fillFrames ?? 24)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:0.3s; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><div class="fill"></div></div>` });
    },
  },

  // ── progress-steps — segments fill one after another
  {
    name: "progress-steps",
    title: "Progress Steps",
    category: "ui",
    description: "Segmented progress — steps fill in sequence.",
    source: "progress-steps",
    props: {
      steps: { default: 4, doc: "segments" },
      completed: { default: 3, doc: "how many fill" },
      width: { default: 340, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("pst");
      const n = p.steps ?? 4;
      const done = Math.min(n, p.completed ?? 3);
      const css: string[] = [
        `.${id} { display:flex; gap:8px; width:${p.width ?? 340}px; }`,
        `.${id} .seg { flex:1; height:8px; border-radius:999px; background:${t.muted}; overflow:hidden; }`,
        `.${id} .seg span { display:block; height:100%; width:0%; background:${t.primary}; }`,
      ];
      const segs = Array.from({ length: n }, (_, i) => {
        if (i >= done) return `<span class="seg"><span></span></span>`;
        const kf = `${id}-s${i}`;
        css.push(`@keyframes ${kf} { from { width:0%; } to { width:100%; } }`);
        return `<span class="seg"><span style="animation:${kf} ${sec(12)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${(0.25 + i * 0.45).toFixed(2)}s"></span></span>`;
      }).join("");
      return centerFill({ css: css.join("\n"), html: `<div class="${id}">${segs}</div>` });
    },
  },

  // ── radio — option dot pops on selection
  {
    name: "radio",
    title: "Radio",
    category: "ui",
    description: "Radio group whose selection dot pops in.",
    source: "radio",
    props: {
      options: { default: ["Draft", "Lossless", "Delivery"], doc: "labels" },
      selected: { default: 1, doc: "which pops" },
      selectAtSeconds: { default: 0.6, doc: "when" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("rad");
      const at = p.selectAtSeconds ?? 0.6;
      const css = [
        `@keyframes ${id}-pop { from { transform:scale(0); } to { transform:scale(1); } }`,
        `@keyframes ${id}-ring { 0%, 99.9% { border-color:${t.border}; } 100% { border-color:${t.primary}; } }`,
        `.${id} { display:flex; flex-direction:column; gap:14px; font:500 15px/1.2 sans-serif; color:${t.foreground}; }`,
        `.${id} .opt { display:flex; align-items:center; gap:10px; }`,
        `.${id} .ring { width:20px; height:20px; border-radius:50%; border:1.5px solid ${t.border}; display:flex; align-items:center; justify-content:center; }`,
        `.${id} .opt.sel .ring { animation:${id}-ring ${at}s steps(1,end) both; }`,
        `.${id} .dot { width:10px; height:10px; border-radius:50%; background:${t.primary}; transform:scale(0); animation:${id}-pop ${sec(8)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay:${at}s; }`,
      ].join("\n");
      const rows = (p.options ?? []).map((o: string, i: number) =>
        `<div class="opt${i === (p.selected ?? 1) ? " sel" : ""}"><span class="ring">${i === (p.selected ?? 1) ? '<span class="dot"></span>' : ""}</span>${escapeHtml(o)}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}">${rows}</div>` });
    },
  },

  // ── slider — thumb glides to value, fill follows
  {
    name: "slider",
    title: "Slider",
    category: "ui",
    description: "Slider whose thumb glides to its value.",
    source: "slider",
    props: {
      value: { default: 65, doc: "target %" },
      width: { default: 320, doc: "px" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("sld");
      const W = p.width ?? 320;
      const target = ((p.value ?? 65) / 100) * W;
      const css = [
        `@keyframes ${id}-fill { from { width:0px; } to { width:${target.toFixed(0)}px; } }`,
        `@keyframes ${id}-thumb { from { transform:translate(-9px, -50%); } to { transform:translate(${(target - 9).toFixed(0)}px, -50%); } }`,
        `.${id} { position:relative; width:${W}px; height:20px; }`,
        `.${id} .track { position:absolute; top:50%; left:0; right:0; height:6px; border-radius:999px; background:${t.muted}; transform:translateY(-50%); }`,
        `.${id} .fill { position:absolute; top:50%; left:0; height:6px; border-radius:999px; background:${t.primary}; transform:translateY(-50%); animation:${id}-fill ${sec(18)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:0.3s; }`,
        `.${id} .thumb { position:absolute; top:50%; left:0; width:18px; height:18px; border-radius:50%; background:${t.background}; border:1.5px solid ${t.primary}; box-shadow:0 1px 4px rgba(0,0,0,.35); animation:${id}-thumb ${sec(18)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:0.3s; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><div class="track"></div><div class="fill"></div><div class="thumb"></div></div>` });
    },
  },

  // ── stepper — count increments through values (stacked cuts)
  {
    name: "stepper",
    title: "Stepper",
    category: "ui",
    description: "Numeric stepper counting up through its values.",
    source: "stepper",
    props: {
      fromValue: { default: 1, doc: "start" },
      toValue: { default: 4, doc: "end" },
      stepSeconds: { default: 0.5, doc: "per increment" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("stp");
      const a = p.fromValue ?? 1, b = p.toValue ?? 4;
      const stepS = p.stepSeconds ?? 0.5;
      const total = (b - a + 1) * stepS + 0.8;
      const css: string[] = [
        `.${id} { display:inline-flex; align-items:center; gap:14px; font:600 20px/1 sans-serif; color:${t.foreground}; }`,
        `.${id} .box { display:grid; place-items:center; min-width:64px; height:44px; border:1px solid ${t.border}; border-radius:${t.radius}px; background:${t.card}; }`,
        `.${id} .box span { grid-area:1/1; }`,
        `.${id} .k { width:36px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:${t.radius - 2}px; background:${t.muted}; color:${t.mutedForeground}; font-size:18px; }`,
      ];
      const vals = [];
      for (let v = a; v <= b; v++) {
        const i = v - a;
        const kf = `${id}-v${i}`;
        const t0 = ((i * stepS) / total) * 100;
        const t1 = v === b ? 100 : ((i + 1) * stepS / total) * 100;
        css.push(`@keyframes ${kf} { 0% { opacity:${i === 0 ? 1 : 0}; } ${t0.toFixed(2)}% { opacity:1; } ${v === b ? "" : `${t1.toFixed(2)}% { opacity:0; }`} 100% { opacity:${v === b ? 1 : 0}; } }`);
        vals.push(`<span style="animation:${kf} ${total.toFixed(2)}s steps(1,end) both">${v}</span>`);
      }
      return centerFill({ css: css.join("\n"), html: `<div class="${id}"><span class="k">−</span><span class="box">${vals.join("")}</span><span class="k">+</span></div>` });
    },
  },

  // ── toggle-group — selection pill hops to the next segment
  {
    name: "toggle-group",
    title: "Toggle Group",
    category: "ui",
    description: "Segment group whose active pill hops to a new segment.",
    source: "toggle-group",
    props: {
      labels: { default: ["16:9", "9:16", "1:1"], doc: "segments" },
      from: { default: 0, doc: "start index" },
      to: { default: 2, doc: "end index" },
      switchAtSeconds: { default: 0.7, doc: "when" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("tgg");
      const labels: string[] = p.labels ?? [];
      const segW = 86;
      const x0 = (p.from ?? 0) * segW, x1 = (p.to ?? labels.length - 1) * segW;
      const css = [
        `@keyframes ${id} { from { transform:translateX(${x0}px); } to { transform:translateX(${x1}px); } }`,
        `.${id} { position:relative; display:flex; padding:4px; gap:0; background:${t.muted}; border-radius:${t.radius}px; }`,
        `.${id} .pill { position:absolute; top:4px; left:4px; width:${segW}px; height:34px; background:${t.background}; border-radius:${t.radius - 3}px; box-shadow:0 1px 4px rgba(0,0,0,.3); animation:${id} ${sec(11)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${p.switchAtSeconds ?? 0.7}s; }`,
        `.${id} span.lbl { position:relative; width:${segW}px; height:34px; display:flex; align-items:center; justify-content:center; font:600 13px/1 sans-serif; color:${t.foreground}; }`,
      ].join("\n");
      const row = labels.map((l) => `<span class="lbl">${escapeHtml(l)}</span>`).join("");
      return centerFill({ css, html: `<div class="${id}"><span class="pill"></span>${row}</div>` });
    },
  },

  // ── accordion — item expands (max-height + chevron rotate)
  {
    name: "accordion",
    title: "Accordion",
    category: "ui",
    description: "Accordion item expanding to reveal its content.",
    source: "accordion",
    props: {
      question: { default: "Is every render deterministic?", doc: "header" },
      answer: { default: "Yes — same take, same pixels. The CSS clock is stepped per frame, so re-renders are byte-identical.", doc: "content" },
      openAtSeconds: { default: 0.5, doc: "when it opens" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("acc");
      const at = p.openAtSeconds ?? 0.5;
      const css = [
        `@keyframes ${id}-open { from { max-height:0px; opacity:0; } to { max-height:140px; opacity:1; } }`,
        `@keyframes ${id}-chev { from { transform:rotate(0deg); } to { transform:rotate(180deg); } }`,
        `.${id} { width:440px; border:1px solid ${t.border}; border-radius:${t.radius}px; background:${t.card}; padding:0 18px; }`,
        `.${id} .q { display:flex; justify-content:space-between; align-items:center; height:52px; font:600 14.5px/1.3 sans-serif; color:${t.cardForeground}; }`,
        `.${id} .chev { width:10px; height:10px; border-right:2px solid ${t.mutedForeground}; border-bottom:2px solid ${t.mutedForeground}; transform-origin:60% 60%; rotate:45deg; animation:${id}-chev ${sec(10)}s ease-out both; animation-delay:${at}s; }`,
        `.${id} .a { overflow:hidden; max-height:0; font:400 13.5px/1.55 sans-serif; color:${t.mutedForeground}; padding-bottom:0; animation:${id}-open ${sec(14)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${at}s; }`,
        `.${id} .a p { padding-bottom:16px; margin:0; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><div class="q">${escapeHtml(p.question)}<span class="chev"></span></div><div class="a"><p>${escapeHtml(p.answer)}</p></div></div>` });
    },
  },

  // ── dropdown-menu — trigger press → 240px panel pops → items cascade
  {
    name: "dropdown-menu",
    title: "Dropdown Menu",
    category: "ui",
    description: "Menu panel popping from a trigger with a cascading item reveal and a highlighted row.",
    source: "dropdown-menu",
    props: {
      trigger: { default: "Options", doc: "trigger label" },
      items: { default: ["Duplicate", "Rename", "Move to…", "Delete"], doc: "rows" },
      highlight: { default: 1, doc: "row that highlights" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("ddm");
      const items: string[] = p.items ?? [];
      const css = [
        `@keyframes ${id}-panel { from { opacity:0; transform:translateY(-6px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-item { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-hl { 0%, 99.9% { background:transparent; } 100% { background:${t.accent}; } }`,
        `.${id} { position:relative; display:inline-flex; flex-direction:column; }`,
        `.${id} .trigger { align-self:flex-start; padding:9px 16px; border:1px solid ${t.border}; border-radius:${t.radius}px; font:600 13.5px/1 sans-serif; color:${t.foreground}; background:${t.card}; }`,
        `.${id} .panel { position:absolute; top:calc(100% + 8px); left:0; width:240px; padding:5px; background:${t.popover ?? t.card}; border:1px solid ${t.border}; border-radius:${t.radius}px; box-shadow:0 14px 40px rgba(0,0,0,.4); transform-origin:top left; animation:${id}-panel ${sec(10)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.4s; }`,
        `.${id} .item { display:flex; align-items:center; height:34px; padding:0 10px; border-radius:${t.radius - 4}px; font:500 13px/1 sans-serif; color:${t.foreground}; animation:${id}-item ${sec(8)}s ease-out both; }`,
        `.${id} .item.hl { animation:${id}-item ${sec(8)}s ease-out both, ${id}-hl 1.15s steps(1,end) both; }`,
        `.${id} .item.destructive { color:${t.destructive}; }`,
      ].join("\n");
      const rows = items.map((label, i) =>
        `<div class="item${i === (p.highlight ?? 1) ? " hl" : ""}${label.toLowerCase() === "delete" ? " destructive" : ""}" style="animation-delay:${(0.48 + i * 0.07).toFixed(2)}s${i === (p.highlight ?? 1) ? `, ${(0.48 + i * 0.07).toFixed(2)}s` : ""}">${escapeHtml(label)}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}"><span class="trigger">${escapeHtml(p.trigger)} ▾</span><div class="panel">${rows}</div></div>` }, "padding-bottom:160px;");
    },
  },

  // ── context-menu — same grammar, appears at a cursor point
  {
    name: "context-menu",
    title: "Context Menu",
    category: "ui",
    description: "Right-click menu popping at a cursor position.",
    source: "context-menu",
    props: {
      items: { default: ["Reveal in Finder", "Add context note", "Copy path"], doc: "rows" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("ctx");
      const items: string[] = p.items ?? [];
      const css = [
        `@keyframes ${id}-panel { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }`,
        `@keyframes ${id}-item { from { opacity:0; } to { opacity:1; } }`,
        `.${id} { position:relative; }`,
        `.${id} .cur { position:absolute; left:-6px; top:-6px; width:14px; height:14px; border-radius:50%; background:rgba(255,255,255,.85); box-shadow:0 0 0 2px rgba(0,0,0,.3); }`,
        `.${id} .panel { width:220px; padding:5px; margin:10px 0 0 8px; background:${t.popover ?? t.card}; border:1px solid ${t.border}; border-radius:${t.radius}px; box-shadow:0 14px 40px rgba(0,0,0,.4); transform-origin:top left; animation:${id}-panel ${sec(9)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.35s; }`,
        `.${id} .item { display:flex; align-items:center; height:32px; padding:0 10px; border-radius:${t.radius - 4}px; font:500 13px/1 sans-serif; color:${t.foreground}; animation:${id}-item ${sec(7)}s ease-out both; }`,
      ].join("\n");
      const rows = items.map((label, i) => `<div class="item" style="animation-delay:${(0.42 + i * 0.06).toFixed(2)}s">${escapeHtml(label)}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}"><span class="cur"></span><div class="panel">${rows}</div></div>` });
    },
  },

  // ── command-menu — ⌘K palette: typed query + filtered rows + highlight
  {
    name: "command-menu",
    title: "Command Menu",
    category: "ui",
    description: "⌘K palette — query types in, results cascade, one row highlights.",
    source: "command-menu",
    props: {
      query: { default: "render", doc: "typed query" },
      items: { default: ["Render take (wavelet)", "Render take (ffmpeg)", "Open render folder"], doc: "results" },
      highlight: { default: 0, doc: "highlighted row" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("cmd");
      const q = String(p.query ?? "");
      const n = Array.from(q).length;
      const typeSecs = +(n / 14).toFixed(3);
      const items: string[] = p.items ?? [];
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(10px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-type { from { width:0ch; } to { width:${n}ch; } }`,
        `@keyframes ${id}-item { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-hl { 0%, 99.9% { background:transparent; } 100% { background:${t.accent}; } }`,
        `.${id} { width:480px; background:${t.popover ?? t.card}; border:1px solid ${t.border}; border-radius:${t.radius + 2}px; box-shadow:0 24px 70px rgba(0,0,0,.5); overflow:hidden; animation:${id}-in ${sec(12)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .search { display:flex; align-items:center; gap:8px; padding:14px 16px; border-bottom:1px solid ${t.border}; font:400 15px/1 ui-monospace, monospace; color:${t.foreground}; }`,
        `.${id} .q { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-type ${typeSecs}s steps(${Math.max(1, n)}, end) both; animation-delay:0.4s; }`,
        `.${id} .list { padding:6px; }`,
        `.${id} .item { display:flex; align-items:center; height:38px; padding:0 12px; border-radius:${t.radius - 3}px; font:500 13.5px/1 sans-serif; color:${t.foreground}; animation:${id}-item ${sec(8)}s ease-out both; }`,
        `.${id} .item.hl { animation:${id}-item ${sec(8)}s ease-out both, ${id}-hl 0.4s steps(1,end) both; }`,
        `.${id} .k { margin-left:auto; font:500 11px ui-monospace, monospace; color:${t.mutedForeground}; }`,
      ].join("\n");
      const base = 0.4 + typeSecs + 0.15;
      const rows = items.map((label, i) =>
        `<div class="item${i === (p.highlight ?? 0) ? " hl" : ""}" style="animation-delay:${(base + i * 0.08).toFixed(2)}s${i === (p.highlight ?? 0) ? `, ${(base + items.length * 0.08 + 0.25).toFixed(2)}s` : ""}">${escapeHtml(label)}${i === 0 ? '<span class="k">↵</span>' : ""}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}"><div class="search">⌘K<span class="q">${escapeHtml(q)}</span></div><div class="list">${rows}</div></div>` });
    },
  },

  // ── combobox — input + panel + option check
  {
    name: "combobox",
    title: "Combobox",
    category: "ui",
    description: "Searchable select — panel opens, options cascade, one gets the check.",
    source: "combobox",
    props: {
      placeholder: { default: "Select deck…", doc: "field text" },
      options: { default: ["showcase", "launch-teaser", "weekly-update"], doc: "options" },
      pick: { default: 0, doc: "picked option" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("cbx");
      const options: string[] = p.options ?? [];
      const css = [
        `@keyframes ${id}-panel { from { opacity:0; transform:translateY(-5px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-item { from { opacity:0; } to { opacity:1; } }`,
        `@keyframes ${id}-check { from { opacity:0; transform:scale(0); } to { opacity:1; transform:scale(1); } }`,
        `.${id} { position:relative; width:280px; }`,
        `.${id} .field { display:flex; align-items:center; justify-content:space-between; height:40px; padding:0 12px; border:1px solid ${t.input}; border-radius:${t.radius}px; background:${t.background}; font:500 13.5px/1 sans-serif; color:${t.mutedForeground}; }`,
        `.${id} .panel { position:absolute; top:calc(100% + 6px); left:0; right:0; padding:5px; background:${t.popover ?? t.card}; border:1px solid ${t.border}; border-radius:${t.radius}px; box-shadow:0 14px 40px rgba(0,0,0,.4); animation:${id}-panel ${sec(9)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.4s; }`,
        `.${id} .opt { display:flex; align-items:center; justify-content:space-between; height:34px; padding:0 10px; border-radius:${t.radius - 4}px; font:500 13px/1 sans-serif; color:${t.foreground}; animation:${id}-item ${sec(7)}s ease-out both; }`,
        `.${id} .chk { display:inline-block; width:9px; height:5.5px; border-left:2px solid ${t.primary}; border-bottom:2px solid ${t.primary}; rotate:-45deg; animation:${id}-check ${sec(8)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; }`,
      ].join("\n");
      const rows = options.map((label, i) =>
        `<div class="opt" style="animation-delay:${(0.46 + i * 0.07).toFixed(2)}s">${escapeHtml(label)}${i === (p.pick ?? 0) ? `<span class="chk" style="animation-delay:${(0.46 + options.length * 0.07 + 0.3).toFixed(2)}s"></span>` : ""}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}"><div class="field">${escapeHtml(p.placeholder)}<span>▾</span></div><div class="panel">${rows}</div></div>` }, "padding-bottom:140px;");
    },
  },

  // ── field — labeled input row (state atom)
  {
    name: "field",
    title: "Field",
    category: "ui",
    description: "Label + input + helper text form row.",
    source: "field",
    props: {
      label: { default: "Project name", doc: "label" },
      value: { default: "wavelet-ui", doc: "field value" },
      help: { default: "Lowercase, dashes allowed.", doc: "helper line" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("fld");
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { display:flex; flex-direction:column; gap:7px; width:320px; animation:${id}-in ${sec(12)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .lbl { font:600 13px/1 sans-serif; color:${t.foreground}; }`,
        `.${id} .inp { display:flex; align-items:center; height:40px; padding:0 12px; border:1px solid ${t.input}; border-radius:${t.radius}px; background:${t.background}; font:400 14px/1 ui-monospace, monospace; color:${t.foreground}; }`,
        `.${id} .help { font:400 12px/1.4 sans-serif; color:${t.mutedForeground}; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><span class="lbl">${escapeHtml(p.label)}</span><span class="inp">${escapeHtml(p.value)}</span><span class="help">${escapeHtml(p.help)}</span></div>` });
    },
  },

  // ── backdrop — content framed in a rounded, padded stage (source: % of width)
  {
    name: "backdrop",
    title: "Backdrop",
    category: "background",
    description: "Rounded padded frame around content — the demo-video stage mat.",
    source: "backdrop",
    props: {
      padding: { default: 4, doc: "% of width" },
      radius: { default: 1, doc: "% of width" },
      outer: { default: "#050508", doc: "mat color" },
      inner: { default: "#101018", doc: "stage color" },
      label: { default: "Your app here", doc: "placeholder content" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("bkd");
      const css = [
        `.${id} { position:absolute; inset:0; background:${p.outer ?? "#050508"}; padding:${p.padding ?? 4}%; }`,
        `.${id} .stage { width:100%; height:100%; background:${p.inner ?? "#101018"}; border-radius:${p.radius ?? 1}vw; border:1px solid rgba(255,255,255,.07); display:flex; align-items:center; justify-content:center; font:600 28px/1 sans-serif; color:#52525b; }`,
      ].join("\n");
      return { css, html: `<div class="${id}"><div class="stage">${escapeHtml(p.label ?? "")}</div></div>` };
    },
  },

  // ── mesh-gradient-bg — drifting blurred color blobs (blur = Chrome lane)
  {
    name: "mesh-gradient-bg",
    title: "Mesh Gradient BG",
    category: "background",
    description: "Slow-breathing mesh of blurred color blobs.",
    source: "mesh-gradient-bg",
    filterDependent: true,
    props: {
      colors: { default: ["#6366f1", "#a855f7", "#0ea5e9"], doc: "blob colors" },
      background: { default: "#0a0a12", doc: "backdrop" },
      blur: { default: 80, doc: "blob blur px" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("mesh");
      const colors: string[] = p.colors ?? ["#6366f1", "#a855f7", "#0ea5e9"];
      const spots = [
        { x: 25, y: 30, s0: 1, s1: 1.15 },
        { x: 72, y: 38, s0: 1.1, s1: 0.95 },
        { x: 48, y: 75, s0: 0.9, s1: 1.1 },
      ];
      const css: string[] = [
        `.${id} { position:absolute; inset:0; background:${p.background ?? "#0a0a12"}; overflow:hidden; }`,
      ];
      const blobs = spots.map((s, i) => {
        const kf = `${id}-b${i}`;
        css.push(`@keyframes ${kf} { 0% { transform:translate(-50%, -50%) scale(${s.s0}); } 50% { transform:translate(-50%, -50%) scale(${s.s1}); } 100% { transform:translate(-50%, -50%) scale(${s.s0}); } }`);
        // radial-gradient core keeps the look even where filter:blur is a no-op
        return `<span style="position:absolute; left:${s.x}%; top:${s.y}%; width:55%; height:55%; border-radius:50%; background:radial-gradient(circle, ${colors[i % colors.length]}88, transparent 65%); filter:blur(${p.blur ?? 80}px); animation:${kf} ${4 + i}s ease-in-out infinite;"></span>`;
      }).join("");
      return { css: css.join("\n"), html: `<div class="${id}">${blobs}</div>` };
    },
  },

  // ── confetti — seeded ballistic burst, sampled to keyframes
  {
    name: "confetti",
    title: "Confetti",
    category: "background",
    description: "Celebration burst — seeded ballistic particles, fully deterministic.",
    source: "confetti",
    props: {
      count: { default: 36, doc: "particles" },
      originX: { default: 50, doc: "% from left" },
      originY: { default: 60, doc: "% from top" },
      seed: { default: "party", doc: "burst seed" },
      durationSeconds: { default: 2.2, doc: "burst length" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("cfi");
      const rand = mulberry32(hashSeed(String(p.seed ?? "party")));
      const COLORS = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6"];
      const n = p.count ?? 36;
      const dur = p.durationSeconds ?? 2.2;
      const css: string[] = [
        `.${id} { position:absolute; inset:0; overflow:hidden; }`,
        `.${id} span { position:absolute; left:${p.originX ?? 50}%; top:${p.originY ?? 60}%; width:9px; height:14px; opacity:0; }`,
      ];
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (rand() * 2 - 1) * 1.15;
        const v = 380 + rand() * 420; // px/s launch
        const g = 900; // px/s² gravity
        const spin = (rand() * 2 - 1) * 720;
        const kf = `${id}-p${i}`;
        const stops: string[] = [];
        const S = 12;
        for (let k = 0; k <= S; k++) {
          const tt = (k / S) * dur;
          const x = Math.cos(ang) * v * tt;
          const y = Math.sin(ang) * v * tt + 0.5 * g * tt * tt;
          const o = k === 0 ? 1 : k === S ? 0 : tt > dur * 0.7 ? (1 - (tt - dur * 0.7) / (dur * 0.3)) : 1;
          stops.push(`${((k / S) * 100).toFixed(1)}% { opacity:${o.toFixed(2)}; transform:translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${(spin * tt).toFixed(0)}deg); }`);
        }
        css.push(`@keyframes ${kf} { ${stops.join(" ")} }`);
        parts.push(`<span style="background:${COLORS[i % COLORS.length]}; animation:${kf} ${dur}s linear both; animation-delay:${(rand() * 0.12).toFixed(2)}s"></span>`);
      }
      return { css: css.join("\n"), html: `<div class="${id}">${parts.join("")}</div>` };
    },
  },

  // ── simulated-cursor — bezier glide + click dip + ripple (source grammar)
  {
    name: "simulated-cursor",
    title: "Simulated Cursor",
    category: "ui",
    description: "Cursor glides along a curve, clicks (scale dip), and fires a ripple.",
    source: "simulated-cursor",
    props: {
      fromX: { default: 200, doc: "start x px" },
      fromY: { default: 480, doc: "start y px" },
      toX: { default: 760, doc: "click x px" },
      toY: { default: 300, doc: "click y px" },
      glideSeconds: { default: 1.1, doc: "travel time" },
      size: { default: 22, doc: "cursor px" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("scur");
      const glide = p.glideSeconds ?? 1.1;
      const total = glide + 0.9;
      const x0 = p.fromX ?? 200, y0 = p.fromY ?? 480, x1 = p.toX ?? 760, y1 = p.toY ?? 300;
      const cx = (x0 + x1) / 2 + (y0 - y1) * 0.35, cy = (y0 + y1) / 2 + (x1 - x0) * 0.2;
      const S = 14;
      const stops: string[] = [];
      for (let k = 0; k <= S; k++) {
        const u = k / S;
        const e = u * u * (3 - 2 * u); // smoothstep ease along the path
        const x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
        const y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y1;
        stops.push(`${((u * glide) / total * 100).toFixed(2)}% { transform:translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) scale(1); }`);
      }
      const clickAt = (glide / total) * 100;
      const css = [
        `@keyframes ${id}-move { ${stops.join(" ")} ${(clickAt + 6).toFixed(2)}% { transform:translate(${x1}px, ${y1}px) scale(0.82); } ${(clickAt + 14).toFixed(2)}% { transform:translate(${x1}px, ${y1}px) scale(1); } 100% { transform:translate(${x1}px, ${y1}px) scale(1); } }`,
        `@keyframes ${id}-rip { 0%, ${(clickAt + 4).toFixed(2)}% { opacity:0; transform:scale(0.25); } ${(clickAt + 8).toFixed(2)}% { opacity:0.7; } 100% { opacity:0; transform:scale(2.2); } }`,
        `.${id} { position:absolute; inset:0; }`,
        `.${id} .cur { position:absolute; left:-${(p.size ?? 22) / 2}px; top:-${(p.size ?? 22) / 2}px; width:${p.size ?? 22}px; height:${p.size ?? 22}px; border-radius:50%; background:rgba(255,255,255,.92); box-shadow:0 0 0 2px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.5); animation:${id}-move ${total}s linear both; }`,
        `.${id} .rip { position:absolute; left:${x1 - 26}px; top:${y1 - 26}px; width:52px; height:52px; border-radius:50%; border:3px solid rgba(129,140,248,.95); opacity:0; animation:${id}-rip ${total}s linear both; }`,
      ].join("\n");
      return { css, html: `<div class="${id}"><span class="rip"></span><span class="cur"></span></div>` };
    },
  },
];
