(function () {
  const GRID = 22; // matches --grid-gap in desktop.css
  const AUTO_MS = 5500;

  const SKILL = `---
name: reactable
description: Agent CLI and deck DSL for Reactable — native stage + metal Mac capture. Author decks in .work format, preview via reactable stage open, manage takes and HyperFrames post.
---

# Reactable (agent CLI)

Install the skill:
  npm i -g reactable-cli && reactable skills install --user

Quick start:
  reactable decks list
  reactable stage open --deck showcase
  reactable doctor

Docs: https://reactable.app
Repo: https://github.com/shinyobjectz/reactable`;

  let zTop = 100;
  let deck = null;
  let autoPlay = true;
  let currentLayout = "demo";

  const WINS = {
    stage: "win-stage",
    term: "win-term",
    bar: "win-bar",
  };

  function snap(n) {
    return Math.round(n / GRID) * GRID;
  }

  function clampPos(node, x, y) {
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const maxX = window.innerWidth - w - GRID;
    const maxY = window.innerHeight - h - GRID;
    return {
      x: snap(Math.max(GRID, Math.min(maxX, x))),
      y: snap(Math.max(GRID + 56, Math.min(maxY, y))), // room for top dock
    };
  }

  function placeWin(id, x, y, animate) {
    const node = document.getElementById(id);
    if (!node) return;
    const p = clampPos(node, x, y);
    if (animate) node.classList.add("snapping");
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    if (animate) setTimeout(() => node.classList.remove("snapping"), 140);
  }

  function syncStageSize() {
    const margin = 96;
    const maxW = 1120;
    const minW = 640;
    const w = Math.min(maxW, Math.max(minW, window.innerWidth - margin));
    document.documentElement.style.setProperty("--rt-preview-w", `${w}px`);
    layoutDeck();
  }

  const LAYOUT_CYCLE = ["demo", "present", "compact"];

  /** Layout presets — fractions of viewport, snapped on apply */
  function layoutCoords(preset) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const stageEl = document.getElementById("win-stage");
    const barEl = document.getElementById("win-bar");
    const termEl = document.getElementById("win-term");
    const stageW = stageEl?.offsetWidth || w * 0.7;
    const barW = barEl?.offsetWidth || 760;
    const termW = termEl?.offsetWidth || 400;
    const presets = {
      demo: {
        stage: { x: (w - stageW) / 2, y: h * 0.08 },
        term: { x: w - termW - w * 0.04, y: h * 0.12 },
        bar: { x: (w - barW) / 2, y: h * 0.78 },
      },
      present: {
        stage: { x: w * 0.1, y: h * 0.06 },
        term: { x: w * 0.03, y: h * 0.52 },
        bar: { x: w * 0.24, y: h * 0.82 },
      },
      compact: {
        stage: { x: w * 0.14, y: h * 0.1 },
        term: { x: w * 0.04, y: h * 0.12 },
        bar: { x: w * 0.38, y: h * 0.68 },
      },
    };
    return presets[preset] || presets.demo;
  }

  function applyLayout(name, animate = true) {
    syncStageSize();
    currentLayout = name;
    const coords = layoutCoords(name);
    placeWin(WINS.stage, coords.stage.x, coords.stage.y, animate);
    placeWin(WINS.term, coords.term.x, coords.term.y, animate);
    placeWin(WINS.bar, coords.bar.x, coords.bar.y, animate);
    const layoutKey = document.getElementById("kc-layout");
    if (layoutKey) layoutKey.textContent = name;
    try {
      localStorage.setItem("reactable-layout", name);
    } catch (_) {}
    layoutDeck();
  }

  function focusWin(el) {
    document.querySelectorAll(".win").forEach((w) => w.classList.remove("focused"));
    el.classList.add("focused");
    el.style.zIndex = String(++zTop);
  }

  function makeDraggable(el, handle) {
    let ox = 0;
    let oy = 0;
    let dragging = false;

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      const node = el.closest(".win") || el;
      focusWin(node);
      handle.setPointerCapture(e.pointerId);
      const r = node.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      node.classList.remove("snapping");
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const node = el.closest(".win") || el;
      const p = clampPos(node, e.clientX - ox, e.clientY - oy);
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
    });

    handle.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      const node = el.closest(".win") || el;
      const r = node.getBoundingClientRect();
      const p = clampPos(node, r.left, r.top);
      node.classList.add("snapping");
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      setTimeout(() => node.classList.remove("snapping"), 140);
    });
  }

  function stageMetrics() {
    const preview = document.querySelector(".rt-stage-preview");
    const w = preview?.clientWidth || 1280;
    const h = preview?.clientHeight || 720;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function layoutDeck() {
    if (!deck) return;
    const { w, h } = stageMetrics();
    deck.configure({ width: w, height: h, margin: 0, minScale: 1, maxScale: 1 });
    deck.layout();
  }

  function updateSlideProgress() {
    if (!deck) return;
    const indices = deck.getIndices();
    const total = deck.getTotalSlides();
    const pct = total > 1 ? ((indices.h || 0) / (total - 1)) * 100 : 0;
    const bar = document.getElementById("slide-progress");
    if (bar) bar.style.width = `${pct}%`;
  }

  function setAutoPlay(on) {
    autoPlay = on;
    if (!deck) return;
    deck.configure({ autoSlide: on ? AUTO_MS : 0, loop: true });
    document.getElementById("kc-auto")?.classList.toggle("on", on);
  }

  function initReveal() {
    const el = document.querySelector("#stage-deck");
    if (!el || typeof Reveal === "undefined") return;

    const { w, h } = stageMetrics();
    deck = new Reveal(el, {
      embedded: true,
      controls: false,
      progress: false,
      slideNumber: false,
      hash: false,
      keyboard: true,
      center: false,
      transition: "slide",
      width: w,
      height: h,
      margin: 0,
      minScale: 1,
      maxScale: 1,
      autoSlide: AUTO_MS,
      autoSlideStoppable: true,
      loop: true,
    });
    deck.initialize().then(() => {
      layoutDeck();
      updateSlideProgress();
      setAutoPlay(autoPlay);
    });
    deck.on("slidechanged", updateSlideProgress);
    deck.on("autoslidepaused", () => {
      if (autoPlay) setAutoPlay(false);
    });
    window.ReactableDeck = deck;
  }

  function bindBar() {
    document.getElementById("prev")?.addEventListener("click", () => {
      deck?.prev();
      updateSlideProgress();
    });
    document.getElementById("next")?.addEventListener("click", () => {
      deck?.next();
      updateSlideProgress();
    });
    document.getElementById("record")?.addEventListener("click", () => {
      document.getElementById("record")?.classList.toggle("on");
    });
    // Decorative toggles — same as native bar UX
    ["cam", "mic", "sys"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", (e) => {
        e.currentTarget.classList.toggle("on");
      });
    });
    document.getElementById("mode-stage")?.addEventListener("click", (e) => {
      e.currentTarget.classList.add("on");
      document.getElementById("mode-window")?.classList.remove("on");
    });
    document.getElementById("mode-window")?.addEventListener("click", (e) => {
      e.currentTarget.classList.add("on");
      document.getElementById("mode-stage")?.classList.remove("on");
    });
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg || "copied");
    } catch {
      prompt("Copy:", text);
    }
  }

  async function copySkill() {
    await copyText(SKILL, "copied · paste into claude code");
  }

  function initTermCopy() {
    document.querySelectorAll(".term-chip[data-copy]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(btn.dataset.copy, "copied · " + btn.dataset.copy);
      });
    });
  }

  async function handleDownload(e) {
    e.preventDefault();
    const res = await fetch("/api/download");
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else toast(data.note || "build locally · just app");
  }

  function initStageKeycaps() {
    document.getElementById("kc-prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      deck?.prev();
      updateSlideProgress();
    });

    document.getElementById("kc-next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      deck?.next();
      updateSlideProgress();
    });

    document.getElementById("kc-auto")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setAutoPlay(!autoPlay);
      toast(autoPlay ? "auto-advance · on" : "auto-advance · paused");
    });

    document.getElementById("kc-layout")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = LAYOUT_CYCLE.indexOf(currentLayout);
      const next = LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length];
      applyLayout(next);
      toast(`layout · ${next}`);
    });

    let saved = "demo";
    try {
      saved = localStorage.getItem("reactable-layout") || "demo";
    } catch (_) {}
    applyLayout(saved, false);

    window.addEventListener("resize", () => {
      syncStageSize();
      applyLayout(currentLayout, false);
    });
  }

  function initWindows() {
    const stage = document.getElementById("win-stage");
    const term = document.getElementById("win-term");
    const bar = document.getElementById("win-bar");

    if (stage) {
      makeDraggable(stage, stage.querySelector(".rt-stage-drag-strip"));
      stage.addEventListener("pointerdown", () => focusWin(stage));
    }
    if (term) {
      makeDraggable(term, term.querySelector(".win-titlebar"));
      term.addEventListener("pointerdown", () => focusWin(term));
    }
    if (bar) {
      makeDraggable(bar, bar.querySelector(".drag"));
      bar.addEventListener("pointerdown", () => focusWin(bar));
    }

    focusWin(stage);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layoutDeck()) : null;
    const preview = stage?.querySelector(".rt-stage-preview");
    if (preview && ro) ro.observe(preview);
  }

  function initIcons() {
    document.querySelectorAll(".desk-icon[data-href]").forEach((icon) => {
      icon.addEventListener("dblclick", () => {
        window.open(icon.dataset.href, "_blank", "noopener");
      });
      icon.addEventListener("click", () => {
        document.querySelectorAll(".desk-icon").forEach((i) => i.classList.remove("selected"));
        icon.classList.add("selected");
      });
    });

  }

  function initAuth() {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((me) => {
        if (me.signedIn) {
          document.getElementById("dock-signin")?.classList.add("hidden");
          document.getElementById("dock-dash")?.classList.remove("hidden");
        }
      })
      .catch(() => {});
  }

  function boot() {
    syncStageSize();
    initWindows();
    initStageKeycaps();
    initReveal();
    bindBar();
    initIcons();
    initAuth();
    initTermCopy();

    document.getElementById("term-copy")?.addEventListener("click", copySkill);
    document.getElementById("dock-download")?.addEventListener("click", handleDownload);

    if (typeof lucide !== "undefined") {
      lucide.createIcons({
        attrs: { "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round" },
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
