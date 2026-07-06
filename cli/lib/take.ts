import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apiBase, takePath, takesDir } from "./paths.ts";

export type TakeSummary = {
  id: string;
  deck?: string;
  source_kind?: string;
  recorded_at?: string;
};

export function listTakeIds(root?: string): string[] {
  const dir = takesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith("take-"))
    .sort()
    .reverse();
}

export function readTakeManifest(id: string, root?: string) {
  const p = join(takePath(id, root), "manifest.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

export function readEvents(id: string, root?: string) {
  const p = join(takePath(id, root), "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function fetchTake(id: string, port?: string) {
  const res = await fetch(`${apiBase(port)}/reactable/takes/${id}`);
  return res.json();
}

export async function fetchTakes(port?: string) {
  const res = await fetch(`${apiBase(port)}/reactable/takes`);
  return res.json();
}

export async function renderTake(id: string, port?: string, aspects?: string[]) {
  const res = await fetch(`${apiBase(port)}/reactable/takes/${id}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ aspects: aspects || ["16:9", "9:16", "1:1"] }),
  });
  return res.json();
}

export function eventSummary(events: { type: string; t?: number }[]) {
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  return { total: events.length, byType };
}
