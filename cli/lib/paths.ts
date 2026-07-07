import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = resolve(HERE, "..", "..");
export const CLI = resolve(PROJECT, "cli");

// Data root for decks/takes. Honors WB_DATA (the sandbox project root nexus
// sets) so `reactable decks …` run by the agent operate on the ACTIVE project,
// not the installed CLI's repo. Falls back to the repo when WB_DATA is unset
// or not a reactable project. Tooling paths (NEXUS, SKILL_SRC) are unaffected.
export const DATA_ROOT = (() => {
  const env = process.env.WB_DATA;
  if (env && existsSync(resolve(env, "index.work"))) return resolve(env);
  return PROJECT;
})();
export const NEXUS =
  process.env.NEXUS || resolve(PROJECT, "..", "..", "..", "workbooks", "nexus");
export const PORT = process.env.PORT || "4020";
export const SKILL_SRC = resolve(PROJECT, "skill");

export function decksDir(root = DATA_ROOT) {
  return resolve(root, "decks");
}

export function takesDir(root = DATA_ROOT) {
  return resolve(root, "takes");
}

export function deckPath(slug: string, root = DATA_ROOT) {
  return resolve(decksDir(root), slug, "deck.work");
}

export function takePath(id: string, root = DATA_ROOT) {
  return resolve(takesDir(root), id);
}

export function apiBase(port = PORT) {
  return `http://127.0.0.1:${port}`;
}

export function assertProject(root = PROJECT) {
  if (!existsSync(resolve(root, "index.work"))) {
    throw new Error(`not a reactable project: ${root}`);
  }
}
