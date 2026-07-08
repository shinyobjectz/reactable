/**
 * Google Drive integration (Pro) — OAuth against the "Reactable Web" client
 * (project reactable-501802, scope drive.file: per-file access, non-sensitive).
 * Refresh tokens live ONLY here, AES-GCM-encrypted in KV under a key derived
 * from SESSION_SECRET — the app never sees them (rule of two vaults).
 */
import type { Env } from "./types";
import { addConnection, connectionStatus, openTokens, pickConnection, removeConnection, updateConnectionTokens } from "./conns";

const SCOPE = "https://www.googleapis.com/auth/drive.file";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });


interface DriveTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

// ── OAuth flow ──
export async function driveConnect(email: string, env: Env): Promise<Response> {
  if (!env.DRIVE_CLIENT_ID) return json({ ok: false, error: "drive not configured" }, { status: 503 });
  const state = crypto.randomUUID();
  await env.KV.put(`drivestate:${state}`, email.toLowerCase(), { expirationTtl: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.DRIVE_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${env.SITE_URL}/api/drive/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  // select_account lets the user attach ANOTHER Drive account any time.
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

export async function driveCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const email = state ? await env.KV.get(`drivestate:${state}`) : null;
  if (!code || !email) return json({ ok: false, error: "invalid state" }, { status: 400 });
  await env.KV.delete(`drivestate:${state}`);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.DRIVE_CLIENT_ID!,
      client_secret: env.DRIVE_CLIENT_SECRET!,
      redirect_uri: `${env.SITE_URL}/api/drive/callback`,
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    return json({ ok: false, error: body.error || "token exchange failed" }, { status: 502 });
  }
  const tokens: DriveTokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
  };
  // Label the connection with the Drive account's own identity.
  let label = "Google Drive";
  try {
    const about = (await (
      await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      })
    ).json()) as any;
    label = about?.user?.emailAddress || about?.user?.displayName || label;
  } catch {}
  const scopes = (body.scope || SCOPE).split(" ").map((x) => x.split("/").pop() || x);
  await addConnection(env, email, "drive", label, tokens, scopes);
  return new Response(null, { status: 302, headers: { location: "/connected?service=drive" } });
}

async function freshToken(email: string, env: Env, selector?: string | null): Promise<string | null> {
  const conn = await pickConnection(env, email, "drive", selector);
  if (!conn) return null;
  const tokens = await openTokens<DriveTokens>(env, "drive", conn.sealed);
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  if (!tokens.refresh_token) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: env.DRIVE_CLIENT_ID!,
      client_secret: env.DRIVE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !body.access_token) return null;
  const next: DriveTokens = {
    access_token: body.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
  };
  await updateConnectionTokens(env, email, "drive", conn.id, next);
  return next.access_token;
}

export async function driveStatus(email: string, env: Env): Promise<Response> {
  return connectionStatus(env, email, "drive");
}

export async function driveDisconnect(email: string, req: Request, env: Env): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (id) await removeConnection(env, email, "drive", id);
  return json({ ok: true });
}

/** List files visible to the app (drive.file scope: app-created/-opened). */
export async function driveList(email: string, req: Request, env: Env): Promise<Response> {
  const url0 = new URL(req.url);
  const token = await freshToken(email, env, url0.searchParams.get("conn"));
  if (!token) return json({ ok: false, error: "drive not connected" }, { status: 404 });
  const q = url0.searchParams.get("q") || "";
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "25");
  url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
  if (q) url.searchParams.set("q", `name contains '${q.replace(/'/g, "\\'")}'`);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return json(await res.json(), { status: res.status });
}

/** Stream a file's bytes — the nexus saves them into the project's assets/. */
export async function driveFile(email: string, req: Request, env: Env): Promise<Response> {
  const url1 = new URL(req.url);
  const token = await freshToken(email, env, url1.searchParams.get("conn"));
  if (!token) return json({ ok: false, error: "drive not connected" }, { status: 404 });
  const id = url1.searchParams.get("id") || "";
  if (!id) return json({ ok: false, error: "id required" }, { status: 400 });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/octet-stream" },
  });
}
