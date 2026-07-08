// wavelet-ui wave 9 — the closing set: social cards, product flows, hero
// scenes, and the remaining motion misc. Compositions reuse the established
// pattern language (staggered cascades, ch-typing, odometer strips, camera
// delta wrappers, seeded fields) with Remocn's house timing.

import { centerFill, escapeHtml, freshId, kfBlock, sec, splitSpans, staggeredText } from "./lib/motion.ts";
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

// odometer digit strip (rolling-number mechanism, reused by cards)
function odometer(id: string, value: string, fontPx: number, color: string, delayBase = 0.4): { css: string; html: string } {
  const chars = Array.from(value);
  const css: string[] = [
    `.${id}-od { display:inline-flex; font-variant-numeric:tabular-nums; color:${color}; }`,
  ];
  const spans = chars.map((ch, i) => {
    if (!/[0-9]/.test(ch)) return `<span>${escapeHtml(ch)}</span>`;
    const d = Number(ch);
    const kf = `${id}-od${i}`;
    css.push(`@keyframes ${kf} { from { transform:translateY(0); } to { transform:translateY(-${d}em); } }`);
    const strip = "0123456789".slice(0, d + 1).split("").join("</span><span>");
    return `<span style="display:inline-block; height:1em; line-height:1em; overflow:hidden;"><span style="display:inline-flex; flex-direction:column; animation:${kf} ${sec(20)}s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay:${(delayBase + (chars.length - i) * 0.06).toFixed(2)}s;"><span>${strip}</span></span></span>`;
  });
  return { css: css.join("\n"), html: `<span class="${id}-od" style="font-size:${fontPx}px; font-weight:700;">${spans.join("")}</span>` };
}

// avatar chip row (deterministic hue per index)
function avatars(n: number, size = 28): string {
  const HUES = [230, 340, 160, 40, 280, 200, 10, 120];
  return Array.from({ length: n }, (_, i) =>
    `<span style="width:${size}px; height:${size}px; border-radius:50%; border:2px solid #0e0e12; margin-left:${i === 0 ? 0 : -8}px; background:linear-gradient(135deg, hsl(${HUES[i % 8]} 70% 60%), hsl(${(HUES[i % 8] + 40) % 360} 70% 45%));"></span>`).join("");
}

// window card scaffold
const card = (w: number, bg: string, border: string, inner: string, extra = "") =>
  `<div style="width:${w}px; background:${bg}; border:1px solid ${border}; border-radius:16px; padding:22px; box-shadow:0 24px 70px rgba(0,0,0,.5); ${extra}">${inner}</div>`;

export const WAVE9: UIComponent[] = [
  // ── github-stars — repo card, star odometer, avatar burst
  {
    name: "github-stars",
    title: "GitHub Stars",
    category: "scene",
    description: "Repo star-count card — odometer count-up, star pop, stargazer avatars cascade.",
    source: "github-stars",
    props: {
      repo: { default: "workbooks-sh/wavelet", doc: "owner/name" },
      stars: { default: "12,408", doc: "count" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("ghs");
      const od = odometer(id, String(p.stars ?? ""), 56, t.foreground);
      const css = [
        od.css,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(14px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-star { 0% { opacity:0; transform:scale(0) rotate(-30deg); } 60% { opacity:1; transform:scale(1.25) rotate(8deg); } 100% { opacity:1; transform:scale(1) rotate(0deg); } }`,
        `@keyframes ${id}-av { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .repo { font:600 15px/1 ui-monospace, monospace; color:${t.mutedForeground}; margin-bottom:14px; }`,
        `.${id} .row { display:flex; align-items:center; gap:14px; }`,
        `.${id} .star { font-size:44px; display:inline-block; animation:${id}-star ${sec(14)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay:0.5s; }`,
        `.${id} .avs { display:flex; margin-top:18px; animation:${id}-av ${sec(10)}s ease-out both; animation-delay:1.1s; }`,
        `.${id} .lbl { font:500 12px/1 sans-serif; color:${t.mutedForeground}; margin-left:10px; align-self:center; }`,
      ].join("\n");
      const html = card(430, t.card, t.border,
        `<div class="repo">★ ${escapeHtml(p.repo ?? "")}</div>
         <div class="row"><span class="star">⭐</span>${od.html}</div>
         <div class="avs">${avatars(7)}<span class="lbl">+ 212 this week</span></div>`);
      return centerFill({ css, html: `<div class="${id}">${html}</div>` });
    },
  },

  // ── github-sponsors — sponsor tiers cascade + heart pulse
  {
    name: "github-sponsors",
    title: "GitHub Sponsors",
    category: "scene",
    description: "Sponsors card — pulsing heart, tier rows cascading in.",
    source: "github-sponsors",
    props: {
      handle: { default: "@shinyobjectz", doc: "sponsored account" },
      tiers: { default: ["$5 · Supporter — 48", "$25 · Backer — 17", "$100 · Partner — 4"], doc: "tier rows" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("ghsp");
      const tiers: string[] = p.tiers ?? [];
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-heart { 0%,100% { transform:scale(1); } 12% { transform:scale(1.22); } 24% { transform:scale(1); } 36% { transform:scale(1.14); } 48% { transform:scale(1); } }`,
        `@keyframes ${id}-row { from { opacity:0; transform:translateX(-10px); } to { opacity:1; transform:translateX(0); } }`,
        `.${id} { animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .head { display:flex; align-items:center; gap:10px; font:600 16px/1 sans-serif; color:${t.cardForeground}; margin-bottom:16px; }`,
        `.${id} .heart { display:inline-block; color:#db61a2; font-size:22px; animation:${id}-heart 1.8s ease-in-out infinite; }`,
        `.${id} .tier { display:flex; align-items:center; height:40px; padding:0 12px; margin-bottom:8px; border:1px solid ${t.border}; border-radius:10px; font:500 13.5px/1 sans-serif; color:${t.foreground}; opacity:0; animation:${id}-row ${sec(9)}s ease-out both; }`,
      ].join("\n");
      const rows = tiers.map((tr, i) => `<div class="tier" style="animation-delay:${(0.5 + i * 0.18).toFixed(2)}s">${escapeHtml(tr)}</div>`).join("");
      const html = card(420, t.card, t.border, `<div class="head"><span class="heart">♥</span>Sponsor ${escapeHtml(p.handle ?? "")}</div>${rows}`);
      return centerFill({ css, html: `<div class="${id}">${html}</div>` });
    },
  },

  // ── x-follow-card — profile card + follow button state flip
  {
    name: "x-follow-card",
    title: "X Follow Card",
    category: "scene",
    description: "X profile card — cursor glides to Follow, button flips to Following.",
    source: "x-follow-card",
    props: {
      handle: { default: "@shinyobjectz", doc: "handle" },
      name: { default: "Shiny Objectz", doc: "display name" },
      followers: { default: "8,214", doc: "count" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("xfc");
      const od = odometer(id, String(p.followers ?? ""), 20, "#e7e9ea", 1.7);
      const css = [
        od.css,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(14px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-cur { 0% { transform:translate(180px, 140px); } 55% { transform:translate(304px, 60px); } 70% { transform:translate(304px, 60px) scale(0.85); } 82% { transform:translate(304px, 60px) scale(1); } 100% { transform:translate(304px, 60px); } }`,
        `@keyframes ${id}-btnA { 0%, 74.9% { opacity:1; } 75%, 100% { opacity:0; } }`,
        `@keyframes ${id}-btnB { 0%, 74.9% { opacity:0; } 75%, 100% { opacity:1; } }`,
        `.${id} { position:relative; animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; font-family:sans-serif; }`,
        `.${id} .top { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }`,
        `.${id} .who { display:flex; gap:12px; align-items:center; }`,
        `.${id} .pfp { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg, #6366f1, #a855f7); }`,
        `.${id} .nm { font-weight:700; font-size:16px; color:#e7e9ea; }`,
        `.${id} .hd { font-size:13px; color:#71767b; }`,
        `.${id} .btn { position:relative; width:104px; height:36px; }`,
        `.${id} .btn span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; border-radius:999px; font:700 13px/1 sans-serif; }`,
        `.${id} .btn .a { background:#eff3f4; color:#0f1419; animation:${id}-btnA 2.4s steps(1,end) both; }`,
        `.${id} .btn .b { background:transparent; color:#e7e9ea; border:1px solid #536471; animation:${id}-btnB 2.4s steps(1,end) both; }`,
        `.${id} .stats { display:flex; gap:6px; align-items:baseline; font-size:13px; color:#71767b; }`,
        `.${id} .cur { position:absolute; left:0; top:0; width:20px; height:20px; border-radius:50%; background:rgba(255,255,255,.9); box-shadow:0 0 0 2px rgba(0,0,0,.4); animation:${id}-cur 2.4s cubic-bezier(0.4, 0, 0.2, 1) both; z-index:5; }`,
      ].join("\n");
      const html = card(400, "#0e0e12", "#2f3336",
        `<div class="top"><div class="who"><span class="pfp"></span><div><div class="nm">${escapeHtml(p.name ?? "")}</div><div class="hd">${escapeHtml(p.handle ?? "")}</div></div></div>
          <div class="btn"><span class="a">Follow</span><span class="b">Following</span></div></div>
         <div class="stats">${od.html}<span>Followers</span></div>`);
      return centerFill({ css, html: `<div class="${id}">${html}<span class="cur"></span></div>` });
    },
  },

  // ── x-followers-overview — stat tiles + mini bar sparkline
  {
    name: "x-followers-overview",
    title: "X Followers Overview",
    category: "scene",
    description: "Analytics overview — stat tiles cascade, weekly bars grow.",
    source: "x-followers-overview",
    props: {
      followers: { default: "8,214", doc: "total" },
      impressions: { default: "412K", doc: "impressions" },
      bars: { default: [40, 55, 45, 70, 62, 85, 96], doc: "weekly series" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("xfo");
      const od = odometer(id, String(p.followers ?? ""), 34, "#e7e9ea");
      const bars: number[] = p.bars ?? [];
      const css = [
        od.css,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-bar { from { transform:scaleY(0); } to { transform:scaleY(1); } }`,
        `.${id} { display:flex; flex-direction:column; gap:14px; animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; font-family:sans-serif; }`,
        `.${id} .tiles { display:flex; gap:12px; }`,
        `.${id} .tile { flex:1; padding:16px; border:1px solid #2f3336; border-radius:14px; background:#0e0e12; opacity:0; animation:${id}-in ${sec(10)}s ease-out both; }`,
        `.${id} .k { font-size:12px; color:#71767b; margin-bottom:6px; }`,
        `.${id} .v { font-size:26px; font-weight:700; color:#e7e9ea; }`,
        `.${id} .spark { display:flex; align-items:flex-end; gap:7px; height:90px; padding:14px 16px; border:1px solid #2f3336; border-radius:14px; background:#0e0e12; }`,
        `.${id} .spark i { flex:1; border-radius:4px 4px 2px 2px; background:#1d9bf0; transform-origin:bottom; animation:${id}-bar ${sec(14)}s cubic-bezier(0.22, 1, 0.36, 1) both; }`,
      ].join("\n");
      const tiles = `<div class="tiles">
        <div class="tile" style="animation-delay:0.25s"><div class="k">Followers</div><div class="v">${od.html}</div></div>
        <div class="tile" style="animation-delay:0.4s"><div class="k">Impressions</div><div class="v">${escapeHtml(p.impressions ?? "")}</div></div>
      </div>`;
      const spark = `<div class="spark">${bars.map((b, i) => `<i style="height:${b}%; animation-delay:${(0.7 + i * 0.08).toFixed(2)}s"></i>`).join("")}</div>`;
      return centerFill({ css, html: `<div class="${id}" style="width:460px">${tiles}${spark}</div>` });
    },
  },

  // ── ai-prompt-flow — prompt types, model chips light up, answer streams
  {
    name: "ai-prompt-flow",
    title: "AI Prompt Flow",
    category: "scene",
    description: "Prompt types in, pipeline chips light in sequence, answer lines stream out.",
    source: "ai-prompt-flow",
    props: {
      prompt: { default: "Cut a 30s teaser from this take", doc: "typed prompt" },
      steps: { default: ["parse", "plan", "render"], doc: "pipeline chips" },
      answer: { default: ["Selected 4 highlight ranges", "Compiled comp with captions", "Rendered 16:9 + 9:16"], doc: "output lines" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("apf");
      const q = String(p.prompt ?? "");
      const n = Array.from(q).length;
      const typeSecs = +(n / 20).toFixed(2);
      const chips: string[] = p.steps ?? [];
      const out: string[] = p.answer ?? [];
      const chipBase = 0.4 + typeSecs + 0.2;
      const outBase = chipBase + chips.length * 0.4 + 0.2;
      const css = [
        `@keyframes ${id}-type { from { width:0ch; } to { width:${n}ch; } }`,
        `@keyframes ${id}-chip { 0%, 99.9% { background:#17171c; color:#8b8b94; border-color:#2a2a32; } 100% { background:#1e1b3a; color:#c7d2fe; border-color:#6366f1; } }`,
        `@keyframes ${id}-line { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { width:560px; display:flex; flex-direction:column; gap:14px; font-family:sans-serif; }`,
        `.${id} .ask { display:flex; align-items:center; height:48px; padding:0 16px; background:#101014; border:1px solid #2a2a32; border-radius:14px; font:400 14.5px/1 ui-monospace, monospace; color:#ececf1; }`,
        `.${id} .q { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-type ${typeSecs}s steps(${Math.max(1, n)}, end) both; animation-delay:0.4s; }`,
        `.${id} .chips { display:flex; gap:8px; }`,
        `.${id} .chip { padding:7px 14px; border-radius:999px; border:1px solid #2a2a32; font:600 12px/1 ui-monospace, monospace; animation:${id}-chip 0.1s steps(1,end) both; }`,
        `.${id} .out { display:flex; flex-direction:column; gap:8px; padding:16px; background:#101014; border:1px solid #2a2a32; border-radius:14px; }`,
        `.${id} .out div { font:400 13.5px/1.5 sans-serif; color:#c9c9d1; opacity:0; animation:${id}-line ${sec(8)}s ease-out both; }`,
      ].join("\n");
      const chipHtml = chips.map((c, i) => `<span class="chip" style="animation-delay:${(chipBase + i * 0.4).toFixed(2)}s">${escapeHtml(c)}</span>`).join("");
      const outHtml = out.map((l, i) => `<div style="animation-delay:${(outBase + i * 0.3).toFixed(2)}s">✓ ${escapeHtml(l)}</div>`).join("");
      return centerFill({ css, html: `<div class="${id}"><div class="ask">✦ <span class="q" style="margin-left:8px">${escapeHtml(q)}</span></div><div class="chips">${chipHtml}</div><div class="out">${outHtml}</div></div>` });
    },
  },

  // ── chat-to-preview-layout — chat panel left, preview builds right
  {
    name: "chat-to-preview-layout",
    title: "Chat → Preview Layout",
    category: "scene",
    description: "Split layout — chat messages land left, the preview assembles right.",
    source: "chat-to-preview-layout",
    props: {
      ask: { default: "Make the hero bolder", doc: "user message" },
      reply: { default: "Done — scaled the headline and tightened tracking.", doc: "agent reply" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("ctp");
      const css = [
        `@keyframes ${id}-pop { from { opacity:0; transform:translateY(10px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-block { from { opacity:0; transform:scaleX(0.3); } to { opacity:1; transform:scaleX(1); } }`,
        `@keyframes ${id}-hero { 0% { opacity:0; font-size:26px; letter-spacing:0em; } 40% { opacity:1; font-size:26px; } 100% { opacity:1; font-size:34px; letter-spacing:-0.02em; } }`,
        `.${id} { display:flex; gap:16px; width:760px; height:380px; font-family:sans-serif; }`,
        `.${id} .chat { width:300px; display:flex; flex-direction:column; gap:10px; justify-content:flex-end; padding:16px; background:#101014; border:1px solid #26262e; border-radius:16px; }`,
        `.${id} .msg { max-width:88%; padding:9px 13px; border-radius:14px; font:400 13px/1.45 sans-serif; opacity:0; animation:${id}-pop ${sec(12)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
        `.${id} .user { align-self:flex-end; background:#312e81; color:#e0e7ff; animation-delay:0.4s; }`,
        `.${id} .agent { align-self:flex-start; background:#1c1c22; color:#d4d4dc; animation-delay:1.5s; }`,
        `.${id} .prev { flex:1; padding:26px; background:#0d0d11; border:1px solid #26262e; border-radius:16px; }`,
        `.${id} .hero { font-weight:800; color:#f4f4f5; animation:${id}-hero 2.2s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.9s; }`,
        `.${id} .ln { height:11px; border-radius:6px; background:#26262e; margin-top:12px; transform-origin:left; animation:${id}-block ${sec(11)}s cubic-bezier(0.22, 1, 0.36, 1) both; }`,
      ].join("\n");
      const html = `<div class="${id}">
        <div class="chat"><span class="msg user">${escapeHtml(p.ask ?? "")}</span><span class="msg agent">${escapeHtml(p.reply ?? "")}</span></div>
        <div class="prev"><div class="hero">Ship videos from code</div>
          <div class="ln" style="width:82%; animation-delay:1.1s"></div>
          <div class="ln" style="width:64%; animation-delay:1.25s"></div>
          <div class="ln" style="width:71%; animation-delay:1.4s"></div></div>
      </div>`;
      return centerFill({ css, html });
    },
  },

  // ── checkout-flow — cart rows land, totals count, pay button succeeds
  {
    name: "checkout-flow",
    title: "Checkout Flow",
    category: "scene",
    description: "Checkout card — line items cascade, total rolls up, Pay flips to success.",
    source: "checkout-flow",
    props: {
      items: { default: ["Pro plan — $29", "Extra seat — $9"], doc: "line items" },
      total: { default: "38", doc: "total (digits)" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("cof");
      const od = odometer(id, String(p.total ?? ""), 22, t.foreground, 1.2);
      const items: string[] = p.items ?? [];
      const css = [
        od.css,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-row { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }`,
        `@keyframes ${id}-payA { 0%, 79.9% { opacity:1; } 80%, 100% { opacity:0; } }`,
        `@keyframes ${id}-payB { 0%, 79.9% { opacity:0; } 80%, 100% { opacity:1; } }`,
        `.${id} { animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; font-family:sans-serif; }`,
        `.${id} .item { display:flex; justify-content:space-between; height:38px; align-items:center; font:500 13.5px/1 sans-serif; color:${t.foreground}; border-bottom:1px solid ${t.border}; opacity:0; animation:${id}-row ${sec(9)}s ease-out both; }`,
        `.${id} .tot { display:flex; justify-content:space-between; align-items:baseline; margin:14px 0 18px; font:600 14px/1 sans-serif; color:${t.mutedForeground}; }`,
        `.${id} .pay { position:relative; height:44px; }`,
        `.${id} .pay span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; border-radius:12px; font:700 14px/1 sans-serif; }`,
        `.${id} .pay .a { background:${t.primary}; color:${t.primaryForeground}; animation:${id}-payA 2.5s steps(1,end) both; }`,
        `.${id} .pay .b { background:#052e1f; color:#34d399; border:1px solid #10b981; animation:${id}-payB 2.5s steps(1,end) both; }`,
      ].join("\n");
      const rows = items.map((it, i) => {
        const [l, r] = it.split("—");
        return `<div class="item" style="animation-delay:${(0.35 + i * 0.2).toFixed(2)}s"><span>${escapeHtml(l.trim())}</span><span>${escapeHtml((r ?? "").trim())}</span></div>`;
      }).join("");
      const html = card(380, t.card, t.border,
        `${rows}<div class="tot"><span>Total</span><span style="display:inline-flex; gap:2px; color:${t.foreground}">$${od.html}</span></div>
         <div class="pay"><span class="a">Pay now</span><span class="b">✓ Payment complete</span></div>`);
      return centerFill({ css, html: `<div class="${id}">${html}</div>` });
    },
  },

  // ── signup-flow — fields type in sequence, CTA succeeds
  {
    name: "signup-flow",
    title: "Signup Flow",
    category: "scene",
    description: "Signup card — email and password type in, button flips to success.",
    source: "signup-flow",
    props: {
      email: { default: "shane@shinyobjectz.com", doc: "typed email" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("suf");
      const email = String(p.email ?? "");
      const n = Array.from(email).length;
      const t1 = +(n / 24).toFixed(2);
      const dots = 10;
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-t1 { from { width:0ch; } to { width:${n}ch; } }`,
        `@keyframes ${id}-t2 { from { width:0ch; } to { width:${dots}ch; } }`,
        `@keyframes ${id}-ctaA { 0%, 84.9% { opacity:1; } 85%, 100% { opacity:0; } }`,
        `@keyframes ${id}-ctaB { 0%, 84.9% { opacity:0; } 85%, 100% { opacity:1; } }`,
        `.${id} { animation:${id}-in ${sec(14)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; font-family:sans-serif; }`,
        `.${id} .lbl { font:600 12px/1 sans-serif; color:${t.mutedForeground}; margin:0 0 6px; }`,
        `.${id} .f { display:flex; align-items:center; height:42px; padding:0 12px; margin-bottom:14px; border:1px solid ${t.input}; border-radius:10px; background:${t.background}; font:400 14px/1 ui-monospace, monospace; color:${t.foreground}; }`,
        `.${id} .v1 { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-t1 ${t1}s steps(${n}, end) both; animation-delay:0.4s; }`,
        `.${id} .v2 { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-t2 0.5s steps(${dots}, end) both; animation-delay:${(0.6 + t1).toFixed(2)}s; }`,
        `.${id} .cta { position:relative; height:44px; margin-top:4px; }`,
        `.${id} .cta span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; border-radius:12px; font:700 14px/1 sans-serif; }`,
        `.${id} .cta .a { background:${t.primary}; color:${t.primaryForeground}; animation:${id}-ctaA 2.6s steps(1,end) both; }`,
        `.${id} .cta .b { background:#052e1f; color:#34d399; border:1px solid #10b981; animation:${id}-ctaB 2.6s steps(1,end) both; }`,
      ].join("\n");
      const html = card(380, t.card, t.border,
        `<div class="lbl">Email</div><div class="f"><span class="v1">${escapeHtml(email)}</span></div>
         <div class="lbl">Password</div><div class="f"><span class="v2">••••••••••</span></div>
         <div class="cta"><span class="a">Create account</span><span class="b">✓ Welcome aboard</span></div>`);
      return centerFill({ css, html: `<div class="${id}">${html}</div>` });
    },
  },

  // ── onboarding-stepper-flow — steps complete one by one
  {
    name: "onboarding-stepper-flow",
    title: "Onboarding Stepper Flow",
    category: "scene",
    description: "Vertical onboarding steps checking off in sequence.",
    source: "onboarding-stepper-flow",
    props: {
      steps: { default: ["Create your workspace", "Record a take", "Render with wavelet", "Share the clip"], doc: "steps" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("obs");
      const steps: string[] = p.steps ?? [];
      const css: string[] = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-fill { 0%, 99.9% { background:${t.muted}; border-color:${t.border}; } 100% { background:${t.primary}; border-color:${t.primary}; } }`,
        `@keyframes ${id}-chk { from { opacity:0; transform:scale(0); } to { opacity:1; transform:scale(1); } }`,
        `@keyframes ${id}-txt { 0%, 99.9% { color:${t.mutedForeground}; } 100% { color:${t.foreground}; } }`,
        `.${id} { display:flex; flex-direction:column; gap:0; animation:${id}-in ${sec(12)}s ease-out both; font-family:sans-serif; }`,
        `.${id} .step { display:flex; align-items:center; gap:14px; height:52px; }`,
        `.${id} .dot { width:26px; height:26px; border-radius:50%; border:1.5px solid ${t.border}; background:${t.muted}; display:flex; align-items:center; justify-content:center; }`,
        `.${id} .bar { width:2px; height:26px; margin-left:12px; background:${t.border}; }`,
        `.${id} .mk { display:inline-block; width:10px; height:6px; border-left:2px solid ${t.primaryForeground}; border-bottom:2px solid ${t.primaryForeground}; rotate:-45deg; opacity:0; }`,
        `.${id} .tx { font:500 14.5px/1 sans-serif; }`,
      ];
      const rows = steps.map((s, i) => {
        const at = 0.6 + i * 0.7;
        css.push(
          `.${id} .d${i} { animation:${id}-fill ${at}s steps(1,end) both; }`,
          `.${id} .d${i} .mk { animation:${id}-chk ${sec(8)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay:${at}s; }`,
          `.${id} .t${i} { animation:${id}-txt ${at}s steps(1,end) both; }`,
        );
        const bar = i < steps.length - 1 ? `<div class="bar"></div>` : "";
        return `<div class="step"><span class="dot d${i}"><span class="mk"></span></span><span class="tx t${i}">${escapeHtml(s)}</span></div>${bar}`;
      }).join("");
      return centerFill({ css: css.join("\n"), html: `<div class="${id}">${rows}</div>` });
    },
  },

  // ── settings-toggle-flow — cursor flips two switches in a settings panel
  {
    name: "settings-toggle-flow",
    title: "Settings Toggle Flow",
    category: "scene",
    description: "Settings rows — cursor glides between switches, flipping them on.",
    source: "settings-toggle-flow",
    props: {
      rows: { default: ["Lossless master", "Auto captions", "Publish to channel"], doc: "settings" },
      flips: { default: [0, 2], doc: "rows that toggle on" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("stf");
      const rows: string[] = p.rows ?? [];
      const flips: number[] = p.flips ?? [];
      const css: string[] = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { animation:${id}-in ${sec(12)}s ease-out both; font-family:sans-serif; position:relative; }`,
        `.${id} .row { display:flex; justify-content:space-between; align-items:center; height:50px; border-bottom:1px solid ${t.border}; font:500 14px/1 sans-serif; color:${t.foreground}; }`,
        `.${id} .row:last-child { border-bottom:0; }`,
        `.${id} .sw { width:42px; height:24px; border-radius:999px; padding:2px; }`,
        `.${id} .th { width:20px; height:20px; border-radius:50%; background:${t.background}; box-shadow:0 1px 3px rgba(0,0,0,.4); }`,
      ];
      const rowHtml = rows.map((r, i) => {
        const flipIdx = flips.indexOf(i);
        if (flipIdx === -1) {
          return `<div class="row"><span>${escapeHtml(r)}</span><span class="sw" style="background:${t.muted}"><span class="th"></span></span></div>`;
        }
        const at = 0.9 + flipIdx * 1.1;
        css.push(
          `@keyframes ${id}-tr${i} { 0%, 99.9% { background:${t.muted}; } 100% { background:${t.primary}; } }`,
          `@keyframes ${id}-th${i} { from { transform:translateX(0); } to { transform:translateX(18px); } }`,
          `.${id} .sw${i} { animation:${id}-tr${i} ${at}s steps(1,end) both; }`,
          `.${id} .sw${i} .th { animation:${id}-th${i} ${sec(8)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:${at}s; }`,
        );
        return `<div class="row"><span>${escapeHtml(r)}</span><span class="sw sw${i}"><span class="th"></span></span></div>`;
      }).join("");
      // cursor glides to each flipped switch
      const stops = flips.map((i, k) => {
        const y = 25 + i * 50;
        const tA = ((0.5 + k * 1.1) / 3) * 100;
        const tB = ((0.9 + k * 1.1) / 3) * 100;
        return `${tA.toFixed(1)}% { transform:translate(330px, ${y}px); } ${tB.toFixed(1)}% { transform:translate(330px, ${y}px) scale(0.85); } ${(tB + 4).toFixed(1)}% { transform:translate(330px, ${y}px) scale(1); }`;
      }).join(" ");
      css.push(
        `@keyframes ${id}-cur { 0% { transform:translate(180px, 160px); } ${stops} 100% { transform:translate(330px, ${25 + (flips.at(-1) ?? 0) * 50}px); } }`,
        `.${id} .cur { position:absolute; left:0; top:0; width:18px; height:18px; border-radius:50%; background:rgba(255,255,255,.9); box-shadow:0 0 0 2px rgba(0,0,0,.4); animation:${id}-cur 3s cubic-bezier(0.4, 0, 0.2, 1) both; z-index:5; }`,
      );
      const html = card(380, t.card, t.border, rowHtml);
      return centerFill({ css: css.join("\n"), html: `<div class="${id}">${html}<span class="cur"></span></div>` });
    },
  },

  // ── kinetic-center-build — words assemble around a center anchor
  {
    name: "kinetic-center-build",
    title: "Kinetic Center Build",
    category: "text",
    description: "Hero words fly in from opposing sides and lock around the center.",
    source: "kinetic-center-build",
    props: {
      words: { default: ["BUILD", "WITH", "MOTION"], doc: "stacked words" },
      fontSize: { default: 96, doc: "px" },
      color: { default: "#f4f4f5", doc: "text color" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("kcb");
      const words: string[] = p.words ?? [];
      const css: string[] = [
        `.${id} { display:flex; flex-direction:column; align-items:center; line-height:0.98; font-family:sans-serif; font-weight:800; letter-spacing:-0.03em; font-size:${p.fontSize ?? 96}px; color:${p.color ?? "#f4f4f5"}; }`,
      ];
      const rows = words.map((w, i) => {
        const from = i % 2 === 0 ? -420 : 420;
        const kf = `${id}-w${i}`;
        css.push(`@keyframes ${kf} { from { opacity:0; transform:translateX(${from}px); } to { opacity:1; transform:translateX(0); } }`);
        return `<span style="display:block; animation:${kf} ${sec(16)}s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay:${(0.25 + i * 0.14).toFixed(2)}s">${escapeHtml(w)}</span>`;
      }).join("");
      return centerFill({ css: css.join("\n"), html: `<div class="${id}">${rows}</div>` });
    },
  },

  // ── infinite-bento-pan — bento grid drifting diagonally forever
  {
    name: "infinite-bento-pan",
    title: "Infinite Bento Pan",
    category: "background",
    description: "Endless diagonal pan across a bento tile field (duplicated sheet loop).",
    source: "infinite-bento-pan",
    props: {
      seed: { default: "bento", doc: "tile seed" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("bento");
      const rand = mulberry32(hashSeed(String(p.seed ?? "bento")));
      const CELL = 260;
      const tiles: string[] = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 8; c++) {
          const w = rand() > 0.7 ? 2 : 1;
          tiles.push(`<i style="left:${c * CELL}px; top:${r * CELL}px; width:${CELL * w - 18}px; height:${CELL - 18}px; opacity:${(0.5 + rand() * 0.5).toFixed(2)}"></i>`);
        }
      }
      const css = [
        `@keyframes ${id} { from { transform:translate(0, 0); } to { transform:translate(-${CELL}px, -${CELL}px); } }`,
        `.${id} { position:absolute; inset:0; background:#0a0a0f; overflow:hidden; }`,
        `.${id} .sheet { position:absolute; left:-${CELL}px; top:-${CELL}px; width:${CELL * 9}px; height:${CELL * 6}px; animation:${id} 6s linear infinite; }`,
        `.${id} .sheet i { position:absolute; border-radius:18px; background:#15151c; border:1px solid #24242e; }`,
      ].join("\n");
      return { css, html: `<div class="${id}"><div class="sheet">${tiles.join("")}</div></div>` };
    },
  },

  // ── data-flow-pipes — pulses travel along connectors between nodes
  {
    name: "data-flow-pipes",
    title: "Data Flow Pipes",
    category: "scene",
    description: "Nodes linked by pipes with pulses traveling between them (18–24f per hop).",
    source: "data-flow-pipes",
    props: {
      nodes: { default: ["events", "compile", "render", "publish"], doc: "pipeline nodes" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("dfp");
      const nodes: string[] = p.nodes ?? [];
      const css: string[] = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`,
        `@keyframes ${id}-pulse { 0% { left:-8px; opacity:0; } 12% { opacity:1; } 88% { opacity:1; } 100% { left:calc(100% - 4px); opacity:0; } }`,
        `.${id} { display:flex; align-items:center; gap:0; font-family:sans-serif; }`,
        `.${id} .node { padding:13px 20px; border:1px solid ${t.border}; border-radius:12px; background:${t.card}; font:600 13.5px/1 ui-monospace, monospace; color:${t.foreground}; opacity:0; animation:${id}-in ${sec(9)}s ease-out both; }`,
        `.${id} .pipe { position:relative; width:84px; height:2px; background:${t.border}; }`,
        `.${id} .pipe b { position:absolute; top:-3px; width:8px; height:8px; border-radius:50%; background:#818cf8; box-shadow:0 0 10px #818cf8; animation:${id}-pulse 0.7s linear infinite; }`,
      ];
      const parts = nodes.map((nx, i) => {
        const node = `<span class="node" style="animation-delay:${(0.25 + i * 0.15).toFixed(2)}s">${escapeHtml(nx)}</span>`;
        const pipe = i < nodes.length - 1 ? `<span class="pipe"><b style="animation-delay:${(-i * 0.23).toFixed(2)}s"></b></span>` : "";
        return node + pipe;
      }).join("");
      return centerFill({ css: css.join("\n"), html: `<div class="${id}">${parts}</div>` });
    },
  },

  // ── ecosystem-constellation — orbiting satellite chips around a core
  {
    name: "ecosystem-constellation",
    title: "Ecosystem Constellation",
    category: "scene",
    description: "Satellite chips orbit a core node on two counter-rotating rings.",
    source: "ecosystem-constellation",
    props: {
      core: { default: "wavelet", doc: "center label" },
      satellites: { default: ["decks", "takes", "agents", "skills", "gate", "cli"], doc: "orbiters" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("eco");
      const sats: string[] = p.satellites ?? [];
      const half = Math.ceil(sats.length / 2);
      const css = [
        `@keyframes ${id}-cw { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`,
        `@keyframes ${id}-ccw { from { transform:rotate(0deg); } to { transform:rotate(-360deg); } }`,
        `@keyframes ${id}-in { from { opacity:0; transform:scale(0.6); } to { opacity:1; transform:scale(1); } }`,
        `.${id} { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:sans-serif; }`,
        `.${id} .core { position:relative; z-index:3; padding:16px 26px; border-radius:999px; background:#1e1b3a; border:1.5px solid #6366f1; color:#c7d2fe; font:700 17px/1 ui-monospace, monospace; animation:${id}-in ${sec(12)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; }`,
        `.${id} .ringbox { position:absolute; left:50%; top:50%; width:0; height:0; }`,
        `.${id} .r1 { animation:${id}-cw 16s linear infinite; }`,
        `.${id} .r2 { animation:${id}-ccw 22s linear infinite; }`,
        `.${id} .ring { position:absolute; left:50%; top:50%; border:1px dashed #2b2b3a; border-radius:50%; transform:translate(-50%,-50%); }`,
        `.${id} .sat { position:absolute; padding:8px 14px; margin:-16px -40px; border-radius:999px; background:${t.card}; border:1px solid ${t.border}; color:${t.foreground}; font:600 12px/1 ui-monospace, monospace; }`,
      ].join("\n");
      const place = (list: string[], radiusVmin: number, cls: string) =>
        `<span class="ringbox ${cls}">` + list.map((sx, i) => {
          const ang = (i / list.length) * 2 * Math.PI;
          const x = Math.cos(ang) * radiusVmin, y = Math.sin(ang) * radiusVmin;
          return `<span class="sat" style="transform:translate(${x.toFixed(1)}vmin, ${y.toFixed(1)}vmin)">${escapeHtml(sx)}</span>`;
        }).join("") + `</span>`;
      const rings = `<span class="ring" style="width:44vmin;height:44vmin"></span><span class="ring" style="width:66vmin;height:66vmin"></span>`;
      const html = `<div class="${id}">${rings}${place(sats.slice(0, half), 22, "r1")}${place(sats.slice(half), 33, "r2")}<span class="core">${escapeHtml(p.core ?? "")}</span></div>`;
      return { css, html };
    },
  },

  // ── live-code-compilation — code lines land, build bar runs, badge flips
  {
    name: "live-code-compilation",
    title: "Live Code Compilation",
    category: "scene",
    description: "Code lines cascade, the build bar sweeps, the status badge flips green.",
    source: "live-code-compilation",
    props: {
      lines: { default: ["fn render(take: &Take) -> Mp4 {", "  let comp = compile(take);", "  encode(comp.frames())", "}"], doc: "code" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("lcc");
      const lines: string[] = p.lines ?? [];
      const buildAt = 0.5 + lines.length * 0.22 + 0.2;
      const css = [
        `@keyframes ${id}-ln { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }`,
        `@keyframes ${id}-bar { from { width:0%; } to { width:100%; } }`,
        `@keyframes ${id}-bA { 0%, 89.9% { opacity:1; } 90%, 100% { opacity:0; } }`,
        `@keyframes ${id}-bB { 0%, 89.9% { opacity:0; } 90%, 100% { opacity:1; } }`,
        `.${id} { width:560px; font-family:ui-monospace, monospace; }`,
        `.${id} .win { background:#0d1117; border:1px solid #23262e; border-radius:14px; padding:20px 22px; box-shadow:0 24px 70px rgba(0,0,0,.5); }`,
        `.${id} .ln { font:400 14.5px/1.75 ui-monospace, monospace; color:#c9d1d9; white-space:pre; opacity:0; animation:${id}-ln ${sec(8)}s ease-out both; }`,
        `.${id} .ln b { color:#ff7b72; font-weight:400; }`,
        `.${id} .build { margin-top:14px; height:6px; border-radius:99px; background:#1c2128; overflow:hidden; }`,
        `.${id} .build i { display:block; height:100%; background:linear-gradient(90deg, #238636, #2ea043); animation:${id}-bar 1.1s cubic-bezier(0.4, 0, 0.6, 1) both; animation-delay:${buildAt}s; }`,
        `.${id} .badge { position:relative; height:26px; margin-top:12px; }`,
        `.${id} .badge span { position:absolute; left:0; padding:5px 12px; border-radius:999px; font:600 11.5px/1 ui-monospace, monospace; }`,
        `.${id} .badge .a { background:#1c2128; color:#8b949e; animation:${id}-bA ${(buildAt + 1.25).toFixed(2)}s steps(1,end) both; }`,
        `.${id} .badge .b { background:#0d2818; color:#3fb950; border:1px solid #238636; animation:${id}-bB ${(buildAt + 1.25).toFixed(2)}s steps(1,end) both; }`,
      ].join("\n");
      const code = lines.map((l, i) =>
        `<div class="ln" style="animation-delay:${(0.5 + i * 0.22).toFixed(2)}s">${escapeHtml(l).replace(/\b(fn|let)\b/g, "<b>$1</b>")}</div>`).join("");
      const html = `<div class="${id}"><div class="win">${code}<div class="build"><i></i></div><div class="badge"><span class="a">building…</span><span class="b">✓ compiled in 297ms</span></div></div></div>`;
      return centerFill({ css, html });
    },
  },

  // ── logo-enter — mark pops with ring burst, wordmark slides beside it
  {
    name: "logo-enter",
    title: "Logo Enter",
    category: "reveal",
    description: "Logo mark pops in with a ring burst; the wordmark slides out beside it.",
    source: "logo-enter",
    props: {
      wordmark: { default: "wavelet", doc: "brand text" },
      accent: { default: "#818cf8", doc: "mark color" },
      fontSize: { default: 64, doc: "wordmark px" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("logo");
      const fs = p.fontSize ?? 64;
      const css = [
        `@keyframes ${id}-mark { 0% { opacity:0; transform:scale(0) rotate(-90deg); } 60% { opacity:1; transform:scale(1.15) rotate(6deg); } 100% { opacity:1; transform:scale(1) rotate(0deg); } }`,
        `@keyframes ${id}-ring { 0% { opacity:0; transform:scale(0.4); } 30% { opacity:0.7; } 100% { opacity:0; transform:scale(2.1); } }`,
        `@keyframes ${id}-wm { from { opacity:0; transform:translateX(-18px); } to { opacity:1; transform:translateX(0); } }`,
        `.${id} { display:flex; align-items:center; gap:${Math.round(fs * 0.35)}px; font-family:sans-serif; position:relative; }`,
        `.${id} .mark { position:relative; width:${fs}px; height:${fs}px; border-radius:${Math.round(fs * 0.28)}px; background:linear-gradient(135deg, ${p.accent ?? "#818cf8"}, #a855f7); animation:${id}-mark ${sec(14)}s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay:0.3s; }`,
        `.${id} .ring { position:absolute; left:${-fs * 0.25}px; top:${-fs * 0.25}px; width:${fs * 1.5}px; height:${fs * 1.5}px; border-radius:50%; border:2.5px solid ${p.accent ?? "#818cf8"}; opacity:0; animation:${id}-ring ${sec(20)}s ease-out both; animation-delay:0.62s; }`,
        `.${id} .wm { font-weight:800; font-size:${fs}px; letter-spacing:-0.03em; color:#f4f4f5; animation:${id}-wm ${sec(13)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.72s; }`,
      ].join("\n");
      const html = `<div class="${id}"><span class="mark"><span class="ring"></span></span><span class="wm">${escapeHtml(p.wordmark ?? "")}</span></div>`;
      return centerFill({ css, html });
    },
  },

  // ── number-wheel — full odometer with unit label
  {
    name: "number-wheel",
    title: "Number Wheel",
    category: "text",
    description: "Odometer wheel rolling every digit to its target value.",
    source: "number-wheel",
    props: {
      value: { default: "1,204,551", doc: "target number" },
      label: { default: "renders shipped", doc: "caption" },
      fontSize: { default: 84, doc: "px" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("nw");
      const od = odometer(id, String(p.value ?? ""), p.fontSize ?? 84, "#f4f4f5", 0.35);
      const css = [
        od.css,
        `@keyframes ${id}-cap { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { display:flex; flex-direction:column; align-items:center; gap:12px; font-family:sans-serif; }`,
        `.${id} .cap { font:500 16px/1 sans-serif; color:#8b8b94; letter-spacing:0.06em; text-transform:uppercase; animation:${id}-cap ${sec(12)}s ease-out both; animation-delay:1.1s; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}">${od.html}<span class="cap">${escapeHtml(p.label ?? "")}</span></div>` });
    },
  },

  // ── perspective-marquee — marquee rows skewed into a perspective plane
  {
    name: "perspective-marquee",
    title: "Perspective Marquee",
    category: "background",
    description: "Angled marquee rows drifting in alternating directions (flat-skew approximation of the 3D plane).",
    source: "perspective-marquee",
    gateGap: "parent rotate/skew doesn't propagate to text descendants in blitz (same family as the %-translate bug) — rows render axis-aligned; Chrome/HyperFrames lane renders the angled plane",
    props: {
      rows: { default: ["SHIP · BUILD · RENDER · ", "MOTION · PIXELS · CODE · ", "DECKS · TAKES · CLIPS · "], doc: "marquee rows" },
      fontSize: { default: 84, doc: "px" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("pmq");
      const rows: string[] = p.rows ?? [];
      const fs = p.fontSize ?? 84;
      const css: string[] = [
        `.${id} { position:absolute; inset:0; overflow:hidden; background:#0a0a0f; }`,
        `.${id} .plane { position:absolute; inset:-20%; transform:rotate(-8deg) skewX(-6deg); display:flex; flex-direction:column; justify-content:center; gap:${Math.round(fs * 0.3)}px; }`,
        `.${id} .row { display:flex; white-space:pre; font:800 ${fs}px/1 sans-serif; letter-spacing:-0.02em; color:#23232e; }`,
      ];
      const rowHtml = rows.map((r, i) => {
        const approx = Math.round(r.length * fs * 0.55);
        const kf = `${id}-r${i}`;
        const dir = i % 2 === 0 ? -approx : 0;
        const from = i % 2 === 0 ? 0 : -approx;
        css.push(`@keyframes ${kf} { from { transform:translateX(${from}px); } to { transform:translateX(${dir}px); } }`);
        const seg = escapeHtml(r);
        return `<div class="row" style="animation:${kf} ${(6 + i).toFixed(0)}s linear infinite;"><span style="min-width:${approx}px">${seg}</span><span style="min-width:${approx}px">${seg}</span></div>`;
      }).join("");
      return { css: css.join("\n"), html: `<div class="${id}"><div class="plane">${rowHtml}</div></div>` };
    },
  },

  // ── resizable — split panel, divider glides, panes rebalance
  {
    name: "resizable",
    title: "Resizable",
    category: "ui",
    description: "Split view whose divider glides to a new balance point.",
    source: "resizable",
    props: {
      fromPct: { default: 50, doc: "start left-pane %" },
      toPct: { default: 68, doc: "end left-pane %" },
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme("dark");
      const id = freshId("rsz");
      const a = p.fromPct ?? 50, b = p.toPct ?? 68;
      const css = [
        `@keyframes ${id}-l { from { width:${a}%; } to { width:${b}%; } }`,
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} { display:flex; width:640px; height:320px; border:1px solid ${t.border}; border-radius:16px; overflow:hidden; background:${t.card}; animation:${id}-in ${sec(12)}s ease-out both; }`,
        `.${id} .l { width:${a}%; background:${t.card}; display:flex; align-items:center; justify-content:center; font:600 14px/1 ui-monospace, monospace; color:${t.mutedForeground}; animation:${id}-l ${sec(16)}s cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay:0.8s; }`,
        `.${id} .d { width:5px; flex:none; background:${t.border}; }`,
        `.${id} .r { flex:1; background:${t.background}; display:flex; align-items:center; justify-content:center; font:600 14px/1 ui-monospace, monospace; color:${t.mutedForeground}; }`,
      ].join("\n");
      return centerFill({ css, html: `<div class="${id}"><div class="l">editor</div><div class="d"></div><div class="r">preview</div></div>` });
    },
  },

  // ── scale-down-fade — block settles down from oversized
  {
    name: "scale-down-fade",
    title: "Scale Down Fade",
    category: "reveal",
    description: "Block fades in while settling down from an oversized scale.",
    source: "scale-down-fade",
    props: {
      text: { default: "Settle in", doc: "content" },
      scaleFrom: { default: 1.15, doc: "start scale" },
      fontSize: { default: 84, doc: "px" },
      color: { default: "#f4f4f5", doc: "text color" },
    },
    demoProps: {},
    generate: (p) =>
      centerFill(
        staggeredText(p.text, {
          name: "sdf",
          unit: "block",
          durationFrames: 16,
          staggerFrames: 0,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          stops: [
            { at: 0, style: { opacity: "0", transform: `scale(${p.scaleFrom ?? 1.15})` } },
            { at: 1, style: { opacity: "1", transform: "scale(1)" } },
          ],
          spanStyle: "transform-origin:50% 50%;",
          wrapperStyle: `font-size:${p.fontSize ?? 84}px; font-weight:700; letter-spacing:-0.03em; color:${p.color ?? "#f4f4f5"}; font-family:sans-serif;`,
        }),
      ),
  },

  // ── select — field opens a native-style option list, pick lands
  {
    name: "select",
    title: "Select",
    category: "ui",
    description: "Select field — panel drops, options cascade, choice fills the field.",
    source: "select",
    props: {
      placeholder: { default: "Aspect ratio", doc: "field label" },
      options: { default: ["16:9 — landscape", "9:16 — vertical", "1:1 — square"], doc: "options" },
      pick: { default: 1, doc: "picked index" },
      ...modeProp,
    },
    demoProps: {},
    generate: (p) => {
      const t = pickTheme(p.mode);
      const id = freshId("sel");
      const options: string[] = p.options ?? [];
      const pick = p.pick ?? 1;
      const pickAt = 0.5 + options.length * 0.07 + 0.5;
      const css = [
        `@keyframes ${id}-panel { from { opacity:0; transform:translateY(-5px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-item { from { opacity:0; } to { opacity:1; } }`,
        `@keyframes ${id}-hl { 0%, 99.9% { background:transparent; } 100% { background:${t.accent}; } }`,
        `@keyframes ${id}-fillA { 0%, ${((pickAt + 0.35) / 3 * 100).toFixed(1)}% { opacity:1; } ${((pickAt + 0.4) / 3 * 100).toFixed(1)}%, 100% { opacity:0; }  }`,
        `@keyframes ${id}-fillB { 0%, ${((pickAt + 0.35) / 3 * 100).toFixed(1)}% { opacity:0; } ${((pickAt + 0.4) / 3 * 100).toFixed(1)}%, 100% { opacity:1; }  }`,
        `.${id} { position:relative; width:300px; font-family:sans-serif; }`,
        `.${id} .field { position:relative; display:flex; align-items:center; justify-content:space-between; height:42px; padding:0 12px; border:1px solid ${t.input}; border-radius:${t.radius}px; background:${t.background}; font:500 13.5px/1 sans-serif; }`,
        `.${id} .ph span { position:absolute; }`,
        `.${id} .ph .a { color:${t.mutedForeground}; animation:${id}-fillA 3s steps(1,end) both; }`,
        `.${id} .ph .b { color:${t.foreground}; animation:${id}-fillB 3s steps(1,end) both; }`,
        `.${id} .panel { position:absolute; top:calc(100% + 6px); left:0; right:0; padding:5px; background:${t.popover ?? t.card}; border:1px solid ${t.border}; border-radius:${t.radius}px; box-shadow:0 14px 40px rgba(0,0,0,.4); animation:${id}-panel ${sec(9)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:0.45s; }`,
        `.${id} .opt { display:flex; align-items:center; height:34px; padding:0 10px; border-radius:${t.radius - 4}px; font:500 13px/1 sans-serif; color:${t.foreground}; opacity:0; animation:${id}-item ${sec(7)}s ease-out both; }`,
        `.${id} .opt.hl { animation:${id}-item ${sec(7)}s ease-out both, ${id}-hl ${pickAt}s steps(1,end) both; }`,
      ].join("\n");
      const rows = options.map((o, i) =>
        `<div class="opt${i === pick ? " hl" : ""}" style="animation-delay:${(0.52 + i * 0.07).toFixed(2)}s${i === pick ? `, 0s` : ""}">${escapeHtml(o)}</div>`).join("");
      const html = `<div class="${id}"><div class="field"><span class="ph" style="position:relative; width:100%;"><span class="a">${escapeHtml(p.placeholder ?? "")}</span><span class="b">${escapeHtml(options[pick] ?? "")}</span></span><span>▾</span></div><div class="panel">${rows}</div></div>`;
      return centerFill({ css, html }, "padding-bottom:150px;");
    },
  },

  // ── short-slide-down — line drops in, words fade with micro reflow blur feel
  {
    name: "short-slide-down",
    title: "Short Slide Down",
    category: "text",
    description: "The line drops down into place while words fade in sequence.",
    source: "short-slide-down",
    props: {
      text: { default: "Short slide down", doc: "content" },
      distance: { default: 24, doc: "drop px" },
      staggerDelay: { default: 3, doc: "frames between words" },
      fontSize: { default: 72, doc: "px" },
      color: { default: "#f4f4f5", doc: "text color" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("ssd");
      const css = [
        `@keyframes ${id}-line { from { transform:translateY(-${p.distance ?? 24}px) scale(0.992); } to { transform:translateY(0) scale(1); } }`,
        `@keyframes ${id}-w { from { opacity:0; } to { opacity:1; } }`,
        `.${id} { display:inline-block; animation:${id}-line ${sec(15)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; font-size:${p.fontSize ?? 72}px; font-weight:600; letter-spacing:-0.03em; color:${p.color ?? "#f4f4f5"}; font-family:sans-serif; }`,
        `.${id} > span { display:inline-block; white-space:pre; animation:${id}-w ${sec(6)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
      ].join("\n");
      const words = splitSpans(p.text, "word");
      const html = `<span class="${id}">` + words.map((w, i) =>
        `<span style="animation-delay:${sec(i * (p.staggerDelay ?? 3))}s;${i < words.length - 1 ? "margin-right:0.28em;" : ""}">${escapeHtml(w)}</span>`).join("") + `</span>`;
      return centerFill({ css, html });
    },
  },
];
