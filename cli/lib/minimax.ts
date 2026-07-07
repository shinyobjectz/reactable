import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// MiniMax provider — the paid agent brain (local Gemma stays the free tier).
// Key: ~/.reactable/minimax.key · config: ~/.reactable/minimax.json

const DIR = join(homedir(), ".reactable");
const KEY_PATH = join(DIR, "minimax.key");
const CFG_PATH = join(DIR, "minimax.json");
// Newest first — first model the API accepts wins and is cached in config.
const MODEL_CANDIDATES = ["MiniMax-M3", "MiniMax-M2", "MiniMax-Text-01"];
const ENDPOINTS = [
  "https://api.minimax.io/v1/text/chatcompletion_v2",
  "https://api.minimaxi.com/v1/text/chatcompletion_v2",
];

export function minimaxKey(): string | null {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY.trim();
  if (existsSync(KEY_PATH)) return readFileSync(KEY_PATH, "utf8").trim();
  return null;
}

function cfg(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CFG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCfg(patch: Record<string, string>) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CFG_PATH, JSON.stringify({ ...cfg(), ...patch }, null, 2) + "\n");
}

export async function minimaxChat(
  message: string,
  opts: { model?: string; system?: string } = {},
): Promise<{ ok: boolean; reply?: string; model?: string; ms?: number; error?: string }> {
  const key = minimaxKey();
  if (!key) return { ok: false, error: `no MiniMax key — put it at ${KEY_PATH}` };

  const models = opts.model
    ? [opts.model]
    : cfg().model
      ? [cfg().model, ...MODEL_CANDIDATES.filter((m) => m !== cfg().model)]
      : MODEL_CANDIDATES;
  const endpoints = cfg().endpoint ? [cfg().endpoint] : ENDPOINTS;

  const messages = [
    {
      role: "system",
      name: "MM Intelligent Assistant",
      content:
        opts.system ??
        "You are the Reactable studio agent: concise, technical, video-production savvy.",
    },
    { role: "user", name: "user", content: message },
  ];

  let lastError = "";
  for (const endpoint of endpoints) {
    for (const model of models) {
      const t0 = Date.now();
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model, messages }),
        });
        const data = (await res.json()) as any;
        const reply = data?.choices?.[0]?.message?.content;
        if (res.ok && reply) {
          saveCfg({ model, endpoint });
          return { ok: true, reply, model, ms: Date.now() - t0 };
        }
        lastError = data?.base_resp?.status_msg || data?.error?.message || `HTTP ${res.status}`;
      } catch (e) {
        lastError = String(e);
      }
    }
  }
  return { ok: false, error: lastError };
}
