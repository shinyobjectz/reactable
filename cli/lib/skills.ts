import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SKILL_SRC } from "./paths.ts";

export function installSkills(target: string) {
  if (!existsSync(SKILL_SRC)) throw new Error(`skill source missing: ${SKILL_SRC}`);
  mkdirSync(target, { recursive: true });
  const copy = (rel: string) => {
    const src = join(SKILL_SRC, rel);
    const dst = join(target, rel);
    if (!existsSync(src)) return;
    mkdirSync(join(dst, ".."), { recursive: true });
    cpSync(src, dst, { recursive: true });
  };
  copy("SKILL.md");
  const refs = join(SKILL_SRC, "references");
  if (existsSync(refs)) {
    for (const f of readdirSync(refs)) copy(join("references", f));
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
