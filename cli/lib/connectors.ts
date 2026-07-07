import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// BYO connector slots — free: bring your own key, we link to where to get it.
// Keys live in ~/.reactable/connectors.json, never in projects or the gateway.

export const CONNECTORS: Record<string, { name: string; signup: string }> = {
  pexels: { name: "Pexels (stock photo/video)", signup: "https://www.pexels.com/api/" },
  unsplash: { name: "Unsplash (stock photo)", signup: "https://unsplash.com/developers" },
  elevenlabs: { name: "ElevenLabs (voice)", signup: "https://elevenlabs.io/app/settings/api-keys" },
  fal: { name: "FAL (gen media)", signup: "https://fal.ai/dashboard/keys" },
  higgsfield: { name: "Higgsfield (video gen)", signup: "https://higgsfield.ai" },
};

const FILE = join(homedir(), ".reactable", "connectors.json");

export function readConnectors(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function setConnector(id: string, key: string) {
  if (!CONNECTORS[id]) throw new Error(`unknown connector: ${id} (${Object.keys(CONNECTORS).join(", ")})`);
  mkdirSync(join(homedir(), ".reactable"), { recursive: true });
  const all = readConnectors();
  all[id] = key;
  writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n");
  return FILE;
}

export function connectorStatus() {
  const saved = readConnectors();
  return Object.entries(CONNECTORS).map(([id, c]) => ({
    id,
    name: c.name,
    connected: Boolean(saved[id]),
    signup: c.signup,
  }));
}
