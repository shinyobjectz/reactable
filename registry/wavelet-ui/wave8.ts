// wavelet-ui wave 8 — the @paper-design shader background family (17 comps).
// These are WebGL shaders in Remocn; here each is a deterministic CSS
// approximation built from seeded blob/band/dot fields with per-shader motif
// and palette. Descriptions carry the shader note — the true GLSL runs in the
// HyperFrames/canvas lane; these keep decks/wavelet renders self-contained.

import { freshId } from "./lib/motion.ts";
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
const shaderNote = "CSS approximation of the WebGL shader — run the true GLSL in the HyperFrames lane.";

interface Motif {
  (id: string, rand: () => number, colors: string[], back: string): { css: string; html: string };
}

// shared pieces
const blobField = (id: string, rand: () => number, colors: string[], n: number, opts: { size?: [number, number]; morph?: boolean; drift?: [number, number]; dur?: [number, number] } = {}) => {
  const [smin, smax] = opts.size ?? [30, 60];
  const [dmin, dmax] = opts.dur ?? [3, 6];
  const blobs: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = smin + rand() * (smax - smin);
    blobs.push(`<i style="left:${(rand() * 100).toFixed(0)}%; top:${(rand() * 100).toFixed(0)}%; width:${s.toFixed(0)}%; height:${s.toFixed(0)}%; background:radial-gradient(circle, ${colors[i % colors.length]}b0, transparent 65%); animation-duration:${(dmin + rand() * (dmax - dmin)).toFixed(1)}s; animation-delay:${(-rand() * dmax).toFixed(1)}s"></i>`);
  }
  const morph = opts.morph
    ? `50% { transform:translate(-44%,-56%) scale(1.18); border-radius:56% 44% 42% 58%; }`
    : `50% { transform:translate(-46%,-54%) scale(1.12); }`;
  const css = [
    `@keyframes ${id}-b { 0% { transform:translate(-50%,-50%) scale(0.92); border-radius:50%; } ${morph} 100% { transform:translate(-50%,-50%) scale(0.92); border-radius:50%; } }`,
    `.${id} i { position:absolute; border-radius:50%; animation:${id}-b 4s ease-in-out infinite; }`,
  ].join("\n");
  return { css, blobs: blobs.join("") };
};

const MOTIFS: Record<string, Motif> = {
  "color-panels": (id, rand, colors, back) => {
    const panels = colors.map((c, i) =>
      `<i style="left:${(i * 100) / colors.length}%; width:${100 / colors.length + 6}%; background:linear-gradient(180deg, ${c}cc, ${c}55); animation-delay:${(-i * 0.8).toFixed(1)}s"></i>`).join("");
    return {
      css: [
        `@keyframes ${id}-p { 0% { transform:translateX(-4%) skewX(-4deg); } 50% { transform:translateX(4%) skewX(4deg); } 100% { transform:translateX(-4%) skewX(-4deg); } }`,
        `.${id} i { position:absolute; top:-10%; bottom:-10%; animation:${id}-p 5s ease-in-out infinite; }`,
      ].join("\n"),
      html: panels,
    };
  },
  dithering: (id, rand) => {
    const dots: string[] = [];
    for (let i = 0; i < 240; i++) {
      dots.push(`<i style="left:${(rand() * 100).toFixed(1)}%; top:${(rand() * 100).toFixed(1)}%; width:${(3 + rand() * 5).toFixed(0)}px; height:${(3 + rand() * 5).toFixed(0)}px; animation-delay:${(-rand() * 1.6).toFixed(2)}s"></i>`);
    }
    return {
      css: [
        `@keyframes ${id}-d { 0%,100% { opacity:0.15; } 50% { opacity:0.85; } }`,
        `.${id} i { position:absolute; border-radius:1px; background:#cfcfda; animation:${id}-d 1.6s steps(2,end) infinite; }`,
      ].join("\n"),
      html: dots.join(""),
    };
  },
  "dot-orbit": (id, rand, colors) => {
    const dots: string[] = [];
    for (let ring = 0; ring < 3; ring++) {
      const r = 18 + ring * 14;
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * 360;
        dots.push(`<i style="transform:rotate(${ang}deg) translateX(${r}vmin); background:${colors[(ring + k) % colors.length]}; animation-duration:${(8 + ring * 4)}s"></i>`);
      }
    }
    return {
      css: [
        `@keyframes ${id}-o { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`,
        `.${id} .hub { position:absolute; left:50%; top:50%; width:0; height:0; animation:${id}-o 12s linear infinite; }`,
        `.${id} .hub i { position:absolute; width:10px; height:10px; margin:-5px; border-radius:50%; }`,
      ].join("\n"),
      html: `<span class="hub">${dots.join("")}</span>`,
    };
  },
  "god-rays": (id, rand, colors) => {
    const rays: string[] = [];
    for (let i = 0; i < 9; i++) {
      rays.push(`<i style="transform:rotate(${(-40 + i * 10).toFixed(0)}deg); animation-delay:${(-i * 0.7).toFixed(1)}s"></i>`);
    }
    return {
      css: [
        `@keyframes ${id}-r { 0%,100% { opacity:0.12; } 50% { opacity:0.5; } }`,
        `.${id} .src { position:absolute; left:50%; top:-12%; width:0; height:0; }`,
        `.${id} .src i { position:absolute; left:-3vmin; width:6vmin; height:150vmin; transform-origin:top center; background:linear-gradient(180deg, ${colors[0]}88, transparent 75%); animation:${id}-r 5s ease-in-out infinite; }`,
      ].join("\n"),
      html: `<span class="src">${rays.join("")}</span>`,
    };
  },
  "pulsing-border": (id, _r, colors, back) => ({
    css: [
      `@keyframes ${id}-pb { 0%,100% { box-shadow:0 0 24px 2px ${colors[0]}66, inset 0 0 24px 2px ${colors[0]}44; } 50% { box-shadow:0 0 70px 10px ${colors[0]}cc, inset 0 0 46px 8px ${colors[0]}88; } }`,
      `.${id} .frame { position:absolute; inset:5%; border-radius:26px; border:2px solid ${colors[0]}; background:${back}; animation:${id}-pb 2.6s ease-in-out infinite; }`,
    ].join("\n"),
    html: `<span class="frame"></span>`,
  }),
  "smoke-ring": (id) => ({
    css: [
      `@keyframes ${id}-ring { 0% { transform:translate(-50%,-50%) scale(0.25); opacity:0; } 18% { opacity:0.6; } 100% { transform:translate(-50%,-50%) scale(1.7); opacity:0; } }`,
      `.${id} i { position:absolute; left:50%; top:50%; width:52vmin; height:52vmin; border-radius:50%; border:5vmin solid rgba(220,220,235,.35); animation:${id}-ring 3.2s ease-out infinite; }`,
    ].join("\n"),
    html: `<i></i><i style="animation-delay:-1.05s"></i><i style="animation-delay:-2.1s"></i>`,
  }),
  spiral: (id, _r, colors) => {
    const arms: string[] = [];
    for (let i = 0; i < 14; i++) {
      arms.push(`<i style="transform:rotate(${(i * 26).toFixed(0)}deg) translateX(${(i * 3.2).toFixed(1)}vmin); background:${colors[i % colors.length]}; width:${(2 + i * 0.5).toFixed(1)}vmin; height:${(2 + i * 0.5).toFixed(1)}vmin; margin:${(-(2 + i * 0.5) / 2).toFixed(1)}vmin"></i>`);
    }
    return {
      css: [
        `@keyframes ${id}-s { from { transform:rotate(0deg); } to { transform:rotate(-360deg); } }`,
        `.${id} .hub { position:absolute; left:50%; top:50%; width:0; height:0; animation:${id}-s 9s linear infinite; }`,
        `.${id} .hub i { position:absolute; border-radius:50%; opacity:0.8; }`,
      ].join("\n"),
      html: `<span class="hub">${arms.join("")}</span>`,
    };
  },
  voronoi: (id, rand, colors, back) => {
    const cells: string[] = [];
    for (let i = 0; i < 26; i++) {
      const s = 12 + rand() * 22;
      cells.push(`<i style="left:${(rand() * 100).toFixed(0)}%; top:${(rand() * 100).toFixed(0)}%; width:${s.toFixed(0)}vmin; height:${s.toFixed(0)}vmin; background:${colors[i % colors.length]}22; border:1px solid ${colors[i % colors.length]}55; animation-delay:${(-rand() * 4).toFixed(1)}s; border-radius:${(30 + rand() * 30).toFixed(0)}% ${(30 + rand() * 30).toFixed(0)}% ${(30 + rand() * 30).toFixed(0)}% ${(30 + rand() * 30).toFixed(0)}%"></i>`);
    }
    return {
      css: [
        `@keyframes ${id}-v { 0%,100% { transform:translate(-50%,-50%) scale(1); } 50% { transform:translate(-52%,-48%) scale(1.08); } }`,
        `.${id} i { position:absolute; animation:${id}-v 4s ease-in-out infinite; }`,
      ].join("\n"),
      html: cells.join(""),
    };
  },
};

// blob-flavored motifs share one implementation
const blobMotif = (n: number, opts: Parameters<typeof blobField>[4] extends never ? any : any): Motif =>
  (id, rand, colors) => {
    const { css, blobs } = blobField(id, rand, colors, n, opts);
    return { css, html: blobs };
  };
Object.assign(MOTIFS, {
  "grain-gradient": blobMotif(7, { size: [35, 55] }),
  "liquid-metal": blobMotif(6, { size: [30, 55], morph: true }),
  "mesh-gradient": blobMotif(5, { size: [40, 65] }),
  metaballs: blobMotif(6, { size: [22, 38], morph: true, dur: [2.4, 4] }),
  "neuro-noise": blobMotif(9, { size: [18, 34], dur: [4, 7] }),
  "perlin-noise": blobMotif(10, { size: [26, 50], morph: true, dur: [4, 7] }),
  "simplex-noise": blobMotif(10, { size: [24, 46], morph: true, dur: [3, 6] }),
  swirl: MOTIFS.spiral,
  warp: (id: string, rand: () => number, colors: string[]) => {
    const bands: string[] = [];
    for (let i = 0; i < 10; i++) {
      bands.push(`<i style="top:${(i * 10.5).toFixed(1)}%; background:linear-gradient(90deg, transparent, ${colors[i % colors.length]}77, transparent); animation-delay:${(-rand() * 2).toFixed(2)}s"></i>`);
    }
    return {
      css: [
        `@keyframes ${id}-w { 0%,100% { transform:translateX(-22%) scaleX(0.8); } 50% { transform:translateX(12%) scaleX(1.5); } }`,
        `.${id} i { position:absolute; left:-10%; width:120%; height:9%; animation:${id}-w 2.4s ease-in-out infinite; }`,
      ].join("\n"),
      html: bands.join(""),
    };
  },
  water: (id: string, rand: () => number, colors: string[]) => {
    const { css, blobs } = blobField(id, rand, ["#1d4ed8", "#0ea5e9", "#22d3ee"], 8, { size: [28, 52], morph: true, dur: [3, 6] });
    const glints: string[] = [];
    for (let i = 0; i < 26; i++) {
      glints.push(`<b style="left:${(rand() * 100).toFixed(1)}%; top:${(rand() * 100).toFixed(1)}%; animation-delay:${(-rand() * 2.2).toFixed(2)}s"></b>`);
    }
    return {
      css: [
        css,
        `@keyframes ${id}-g { 0%,100% { opacity:0.1; } 50% { opacity:0.85; } }`,
        `.${id} b { position:absolute; width:3px; height:3px; border-radius:50%; background:#e0f2fe; animation:${id}-g 2.2s ease-in-out infinite; }`,
      ].join("\n"),
      html: blobs + glints.join(""),
    };
  },
} satisfies Record<string, Motif>);

const PALETTES: Record<string, { colors: string[]; back: string }> = {
  "color-panels": { colors: ["#6366f1", "#ec4899", "#f59e0b", "#10b981"], back: "#0a0a12" },
  dithering: { colors: ["#cfcfda"], back: "#101014" },
  "dot-orbit": { colors: ["#818cf8", "#f472b6", "#34d399"], back: "#0a0a12" },
  "god-rays": { colors: ["#fbbf24"], back: "#0d0b06" },
  "grain-gradient": { colors: ["#3a3a52", "#4a4a68", "#8f88ae"], back: "#23233a" },
  "liquid-metal": { colors: ["#9ca3af", "#e5e7eb", "#6b7280"], back: "#111114" },
  "mesh-gradient": { colors: ["#6366f1", "#a855f7", "#0ea5e9"], back: "#0a0a12" },
  metaballs: { colors: ["#f472b6", "#c084fc", "#818cf8"], back: "#120a16" },
  "neuro-noise": { colors: ["#22d3ee", "#0e7490", "#164e63"], back: "#06131a" },
  "perlin-noise": { colors: ["#64748b", "#94a3b8", "#475569"], back: "#0f1420" },
  "pulsing-border": { colors: ["#818cf8"], back: "#0a0a12" },
  "simplex-noise": { colors: ["#78716c", "#a8a29e", "#57534e"], back: "#171412" },
  "smoke-ring": { colors: ["#e2e8f0"], back: "#131316" },
  spiral: { colors: ["#f59e0b", "#f97316", "#ef4444"], back: "#140b06" },
  swirl: { colors: ["#818cf8", "#6366f1", "#4f46e5"], back: "#0a0a16" },
  voronoi: { colors: ["#34d399", "#10b981", "#059669"], back: "#04120c" },
  warp: { colors: ["#a78bfa", "#8b5cf6", "#7c3aed"], back: "#0e0a16" },
  water: { colors: ["#0ea5e9"], back: "#04121f" },
};

export const WAVE8: UIComponent[] = Object.keys(PALETTES).map((key) => ({
  name: `shader-${key}`,
  title: `Shader: ${key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
  category: "background" as const,
  description: `Animated ${key.replace(/-/g, " ")} backdrop. ${shaderNote}`,
  source: `shader-${key}`,
  props: {
    seed: { default: key, doc: "field seed" },
    back: { default: PALETTES[key].back, doc: "backdrop color" },
  },
  ...(key === "pulsing-border"
    ? { gateGap: "box-shadow glow (large spread) renders materially weaker in blitz — frame + pulse land, halo is fainter; Chrome/HyperFrames lane full" }
    : {}),
  demoProps: {},
  generate: (p: Record<string, any>) => {
    const id = freshId(`sh-${key}`);
    const pal = PALETTES[key];
    const rand = mulberry32(hashSeed(String(p.seed ?? key)));
    const motif = MOTIFS[key](id, rand, pal.colors, p.back ?? pal.back);
    const css = [
      `.${id} { position:absolute; inset:0; background:${p.back ?? pal.back}; overflow:hidden; }`,
      motif.css,
    ].join("\n");
    return { css, html: `<div class="${id}">${motif.html}</div>` };
  },
}));
