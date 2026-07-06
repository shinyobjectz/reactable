import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = resolve(HERE, "..", "..");
export const CLI = resolve(PROJECT, "cli");
export const NEXUS =
  process.env.NEXUS || resolve(PROJECT, "..", "..", "..", "workbooks", "nexus");
export const PORT = process.env.PORT || "4020";
export const SKILL_SRC = resolve(PROJECT, "skill");

export function decksDir(root = PROJECT) {
  return resolve(root, "decks");
}

export function takesDir(root = PROJECT) {
  return resolve(root, "takes");
}

export function deckPath(slug: string, root = PROJECT) {
  return resolve(decksDir(root), slug, "deck.work");
}

export function takePath(id: string, root = PROJECT) {
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
