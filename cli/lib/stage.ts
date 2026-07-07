import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { apiBase, PORT, PROJECT } from "./paths.ts";

export type StageLive = {
  deck?: string;
  visible?: boolean;
  projectId?: string;
  ts?: number;
};

export type StageStatus = {
  ok: boolean;
  live?: StageLive | null;
  pending?: { id: string; action: string; deck?: string } | null;
  error?: string;
};

async function stageFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${apiBase()}${path}`, init);
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: text };
  }
}

export async function stageStatus(): Promise<StageStatus> {
  return (await stageFetch("/reactable/stage")) as StageStatus;
}

export async function stageCommand(action: "open" | "hide" | "load", deck?: string) {
  const body: Record<string, string> = { action };
  if (deck) body.deck = deck;
  return stageFetch("/reactable/stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Open any Surface as a Stage tab. kind ∈ deck|web|doc|youtube. */
export async function stageSurface(kind: string, ref: string, opts: { project?: string; title?: string } = {}) {
  return stageFetch("/reactable/stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "surface", kind, ref, project: opts.project ?? "", title: opts.title ?? ref }),
  });
}

export function nativeBinaryPath() {
  return join(PROJECT, "native/.build/release/reactable");
}

export function launchNativeApp(): boolean {
  const bin = nativeBinaryPath();
  if (!existsSync(bin)) return false;
  const child = spawn(bin, [], {
    detached: true,
    stdio: "ignore",
    cwd: PROJECT,
  });
  child.unref();
  return true;
}

export async function waitForStageLive(opts: {
  deck?: string;
  visible?: boolean;
  timeoutMs?: number;
}): Promise<StageStatus> {
  const deadline = Date.now() + (opts.timeoutMs ?? 15000);
  while (Date.now() < deadline) {
    const st = await stageStatus();
    const live = st.live;
    if (live?.deck) {
      const deckOk = !opts.deck || live.deck === opts.deck;
      const visOk = opts.visible == null || live.visible === opts.visible;
      if (deckOk && visOk) return st;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return stageStatus();
}

export async function ensureNexusUp(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/reactable/health`);
    const j = await res.json();
    return j?.ok === true;
  } catch {
    return false;
  }
}

export async function stageOpen(deck: string, opts: { launch?: boolean } = {}) {
  if (!(await ensureNexusUp())) {
    return { ok: false, error: `nexus not running on :${PORT} — run: reactable serve or just reactable dev` };
  }

  const queued = await stageCommand("open", deck);
  if (!queued.ok) return queued;

  let st = await stageStatus();
  const fresh = st.live?.ts && Date.now() / 1000 - (st.live.ts ?? 0) < 5;

  if (!fresh && opts.launch !== false) {
    if (!launchNativeApp()) {
      return {
        ok: false,
        error: "native app not running — build with: just reactable build, then: just reactable dev",
        queued,
      };
    }
  }

  st = await waitForStageLive({ deck, visible: true, timeoutMs: 15000 });
  if (st.live?.deck === deck && st.live?.visible) {
    return { ok: true, deck, live: st.live, queued };
  }
  return {
    ok: false,
    error: "stage did not open in time — run: just reactable dev",
    live: st.live,
    queued,
  };
}
