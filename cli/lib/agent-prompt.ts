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

export function buildAgentPrompt(opts: PromptOpts = {}) {
  const deck = opts.deck || "showcase";
  const manifest = loadManifest();
  const pkg = manifest?.package ?? {};
  const related = (manifest?.relatedSkills as { name: string; install: string }[]) ?? [];

  const relatedBlock = related.length
    ? related.map((r) => `  ${r.name}: ${r.install}`).join("\n")
    : "  npx hyperframes init";

  return `You are working with **Reactable** — native macOS stage recorder + agent CLI for deck authoring and video post.

## Install (pick your agent host)

**CLI + skills (recommended):**
\`\`\`bash
npm i -g reactable-cli
reactable doctor
reactable skills install --user
reactable install app          # macOS — downloads Reactable.app
\`\`\`

**skills.sh (when published):**
\`\`\`bash
npx skills add ${pkg.owner ?? "shinyobjectz"}/${pkg.repo ?? "reactable"} --copy -y -a cursor -a claude-code
\`\`\`

**Related motion skills:**
\`\`\`bash
${relatedBlock}
\`\`\`

## Hard rules

1. Preview decks with \`reactable stage open --deck <slug>\` — never a browser tab.
2. Decks are \`decks/<slug>/deck.work\` (\`slide do\`, \`script do\`, \`client :unit\`).
3. Nexus is local only — \`:4020\`, not the studio server.

## Quick start (deck: ${deck})

\`\`\`bash
reactable decks get ${deck} --json
reactable stage open --deck ${deck}
reactable plan ${deck}
reactable takes list
\`\`\`

## Progressive disclosure

Load \`reactable\` skill references by verb:
- decks / plan → verbs/decks.md
- stage / record → verbs/stage.md
- takes render → verbs/post-ffmpeg.md
- takes hf → verbs/post-hyperframes.md (+ hyperframes, gsap skills)
- youtube → verbs/youtube.md

Skill root after install: \`~/.cursor/skills/reactable/\` or \`.cursor/skills/reactable/\`

Docs: ${pkg.download?.replace("/download/Reactable.dmg", "") ?? "https://reactable.app"}
`;
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
