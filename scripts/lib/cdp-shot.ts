// Deterministic headless-Chrome screenshots via CDP virtual time.
// The CLI `--screenshot --virtual-time-budget` path has idle-shortcut
// heuristics that blank out pages whose every animation is delayed (and it
// races <body>-parsed keep-alives). This drives the browser explicitly:
//   pause virtual time → navigate → grant EXACTLY `budgetMs` → screenshot.
// One long-lived browser serves the whole gate run (fast + hang-proof).

import { existsSync, writeFileSync } from "node:fs";

export interface ShotBrowser {
  shot: (fileUrl: string, png: string, budgetMs?: number) => Promise<boolean>;
  close: () => void;
}

export async function launchShotBrowser(chrome: string, width: number, height: number): Promise<ShotBrowser> {
  const proc = Bun.spawn(
    [chrome, ...(chrome.includes("headless-shell") ? [] : ["--headless=new"]),
     "--remote-debugging-port=0", "--no-first-run", "--disable-crash-reporter",
     `--window-size=${width},${height}`, "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"],
    { stderr: "pipe", stdout: "ignore" },
  );

  // ws endpoint is announced on stderr: "DevTools listening on ws://..."
  const wsUrl = await new Promise<string>(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("chrome devtools endpoint timeout")), 15_000);
    const reader = proc.stderr.getReader();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        reader.releaseLock();
        resolve(m[1]);
        return;
      }
    }
    reject(new Error("chrome exited before devtools endpoint"));
  });

  // browser-level connection
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map<number, (msg: any) => void>();
  const eventWaiters: { method: string; sessionId?: string; resolve: () => void }[] = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      for (let i = eventWaiters.length - 1; i >= 0; i--) {
        const w = eventWaiters[i];
        if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) {
          eventWaiters.splice(i, 1);
          w.resolve();
        }
      }
    }
  };
  const send = (method: string, params: any = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const waitEvent = (method: string, sessionId: string, timeoutMs: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting ${method}`)), timeoutMs);
      eventWaiters.push({ method, sessionId, resolve: () => { clearTimeout(timer); resolve(); } });
    });

  async function shot(fileUrl: string, png: string, budgetMs = 3000): Promise<boolean> {
    try {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      try {
        await send("Page.enable", {}, sessionId);
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
        // freeze the clock BEFORE the page exists, then spend the budget exactly
        await send("Emulation.setVirtualTimePolicy", { policy: "pause" }, sessionId);
        const nav = send("Page.navigate", { url: fileUrl }, sessionId);
        const loaded = waitEvent("Page.loadEventFired", sessionId, 15_000);
        await nav;
        await send("Emulation.setVirtualTimePolicy", { policy: "pauseIfNetworkFetchesPending", budget: budgetMs }, sessionId);
        await waitEvent("Emulation.virtualTimeBudgetExpired", sessionId, 20_000);
        await loaded.catch(() => {});
        const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(png, Buffer.from(data, "base64"));
        return existsSync(png);
      } finally {
        await send("Target.closeTarget", { targetId }).catch(() => {});
      }
    } catch (e) {
      console.error(`cdp-shot: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  return {
    shot,
    close: () => {
      try { ws.close(); } catch {}
      try { proc.kill("SIGKILL"); } catch {}
    },
  };
}
