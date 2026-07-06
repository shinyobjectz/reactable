import type { Env, Session } from "./types";

const COOKIE = "reactable_session";

function b64url(data: ArrayBuffer | string): string {
  const raw = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = btoa(String.fromCharCode(...raw));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", sha: "256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}

export async function sealSession(env: Env, sessionId: string): Promise<string> {
  const payload = b64url(JSON.stringify({ sid: sessionId, ts: Date.now() }));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

export async function openSession(env: Env, req: Request): Promise<Session | null> {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payload, sig] = match[1].split(".");
  if (!payload || !sig) return null;
  const expect = await hmac(env.SESSION_SECRET, payload);
  if (sig !== expect) return null;
  try {
    const { sid } = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    const raw = await env.KV.get(`session:${sid}`);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function saveSession(env: Env, session: Session): Promise<void> {
  await env.KV.put(`session:${session.id}`, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 30 });
  await env.KV.put(`user:${session.userId}`, JSON.stringify({
    id: session.userId,
    email: session.email,
    name: session.name,
    picture: session.picture,
    plan: session.plan,
    createdAt: session.createdAt,
  }));
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function redirect(url: string, init: ResponseInit = {}): Response {
  return Response.redirect(url, init.status ?? 302);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function oauthClient(env: Env, kind: "google" | "youtube") {
  if (kind === "youtube" && env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET) {
    return { id: env.YOUTUBE_CLIENT_ID, secret: env.YOUTUBE_CLIENT_SECRET };
  }
  return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
}
