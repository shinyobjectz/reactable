// wavelet-ui wave 6 — charts, terminals, dissolve family.
// Charts/terminals port 1:1 (bars=scaleY stagger, line=segment spans, typed
// commands=ch-width). The six dissolves are CSS APPROXIMATIONS of Remocn's
// WebGL shader transitions: the source's opacity ENVELOPE curves are exact
// ([0,.3,.65,1]→[0,1,1,0]; out .28–.36, in .58–.66), the cover texture is an
// organic blob field flavored per variant (the shader itself needs the
// HyperFrames/canvas lane — noted per component).

import { escapeHtml, freshId, kfBlock, sec, centerFill } from "./lib/motion.ts";
import { theme as pickTheme } from "./lib/theme.ts";
import type { UIComponent } from "./components.ts";

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

// terminal window scaffold (traffic lights + dark chrome)
function termWindow(id: string, inner: string, w = 900, h = 480, title = ""): string {
  return `<div class="${id}-win" style="width:${w}px; height:${h}px; background:#0d1117; border:1px solid #23262e; border-radius:12px; overflow:hidden; box-shadow:0 24px 70px rgba(0,0,0,.5); display:flex; flex-direction:column;">
    <div style="height:40px; flex:none; display:flex; align-items:center; gap:8px; padding:0 14px; background:#161b22; border-bottom:1px solid #23262e;">
      <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
      <span style="margin-left:10px;font:500 12px ui-monospace,monospace;color:#8b949e">${escapeHtml(title)}</span>
    </div>
    <div style="flex:1; padding:20px; font:400 15px/1.7 ui-monospace, monospace; color:#e6edf3;">${inner}</div>
  </div>`;
}

// typed command line: prompt + ch-growth text + block caret
function typedLine(id: string, cmd: string, cps: number, delay: number, promptSym = "❯"): { css: string; html: string; done: number } {
  const n = Array.from(cmd).length;
  const typeSecs = +(n / cps).toFixed(3);
  const css = [
    `@keyframes ${id}-t { from { width:0ch; } to { width:${n}ch; } }`,
    `.${id}-cmd { display:inline-block; overflow:hidden; white-space:pre; vertical-align:bottom; width:0ch; animation:${id}-t ${typeSecs}s steps(${Math.max(1, n)}, end) both; animation-delay:${delay}s; }`,
  ].join("\n");
  const html = `<div><span style="color:#7ee787">${escapeHtml(promptSym)}</span> <span class="${id}-cmd">${escapeHtml(cmd)}</span><span class="${id}-caret"></span></div>`;
  return { css, html, done: delay + typeSecs };
}

// dissolve scaffold: from/to panels + organic cover with the source envelope
function dissolve(
  name: string,
  flavorCss: (id: string, rand: () => number) => { blobCss: string; blobs: string },
  colors: { back: string },
): Pick<UIComponent, "generate"> ["generate"] {
  return (p: Record<string, any>) => {
    const id = freshId(name);
    const speed = p.speed ?? 1;
    const dur = p.durationFrames ?? 45;
    const rand = mulberry32(hashSeed(name + (p.seed ?? "")));
    const { blobCss, blobs } = flavorCss(id, rand);
    const css = [
      // source envelope: cover 0→1 by 30%, hold to 65%, →0 at 100%
      kfBlock(`${id}-cover`, [
        { at: 0, style: { opacity: "0" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
        { at: 0.3, style: { opacity: "1" } },
        { at: 0.65, style: { opacity: "1" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
        { at: 1, style: { opacity: "0" } },
      ]),
      kfBlock(`${id}-out`, [
        { at: 0, style: { opacity: "1" } },
        { at: 0.28, style: { opacity: "1" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
        { at: 0.36, style: { opacity: "0" } },
        { at: 1, style: { opacity: "0" } },
      ]),
      kfBlock(`${id}-in`, [
        { at: 0, style: { opacity: "0" } },
        { at: 0.58, style: { opacity: "0" }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
        { at: 0.66, style: { opacity: "1" } },
        { at: 1, style: { opacity: "1" } },
      ]),
      `.${id} { position:absolute; inset:0; overflow:hidden; }`,
      `.${id} .panel { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font:600 ${p.fontSize ?? 72}px/1.1 sans-serif; letter-spacing:-0.03em; color:${p.color ?? "#f4f4f5"}; }`,
      `.${id} .from { animation:${id}-out ${sec(dur, speed)}s linear both; }`,
      `.${id} .to { animation:${id}-in ${sec(dur, speed)}s linear both; }`,
      `.${id} .cover { position:absolute; inset:0; background:${colors.back}; opacity:0; animation:${id}-cover ${sec(dur, speed)}s linear both; overflow:hidden; }`,
      blobCss,
    ].join("\n");
    const html = `<div class="${id}"><div class="panel from">${escapeHtml(p.from ?? "Before")}</div><div class="panel to">${escapeHtml(p.to ?? "After")}</div><div class="cover">${blobs}</div></div>`;
    return { css, html };
  };
}

const dissolveProps = {
  from: { default: "Before", doc: "outgoing text" },
  to: { default: "After", doc: "incoming text" },
  durationFrames: { default: 45, doc: "transition length" },
  fontSize: { default: 72, doc: "panel text px" },
  color: { default: "#f4f4f5", doc: "panel text color" },
  seed: { default: "", doc: "texture seed" },
  speed: { default: 1, doc: "playback multiplier" },
};
const shaderNote = " CSS approximation of the WebGL shader (envelope curves exact; run the true shader in the HyperFrames lane).";

export const WAVE6: UIComponent[] = [
  // ── animated-bar-chart — bars scaleY up, stagger 6f (source defaults)
  {
    name: "animated-bar-chart",
    title: "Animated Bar Chart",
    category: "ui",
    description: "Bars grow from the baseline in a stagger.",
    source: "animated-bar-chart",
    props: {
      data: { default: [35, 60, 45, 80, 55, 70, 90, 65], doc: "values" },
      width: { default: 1000, doc: "px" },
      height: { default: 500, doc: "px" },
      barColor: { default: "#0ea5e9", doc: "bar fill" },
      gap: { default: 16, doc: "px between bars" },
      staggerFrames: { default: 6, doc: "frames between bars" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { width: 800, height: 400 },
    generate: (p) => {
      const id = freshId("bar");
      const data: number[] = p.data ?? [35, 60, 45, 80, 55, 70, 90, 65];
      const max = Math.max(...data);
      const css = [
        `@keyframes ${id} { from { transform:scaleY(0); } to { transform:scaleY(1); } }`,
        `.${id} { display:flex; align-items:flex-end; gap:${p.gap ?? 16}px; width:${p.width ?? 1000}px; height:${p.height ?? 500}px; }`,
        `.${id} span { flex:1; border-radius:8px 8px 3px 3px; background:${p.barColor ?? "#0ea5e9"}; transform-origin:bottom; animation:${id} ${sec(16, p.speed ?? 1)}s cubic-bezier(0.22, 1, 0.36, 1) both; }`,
      ].join("\n");
      const bars = data.map((v, i) =>
        `<span style="height:${((v / max) * 100).toFixed(1)}%; animation-delay:${sec(i * (p.staggerFrames ?? 6), p.speed ?? 1)}s"></span>`).join("");
      return centerFill({ css, html: `<div class="${id}">${bars}</div>` });
    },
  },

  // ── animated-line-chart — segments draw L→R, dot rides the tip
  {
    name: "animated-line-chart",
    title: "Animated Line Chart",
    category: "ui",
    description: "Line chart drawing itself point to point with a leading dot.",
    source: "animated-line-chart",
    props: {
      data: { default: [12, 19, 8, 15, 22, 18, 28, 25, 32], doc: "values" },
      width: { default: 1000, doc: "px" },
      height: { default: 500, doc: "px" },
      strokeColor: { default: "#22c55e", doc: "line" },
      strokeWidth: { default: 4, doc: "px" },
      gridColor: { default: "#27272a", doc: "grid lines" },
      speed: { default: 1, doc: "playback multiplier" },
    },
    demoProps: { width: 800, height: 400 },
    generate: (p) => {
      const id = freshId("lin");
      const data: number[] = p.data ?? [12, 19, 8, 15, 22, 18, 28, 25, 32];
      const W = p.width ?? 1000, H = p.height ?? 500;
      const max = Math.max(...data), min = Math.min(...data);
      const px = (i: number) => (i / (data.length - 1)) * W;
      const py = (v: number) => H - ((v - min) / (max - min)) * (H * 0.86) - H * 0.07;
      const segFrames = 42 / (data.length - 1);
      const css: string[] = [
        `.${id} { position:relative; width:${W}px; height:${H}px; }`,
        `.${id} .grid { position:absolute; left:0; right:0; height:1px; background:${p.gridColor ?? "#27272a"}; }`,
        `@keyframes ${id}-seg { from { transform:scaleX(0); } to { transform:scaleX(1); } }`,
        `@keyframes ${id}-dotin { from { opacity:0; } to { opacity:1; } }`,
      ];
      const grid = [0.2, 0.4, 0.6, 0.8].map((g) => `<span class="grid" style="top:${(g * 100).toFixed(0)}%"></span>`).join("");
      const segs = data.slice(1).map((v, i) => {
        const x0 = px(i), y0 = py(data[i]), x1 = px(i + 1), y1 = py(v);
        const len = Math.hypot(x1 - x0, y1 - y0);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        return `<span style="position:absolute; left:${x0.toFixed(1)}px; top:${y0.toFixed(1)}px; width:${len.toFixed(1)}px; height:${p.strokeWidth ?? 4}px; margin-top:-${(p.strokeWidth ?? 4) / 2}px; border-radius:99px; background:${p.strokeColor ?? "#22c55e"}; transform-origin:0 50%; transform:rotate(${ang.toFixed(4)}rad) scaleX(0); animation:${id}-seg ${sec(segFrames, p.speed ?? 1)}s linear both; animation-delay:${sec(i * segFrames, p.speed ?? 1)}s"></span>`;
      }).join("");
      const dots = data.map((v, i) =>
        `<span style="position:absolute; left:${(px(i) - 5).toFixed(1)}px; top:${(py(v) - 5).toFixed(1)}px; width:10px; height:10px; border-radius:50%; background:${p.strokeColor ?? "#22c55e"}; opacity:0; animation:${id}-dotin 0.15s linear both; animation-delay:${sec(i * segFrames, p.speed ?? 1)}s"></span>`).join("");
      return centerFill({ css: css.join("\n"), html: `<div class="${id}">${grid}${segs}${dots}</div>` });
    },
  },

  // ── terminal-simulator — window + typed command + output cascade
  {
    name: "terminal-simulator",
    title: "Terminal Simulator",
    category: "scene",
    description: "Terminal window: command types in, output lines land.",
    source: "terminal-simulator",
    props: {
      command: { default: "reactable takes render take-01 --engine wavelet", doc: "typed command" },
      output: { default: ["rendered 240 frames in 1.02s", "encoded out/wavelet.mp4", "✓ done"], doc: "result lines" },
      title: { default: "reactable — zsh", doc: "window title" },
      charsPerSecond: { default: 28, doc: "typing speed" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("term");
      const typed = typedLine(id, p.command ?? "", p.charsPerSecond ?? 28, 0.4);
      const outLines: string[] = p.output ?? [];
      const css: string[] = [
        typed.css,
        `@keyframes ${id}-blink { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }`,
        `.${id}-caret { display:inline-block; width:0.55em; height:1.1em; background:#e6edf3; vertical-align:-0.15em; margin-left:2px; animation:${id}-blink 1s steps(1,end) infinite; }`,
        `@keyframes ${id}-line { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id}-out { color:#8b949e; opacity:0; animation:${id}-line ${sec(7)}s ease-out both; }`,
        `.${id}-out.ok { color:#7ee787; }`,
      ];
      const out = outLines.map((l, i) =>
        `<div class="${id}-out${l.startsWith("✓") ? " ok" : ""}" style="animation-delay:${(typed.done + 0.35 + i * 0.28).toFixed(2)}s">${escapeHtml(l)}</div>`).join("");
      return centerFill({ css: css.join("\n"), html: termWindow(id, typed.html + out, 900, 420, p.title ?? "") });
    },
  },

  // ── terminal-cursor-zoom — terminal types, camera punches into the caret
  {
    name: "terminal-cursor-zoom",
    title: "Terminal Cursor Zoom",
    category: "scene",
    description: "Terminal types a command while the camera zooms toward the caret (zoom 2.8, source constants).",
    source: "terminal-cursor-zoom",
    props: {
      command: { default: "npx shadcn add @remocn/terminal-cursor-zoom", doc: "typed command" },
      zoom: { default: 2.8, doc: "punch-in scale" },
      title: { default: "terminal", doc: "window title" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("tcz");
      const typed = typedLine(id, p.command ?? "", 24, 0.5);
      const z = p.zoom ?? 2.8;
      const css = [
        typed.css,
        `@keyframes ${id}-blink { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }`,
        `.${id}-caret { display:inline-block; width:0.55em; height:1.1em; background:#e6edf3; vertical-align:-0.15em; margin-left:2px; animation:${id}-blink 1s steps(1,end) infinite; }`,
        kfBlock(`${id}-cam`, [
          { at: 0, style: { transform: "scale(1)" } },
          { at: 0.35, style: { transform: "scale(1)" }, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { at: 1, style: { transform: `scale(${z})` } },
        ]),
        `.${id}-stage { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; transform-origin:38% 42%; animation:${id}-cam ${(typed.done + 1.2).toFixed(2)}s linear both; }`,
      ].join("\n");
      return { css, html: `<div class="${id}-stage">${termWindow(id, typed.html, 900, 480, p.title ?? "")}</div>` };
    },
  },

  // ── glass-code-block — frosted panel with staggered code lines
  {
    name: "glass-code-block",
    title: "Glass Code Block",
    category: "scene",
    description: "Frosted glass code card with line-by-line reveal.",
    source: "glass-code-block",
    filterDependent: true,
    props: {
      lines: { default: ["const take = await record(deck);", "const comp = compile(take);", "await render(comp, { lossless: true });"], doc: "code lines" },
      accent: { default: "#818cf8", doc: "keyword tint" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("gcb");
      const lines: string[] = p.lines ?? [];
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(14px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-line { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }`,
        `.${id} { width:640px; padding:26px 28px; border-radius:18px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14); backdrop-filter:blur(18px); box-shadow:0 24px 70px rgba(0,0,0,.45); animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .ln { font:400 16px/1.8 ui-monospace, monospace; color:#e6e6f0; opacity:0; animation:${id}-line ${sec(9)}s ease-out both; }`,
        `.${id} .ln b { color:${p.accent ?? "#818cf8"}; font-weight:600; }`,
      ].join("\n");
      const rows = lines.map((l, i) =>
        `<div class="ln" style="animation-delay:${(0.35 + i * 0.22).toFixed(2)}s">${escapeHtml(l).replace(/\b(const|await|function|return|import)\b/g, "<b>$1</b>")}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}">${rows}</div>` });
    },
  },

  // ── glass-code-walk — glass code card + camera pan down the lines
  {
    name: "glass-code-walk",
    title: "Glass Code Walk",
    category: "scene",
    description: "Camera walks down a glass code card line by line.",
    source: "glass-code-walk",
    filterDependent: true,
    gateGap: "backdrop-filter (frosted glass) unsupported in blitz — panel renders unfrosted; Chrome/HyperFrames lane renders fully",
    props: {
      lines: { default: ["deck showcase {", "  slide prose {", "    # Authored in .work", "  }", "}", "", "render --lossless"], doc: "code lines" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("gcw");
      const lines: string[] = p.lines ?? [];
      const settle = Math.max(0, lines.length * 14 - 30);
      // camera pattern for blitz: STATIC end-state transform on the stage,
      // identity-settling DELTA on an inner wrapper (animated ancestor
      // transforms don't propagate to descendants unless they settle at identity)
      const css = [
        kfBlock(`${id}-cam`, [
          { at: 0, style: { transform: `translateY(${40 + settle}px)` }, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { at: 1, style: { transform: "translateY(0px)" } },
        ]),
        `.${id}-stage { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; transform:translateY(-${settle}px) scale(1.35); }`,
        `.${id}-delta { animation:${id}-cam 3s linear both; }`,
        `.${id} { width:620px; padding:24px 28px; border-radius:18px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14); backdrop-filter:blur(18px); }`,
        `.${id} .ln { font:400 16px/1.75 ui-monospace, monospace; color:#e6e6f0; white-space:pre; }`,
      ].join("\n");
      const rows = lines.map((l) => `<div class="ln">${escapeHtml(l) || "&nbsp;"}</div>`).join("");
      return { css, html: `<div class="${id}-stage"><div class="${id}-delta"><div class="${id}">${rows}</div></div></div>` };
    },
  },

  // ── the six shader dissolves — envelope-exact CSS approximations
  {
    name: "dither-dissolve",
    title: "Dither Dissolve",
    category: "transition",
    description: "Dot-field cover sweeps between scenes." + shaderNote,
    source: "dither-dissolve",
    props: dissolveProps,
    demoProps: { from: "Dither", to: "Dissolve" },
    generate: dissolve("dither", (id, rand) => {
      const dots: string[] = [];
      for (let i = 0; i < 130; i++) {
        const x = rand() * 100, y = rand() * 100, s = 6 + rand() * 16;
        dots.push(`<i style="left:${x.toFixed(1)}%; top:${y.toFixed(1)}%; width:${s.toFixed(0)}px; height:${s.toFixed(0)}px; animation-delay:${(rand() * 0.5).toFixed(2)}s"></i>`);
      }
      return {
        blobCss: [
          `@keyframes ${id}-dot { 0% { transform:scale(0.4); } 50% { transform:scale(1); } 100% { transform:scale(0.4); } }`,
          `.${id} .cover i { position:absolute; border-radius:2px; background:#e8e8ec; animation:${id}-dot 0.9s ease-in-out infinite; }`,
        ].join("\n"),
        blobs: dots.join(""),
      };
    }, { back: "#101014" }),
  },
  {
    name: "grain-dissolve",
    title: "Grain Dissolve",
    category: "transition",
    description: "Grainy gradient cover washes between scenes." + shaderNote,
    source: "grain-dissolve",
    props: dissolveProps,
    demoProps: { from: "Grain", to: "Dissolve" },
    generate: dissolve("grain", (id, rand) => {
      const blobs: string[] = [];
      const cols = ["#3a3a52", "#4a4a68", "#8f88ae"];
      for (let i = 0; i < 7; i++) {
        blobs.push(`<i style="left:${(rand() * 100).toFixed(0)}%; top:${(rand() * 100).toFixed(0)}%; width:46%; height:46%; background:radial-gradient(circle, ${cols[i % 3]}cc, transparent 65%); animation-duration:${(2.4 + rand()).toFixed(1)}s"></i>`);
      }
      const dots: string[] = [];
      for (let i = 0; i < 90; i++) {
        dots.push(`<b style="left:${(rand() * 100).toFixed(1)}%; top:${(rand() * 100).toFixed(1)}%;"></b>`);
      }
      return {
        blobCss: [
          `@keyframes ${id}-b { 0% { transform:translate(-50%,-50%) scale(1); } 50% { transform:translate(-46%,-54%) scale(1.15); } 100% { transform:translate(-50%,-50%) scale(1); } }`,
          `.${id} .cover i { position:absolute; border-radius:50%; animation:${id}-b 2.6s ease-in-out infinite; }`,
          `.${id} .cover b { position:absolute; width:2px; height:2px; border-radius:50%; background:rgba(255,255,255,.35); }`,
        ].join("\n"),
        blobs: blobs.join("") + dots.join(""),
      };
    }, { back: "#23233a" }),
  },
  {
    name: "smoke-dissolve",
    title: "Smoke Dissolve",
    category: "transition",
    description: "Soft smoke plumes drift up between scenes." + shaderNote,
    source: "smoke-dissolve",
    props: dissolveProps,
    demoProps: { from: "Smoke", to: "Dissolve" },
    generate: dissolve("smoke", (id, rand) => {
      const blobs: string[] = [];
      for (let i = 0; i < 8; i++) {
        blobs.push(`<i style="left:${(10 + rand() * 80).toFixed(0)}%; top:${(50 + rand() * 60).toFixed(0)}%; width:${(35 + rand() * 25).toFixed(0)}%; height:${(35 + rand() * 25).toFixed(0)}%; animation-duration:${(2.2 + rand() * 1.4).toFixed(1)}s; animation-delay:${(rand() * 0.6).toFixed(2)}s"></i>`);
      }
      return {
        blobCss: [
          `@keyframes ${id}-rise { from { transform:translate(-50%,-30%) scale(0.8); } to { transform:translate(-50%,-130%) scale(1.5); } }`,
          `.${id} .cover i { position:absolute; border-radius:50%; background:radial-gradient(circle, rgba(226,226,236,.55), transparent 62%); animation:${id}-rise 2.6s ease-in-out infinite; }`,
        ].join("\n"),
        blobs: blobs.join(""),
      };
    }, { back: "#1a1a22" }),
  },
  {
    name: "swirl-dissolve",
    title: "Swirl Dissolve",
    category: "transition",
    description: "Rotating vortex cover spins between scenes." + shaderNote,
    source: "swirl-dissolve",
    props: dissolveProps,
    demoProps: { from: "Swirl", to: "Dissolve" },
    generate: dissolve("swirl", (id, rand) => {
      const arms: string[] = [];
      for (let i = 0; i < 6; i++) {
        arms.push(`<i style="transform:rotate(${(i * 60)}deg)"></i>`);
      }
      return {
        blobCss: [
          `@keyframes ${id}-spin { from { transform:translate(-50%,-50%) rotate(0deg); } to { transform:translate(-50%,-50%) rotate(360deg); } }`,
          `.${id} .cover .vortex { position:absolute; left:50%; top:50%; width:150vmin; height:150vmin; animation:${id}-spin 2.4s linear infinite; }`,
          `.${id} .cover .vortex i { position:absolute; left:50%; top:0; width:26%; height:100%; margin-left:-13%; background:linear-gradient(180deg, rgba(148,148,180,.5), transparent 70%); border-radius:50%; transform-origin:50% 50%; }`,
        ].join("\n"),
        blobs: `<span class="vortex">${arms.join("")}</span>`,
      };
    }, { back: "#181826" }),
  },
  {
    name: "warp-dissolve",
    title: "Warp Dissolve",
    category: "transition",
    description: "Stretching warp bands sweep between scenes." + shaderNote,
    source: "warp-dissolve",
    props: dissolveProps,
    demoProps: { from: "Warp", to: "Dissolve" },
    generate: dissolve("warp", (id, rand) => {
      const bands: string[] = [];
      for (let i = 0; i < 9; i++) {
        bands.push(`<i style="top:${(i * 11.5).toFixed(1)}%; animation-delay:${(rand() * 0.5).toFixed(2)}s; animation-duration:${(1.4 + rand() * 0.8).toFixed(2)}s"></i>`);
      }
      return {
        blobCss: [
          `@keyframes ${id}-band { 0% { transform:translateX(-30%) scaleX(0.7); } 50% { transform:translateX(10%) scaleX(1.6); } 100% { transform:translateX(-30%) scaleX(0.7); } }`,
          `.${id} .cover i { position:absolute; left:-10%; width:120%; height:10%; background:linear-gradient(90deg, transparent, rgba(160,160,200,.55), transparent); animation:${id}-band 1.8s ease-in-out infinite; }`,
        ].join("\n"),
        blobs: bands.join(""),
      };
    }, { back: "#14141e" }),
  },
  {
    name: "perlin-dissolve",
    title: "Perlin Dissolve",
    category: "transition",
    description: "Slow organic noise field morphs between scenes." + shaderNote,
    source: "perlin-dissolve",
    props: dissolveProps,
    demoProps: { from: "Perlin", to: "Dissolve" },
    generate: dissolve("perlin", (id, rand) => {
      const blobs: string[] = [];
      for (let i = 0; i < 10; i++) {
        blobs.push(`<i style="left:${(rand() * 100).toFixed(0)}%; top:${(rand() * 100).toFixed(0)}%; width:${(28 + rand() * 30).toFixed(0)}%; height:${(28 + rand() * 30).toFixed(0)}%; animation-duration:${(3 + rand() * 2).toFixed(1)}s; animation-delay:${(-rand() * 2).toFixed(1)}s"></i>`);
      }
      return {
        blobCss: [
          `@keyframes ${id}-m { 0% { transform:translate(-50%,-50%) scale(0.9); border-radius:48% 52% 55% 45%; } 50% { transform:translate(-44%,-56%) scale(1.2); border-radius:55% 45% 42% 58%; } 100% { transform:translate(-50%,-50%) scale(0.9); border-radius:48% 52% 55% 45%; } }`,
          `.${id} .cover i { position:absolute; background:radial-gradient(circle, rgba(120,130,170,.5), transparent 66%); animation:${id}-m 4s ease-in-out infinite; }`,
        ].join("\n"),
        blobs: blobs.join(""),
      };
    }, { back: "#161620" }),
  },
];
