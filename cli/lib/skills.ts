import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SKILL_SRC } from "./paths.ts";

function skillSourceRoot() {
  const bundle = join(SKILL_SRC, "dist", "bundle");
  return existsSync(bundle) ? bundle : SKILL_SRC;
}

export function installSkills(target: string) {
  const src = skillSourceRoot();
  if (!existsSync(join(src, "SKILL.md"))) throw new Error(`skill source missing: ${src}`);
  mkdirSync(target, { recursive: true });
  const copy = (rel: string) => {
    const from = join(src, rel);
    const dst = join(target, rel);
    if (!existsSync(from)) return;
    mkdirSync(join(dst, ".."), { recursive: true });
    cpSync(from, dst, { recursive: true });
  };
  copy("SKILL.md");
  for (const sub of ["references", "verbs"]) {
    const dir = join(src, sub);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) copy(join(sub, f));
    }
  }
  // Registry for agents that read JSON
  const registry = join(SKILL_SRC, "dist", "registry.json");
  if (existsSync(registry)) {
    mkdirSync(join(target, "dist"), { recursive: true });
    cpSync(registry, join(target, "dist", "registry.json"));
  }
  return target;
}

export function defaultCursorSkillPath(projectRoot: string) {
  return join(projectRoot, ".cursor", "skills", "reactable");
}

export function userCursorSkillPath() {
  const home = process.env.HOME || "";
  return join(home, ".cursor", "skills", "reactable");
}
