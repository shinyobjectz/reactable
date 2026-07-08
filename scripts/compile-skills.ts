/**
 * Compile skill registry + agent prompt from skill/manifest.json (CI + local).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { buildAgentPrompt } from "../cli/lib/agent-prompt.ts";
import { PROJECT, SKILL_SRC } from "../cli/lib/paths.ts";

const MANIFEST = join(SKILL_SRC, "manifest.json");
const DIST = join(SKILL_SRC, "dist");
const BUNDLE = join(DIST, "bundle");

function sha256(paths: string[]) {
  const h = createHash("sha256");
  for (const p of paths.sort()) {
    if (!existsSync(p)) continue;
    h.update(readFileSync(p));
  }
  return h.digest("hex").slice(0, 16);
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) collectFiles(p, acc);
    else if (/\.(md|json)$/.test(name.name)) acc.push(p);
  }
  return acc;
}

function copySkillTree() {
  mkdirSync(BUNDLE, { recursive: true });
  const copyRel = (rel: string) => {
    const src = join(SKILL_SRC, rel);
    const dst = join(BUNDLE, rel);
    if (!existsSync(src)) return;
    mkdirSync(join(dst, ".."), { recursive: true });
    cpSync(src, dst, { recursive: true });
  };
  copyRel("SKILL.md");
  copyRel("AGENT.md");
  copyRel("manifest.json");
  for (const sub of ["references", "verbs", "connectors"]) {
    const dir = join(SKILL_SRC, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) copyRel(join(sub, f));
  }
}

function skillsShManifest(manifest: Record<string, unknown>, contentHash: string) {
  const pkg = manifest.package as Record<string, string>;
  const bundled = (manifest.bundled as { name: string; path: string; description: string }[]) || [];
  return {
    version: manifest.version,
    contentHash,
    publish: {
      owner: pkg.owner,
      repo: pkg.repo,
      baseUrl: pkg.skillsSh,
      install: `npx skills add ${pkg.owner}/${pkg.repo} --copy -y -a cursor -a claude-code -a claude`,
    },
    skills: bundled.map((b) => ({
      name: b.name,
      path: `skill/dist/bundle`,
      description: b.description,
    })),
    relatedInstall: ((manifest.relatedSkills as { name: string; install: string }[]) || []).map((r) => ({
      name: r.name,
      command: r.install,
    })),
  };
}

function main() {
  if (!existsSync(MANIFEST)) throw new Error(`missing ${MANIFEST}`);
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const sources = collectFiles(SKILL_SRC);
  const contentHash = sha256(sources);

  mkdirSync(DIST, { recursive: true });
  copySkillTree();

  const registry = {
    ...manifest,
    compiledAt: new Date().toISOString(),
    contentHash,
    verbIndex: manifest.verbIndex,
  };
  writeFileSync(join(DIST, "registry.json"), JSON.stringify(registry, null, 2));

  const skillsSh = skillsShManifest(manifest, contentHash);
  writeFileSync(join(DIST, "skills.sh.json"), JSON.stringify(skillsSh, null, 2));

  const prompt = buildAgentPrompt({ deck: "demo", projectRoot: PROJECT });
  writeFileSync(join(DIST, "agent-prompt.txt"), prompt);

  // Verb router index for progressive disclosure
  const verbLines = (manifest.verbIndex as { verbs: string[]; reference: string }[])
    .map((v) => `- **${v.verbs.join("`, `")}** → \`${v.reference}\``)
    .join("\n");
  writeFileSync(
    join(BUNDLE, "VERBS.md"),
    `# CLI verb index\n\nLoad the linked file when working that verb group.\n\n${verbLines}\n`,
  );

  console.log(`→ ${relative(PROJECT, DIST)}/`);
  console.log(`  registry.json (${contentHash})`);
  console.log(`  skills.sh.json`);
  console.log(`  agent-prompt.txt`);
  console.log(`  bundle/ (${readdirSync(BUNDLE).length} entries)`);
}

main();
