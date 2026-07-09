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
import { cleanVoice, installDeepFilter } from "../lib/voice.ts";
import { ttsSpeak, ttsDoctor } from "../lib/tts.ts";
import { agentChat, agentStatus, agentLlmProbe, createProject } from "../lib/agent.ts";
import { minimaxChat, minimaxKey } from "../lib/minimax.ts";
import { CONNECTORS, connectorStatus, setConnector } from "../lib/connectors.ts";
import * as intel from "../lib/intel.ts";
import * as video from "../lib/video.ts";
import { compose, composeBehind, zRender, motionPlan, renderMatte } from "../lib/matte.ts";
import { autoEdit } from "../lib/autoedit.ts";
import { captureEpisode, editIntelStats } from "../lib/edit-intel.ts";
import { decompile, writeSkeleton } from "../lib/decompile.ts";
import { synthBatch } from "../lib/synth.ts";
import { baselineRun } from "../lib/baseline.ts";
import { exportDataset } from "../lib/dataset.ts";
import { analyzeAudio } from "../lib/audio.ts";
import { procure } from "../lib/procure.ts";
import { getProject, listSurfaces, listResearch, addResearch } from "../lib/surface.ts";
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
  tools install deep-filter     DeepFilterNet3 voice denoiser → ~/.reactable/tools
  tools build                   build dist/reactable-tools (Rust)

  har capture <url> [--project] cache page refs under .reactable/har/
  har list [--project] [--json]
  har replay --ref <id>         Blitz replay via nexus (requires serve)

  takes transcribe <id> [--model UsefulSensors/moonshine-tiny]
  edit remove-filler <id> [--aggressive]
  edit trim-silence <id>
  edit captions <id>              word-level WEBVTT from transcript
  edit clean-voice <id> [--aggressive]  ML denoise mic → mic-clean.wav (DeepFilterNet3)

  tts speak --text "<script>" -o <wav> [--voice af_heart]
  tts doctor [--json]             moonshine + kokoro via Rust MLX sidecar

  agent chat "<message>" [--provider minimax|gemma] [--model <id>] [--json]
  connect [list]                    BYO connector slots (pexels, unsplash, …)
  connect <id> --key <key>          save a connector key locally
  agent status [--json]           local Gemma MLX via reactable-tools
  projects new "<title>" [--slug]   scaffold under ~/Reactable/projects/
  projects board [--json]           pipeline kanban (shared with the app)
  projects stage <id> <column>      move a project through the pipeline
  project [<id>] [--json]           project aggregate: research · decks · takes · surfaces
  surfaces [--project <id>] [--json]  flat Surface list (all projects if unscoped)
  research list [--project <id>] [--json]
  research add "<title>" [--url <u>] [--note <n>] [--project <id>]

  decks list
  decks get <slug> [--json]
  decks new <title>
  decks validate <slug>
  decks slide add <slug> --id <id> --type <type> [--url|--body|--src ...]
  decks slide move <slug> <id> --to <index>
  decks script add <slug> --on <trigger> --run "<cmd>" [--slide <id>] [--at <sec>] [--detach]
  decks script run <slug> --on <trigger> [--slide <id>]

  video index <take-id|path> [--tier t0|t1]   build <asset>.intel/ sidecar
  video find "<query>" --in <ref> [--json]    text → timecodes (transcript·ocr·captions·tracks)
  video at <ref> <ms|mm:ss> [--json]          everything known at that moment
  video tracks <ref> [--concept "…"] [--json] tracklets from concept passes
  video pass <ref> <sam31|depth> --concept "…" [--estimate|--run]  GPU pass (Modal L4)
  video matte <ref> <track-id> [--apply]      luma matte + RGBA cutout from track masks
  video motion <ref> <track-id> [--style punch-in|follow]  keyframed transform plan
  video compose <ref> <track-id> [--bg <path|gradient>] [--out <mp4>]  finished render: cutout + bg-swap + fg punch-in
  video stabilize <ref> [--out <mp4>] [--shakiness 1-10] [--smoothing N]  two-pass vidstab (targets shaky shots from the motion pass)
  video similar <ref> <shot-id|ms> [--k N]    find clips like this one (MobileViCLIP semantic similarity — run 'pass <ref> mvc' first)
  video autoedit <take-id> [--render]         authored edit from ground-truth events: cursor punch-ins + silence trims
  video audio <ref>                           audio understanding: kind (speech/silence/sound) · onsets/tempo · turns
  video decompile <ref> [--verify]            reverse a clip → abstract edit skeleton (structure kept, content stripped)
  edit-intel [stats]                          the training flywheel: corpus of edits (specs + renders + scores)
  synth pairs [--n N] [--seed S]              Engine A: synthetic (video↔timeline) pairs + round-trip fidelity
  baseline <ref> [--k N]                      frozen-base go/no-go: can an off-the-shelf model emit a valid edit-skeleton?
  dataset export [--val F]                    corpus → SFT jsonl (train: modal run gpu/modal_train.py [--run])
  procure "<brand>" [--library fb|tiktok] [--n N] | --url <u>   real clips → skeletons → corpus (content-stripped)
  video sweep [--json]                        index everything un-indexed (takes/ + assets/)

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
    if (sub === "install" && third === "deep-filter") {
      try {
        console.log(`→ ${installDeepFilter()}`);
        process.exit(0);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    }
    console.error("tools: doctor | build | install hyperframes | install deep-filter");
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
    if (sub === "clean-voice" && third) {
      try {
        jsonOut(cleanVoice(third, { aggressive: Boolean(flags.aggressive) }));
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

  if (cmd === "intel") {
    const j = flags.json === true;
    const out = (v: unknown) => console.log(j ? JSON.stringify(v, null, 2) : typeof v === "string" ? v : JSON.stringify(v, null, 2));
    if (sub === "track") {
      const kind = third === "competitor" ? "competitor" : "topic";
      const q = rest.slice(kind === "topic" && third === "topic" ? 3 : 3).join(" ") || String(fourth || "");
      if (!q) { console.error('usage: reactable intel track topic|competitor "<q>" [--platforms a,b]'); process.exit(1); }
      const platforms = String(flags.platforms || flags.platform || "").split(",").filter(Boolean);
      out(intel.track(kind as any, q, platforms));
      process.exit(0);
    }
    if (sub === "untrack") { out(intel.untrack(String(third || ""))); process.exit(0); }
    if (sub === "list") { out({ topics: intel.topics().map(({series, ...t}) => t), competitors: intel.competitors() }); process.exit(0); }
    if (sub === "snapshot") { out(await intel.snapshot(Number(flags.budget || 40), flags.force === true)); process.exit(0); }
    if (sub === "trends") { out(flags.commons === true ? await intel.trendsMerged() : intel.trends()); process.exit(0); }
    if (sub === "breakouts") { out(intel.breakouts()); process.exit(0); }
    if (sub === "radar") {
      const q = rest.slice(2).filter((x) => !x.startsWith("-")).join(" ");
      if (!q) { console.error('usage: reactable intel radar "<topic>" [--platform youtube|tiktok]'); process.exit(1); }
      out(await intel.radar(q, String(flags.platform || "youtube")));
      process.exit(0);
    }
    if (sub === "ads") {
      const q = rest.slice(2).filter((x) => !x.startsWith("-")).join(" ");
      if (!q) { console.error('usage: reactable intel ads "<company>" [--library facebook|tiktok]'); process.exit(1); }
      out(await intel.ads(q, String(flags.library || "facebook")));
      process.exit(0);
    }
    if (sub === "deconstruct") {
      const url = String(third || "");
      if (!url.startsWith("http")) { console.error("usage: reactable intel deconstruct <video-url>"); process.exit(1); }
      out(await intel.deconstruct(url));
      process.exit(0);
    }
    if (sub === "brief") { out(intel.brief()); process.exit(0); }
    console.error("intel verbs: track · untrack · list · snapshot · trends · breakouts · radar · ads · deconstruct · brief");
    process.exit(1);
  }

  if (cmd === "video") {
    const j = flags.json === true;
    const out = (v: unknown) => console.log(j ? JSON.stringify(v) : JSON.stringify(v, null, 2));
    const parseMs = (s: string): number => {
      if (/^\d+$/.test(s)) return Number(s);
      const parts = s.split(":").map(Number);
      if (parts.some(Number.isNaN)) throw new Error(`bad time "${s}" — ms or [hh:]mm:ss[.ms]`);
      let sec = 0;
      for (const p of parts) sec = sec * 60 + p;
      return Math.round(sec * 1000);
    };
    if (sub === "index") {
      const ref = video.resolveRef(String(third || ""));
      const tier = String(flags.tier || "t0");
      const idx = video.indexT0(ref);
      let t1: any = null;
      if (tier === "t1") t1 = video.indexT1(ref);
      out({
        ...(t1 ? { t1 } : {}),
        sidecar: video.sidecarDir(ref.media),
        duration_ms: idx.probe.duration_ms,
        shots: idx.shots.length,
        transcript: idx.transcript ? `${idx.transcript.model} (${idx.transcript.words.length} words, ${idx.transcript.timing})` : null,
        ocr_frames: idx.ocr.length,
        events: idx.events?.source ?? null,
      });
      process.exit(0);
    }
    if (sub === "find") {
      const q = rest.slice(2).filter((x) => !x.startsWith("-")).join(" ");
      const inRef = String(flags.in || "");
      if (!q || !inRef) { console.error('usage: reactable video find "<query>" --in <take-id|path>'); process.exit(1); }
      out(video.find(video.resolveRef(inRef), q));
      process.exit(0);
    }
    if (sub === "at") {
      if (!third || !fourth) { console.error("usage: reactable video at <ref> <ms|mm:ss>"); process.exit(1); }
      out(video.at(video.resolveRef(String(third)), parseMs(String(fourth))));
      process.exit(0);
    }
    if (sub === "tracks") {
      if (!third) { console.error("usage: reactable video tracks <ref> [--concept \"…\"]"); process.exit(1); }
      const ref = video.resolveRef(String(third));
      video.readIndex(ref);
      const concept = String(flags.concept || "").toLowerCase();
      const tracks = video.readTracks(ref).filter((t) => !concept || t.concept?.toLowerCase().includes(concept));
      out({ tracks, note: tracks.length ? undefined : "no tracklets — queue one: reactable video pass <ref> sam31 --concept \"…\"" });
      process.exit(0);
    }
    if (sub === "sweep") {
      out(video.sweep());
      process.exit(0);
    }
    if (sub === "matte") {
      if (!third || !fourth) { console.error("usage: reactable video matte <ref> <track-id> [--apply]"); process.exit(1); }
      out(renderMatte(video.resolveRef(String(third)), String(fourth), { apply: flags.apply === true }));
      process.exit(0);
    }
    if (sub === "motion") {
      if (!third || !fourth) { console.error("usage: reactable video motion <ref> <track-id> [--style punch-in|follow]"); process.exit(1); }
      out(motionPlan(video.resolveRef(String(third)), String(fourth), { style: flags.style ? String(flags.style) : undefined }));
      process.exit(0);
    }
    if (sub === "similar") {
      if (!third || !fourth) { console.error("usage: reactable video similar <ref> <shot-id|ms> [--k N]  (needs: video pass <ref> mvc --run)"); process.exit(1); }
      out(video.similar(video.resolveRef(String(third)), String(fourth), { k: flags.k ? Number(flags.k) : undefined }));
      process.exit(0);
    }
    if (sub === "zrender") {
      if (!third || !fourth) { console.error("usage: reactable video zrender <ref> <spec.json>  (spec: {inserts:[{z,text|image,pos,fontSize,color}]})"); process.exit(1); }
      const spec = JSON.parse(readFileSync(String(fourth), "utf8"));
      out(zRender(video.resolveRef(String(third)), spec));
      process.exit(0);
    }
    if (sub === "matte-hq") {
      if (!third) { console.error("usage: reactable video matte-hq <ref> [--fps N]  (BiRefNet production matte → sidecar; every frame by default)"); process.exit(1); }
      out(video.matteHq(video.resolveRef(String(third)), { fps: flags.fps ? Number(flags.fps) : undefined }));
      process.exit(0);
    }
    if (sub === "behind") {
      if (!third) { console.error("usage: reactable video behind <ref> [track-id|people] --text \"…\"|--image <path> [--pos center|lower-third|upper-third] [--font-size N] [--color white] [--depth off] [--out <mp4>]  (depth-aware: occluded by the subjects + anything nearer)"); process.exit(1); }
      // track arg optional — a bare 4th token that isn't a flag names a track; else "people"
      const trackArg = (fourth && !String(fourth).startsWith("--")) ? String(fourth) : "people";
      out(composeBehind(video.resolveRef(String(third)), trackArg, {
        text: flags.text ? String(flags.text) : undefined,
        image: flags.image ? String(flags.image) : undefined,
        pos: flags.pos ? String(flags.pos) : undefined,
        fontSize: flags["font-size"] ? Number(flags["font-size"]) : undefined,
        color: flags.color ? String(flags.color) : undefined,
        depth: flags.depth ? String(flags.depth) : undefined,
        out: flags.out ? String(flags.out) : undefined,
      }));
      process.exit(0);
    }
    if (sub === "stabilize") {
      if (!third) { console.error("usage: reactable video stabilize <ref> [--out <mp4>] [--shakiness 1-10] [--smoothing N]"); process.exit(1); }
      out(video.stabilize(video.resolveRef(String(third)), {
        out: flags.out ? String(flags.out) : undefined,
        shakiness: flags.shakiness ? Number(flags.shakiness) : undefined,
        smoothing: flags.smoothing ? Number(flags.smoothing) : undefined,
      }));
      process.exit(0);
    }
    if (sub === "compose") {
      if (!third || !fourth) { console.error("usage: reactable video compose <ref> <track-id> [--bg <path|gradient>] [--out <mp4>]"); process.exit(1); }
      const cref = video.resolveRef(String(third));
      const composed = compose(cref, String(fourth), {
        bg: flags.bg ? String(flags.bg) : undefined,
        out: flags.out ? String(flags.out) : undefined,
      });
      captureEpisode({
        source: "compose",
        take: cref.take ?? null,
        media: cref.media,
        sidecar: join(video.sidecarDir(cref.media), "index.json"),
        editSpec: composed,
        render: composed.render ?? null,
        summary: `compose: track ${composed.track} (${composed.concept}) onto ${composed.background}${composed.foreground_window ? " + fg punch-in" : ""}`,
        label: "gold",
      });
      out(composed);
      process.exit(0);
    }
    if (sub === "autoedit") {
      if (!third) { console.error("usage: reactable video autoedit <take-id> [--render]"); process.exit(1); }
      const plan = autoEdit(String(third), { render: flags.render === true });
      const stage = join(takePath(String(third)), "stage.mov");
      captureEpisode({
        source: "autoedit",
        take: String(third),
        media: existsSync(stage) ? stage : null,
        sidecar: join(video.sidecarDir(stage), "index.json"),
        editSpec: plan,
        render: (plan as any).render ?? null,
        summary: `autoedit: ${plan.punches?.length ?? 0} punch-ins, trimmed ${plan.trimmed_ms ?? 0}ms, ${plan.chapters?.length ?? 0} chapters`,
        label: "gold",
      });
      out(plan);
      process.exit(0);
    }
    if (sub === "audio") {
      if (!third) { console.error("usage: reactable video audio <ref>   (audio-kind · onsets/tempo · speech turns → sidecar)"); process.exit(1); }
      out(analyzeAudio(video.resolveRef(String(third))));
      process.exit(0);
    }
    if (sub === "decompile") {
      if (!third) { console.error("usage: reactable video decompile <ref> [--verify]   (→ edit skeleton, structure kept / content stripped)"); process.exit(1); }
      const dref = video.resolveRef(String(third));
      const skel = decompile(dref, { verify: flags.verify === true });
      const p = writeSkeleton(dref, skel);
      out({ ...skel, skeleton: p });
      process.exit(0);
    }
    if (sub === "pass") {
      if (!third || !fourth) { console.error("usage: reactable video pass <ref> <sam31|depth|matte> [--box \"x,y,w,h\" --label \"…\"] [--sample-fps N] [--max-frames N] [--run|--estimate]"); process.exit(1); }
      const ref = video.resolveRef(String(third));
      if (flags.estimate === true) { out(video.estimatePass(ref, String(fourth))); process.exit(0); }
      const params: Record<string, unknown> = {};
      // sam31 tracking = EdgeTAM box-prompt (box the subject on the first frame)
      if (flags.box) params.box = String(flags.box);
      if (flags.label) params.label = String(flags.label);
      if (flags.concept) params.concept = String(flags.concept); // legacy alias → label
      if (flags["sample-fps"]) params["sample-fps"] = String(flags["sample-fps"]);
      if (flags["max-frames"]) params["max-frames"] = String(flags["max-frames"]);
      out(video.requestPass(ref, String(fourth), params, flags.run === true));
      process.exit(0);
    }
    console.error("video verbs: index · find · at · tracks · pass · matte · motion · compose · autoedit · audio · decompile · sweep   (footage intel — docs/PLAN.footage-intel.work)");
    process.exit(1);
  }

  if (cmd === "edit-intel") {
    const emit = (v: unknown) => console.log(Boolean(flags.json) ? JSON.stringify(v) : JSON.stringify(v, null, 2));
    if (!sub || sub === "stats") {
      emit(editIntelStats());
      process.exit(0);
    }
    console.error("edit-intel verbs: stats   (the training flywheel — docs/PLAN.omni-editing-model.work)");
    process.exit(1);
  }

  if (cmd === "synth") {
    const emit = (v: unknown) => console.log(Boolean(flags.json) ? JSON.stringify(v) : JSON.stringify(v, null, 2));
    if (!sub || sub === "pairs") {
      emit(synthBatch(flags.seed ? Number(flags.seed) : 1, flags.n ? Number(flags.n) : 3));
      process.exit(0);
    }
    console.error("synth verbs: pairs [--n N] [--seed S]   (Engine A — synthetic (video↔timeline) training pairs)");
    process.exit(1);
  }

  if (cmd === "procure") {
    const report = await procure({
      url: flags.url ? String(flags.url) : undefined,
      query: !flags.url ? (sub ? String(sub) : flags.query ? String(flags.query) : undefined) : undefined,
      library: flags.library ? String(flags.library) : undefined,
      n: flags.n ? Number(flags.n) : undefined,
    });
    console.log(Boolean(flags.json) ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    process.exit(0);
  }

  if (cmd === "dataset") {
    const emit = (v: unknown) => console.log(Boolean(flags.json) ? JSON.stringify(v) : JSON.stringify(v, null, 2));
    if (!sub || sub === "export") {
      emit(exportDataset({ valFrac: flags.val ? Number(flags.val) : undefined }));
      process.exit(0);
    }
    console.error("dataset verbs: export [--val F]   (corpus → SFT jsonl; then train: modal run gpu/modal_train.py)");
    process.exit(1);
  }

  if (cmd === "baseline") {
    if (!sub) { console.error("usage: reactable baseline <ref> [--k N] [--model <id>]   (frozen-base go/no-go — §9-P3)"); process.exit(1); }
    const report = await baselineRun(video.resolveRef(String(sub)), { k: flags.k ? Number(flags.k) : 3, model: flags.model ? String(flags.model) : undefined });
    console.log(Boolean(flags.json) ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    process.exit(0);
  }

  if (cmd === "connect") {
    if (!sub || sub === "list") {
      for (const c of connectorStatus()) {
        console.log(`${c.connected ? "✓" : "○"} ${c.id.padEnd(12)} ${c.name}${c.connected ? "" : `  → get a key: ${c.signup}`}`);
      }
      process.exit(0);
    }
    const key = String(flags.key || "");
    if (!key) {
      console.error(`connect ${sub} --key <api-key>   (signup: ${CONNECTORS[sub]?.signup ?? "?"})`);
      process.exit(1);
    }
    try {
      console.log(`→ ${setConnector(sub, key)}`);
      process.exit(0);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
  }

  if (cmd === "agent" && sub === "chat" && (flags.provider === "minimax" || (!flags.provider && minimaxKey()))) {
    const msg = rest.slice(2).join(" ");
    const r = await minimaxChat(msg, { model: flags.model ? String(flags.model) : undefined });
    if (flags.json) jsonOut(r);
    else if (r.ok) console.log(`[${r.model} · ${r.ms}ms]\n${r.reply}`);
    else console.error(`minimax: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
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

  if (cmd === "research") {
    try {
      if (sub === "list") {
        const items = await listResearch(flags.project ? String(flags.project) : undefined);
        if (flags.json) jsonOut({ ok: true, research: items });
        else for (const r of items) console.log(`${r.id.padEnd(28)} ${r.title}`);
        process.exit(0);
      }
      if (sub === "add") {
        const title = rest.slice(2).join(" ") || String(flags.title || "");
        if (!title) { console.error('research add "<title>" [--url <u>] [--note <n>] [--project <id>]'); process.exit(1); }
        const r = await addResearch(title, {
          url: flags.url ? String(flags.url) : undefined,
          note: flags.note ? String(flags.note) : undefined,
          project: flags.project ? String(flags.project) : undefined,
        });
        jsonOut(r);
        process.exit(r.ok ? 0 : 1);
      }
      console.error("research: list | add");
      process.exit(1);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
  }

  if (cmd === "projects" && (sub === "board" || sub === "stage")) {
    const { homedir } = await import("node:os");
    const file = join(homedir(), "Reactable", "pipeline.json");
    const board = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : { columns: ["idea", "recording", "editing", "done"], stages: {} };
    if (sub === "board") {
      if (flags.json) jsonOut(board);
      else {
        for (const col of board.columns) {
          const ids = Object.entries(board.stages)
            .filter(([, st]) => st === col)
            .map(([id]) => id);
          console.log(`${col.toUpperCase().padEnd(12)} ${ids.join(", ")}`);
        }
      }
      process.exit(0);
    }
    // projects stage <id> <column>
    const id = third;
    const stage = fourth;
    if (!id || !stage) {
      console.error("projects stage <project-id> <column>");
      process.exit(1);
    }
    if (!board.columns.includes(stage)) board.columns.push(stage);
    board.stages[id] = stage;
    writeFileSync(file, JSON.stringify(board, null, 2) + "\n");
    console.log(`${id} → ${stage}`);
    process.exit(0);
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
