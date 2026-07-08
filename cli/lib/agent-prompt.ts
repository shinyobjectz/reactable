import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT, SKILL_SRC } from "./paths.ts";

type PromptOpts = {
  deck?: string;
  projectRoot?: string;
};

function loadManifest() {
  const compiled = join(SKILL_SRC, "dist", "registry.json");
  const src = join(SKILL_SRC, "manifest.json");
  const path = existsSync(compiled) ? compiled : src;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

// The in-app agent prompt is authored in skill/AGENT.md (the source of
// truth); this function only appends the verb router from the manifest.
// The old install-oriented onboarding text lives on in skill/SKILL.md for
// external agent hosts — it has no place in the in-app brain.
export function buildAgentPrompt(opts: PromptOpts = {}) {
  const manifest = loadManifest();
  const agentDoc = join(SKILL_SRC, "AGENT.md");
  const base = existsSync(agentDoc)
    ? readFileSync(agentDoc, "utf8")
    : "You are the Reactable studio agent. Help author decks, run the reactable CLI, and plan videos.";

  const verbIndex = (manifest?.verbIndex as { verbs: string[]; reference: string }[]) ?? [];
  const routerBlock = verbIndex.length
    ? `\n## Deeper references (read_file when needed)\n\n${verbIndex
        .map((v) => `- ${v.verbs.join(", ")} → skill/${v.reference}`)
        .join("\n")}\n`
    : "";

  return base + routerBlock;
}

export function agentPromptPath(root = PROJECT) {
  const compiled = join(root, "skill", "dist", "agent-prompt.txt");
  if (existsSync(compiled)) return compiled;
  return null;
}

export function readAgentPrompt(opts: PromptOpts = {}) {
  const path = agentPromptPath(opts.projectRoot);
  if (path) return readFileSync(path, "utf8");
  return buildAgentPrompt(opts);
}
