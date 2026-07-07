#!/usr/bin/env bun
/**
 * reactable — agent CLI for decks, takes, stage scripts, and HyperFrames post.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  newDeckTemplate,
  readDeck,
  slugify,
  validateDeck,
  writeDeck,
  type DeckScript,
  type Slide,
} from "../lib/deck.ts";
import { scaffoldHyperframes, hfDir } from "../lib/hf.ts";
import {
  assertProject,
  apiBase,
  deckPath,
  decksDir,
  NEXUS,
  PORT,
  PROJECT,
  takePath,
} from "../lib/paths.ts";
import {
  stageCommand,
  stageOpen,
  stageStatus,
  stageSurface,
} from "../lib/stage.ts";
import {
  eventSummary,
  fetchTake,
  fetchTakes,
  listTakeIds,
  readEvents,
  readTakeManifest,
  renderTake,
} from "../lib/take.ts";
import {
  defaultCursorSkillPath,
  installSkills,
  userCursorSkillPath,
} from "../lib/skills.ts";
import { buildAgentPrompt, readAgentPrompt } from "../lib/agent-prompt.ts";
import { installAppFromWeb } from "../lib/app-install.ts";
import { toolsDoctor, installHyperframesSkills, runTools } from "../lib/tools.ts";
import { harCapture, harList, blitzReplay } from "../lib/har.ts";
import {
  transcribeTake,
  removeFiller,
  trimSilence,
  writeWordCaptions,
  applyFillerCutsToEdit,
} from "../lib/speech.ts";
import { ttsSpeak, ttsDoctor } from "../lib/tts.ts";
import { agentChat, agentStatus, agentLlmProbe, createProject } from "../lib/agent.ts";
import { getProject, listSurfaces } from "../lib/surface.ts";
import { authLogin, authStatus, clearCredentials } from "../lib/auth.ts";
import {
  youtubeConnect,
  youtubeDisconnect,
  youtubeProxy,
  youtubeSearch,
  youtubeStatusCmd,
} from "../lib/youtube.ts";

function sh(cmd: string, args: string[], cwd = PROJECT, env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd,
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
}

function jsonOut(v: unknown) {
  console.log(JSON.stringify(v, null, 2));
}

async function apiExec(body: Record<string, unknown>, port = PORT) {
  const res = await fetch(`${apiBase(port)}/reactable/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

const HELP = `reactable — agent CLI for decks, takes, and HyperFrames post

Usage: reactable <command> [args]

  serve                         headless nexus sidecar (:${PORT})
  doctor                        check toolchain + project layout
  install app                   download + install Reactable.app (macOS)
  skills install [--user]       install agent skills (project or ~/.cursor)
  skills prompt [--deck <slug>] print copy-paste block for any agent
  skills list [--json]          verb-indexed skill registry

  tools doctor [--json]         ffmpeg, hyperframes, reactable-tools sidecar
  tools install hyperframes     run npx hyperframes init (skills + CLI)
  tools build                   build dist/reactable-tools (Rust)

  har capture <url> [--project] cache page refs under .reactable/har/
  har list [--project] [--json]
  har replay --ref <id>         Blitz replay via nexus (requires serve)

  takes transcribe <id> [--model UsefulSensors/moonshine-tiny]
  edit remove-filler <id> [--aggressive]
  edit trim-silence <id>
  edit captions <id>              word-level WEBVTT from transcript

  tts speak --text "<script>" -o <wav> [--voice af_heart]
  tts doctor [--json]             moonshine + kokoro via Rust MLX sidecar

  agent chat "<message>" [--deck demo] [--json]
  agent status [--json]           local Gemma MLX via reactable-tools
  projects new "<title>" [--slug]   scaffold under ~/Reactable/projects/
  project [<id>] [--json]           project aggregate: research · decks · takes · surfaces
  surfaces [--project <id>] [--json]  flat Surface list (all projects if unscoped)

  decks list
  decks get <slug> [--json]
  decks new <title>
  decks validate <slug>
  decks slide add <slug> --id <id> --type <type> [--url|--body|--src ...]
  decks slide move <slug> <id> --to <index>
  decks script add <slug> --on <trigger> --run "<cmd>" [--slide <id>] [--at <sec>] [--detach]
  decks script run <slug> --on <trigger> [--slide <id>]

  takes list [--json]
  takes get <id> [--json]
  takes events <id> [--json]
  takes render <id> [--aspect 16:9,9:16]
  takes edit get|set <id> [--file edit.json]
  takes hf init <id>
  takes hf render <id>

  open bar
  stage open [--deck <slug>]        open native stage (preview = record surface)
  stage hide                        hide native stage window
  stage load --deck <slug>          switch deck in stage
  stage surface --kind <k> --ref <r> [--project <id>] [--title <t>]
                                    open any Surface as a Stage tab (deck|web|doc|youtube)
  stage status [--json]             native stage heartbeat + pending commands
  auth login                        cloud account (reactable.app) — optional
  auth status [--json]
  auth logout
  youtube connect                   Google OAuth → ~/.shinyobjectz/ (same as studio)
  youtube disconnect
  youtube status [--json]
  youtube search "<query>" [--json]
  youtube proxy --video <id> [--start <sec>] [--json]
  plan <slug>                   print agent planning brief for a deck
  record                        print how to start a metal capture session

Env: PORT (default ${PORT}), NEXUS (nexus runtime path).
Project root: ${PROJECT}

Note: \`open present\` is deprecated — use \`stage open\`. The stage WKWebView is the only presentation surface.`;

function cmdDoctor(asJson = false) {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const ok = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, ok: pass, detail });

  ok("project index.work", existsSync(join(PROJECT, "index.work")));
  ok("nexus path", existsSync(join(NEXUS, "mix.exs")), NEXUS);
  ok("bun", spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0);
  ok("python3", spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0);
  ok("decks/", existsSync(decksDir()));
  ok("takes/", existsSync(join(PROJECT, "takes")));

  const tools = toolsDoctor(PROJECT);
  for (const c of tools.checks) checks.push(c);

  if (asJson) jsonOut({ ok: checks.every((c) => c.ok), checks });
  else {
    for (const c of checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }
  return checks.every((c) => c.ok) ? 0 : 1;
}

function cmdToolsDoctor(asJson: boolean) {
  const r = toolsDoctor(PROJECT);
  if (asJson) jsonOut(r);
  else {
    for (const c of r.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.log(r.ok ? "\n✓ tools ready" : "\n✗ tools incomplete — run: reactable tools build");
  }
  return r.ok ? 0 : 1;
}

function cmdDecksList() {
  const dir = decksDir();
  if (!existsSync(dir)) return console.log("(no decks)");
  for (const slug of readdirSync(dir).sort()) {
    if (existsSync(deckPath(slug))) console.log(slug);
  }
}

function cmdDecksGet(slug: string, asJson: boolean) {
  const deck = readDeck(slug);
  if (asJson) jsonOut(deck);
  else {
    console.log(`${deck.title} (${deck.slug})`);
    console.log(`slides: ${deck.slides.length} · scripts: ${deck.scripts.length}`);
    deck.slides.forEach((s, i) => console.log(`  ${i}. ${s.id} [${s.type || "?"}]`));
  }
}

function cmdDecksNew(title: string) {
  const slug = slugify(title);
  const dir = join(decksDir(), slug);
  if (existsSync(dir)) {
    console.error(`exists: ${dir}`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(deckPath(slug), newDeckTemplate(slug, title));
  console.log(`created decks/${slug}/deck.work`);
  console.log(`preview: reactable stage open --deck ${slug}`);
  return 0;
}

function cmdDecksValidate(slug: string) {
  const deck = readDeck(slug);
  const errs = validateDeck(deck);
  if (errs.length) {
    errs.forEach((e) => console.error("✗", e));
    return 1;
  }
  console.log("✓ deck ok");
  return 0;
}

function parseFlags(args: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else if (a.startsWith("-") && a.length === 2) {
      const key = a.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

function cmdDecksSlideAdd(slug: string, flags: Record<string, string | boolean>) {
  const deck = readDeck(slug);
  const slide: Slide = {
    id: String(flags.id || `slide-${deck.slides.length}`),
    type: String(flags.type || "prose"),
  };
  if (flags.url) slide.url = String(flags.url);
  if (flags.body) slide.body = String(flags.body);
  if (flags.src) slide.src = String(flags.src);
  if (flags.notes) slide.notes = String(flags.notes);
  if (flags.videoId) slide.videoId = String(flags.videoId);
  deck.slides.push(slide);
  writeDeck(slug, { slides: deck.slides });
  console.log(`added slide ${slide.id} → decks/${slug}/deck.work`);
  return 0;
}

function cmdDecksSlideMove(slug: string, id: string, to: number) {
  const deck = readDeck(slug);
  const idx = deck.slides.findIndex((s) => s.id === id);
  if (idx < 0) {
    console.error(`no slide ${id}`);
    return 1;
  }
  const [slide] = deck.slides.splice(idx, 1);
  deck.slides.splice(to, 0, slide);
  writeDeck(slug, { slides: deck.slides });
  console.log(`moved ${id} → index ${to}`);
  return 0;
}

function cmdDecksScriptAdd(slug: string, flags: Record<string, string | boolean>) {
  const deck = readDeck(slug);
  const script: DeckScript = {
    id: flags.id ? String(flags.id) : `script-${deck.scripts.length + 1}`,
    on: String(flags.on || "slide.enter") as DeckScript["on"],
    run: String(flags.run || ""),
  };
  if (flags.slide) script.slide = String(flags.slide);
  if (flags.at) script.at = Number(flags.at);
  if (flags.shell) script.shell = String(flags.shell);
  if (flags.cwd) script.cwd = String(flags.cwd);
  if (flags.url) script.url = String(flags.url);
  if (flags.detach) script.detach = true;
  if (!script.run) {
    console.error("--run required");
    return 1;
  }
  deck.scripts.push(script);
  writeDeck(slug, { scripts: deck.scripts });
  console.log(`added script ${script.id} (${script.on})`);
  return 0;
}

async function cmdDecksScriptRun(slug: string, flags: Record<string, string | boolean>) {
  const body: Record<string, unknown> = {
    deck: slug,
    on: String(flags.on || "deck.open"),
  };
  if (flags.slide) body.slide = String(flags.slide);
  const out = await apiExec(body);
  jsonOut(out);
  return out.ok ? 0 : 1;
}

async function cmdTakesList(asJson: boolean) {
  try {
    const remote = await fetchTakes();
    if (remote.ok) {
      if (asJson) jsonOut(remote);
      else remote.takes?.forEach((t: { id: string }) => console.log(t.id));
      return 0;
    }
  } catch {
    /* offline */
  }
  const ids = listTakeIds();
  if (asJson) jsonOut({ ok: true, takes: ids.map((id) => ({ id, ...readTakeManifest(id) })) });
  else ids.forEach((id) => console.log(id));
  return 0;
}

async function cmdTakesGet(id: string, asJson: boolean) {
  try {
    const remote = await fetchTake(id);
    if (remote.ok) {
      if (asJson) jsonOut(remote);
      else {
        console.log(id, remote.manifest?.deck || "");
        console.log("events:", remote.events?.length || 0);
      }
      return 0;
    }
  } catch {
    /* offline */
  }
  const manifest = readTakeManifest(id);
  const events = readEvents(id);
  const payload = { ok: true, id, manifest, events };
  if (asJson) jsonOut(payload);
  else jsonOut(payload);
  return 0;
}

function cmdTakesEvents(id: string, asJson: boolean) {
  const events = readEvents(id);
  const summary = eventSummary(events);
  if (asJson) jsonOut({ ok: true, id, summary, events });
  else {
    console.log(`${id}: ${summary.total} events`);
    Object.entries(summary.byType).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }
  return 0;
}

async function cmdTakesRender(id: string, flags: Record<string, string | boolean>) {
  const aspects = flags.aspect ? String(flags.aspect).split(",") : undefined;
  try {
    const out = await renderTake(id, PORT, aspects);
    jsonOut(out);
    return out.ok ? 0 : 1;
  } catch {
    return sh("python3", [join(PROJECT, "scripts", "composite.py"), takePath(id)]);
  }
}

function cmdTakesEdit(op: string, id: string, file?: string) {
  const editPath = join(takePath(id), "edit.json");
  if (op === "get") {
    if (existsSync(editPath)) console.log(readFileSync(editPath, "utf8"));
    else console.log("{}");
    return 0;
  }
  if (op === "set" && file) {
    copyFileSync(file, editPath);
    console.log(`wrote ${editPath}`);
    return 0;
  }
  console.error("usage: takes edit get|set <id> [--file path]");
  return 1;
}

function cmdTakesHfInit(id: string) {
  const out = scaffoldHyperframes(id);
  console.log(`→ ${out}`);
  console.log(`edit compositions/take-edit.html then: reactable take hf render ${id}`);
  return 0;
}

function cmdTakesHfRender(id: string) {
  const dir = hfDir(id);
  if (!existsSync(dir)) {
    console.error("run: reactable take hf init", id);
    return 1;
  }
  return sh("npx", ["hyperframes", "render", "--output", join(takePath(id), "out", "hyperframes-final.mp4")], dir);
}

function cmdOpen(target: string, deck?: string) {
  if (target === "present") {
    console.error("open present is deprecated — use: reactable stage open");
    return cmdStageOpen(deck);
  }
  const urls: Record<string, string> = {
    bar: `${apiBase()}/bar`,
  };
  const url = urls[target];
  if (!url) {
    console.error("unknown:", target, "(use stage open for decks)");
    return 1;
  }
  console.log(url);
  return sh("open", [url]);
}

async function cmdStageOpen(deck?: string) {
  const slug = deck || "showcase";
  const result = await stageOpen(slug);
  if (result.ok) {
    console.log(`stage open · deck=${slug} · visible=${result.live?.visible ?? true}`);
    return 0;
  }
  console.error(result.error || "stage open failed");
  return 1;
}

async function cmdStageHide() {
  const r = await stageCommand("hide");
  if (r.ok) {
    console.log("stage hide queued");
    return 0;
  }
  console.error(r.error || "stage hide failed");
  return 1;
}

async function cmdStageLoad(deck: string) {
  if (!deck) {
    console.error("--deck required");
    return 1;
  }
  const r = await stageCommand("load", deck);
  if (r.ok) {
    console.log(`stage load · deck=${deck}`);
    return 0;
  }
  console.error(r.error || "stage load failed");
  return 1;
}

async function cmdStageStatus(asJson: boolean) {
  const st = await stageStatus();
  if (asJson) jsonOut(st);
  else {
    const live = st.live;
    console.log(`native: ${live?.deck ? "connected" : "offline"}`);
    if (live) console.log(`  deck=${live.deck} visible=${live.visible} project=${live.projectId ?? "?"}`);
    if (st.pending) console.log(`  pending: ${st.pending.action}${st.pending.deck ? ` deck=${st.pending.deck}` : ""}`);
  }
  return st.ok ? 0 : 1;
}

function cmdPlan(slug: string) {
  const deck = readDeck(slug);
  const brief = `# Plan — ${deck.title}

## Deck
- slug: \`${deck.slug}\`
- slides: ${deck.slides.length}
- scripts: ${deck.scripts.length}

## Agent checklist
1. **Research** — gather URLs, demo assets, and speaker notes per slide.
2. **Order** — \`reactable decks slide move ${slug} <id> --to <n>\`
3. **Dev servers** — add scripts with \`on: deck.open\`, \`detach: true\`, \`run: "npm run dev"\`, \`url: http://localhost:PORT\`
4. **Slide hooks** — \`on: slide.enter\`, \`slide: <id>\`, optional \`at: <seconds>\`
5. **Record** — \`just reactable dev\` then \`reactable stage open --deck ${slug}\` (same surface as capture).
6. **Post** — \`reactable takes render <id>\` (ffmpeg) or \`reactable take hf init <id>\` (HyperFrames).

## Slides
${deck.slides.map((s, i) => `- ${i}. **${s.id}** (${s.type || "?"})${s.notes ? ` — ${s.notes}` : ""}`).join("\n")}

## Scripts
${deck.scripts.length ? deck.scripts.map((s) => `- ${s.id || s.on}: \`${s.on}\`${s.slide ? ` slide=${s.slide}` : ""} → ${s.run}`).join("\n") : "(none yet)"}
`;
  console.log(brief);
  return 0;
}

function cmdRecord() {
  console.log(`Metal capture (macOS):
  1. just reactable dev          # menu-bar app + nexus (spawns stage poller)
  2. reactable stage open --deck demo   # preview = recorded WKWebView stage
  3. Record from bar (Stage capture mode) — navigate slides while recording
  Takes land in takes/take-<timestamp>/ with stage.mov, cam.mov, events.jsonl`);
  return 0;
}

// ── dispatch ──────────────────────────────────────────────────────────
assertProject();

const argv = process.argv.slice(2);
const { flags, rest } = parseFlags(argv);
const [cmd, sub, third, fourth, fifth] = rest;

try {
  if (cmd === "serve") {
    process.exit(
      sh(
        "elixir",
        ["--no-halt", "-S", "mix", "run"],
        NEXUS,
        { WB_SERVE: "1", PORT, WB_DATA: PROJECT },
      ),
    );
  }

  if (cmd === "doctor") process.exit(cmdDoctor(Boolean(flags.json)));

  if (cmd === "tools") {
    if (sub === "doctor") process.exit(cmdToolsDoctor(Boolean(flags.json)));
    if (sub === "build") {
      process.exit(sh("bash", [join(PROJECT, "scripts/build-tools.sh")], PROJECT));
    }
    if (sub === "install" && third === "hyperframes") {
      process.exit(installHyperframesSkills() ? 0 : 1);
    }
    console.error("tools: doctor | build | install hyperframes");
    process.exit(1);
  }

  if (cmd === "har") {
    const project = String(flags.project || "default");
    if (sub === "capture" && third) {
      try {
        jsonOut(harCapture(third, project));
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    if (sub === "list") {
      try {
        const data = harList(project);
        if (flags.json) jsonOut(data);
        else (data.entries ?? []).forEach((e: { id: string; url: string }) => console.log(`${e.id}  ${e.url}`));
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    if (sub === "replay" && flags.ref) {
      try {
        jsonOut(await blitzReplay(String(flags.ref), project, PORT));
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    console.error("har: capture <url> | list | replay --ref <id>");
    process.exit(1);
  }

  if (cmd === "edit") {
    if (sub === "remove-filler" && third) {
      try {
        const r = removeFiller(third, Boolean(flags.aggressive));
        applyFillerCutsToEdit(third);
        jsonOut(r);
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    if (sub === "trim-silence" && third) {
      try {
        jsonOut(trimSilence(third));
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    if (sub === "captions" && third) {
      try {
        const vtt = writeWordCaptions(third);
        console.log(`→ ${vtt}`);
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    console.error("edit: remove-filler | trim-silence | captions <take-id>");
    process.exit(1);
  }

  if (cmd === "tts") {
    if (sub === "doctor") {
      const d = ttsDoctor();
      if (flags.json) jsonOut(d);
      else {
        console.log(`backend: ${d.backend ?? "rust-mlx"}`);
        console.log(`${d.moonshine?.ok ? "✓" : "✗"} moonshine — ${d.moonshine?.via ?? "missing"}`);
        console.log(`${d.kokoro?.ok ? "✓" : "✗"} kokoro — ${d.kokoro?.via ?? "missing"}`);
      }
      process.exit(d.kokoro?.ok || d.moonshine?.ok ? 0 : 1);
    }
    if (sub === "speak") {
      const text = String(flags.text || "");
      const out = String(flags.o || flags.output || "");
      if (!text || !out) {
        console.error("tts speak --text \"...\" -o path.wav");
        process.exit(1);
      }
      try {
        jsonOut(ttsSpeak(text, out, flags.voice ? String(flags.voice) : undefined));
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    console.error("tts: speak | doctor");
    process.exit(1);
  }

  if (cmd === "agent") {
    if (sub === "status") {
      try {
        const s = flags.json ? await agentStatus() : agentLlmProbe();
        if (flags.json) jsonOut(s);
        else {
          console.log(`backend: ${s.backend ?? s.engine ?? "mlx-lm"}`);
          console.log(`${s.ok ? "✓" : "✗"} ${s.state ?? "unknown"}${s.hint ? ` — ${s.hint}` : ""}`);
        }
        process.exit(s.ok ? 0 : 1);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    if (sub === "chat") {
      const message = rest.slice(2).join(" ") || String(flags.message || "");
      if (!message) {
        console.error("agent chat \"your message\"");
        process.exit(1);
      }
      try {
        const r = await agentChat(message, { deck: String(flags.deck || "showcase") });
        if (flags.json) jsonOut(r);
        else console.log(r.reply ?? "");
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    if (sub === "pull") {
      const model = flags.model ? ["--model", String(flags.model)] : [];
      process.exit(runTools(["agent-pull", ...model]).status);
    }
    if (sub === "serve") {
      process.exit(runTools(flags.stop ? ["agent-serve", "--stop"] : ["agent-serve"]).status);
    }
    console.error("agent: chat | status | pull | serve [--stop]");
    process.exit(1);
  }

  if (cmd === "project") {
    try {
      const proj = await getProject(sub || undefined);
      if (flags.json) jsonOut(proj);
      else {
        console.log(`${proj.name} (${proj.id}) — ${proj.path}`);
        console.log(`  research: ${proj.research.length} · decks: ${proj.decks.length} · takes: ${proj.takes.length}`);
        for (const s of proj.surfaces) console.log(`  ${s.kind.padEnd(10)} ${s.title}`);
      }
      process.exit(0);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
  }

  if (cmd === "surfaces") {
    try {
      const surfaces = await listSurfaces(flags.project ? String(flags.project) : undefined);
      if (flags.json) jsonOut({ ok: true, surfaces });
      else for (const s of surfaces) console.log(`${s.kind.padEnd(10)} ${s.project}/${s.ref}  ${s.title}`);
      process.exit(0);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
  }

  if (cmd === "projects" && sub === "new") {
    const title = rest.slice(2).join(" ") || String(flags.title || "");
    if (!title) {
      console.error("projects new \"My Talk\"");
      process.exit(1);
    }
    try {
      jsonOut(await createProject(title, flags.slug ? String(flags.slug) : undefined));
      process.exit(0);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
  }

  if (cmd === "install" && sub === "app") {
    try {
      const dest = await installAppFromWeb();
      console.log(`installed → ${dest}`);
      process.exit(0);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
  }

  if (cmd === "skills" && sub === "compile") {
    process.exit(sh("bun", ["run", join(PROJECT, "scripts/compile-skills.ts")], PROJECT));
  }

  if (cmd === "skills" && sub === "install") {
    if (!existsSync(join(PROJECT, "skill", "dist", "registry.json"))) {
      sh("bun", ["run", join(PROJECT, "scripts/compile-skills.ts")], PROJECT);
    }
    const dest = flags.user ? userCursorSkillPath() : defaultCursorSkillPath(PROJECT);
    installSkills(dest);
    console.log(`skills → ${dest}`);
    process.exit(0);
  }

  if (cmd === "skills" && sub === "prompt") {
    const deck = (flags.deck as string) || "showcase";
    console.log(readAgentPrompt({ deck, projectRoot: PROJECT }));
    process.exit(0);
  }

  if (cmd === "skills" && sub === "list") {
    const regPath = join(PROJECT, "skill", "dist", "registry.json");
    const srcPath = join(PROJECT, "skill", "manifest.json");
    const path = existsSync(regPath) ? regPath : srcPath;
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (flags.json) jsonOut(data);
    else {
      console.log(`registry ${data.contentHash ?? "source"} · ${data.compiledAt ?? "manifest"}`);
      for (const v of data.verbIndex ?? []) {
        console.log(`  ${v.verbs.join(", ")} → ${v.reference}`);
      }
    }
    process.exit(0);
  }

  if (cmd === "decks") {
    if (sub === "list") {
      cmdDecksList();
      process.exit(0);
    }
    if (sub === "get") process.exit(cmdDecksGet(third, Boolean(flags.json)));
    if (sub === "new") process.exit(cmdDecksNew(rest.slice(2).join(" ") || "Untitled deck"));
    if (sub === "validate") process.exit(cmdDecksValidate(third));
    if (sub === "slide" && third === "add") process.exit(cmdDecksSlideAdd(fourth, flags));
    if (sub === "slide" && third === "move") process.exit(cmdDecksSlideMove(fourth, fifth, Number(flags.to || 0)));
    if (sub === "script" && third === "add") process.exit(cmdDecksScriptAdd(fourth, flags));
    if (sub === "script" && third === "run") process.exit(await cmdDecksScriptRun(fourth, flags));
  }

  if (cmd === "takes") {
    if (sub === "list") process.exit(await cmdTakesList(Boolean(flags.json)));
    if (sub === "get") process.exit(await cmdTakesGet(third, Boolean(flags.json)));
    if (sub === "events") process.exit(cmdTakesEvents(third, Boolean(flags.json)));
    if (sub === "render") process.exit(await cmdTakesRender(third, flags));
    if (sub === "edit") process.exit(cmdTakesEdit(third, fourth, flags.file ? String(flags.file) : undefined));
    if (sub === "hf" && third === "init") process.exit(cmdTakesHfInit(fourth));
    if (sub === "hf" && third === "render") process.exit(cmdTakesHfRender(fourth));
    if (sub === "transcribe" && third) {
      try {
        const model =
          flags.model
            ? String(flags.model)
            : flags.engine === "moonshine-base"
              ? "UsefulSensors/moonshine-base"
              : "UsefulSensors/moonshine-tiny";
        jsonOut(transcribeTake(third, model));
        writeWordCaptions(third);
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
  }

  if (cmd === "take") {
    if (sub === "hf" && third === "init") process.exit(cmdTakesHfInit(fourth));
    if (sub === "hf" && third === "render") process.exit(cmdTakesHfRender(fourth));
  }

  if (cmd === "open") process.exit(cmdOpen(sub, flags.deck ? String(flags.deck) : undefined));

  if (cmd === "stage") {
    if (sub === "open") process.exit(await cmdStageOpen(flags.deck ? String(flags.deck) : third));
    if (sub === "hide") process.exit(await cmdStageHide());
    if (sub === "load") process.exit(await cmdStageLoad(String(flags.deck || third || "")));
    if (sub === "status") process.exit(await cmdStageStatus(Boolean(flags.json)));
    if (sub === "surface") {
      const kind = String(flags.kind || "web");
      const ref = String(flags.ref || third || "");
      if (!ref) { console.error("stage surface --kind web --ref <url|slug|path> [--project <id>] [--title <t>]"); process.exit(1); }
      const r = await stageSurface(kind, ref, {
        project: flags.project ? String(flags.project) : undefined,
        title: flags.title ? String(flags.title) : undefined,
      });
      jsonOut(r);
      process.exit(r.ok ? 0 : 1);
    }
  }

  if (cmd === "plan") process.exit(cmdPlan(sub || "showcase"));
  if (cmd === "record") process.exit(cmdRecord());

  if (cmd === "auth") {
    if (sub === "login") process.exit(await authLogin());
    if (sub === "status") process.exit(await authStatus(Boolean(flags.json)));
    if (sub === "logout") {
      clearCredentials();
      console.log("signed out");
      process.exit(0);
    }
  }

  if (cmd === "youtube") {
    if (sub === "connect") process.exit(await youtubeConnect());
    if (sub === "disconnect") process.exit(await youtubeDisconnect());
    if (sub === "status") process.exit(await youtubeStatusCmd(Boolean(flags.json)));
    if (sub === "search") process.exit(await youtubeSearch(rest.slice(2).join(" ") || third || "", Boolean(flags.json)));
    if (sub === "proxy") process.exit(await youtubeProxy(String(flags.video || third || ""), String(flags.start || "0"), Boolean(flags.json)));
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h" || !cmd) {
    console.log(HELP);
    process.exit(0);
  }

  console.error(`unknown: ${cmd} ${sub || ""}\n`);
  console.log(HELP);
  process.exit(1);
} catch (e) {
  console.error(String(e));
  process.exit(1);
}
