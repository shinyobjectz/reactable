// wavelet-ui wave 7 — chat & agent simulators. One conversation scaffold
// (typing indicator → bubble cascade on a shared clock), skinned per product.
// Bubble enter = the message-bubble source values (y12 scale.94, 12f).

import { escapeHtml, freshId, sec } from "./lib/motion.ts";
import type { UIComponent } from "./components.ts";

interface Msg { side: "in" | "out"; text: string }
interface ChatSkin {
  frame: (inner: string, title: string) => string;
  inBubble: string;  // css for received bubble
  outBubble: string; // css for sent bubble
  font: string;
  gap: number;
  showTyping: boolean;
}

// timeline: each message = optional typing dots (0.55s) then bubble pop
function chatScene(id: string, msgs: Msg[], skin: ChatSkin, title: string): { css: string; html: string } {
  const css: string[] = [
    `@keyframes ${id}-pop { from { opacity:0; transform:translateY(12px) scale(0.94); } to { opacity:1; transform:translateY(0) scale(1); } }`,
    `@keyframes ${id}-ty { 0% { opacity:0; } 12% { opacity:1; } 88% { opacity:1; } 100% { opacity:0; } }`,
    `@keyframes ${id}-dot { 0%,100% { opacity:0.35; transform:translateY(0); } 50% { opacity:1; transform:translateY(-3px); } }`,
    `.${id} .col { display:flex; flex-direction:column; gap:${skin.gap}px; width:100%; }`,
    `.${id} .row { display:flex; width:100%; }`,
    `.${id} .row.out { justify-content:flex-end; }`,
    `.${id} .bubble { max-width:78%; padding:9px 13px; font:${skin.font}; opacity:0; animation:${id}-pop ${sec(12)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; }`,
    `.${id} .bubble.in { ${skin.inBubble} }`,
    `.${id} .bubble.out { ${skin.outBubble} }`,
    `.${id} .typing { display:inline-flex; gap:4px; padding:11px 13px; opacity:0; ${skin.inBubble} animation:${id}-ty 0.55s steps(1,end) both; }`,
    `.${id} .typing b { width:7px; height:7px; border-radius:50%; background:currentColor; opacity:0.5; animation:${id}-dot 0.9s ease-in-out infinite; }`,
  ];
  let t = 0.5;
  const rows = msgs.map((m) => {
    let typing = "";
    if (m.side === "in" && skin.showTyping) {
      typing = `<div class="row"><span class="typing" style="animation-delay:${t.toFixed(2)}s"><b></b><b style="animation-delay:0.15s"></b><b style="animation-delay:0.3s"></b></span></div>`;
      t += 0.62;
    }
    const row = `<div class="row ${m.side}"><span class="bubble ${m.side}" style="animation-delay:${t.toFixed(2)}s">${escapeHtml(m.text)}</span></div>`;
    t += 0.55;
    return typing + row;
  }).join("");
  return { css: css.join("\n"), html: skin.frame(`<div class="${id}"><div class="col">${rows}</div></div>`, title) };
}

const phoneFrame = (bg: string, chrome: string, titleColor: string) => (inner: string, title: string) =>
  `<div style="width:390px; height:640px; background:${bg}; border-radius:38px; border:1px solid rgba(255,255,255,.12); overflow:hidden; display:flex; flex-direction:column; box-shadow:0 30px 80px rgba(0,0,0,.55);">
    <div style="flex:none; height:74px; display:flex; align-items:flex-end; justify-content:center; padding-bottom:10px; background:${chrome}; font:600 15px/1 -apple-system, sans-serif; color:${titleColor};">${escapeHtml(title)}</div>
    <div style="flex:1; padding:16px 12px; display:flex; flex-direction:column; justify-content:flex-end;">${inner}</div>
  </div>`;

const panelFrame = (bg: string, border: string, titleColor: string, dot: string) => (inner: string, title: string) =>
  `<div style="width:560px; height:520px; background:${bg}; border:1px solid ${border}; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 70px rgba(0,0,0,.5);">
    <div style="flex:none; height:46px; display:flex; align-items:center; gap:8px; padding:0 16px; border-bottom:1px solid ${border}; font:600 13px/1 sans-serif; color:${titleColor};"><span style="width:8px;height:8px;border-radius:50%;background:${dot}"></span>${escapeHtml(title)}</div>
    <div style="flex:1; padding:18px 16px; display:flex; flex-direction:column; justify-content:flex-end;">${inner}</div>
  </div>`;

const chatProps = {
  messages: { default: null, doc: "[{side:'in'|'out', text}] — null = skin demo script" },
};

function msgsOf(p: any, fallback: Msg[]): Msg[] {
  return (p.messages as Msg[]) ?? fallback;
}

export const WAVE7: UIComponent[] = [
  {
    name: "chat-flow",
    title: "Chat Flow",
    category: "scene",
    description: "Generic chat conversation — typing dots, bubble cascade.",
    source: "chat-flow",
    props: chatProps,
    demoProps: {},
    generate: (p) => {
      const id = freshId("chf");
      const frag = chatScene(id, msgsOf(p, [
        { side: "in", text: "New take just rendered — want the lossless master?" },
        { side: "out", text: "Yes, and the 9:16 cut too" },
        { side: "in", text: "On it. Both exporting now ✅" },
      ]), {
        frame: panelFrame("oklch(0.205 0 0)", "oklch(1 0 0 / 10%)", "oklch(0.985 0 0)", "#34d399"),
        inBubble: "background:oklch(0.269 0 0); color:oklch(0.985 0 0); border-radius:16px 16px 16px 6px;",
        outBubble: "background:oklch(0.922 0 0); color:oklch(0.205 0 0); border-radius:16px 16px 6px 16px;",
        font: "400 14px/1.45 sans-serif",
        gap: 10,
        showTyping: true,
      }, "Team chat");
      return { css: frag.css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${frag.html}</div>` };
    },
  },
  {
    name: "imessage-chat-flow",
    title: "iMessage Chat Flow",
    category: "scene",
    description: "iMessage-styled phone conversation.",
    source: "imessage-chat-flow",
    props: chatProps,
    demoProps: {},
    generate: (p) => {
      const id = freshId("imsg");
      const frag = chatScene(id, msgsOf(p, [
        { side: "in", text: "did you see the demo video??" },
        { side: "out", text: "rendered it with wavelet 🚀" },
        { side: "in", text: "no screen recorder?? wild" },
        { side: "out", text: "events in, pixels out" },
      ]), {
        frame: phoneFrame("#000", "rgba(28,28,30,.96)", "#f5f5f7"),
        inBubble: "background:#26262a; color:#f5f5f7; border-radius:18px 18px 18px 5px;",
        outBubble: "background:#0a84ff; color:#fff; border-radius:18px 18px 5px 18px;",
        font: "400 15px/1.4 -apple-system, sans-serif",
        gap: 8,
        showTyping: true,
      }, "Riley");
      return { css: frag.css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${frag.html}</div>` };
    },
  },
  {
    name: "telegram-chat-flow",
    title: "Telegram Chat Flow",
    category: "scene",
    description: "Telegram-styled phone conversation.",
    source: "telegram-chat-flow",
    props: chatProps,
    demoProps: {},
    generate: (p) => {
      const id = freshId("tg");
      const frag = chatScene(id, msgsOf(p, [
        { side: "in", text: "Shipping the launch clip today?" },
        { side: "out", text: "Final render is in the pipeline" },
        { side: "in", text: "Send it to the channel when done 🙌" },
      ]), {
        frame: phoneFrame("#0e1621", "#17212b", "#fff"),
        inBubble: "background:#182533; color:#fff; border-radius:12px 12px 12px 4px;",
        outBubble: "background:#2b5278; color:#fff; border-radius:12px 12px 4px 12px;",
        font: "400 15px/1.4 sans-serif",
        gap: 8,
        showTyping: true,
      }, "Launch crew");
      return { css: frag.css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${frag.html}</div>` };
    },
  },
  {
    name: "claude-chat",
    title: "Claude Chat",
    category: "scene",
    description: "Claude-styled assistant exchange.",
    source: "claude-chat",
    props: chatProps,
    demoProps: {},
    generate: (p) => {
      const id = freshId("clc");
      const frag = chatScene(id, msgsOf(p, [
        { side: "out", text: "Turn this take into a 30s teaser with captions" },
        { side: "in", text: "Compiling the take → comp, adding word captions from the transcript, rendering 16:9 and 9:16. One lossless master, two delivery cuts." },
      ]), {
        frame: panelFrame("#262624", "#3a3a37", "#e8e6e0", "#d97757"),
        inBubble: "background:#30302e; color:#e8e6e0; border-radius:14px; border:1px solid #3a3a37;",
        outBubble: "background:#3d3d3a; color:#e8e6e0; border-radius:14px;",
        font: "400 14px/1.55 sans-serif",
        gap: 12,
        showTyping: true,
      }, "Claude");
      return { css: frag.css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${frag.html}</div>` };
    },
  },
  {
    name: "chat-gpt",
    title: "ChatGPT",
    category: "scene",
    description: "ChatGPT-styled assistant exchange.",
    source: "chat-gpt",
    props: chatProps,
    demoProps: {},
    generate: (p) => {
      const id = freshId("cgpt");
      const frag = chatScene(id, msgsOf(p, [
        { side: "out", text: "Summarize what wavelet-ui ships" },
        { side: "in", text: "A deterministic, CSS-keyframe port of the Remocn registry — text reveals, transitions, UI atoms, and full scenes, all gate-verified against Chrome." },
      ]), {
        frame: panelFrame("#212121", "#3a3a3a", "#ececec", "#19c37d"),
        inBubble: "background:transparent; color:#ececec; border-radius:0; padding-left:0;",
        outBubble: "background:#2f2f2f; color:#ececec; border-radius:18px;",
        font: "400 14.5px/1.6 sans-serif",
        gap: 14,
        showTyping: true,
      }, "ChatGPT");
      return { css: frag.css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${frag.html}</div>` };
    },
  },
  {
    name: "claude-code",
    title: "Claude Code",
    category: "scene",
    description: "Claude Code terminal session — prompt, tool call, diff-ish output.",
    source: "claude-code",
    props: {
      prompt: { default: "add a --lossless flag to the render verb", doc: "user ask" },
      steps: { default: ["● Reading tools/src/wavelet.rs", "● Editing wavelet.rs — qp 0 + yuv444p lane", "✓ Built. 72f@1080p30 in 297ms"], doc: "agent lines" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("ccd");
      const steps: string[] = p.steps ?? [];
      const css = [
        `@keyframes ${id}-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }`,
        `.${id} .ln { opacity:0; animation:${id}-in ${sec(8)}s ease-out both; font:400 14px/1.75 ui-monospace, monospace; }`,
        `.${id} .user { color:#e8e6e0; }`,
        `.${id} .user b { color:#d97757; font-weight:600; }`,
        `.${id} .step { color:#b8b5ad; }`,
        `.${id} .ok { color:#7ee787; }`,
      ].join("\n");
      const lines = [
        `<div class="ln user" style="animation-delay:0.4s"><b>&gt;</b> ${escapeHtml(p.prompt ?? "")}</div>`,
        ...steps.map((s, i) => `<div class="ln step${s.startsWith("✓") ? " ok" : ""}" style="animation-delay:${(1.0 + i * 0.5).toFixed(1)}s">${escapeHtml(s)}</div>`),
      ].join("");
      const win = `<div style="width:640px; background:#1f1e1d; border:1px solid #3a3a37; border-radius:14px; padding:20px 22px; box-shadow:0 24px 70px rgba(0,0,0,.5);"><div style="font:600 12px/1 sans-serif; color:#d97757; margin-bottom:12px;">✳ Claude Code</div><div class="${id}">${lines}</div></div>`;
      return { css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${win}</div>` };
    },
  },
  {
    name: "opencode",
    title: "OpenCode",
    category: "scene",
    description: "OpenCode TUI session panel.",
    source: "opencode",
    props: {
      prompt: { default: "port the registry build to bun", doc: "user ask" },
      steps: { default: ["bash · bun registry/build.ts", "edit · package.json", "done · 2 files changed"], doc: "tool lines" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("ocd");
      const steps: string[] = p.steps ?? [];
      const css = [
        `@keyframes ${id}-in { from { opacity:0; } to { opacity:1; } }`,
        `.${id} .ln { opacity:0; animation:${id}-in ${sec(7)}s ease-out both; font:400 13.5px/1.8 ui-monospace, monospace; color:#c9d1d9; }`,
        `.${id} .tag { color:#f97583; }`,
        `.${id} .user { color:#e6edf3; font-weight:600; }`,
      ].join("\n");
      const lines = [
        `<div class="ln user" style="animation-delay:0.4s">┃ ${escapeHtml(p.prompt ?? "")}</div>`,
        ...steps.map((s, i) => {
          const [tag, ...rest] = s.split("·");
          return `<div class="ln" style="animation-delay:${(0.95 + i * 0.45).toFixed(2)}s"><span class="tag">${escapeHtml(tag.trim())}</span> ·${escapeHtml(rest.join("·"))}</div>`;
        }),
      ].join("");
      const win = `<div style="width:620px; background:#0d1117; border:1px solid #30363d; border-radius:10px; padding:18px 20px; box-shadow:0 24px 70px rgba(0,0,0,.5);"><div style="font:600 12px/1 ui-monospace, monospace; color:#8b949e; margin-bottom:10px;">▌opencode</div><div class="${id}">${lines}</div></div>`;
      return { css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${win}</div>` };
    },
  },
  {
    name: "v0",
    title: "v0",
    category: "scene",
    description: "v0-style prompt → generating → preview card swap.",
    source: "v0",
    props: {
      prompt: { default: "a pricing page with three tiers", doc: "typed prompt" },
    },
    demoProps: {},
    generate: (p) => {
      const id = freshId("v0");
      const q = String(p.prompt ?? "");
      const n = Array.from(q).length;
      const typeSecs = +(n / 20).toFixed(2);
      const genAt = 0.5 + typeSecs + 0.3;
      const doneAt = genAt + 1.1;
      const css = [
        `@keyframes ${id}-type { from { width:0ch; } to { width:${n}ch; } }`,
        `@keyframes ${id}-show { from { opacity:0; } to { opacity:1; } }`,
        `@keyframes ${id}-hide { from { opacity:1; } to { opacity:0; } }`,
        `@keyframes ${id}-bar { from { width:8%; } to { width:92%; } }`,
        `@keyframes ${id}-card { from { opacity:0; transform:translateY(12px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }`,
        `.${id} { width:560px; display:flex; flex-direction:column; gap:14px; }`,
        `.${id} .ask { display:flex; align-items:center; height:46px; padding:0 16px; background:#0e0e10; border:1px solid #2a2a2e; border-radius:12px; font:400 14px/1 ui-monospace, monospace; color:#ececf1; }`,
        `.${id} .q { display:inline-block; overflow:hidden; white-space:pre; width:0ch; animation:${id}-type ${typeSecs}s steps(${Math.max(1, n)}, end) both; animation-delay:0.5s; }`,
        `.${id} .gen { opacity:0; animation:${id}-show 0.1s linear both, ${id}-hide 0.15s linear both; animation-delay:${genAt}s, ${doneAt}s; }`,
        `.${id} .gen .bar { height:5px; border-radius:99px; background:#3b82f6; animation:${id}-bar 1.05s cubic-bezier(0.4, 0, 0.6, 1) both; animation-delay:${genAt}s; }`,
        `.${id} .card { opacity:0; background:#0e0e10; border:1px solid #2a2a2e; border-radius:14px; padding:18px; animation:${id}-card ${sec(13)}s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay:${doneAt}s; }`,
        `.${id} .tiers { display:flex; gap:10px; }`,
        `.${id} .tier { flex:1; height:120px; border-radius:10px; background:#17171a; border:1px solid #2a2a2e; }`,
        `.${id} .tier.hot { border-color:#3b82f6; background:#101623; }`,
      ].join("\n");
      const html = `<div class="${id}">
        <div class="ask">▲ <span class="q" style="margin-left:8px">${escapeHtml(q)}</span></div>
        <div class="gen"><div class="bar"></div></div>
        <div class="card"><div class="tiers"><div class="tier"></div><div class="tier hot"></div><div class="tier"></div></div></div>
      </div>`;
      return { css, html: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${html}</div>` };
    },
  },
];
