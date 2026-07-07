import { PROJECT } from "./paths.ts";
import { runTools } from "./tools.ts";

export type AgentMessage = { role: string; content: string };

export async function agentChat(message: string, opts: { deck?: string; history?: AgentMessage[]; maxTurns?: number } = {}) {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 4020}/reactable/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      deck: opts.deck ?? "demo",
      history: opts.history ?? [],
      max_turns: opts.maxTurns ?? 6,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "agent chat failed");
  return data;
}

export async function agentStatus() {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 4020}/reactable/agent/status`);
  return res.json();
}

export function agentLlmProbe() {
  const r = runTools(["agent-status"], PROJECT, true);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: r.stderr || r.stdout };
  }
}

export async function createProject(title: string, slug?: string) {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 4020}/reactable/projects/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, slug }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "create project failed");
  return data;
}
