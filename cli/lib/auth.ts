/**
 * Cloud account auth (reactable.app) — optional, for future Polar/subscription sync.
 * YouTube uses the same local OAuth as studio: ~/.shinyobjectz/youtube_client.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CRED_DIR = join(homedir(), ".reactable");
// Canonical credential file — the app's Settings panel reads the same one.
export const CRED_FILE = join(CRED_DIR, "auth.json");
const LEGACY_CRED_FILE = join(CRED_DIR, "credentials.json");

export type Credentials = {
  access_token: string;
  email: string;
  session_id: string;
  api_base: string;
  saved_at: string;
  plan?: string;
};

export function apiSite(): string {
  return process.env.REACTABLE_API?.replace(/\/$/, "") || "https://reactable.app";
}

export function loadCredentials(): Credentials | null {
  const path = existsSync(CRED_FILE) ? CRED_FILE : existsSync(LEGACY_CRED_FILE) ? LEGACY_CRED_FILE : null;
  if (!path) return null;
  try {
    const creds = JSON.parse(readFileSync(path, "utf8")) as Credentials;
    if (path === LEGACY_CRED_FILE && creds.access_token) saveCredentials(creds);
    return creds;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials) {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function clearCredentials() {
  for (const f of [CRED_FILE, LEGACY_CRED_FILE]) {
    if (existsSync(f)) writeFileSync(f, "{}");
  }
}

/** Device flow against reactable.app (when deployed). YouTube stays local. */
export async function authLogin(): Promise<number> {
  const base = apiSite();
  const start = await fetch(`${base}/api/auth/cli/start`, { method: "POST" });
  const body = (await start.json()) as Record<string, string | number | boolean>;
  if (!start.ok || !body.ok) {
    console.error("auth start failed:", body.error || start.statusText);
    console.error("Tip: YouTube does not need cloud auth — use `reactable youtube connect`");
    return 1;
  }

  const url = String(body.verification_url);
  console.log(`Open in browser:\n  ${url}\n`);
  console.log(`Waiting for sign-in… (expires in ${body.expires_in}s)`);

  const deviceCode = String(body.device_code);
  const interval = Number(body.interval || 3) * 1000;
  const deadline = Date.now() + Number(body.expires_in || 600) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const poll = await fetch(`${base}/api/auth/cli/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });
    const res = (await poll.json()) as Record<string, unknown>;
    if (res.pending) continue;
    if (!res.ok) {
      console.error("auth poll failed:", res.error);
      return 1;
    }
    let plan = "";
    try {
      const me = await fetch(`${base}/api/auth/me`, {
        headers: { cookie: `reactable_session=${String(res.access_token)}` },
      });
      plan = String(((await me.json()) as any)?.user?.plan || "");
    } catch {}
    saveCredentials({
      access_token: String(res.access_token),
      email: String(res.email),
      session_id: String(res.session_id),
      api_base: base,
      saved_at: new Date().toISOString(),
      plan,
    });
    console.log(`Signed in as ${res.email}${plan ? ` (${plan})` : ""}`);
    return 0;
  }
  console.error("auth timed out");
  return 1;
}

export async function authStatus(json = false): Promise<number> {
  const creds = loadCredentials();
  if (!creds?.access_token) {
    if (json) console.log(JSON.stringify({ ok: true, signedIn: false }));
    else console.log("cloud account: not signed in (optional — `reactable auth login`)");
    return 0;
  }
  try {
    const res = await fetch(`${creds.api_base}/api/auth/me`, {
      headers: { cookie: `reactable_session=${creds.access_token}` },
    });
    const body = await res.json();
    if (json) console.log(JSON.stringify(body, null, 2));
    else console.log(body.signedIn ? `cloud · ${body.user?.email}` : "cloud session expired");
  } catch {
    if (json) console.log(JSON.stringify({ ok: true, signedIn: false, error: "site unreachable" }));
    else console.log(`saved credentials · ${creds.email} (offline)`);
  }
  return 0;
}
