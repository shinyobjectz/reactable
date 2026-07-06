import { readFileSync, writeFileSync } from "node:fs";
import { deckPath } from "./paths.ts";

export type Slide = Record<string, unknown> & {
  id: string;
  type?: string;
  body?: string;
  unit?: string;
  actions?: Array<{ type: string; ms?: number; step?: number }>;
};

export type DeckScript = {
  id?: string;
  on: "deck.open" | "record.start" | "slide.enter" | "slide.leave" | "timer";
  slide?: string;
  at?: number;
  run: string;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  detach?: boolean;
  url?: string;
  port?: number;
};

export type Deck = {
  slug: string;
  title: string;
  slides: Slide[];
  preload: string[];
  scripts: DeckScript[];
  raw: string;
};

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function jsonBlock(content: string, name: string): unknown | null {
  const re = new RegExp("```json\\s+" + name + "\\s*\\n([\\s\\S]*?)```");
  const m = content.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

function deckTitle(content: string, fallback: string) {
  const m = content.match(/title:\s*(.+)/);
  return m ? m[1].trim() : fallback;
}

function deckId(content: string, fallback: string) {
  const m = content.match(/id:\s*(\S+)/);
  return m ? m[1].trim() : fallback;
}

function extractClients(content: string): Record<string, string> {
  const clients: Record<string, string> = {};
  const re = /^client\s+:(\S+)\s+do\r?\n([\s\S]*?)^end\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    clients[m[1]] = m[2].trim();
  }
  return clients;
}

function parseAttrs(text: string): { attrs: Record<string, string>; actions: string[] } {
  const attrs: Record<string, string> = {};
  const actions: string[] = [];
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k === "action") actions.push(v);
    else attrs[k] = v;
  }
  return { attrs, actions };
}

function slideTrailingBody(rest: string): string {
  const m = rest.match(/^([\s\S]*?)(?=^(?:slide|script|preload|client\s*:)|\z)/m);
  return m ? m[1].trim() : "";
}

function parseActionsList(actions: string[]) {
  const out: Slide["actions"] = [];
  for (const a of actions) {
    if (a.startsWith("wait ")) {
      const ms = parseInt(a.slice(5), 10);
      if (!Number.isNaN(ms)) out.push({ type: "wait", ms });
    } else if (a === "play") out.push({ type: "play" });
    else if (a.startsWith("fragment ")) {
      const step = parseInt(a.slice(9), 10);
      if (!Number.isNaN(step)) out.push({ type: "fragment", step });
    }
  }
  return out.length ? out : undefined;
}

function parseWorkSlides(content: string, clients: Record<string, string>): Slide[] {
  const re = /^slide\s+do\r?\n([\s\S]*?)^end/gm;
  const slides: Slide[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const full = m[0];
    const attrsText = m[1];
    const { attrs, actions } = parseAttrs(attrsText);
    const rest = content.split(full)[1] ?? "";
    const body = slideTrailingBody(rest);
    const type = attrs.type || "prose";
    const slide: Slide = {
      id: attrs.id || "slide",
      type,
    };
    if (attrs.notes) slide.notes = attrs.notes;
    if (attrs.theme) slide.theme = attrs.theme;
    if (attrs.url) slide.url = attrs.url;
    if (attrs.src) slide.src = attrs.src;
    if (attrs.title) slide.title = attrs.title;
    if (attrs.videoId) slide.videoId = attrs.videoId;
    const parsedActions = parseActionsList(actions);
    if (parsedActions) slide.actions = parsedActions;

    if (type === "client") {
      slide.unit = attrs.unit;
    } else if (type === "html") {
      slide.body = body;
    } else if (type === "prose" || type === "work" || type === "document") {
      slide.body = body;
      slide.type = "prose";
    }

    slides.push(slide);
  }
  return slides;
}

function parsePreloadBlocks(content: string): string[] {
  const urls: string[] = [];
  const re = /^preload\s+do\r?\n([\s\S]*?)^end/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    for (const line of m[1].split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const colon = t.indexOf(":");
      urls.push(colon === 2 && t.startsWith("url") ? t.slice(4).trim() : t);
    }
  }
  return urls;
}

function parseScriptBlocks(content: string): DeckScript[] {
  const scripts: DeckScript[] = [];
  const re = /^script\s+do\r?\n([\s\S]*?)^end/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const { attrs } = parseAttrs(m[1]);
    const script: DeckScript = {
      id: attrs.id,
      on: attrs.on as DeckScript["on"],
      run: attrs.run || "",
    };
    if (attrs.slide) script.slide = attrs.slide;
    if (attrs.at) script.at = parseFloat(attrs.at);
    if (attrs.shell) script.shell = attrs.shell;
    if (attrs.cwd) script.cwd = attrs.cwd;
    if (attrs.url) script.url = attrs.url;
    if (attrs.detach === "true" || attrs.detach === "yes" || attrs.detach === "1") {
      script.detach = true;
    }
    scripts.push(script);
  }
  return scripts;
}

function hasWorkSlides(content: string) {
  return /^slide\s+do/m.test(content);
}

function readLegacyDeck(raw: string, slug: string): Deck {
  return {
    slug: deckId(raw, slug),
    title: deckTitle(raw, slug),
    slides: (jsonBlock(raw, "slides") as Slide[]) || [],
    preload: (jsonBlock(raw, "preload") as string[]) || [],
    scripts: (jsonBlock(raw, "scripts") as DeckScript[]) || [],
    raw,
  };
}

export function readDeck(slug: string, root?: string): Deck {
  const path = deckPath(slug, root);
  const raw = readFileSync(path, "utf8");
  if (!hasWorkSlides(raw)) return readLegacyDeck(raw, slug);

  const clients = extractClients(raw);
  return {
    slug: deckId(raw, slug),
    title: deckTitle(raw, slug),
    slides: parseWorkSlides(raw, clients),
    preload: parsePreloadBlocks(raw),
    scripts: parseScriptBlocks(raw),
    raw,
  };
}

function serializeAction(a: { type: string; ms?: number; step?: number }): string {
  if (a.type === "wait" && a.ms != null) return `action: wait ${a.ms}`;
  if (a.type === "play") return "action: play";
  if (a.type === "fragment" && a.step != null) return `action: fragment ${a.step}`;
  return "";
}

function serializeSlide(slide: Slide): string {
  const lines = ["slide do", `  id: ${slide.id}`];
  const type = slide.type || "prose";
  lines.push(`  type: ${type}`);
  if (attrs.notes) lines.push(`  notes: ${slide.notes}`);
  if (slide.theme) lines.push(`  theme: ${slide.theme}`);
  if (slide.url) lines.push(`  url: ${slide.url}`);
  if (slide.src) lines.push(`  src: ${slide.src}`);
  if (slide.title) lines.push(`  title: ${slide.title}`);
  if (slide.videoId) lines.push(`  videoId: ${slide.videoId}`);
  if (slide.unit) lines.push(`  unit: ${slide.unit}`);
  if (Array.isArray(slide.actions)) {
    for (const a of slide.actions) {
      const line = serializeAction(a);
      if (line) lines.push(`  ${line}`);
    }
  }
  lines.push("end");
  if ((type === "prose" || type === "work" || type === "html") && slide.body) {
    lines.push("", slide.body);
  }
  return lines.join("\n");
}

function serializePreload(urls: string[]): string {
  if (!urls.length) return "";
  return ["preload do", ...urls.map((u) => `  ${u}`), "end"].join("\n");
}

function serializeScript(sc: DeckScript): string {
  const lines = ["script do"];
  if (sc.id) lines.push(`  id: ${sc.id}`);
  lines.push(`  on: ${sc.on}`);
  if (sc.slide) lines.push(`  slide: ${sc.slide}`);
  if (sc.at != null) lines.push(`  at: ${sc.at}`);
  lines.push(`  run: ${sc.run}`);
  if (sc.shell) lines.push(`  shell: ${sc.shell}`);
  if (sc.cwd) lines.push(`  cwd: ${sc.cwd}`);
  if (sc.url) lines.push(`  url: ${sc.url}`);
  if (sc.detach) lines.push("  detach: true");
  lines.push("end");
  return lines.join("\n");
}

function stripSlideSections(raw: string): string {
  let out = raw;
  const slideRe = /^slide\s+do\r?\n[\s\S]*?^end\r?\n?/gm;
  out = out.replace(slideRe, "");
  // trailing prose before next top-level block
  out = out.replace(
    /(?:^|\n)([\s\S]*?)(?=^(?:script|preload|client\s*:|deck\s+do)|\s*$)/m,
    (match, prose, offset) => {
      if (offset === 0 && prose.startsWith("#")) return match;
      const trimmed = prose.trim();
      if (!trimmed || trimmed.includes("deck do") || trimmed.includes("```json")) return match;
      return "\n";
    },
  );
  return out.trimEnd();
}

function stripBlock(raw: string, name: "preload" | "script"): string {
  const re = new RegExp(`^${name}\\s+do\\r?\\n[\\s\\S]*?^end\\r?\\n?`, "gm");
  return raw.replace(re, "").trimEnd();
}

function serializeWorkDeck(deck: Deck, raw: string): string {
  const clients = extractClients(raw);
  let base = stripSlideSections(raw);
  base = stripBlock(base, "preload");
  base = stripBlock(base, "script");

  const parts = [base.trimEnd()];
  const preload = serializePreload(deck.preload);
  if (preload) parts.push("", preload);
  if (deck.scripts.length) {
    parts.push("", deck.scripts.map(serializeScript).join("\n\n"));
  }
  if (deck.slides.length) {
    parts.push("", deck.slides.map(serializeSlide).join("\n\n"));
  }
  for (const [unit, html] of Object.entries(clients)) {
    if (!raw.includes(`client :${unit}`)) {
      parts.push("", `client :${unit} do`, html, "end");
    }
  }
  return parts.join("\n\n").trimEnd() + "\n";
}

export function writeDeckBlock(slug: string, block: string, value: unknown, root?: string) {
  const path = deckPath(slug, root);
  let raw = readFileSync(path, "utf8");
  if (hasWorkSlides(raw)) {
    const deck = readDeck(slug, root);
    if (block === "slides") deck.slides = value as Slide[];
    if (block === "preload") deck.preload = value as string[];
    if (block === "scripts") deck.scripts = value as DeckScript[];
    writeFileSync(path, serializeWorkDeck(deck, raw));
    return;
  }
  const body = JSON.stringify(value, null, 2);
  const fence = "```json " + block + "\n" + body + "\n```";
  const re = new RegExp("```json\\s+" + block + "\\s*\\n[\\s\\S]*?```");
  if (re.test(raw)) {
    raw = raw.replace(re, fence);
  } else {
    raw = raw.trimEnd() + "\n\n" + fence + "\n";
  }
  writeFileSync(path, raw);
}

export function writeDeck(slug: string, deck: Partial<Deck>, root?: string) {
  const path = deckPath(slug, root);
  const raw = readFileSync(path, "utf8");
  if (hasWorkSlides(raw) || deck.slides) {
    const current = readDeck(slug, root);
    if (deck.slides) current.slides = deck.slides;
    if (deck.preload) current.preload = deck.preload;
    if (deck.scripts) current.scripts = deck.scripts;
    writeFileSync(path, serializeWorkDeck(current, raw));
    return;
  }
  if (deck.slides) writeDeckBlock(slug, "slides", deck.slides, root);
  if (deck.preload) writeDeckBlock(slug, "preload", deck.preload, root);
  if (deck.scripts) writeDeckBlock(slug, "scripts", deck.scripts, root);
}

export function newDeckTemplate(slug: string, title: string) {
  return `# ${title}

deck do
  id: ${slug}
  title: ${title}
end

preload do
end

script do
  id: open-log
  on: deck.open
  run: echo deck open: ${slug}
  detach: true
end

slide do
  id: intro
  type: prose
  notes: Opening slide — set the hook.
end

## ${title}

← → to navigate.
`;
}

export function validateDeck(deck: Deck): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const s of deck.slides) {
    if (!s.id) errs.push("slide missing id");
    else if (ids.has(s.id)) errs.push(`duplicate slide id: ${s.id}`);
    else ids.add(s.id);
  }
  for (const sc of deck.scripts) {
    if (!sc.on) errs.push("script missing on");
    if (!sc.run) errs.push(`script ${sc.id || sc.on} missing run`);
    if ((sc.on === "slide.enter" || sc.on === "slide.leave") && !sc.slide) {
      errs.push(`script ${sc.id || sc.on} needs slide`);
    }
  }
  return errs;
}
