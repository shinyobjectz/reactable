/**
 * Meta integration (Pro) — Marketing API app 1328674082772721 ("Reactable").
 * OAuth via Facebook Login for Business; long-lived user tokens sealed in KV
 * (same AES-GCM vault pattern as Drive). Scopes: ads_read + read_insights —
 * pull ad accounts, campaigns, and insights into the agent.
 */
import type { Env } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";
const SCOPES = "ads_read,read_insights,business_management";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });

// ── same envelope crypto as drive.ts (kept local to avoid a shared-module
// refactor; the key derivation differs by label so blobs aren't portable) ──
async function vaultKey(env: Env): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`meta-vault:${env.SESSION_SECRET}`));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sealJson(env: Env, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(env);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  const buf = new Uint8Array(iv.length + data.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(data), iv.length);
  return btoa(String.fromCharCode(...buf));
}

async function openJson<T>(env: Env, sealed: string): Promise<T | null> {
  try {
    const buf = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    const key = await vaultKey(env);
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    return null;
  }
}

interface MetaTokens {
  access_token: string;
  expires_at: number;
}

const tokenKey = (email: string) => `metatok:${email.toLowerCase()}`;

export async function metaConnect(email: string, env: Env): Promise<Response> {
  if (!env.META_APP_ID) return json({ ok: false, error: "meta not configured" }, { status: 503 });
  const state = crypto.randomUUID();
  await env.KV.put(`metastate:${state}`, email.toLowerCase(), { expirationTtl: 600 });
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("redirect_uri", `${env.SITE_URL}/api/meta/callback`);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

export async function metaCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const email = state ? await env.KV.get(`metastate:${state}`) : null;
  if (!code || !email) return json({ ok: false, error: "invalid state" }, { status: 400 });
  await env.KV.delete(`metastate:${state}`);

  // code → short-lived token → long-lived token (~60 days)
  const short = new URL(`${GRAPH}/oauth/access_token`);
  short.searchParams.set("client_id", env.META_APP_ID!);
  short.searchParams.set("client_secret", env.META_APP_SECRET!);
  short.searchParams.set("redirect_uri", `${env.SITE_URL}/api/meta/callback`);
  short.searchParams.set("code", code);
  const shortRes = (await (await fetch(short)).json()) as { access_token?: string };
  if (!shortRes.access_token) return json({ ok: false, error: "token exchange failed" }, { status: 502 });

  const long = new URL(`${GRAPH}/oauth/access_token`);
  long.searchParams.set("grant_type", "fb_exchange_token");
  long.searchParams.set("client_id", env.META_APP_ID!);
  long.searchParams.set("client_secret", env.META_APP_SECRET!);
  long.searchParams.set("fb_exchange_token", shortRes.access_token);
  const longRes = (await (await fetch(long)).json()) as { access_token?: string; expires_in?: number };
  const token = longRes.access_token || shortRes.access_token;
  const tokens: MetaTokens = {
    access_token: token,
    expires_at: Date.now() + (longRes.expires_in ?? 5_184_000) * 1000,
  };
  await env.KV.put(tokenKey(email), await sealJson(env, tokens));
  return new Response(null, { status: 302, headers: { location: "/connected?service=meta" } });
}

async function metaToken(email: string, env: Env): Promise<string | null> {
  const sealed = await env.KV.get(tokenKey(email));
  if (!sealed) return null;
  const tokens = await openJson<MetaTokens>(env, sealed);
  if (!tokens || Date.now() > tokens.expires_at) return null;
  return tokens.access_token;
}

export async function metaStatus(email: string, env: Env): Promise<Response> {
  const token = await metaToken(email, env);
  return json({ ok: true, connected: Boolean(token) });
}

/** Scoped Graph proxy: ad accounts, campaigns, insights — GET only,
 * path-allowlisted, token appended server-side. */
export async function metaGraph(email: string, req: Request, env: Env): Promise<Response> {
  const token = await metaToken(email, env);
  if (!token) return json({ ok: false, error: "meta not connected" }, { status: 404 });
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "/me/adaccounts";
  const allowed =
    /^\/me(\/adaccounts)?$/.test(path) ||
    /^\/act_\d+(\/(campaigns|adsets|ads|insights))?$/.test(path) ||
    /^\/\d+(\/(campaigns|adsets|ads|insights))?$/.test(path);
  if (!allowed) return json({ ok: false, error: "path not allowed" }, { status: 400 });

  const target = new URL(GRAPH + path);
  for (const [k, v] of url.searchParams) {
    if (k !== "path") target.searchParams.set(k, v);
  }
  target.searchParams.set("access_token", token);
  const res = await fetch(target);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
