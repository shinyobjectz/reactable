/**
 * Meta integration (Pro) — Marketing API app 1328674082772721 ("Reactable").
 * OAuth via Facebook Login for Business; long-lived user tokens sealed in KV
 * (same AES-GCM vault pattern as Drive). Scopes: ads_read + read_insights —
 * pull ad accounts, campaigns, and insights into the agent.
 */
import type { Env } from "./types";
import { addConnection, connectionStatus, openTokens, pickConnection, removeConnection } from "./conns";

const GRAPH = "https://graph.facebook.com/v21.0";
const SCOPES = "ads_read,read_insights,business_management";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });


interface MetaTokens {
  access_token: string;
  expires_at: number;
}

export async function metaConnect(email: string, env: Env): Promise<Response> {
  if (!env.META_APP_ID) return json({ ok: false, error: "meta not configured" }, { status: 503 });
  const state = crypto.randomUUID();
  await env.KV.put(`metastate:${state}`, email.toLowerCase(), { expirationTtl: 600 });
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("redirect_uri", `${env.SITE_URL}/api/meta/callback`);
  url.searchParams.set("scope", SCOPES);
  // let the user attach a different FB identity / business any time
  url.searchParams.set("auth_type", "reauthenticate");
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
  let label = "Meta";
  try {
    const who = (await (await fetch(`${GRAPH}/me?fields=name&access_token=${token}`)).json()) as any;
    label = who?.name || label;
    const accts = (await (
      await fetch(`${GRAPH}/me/adaccounts?fields=name&limit=1&access_token=${token}`)
    ).json()) as any;
    if (accts?.data?.[0]?.name) label = `${label} · ${accts.data[0].name}`;
  } catch {}
  await addConnection(env, email, "meta", label, tokens);
  return new Response(null, { status: 302, headers: { location: "/connected?service=meta" } });
}

async function metaToken(email: string, env: Env, selector?: string | null): Promise<string | null> {
  const conn = await pickConnection(env, email, "meta", selector);
  if (!conn) return null;
  const tokens = await openTokens<MetaTokens>(env, "meta", conn.sealed);
  if (!tokens || Date.now() > tokens.expires_at) return null;
  return tokens.access_token;
}

export async function metaStatus(email: string, env: Env): Promise<Response> {
  return connectionStatus(env, email, "meta");
}

export async function metaDisconnect(email: string, req: Request, env: Env): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (id) await removeConnection(env, email, "meta", id);
  return json({ ok: true });
}

/** Scoped Graph proxy: ad accounts, campaigns, insights — GET only,
 * path-allowlisted, token appended server-side. */
export async function metaGraph(email: string, req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = await metaToken(email, env, url.searchParams.get("conn"));
  if (!token) return json({ ok: false, error: "meta not connected" }, { status: 404 });
  const path = url.searchParams.get("path") || "/me/adaccounts";
  const allowed =
    /^\/me(\/adaccounts)?$/.test(path) ||
    /^\/act_\d+(\/(campaigns|adsets|ads|insights))?$/.test(path) ||
    /^\/\d+(\/(campaigns|adsets|ads|insights))?$/.test(path);
  if (!allowed) return json({ ok: false, error: "path not allowed" }, { status: 400 });

  const target = new URL(GRAPH + path);
  for (const [k, v] of url.searchParams) {
    if (k !== "path" && k !== "conn") target.searchParams.set(k, v);
  }
  target.searchParams.set("access_token", token);
  const res = await fetch(target);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
