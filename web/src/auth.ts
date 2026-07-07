import type { Env, Session } from "./types";

const COOKIE = "reactable_session";

/** Workers-safe base64url (no spread on large arrays). */
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, payload: string): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

export async function sealSession(env: Env, sessionId: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ sid: sessionId, ts: Date.now() })));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

export async function openSession(env: Env, req: Request): Promise<Session | null> {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;

  const dot = match[1].indexOf(".");
  if (dot <= 0) return null;
  const payload = match[1].slice(0, dot);
  const sig = match[1].slice(dot + 1);
  if (!payload || !sig) return null;

  try {
    const expect = await hmac(env.SESSION_SECRET, payload);
    if (sig !== expect) return null;
    const json = new TextDecoder().decode(fromBase64Url(payload));
    const { sid } = JSON.parse(json) as { sid?: string };
    if (!sid) return null;
    const raw = await env.KV.get(`session:${sid}`);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch (e) {
    console.error("openSession", e);
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
  await env.KV.put(
    `user:${session.userId}`,
    JSON.stringify({
      id: session.userId,
      email: session.email,
      name: session.name,
      picture: session.picture,
      plan: session.plan,
      createdAt: session.createdAt,
    }),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function redirect(url: string, status = 302): Response {
  return Response.redirect(url, status);
}

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function oauthClient(env: Env, kind: "google" | "youtube") {
  if (kind === "youtube" && env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET) {
    return { id: env.YOUTUBE_CLIENT_ID, secret: env.YOUTUBE_CLIENT_SECRET };
  }
  const id = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google OAuth not configured on worker");
  return { id, secret };
}

export function oauthError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") return JSON.stringify(err);
  return "oauth error";
}
