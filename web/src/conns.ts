/**
 * Multi-account connection store — a user can hold several YouTube channels,
 * Meta ad accounts, or Drive accounts. One KV key per (user, provider) holds
 * a labeled array; token payloads are AES-GCM-sealed per entry.
 */
import type { Env } from "./types";

export interface Connection {
  id: string;
  label: string;
  sealed: string;
  addedAt: string;
}

const key = (email: string, provider: string) => `conns:${email.toLowerCase()}:${provider}`;

async function vaultKey(env: Env, provider: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${provider}-vault:${env.SESSION_SECRET}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealTokens(env: Env, provider: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await vaultKey(env, provider);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(value)));
  const buf = new Uint8Array(iv.length + data.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(data), iv.length);
  return btoa(String.fromCharCode(...buf));
}

export async function openTokens<T>(env: Env, provider: string, sealed: string): Promise<T | null> {
  try {
    const buf = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    const k = await vaultKey(env, provider);
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, k, buf.slice(12));
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    return null;
  }
}

export async function listConnections(env: Env, email: string, provider: string): Promise<Connection[]> {
  const raw = await env.KV.get(key(email, provider));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Connection[];
  } catch {
    return [];
  }
}

/** Append (or replace by label — reconnecting the same account updates it). */
export async function addConnection(
  env: Env,
  email: string,
  provider: string,
  label: string,
  tokens: unknown,
): Promise<Connection> {
  const conns = await listConnections(env, email, provider);
  const conn: Connection = {
    id: crypto.randomUUID(),
    label,
    sealed: await sealTokens(env, provider, tokens),
    addedAt: new Date().toISOString(),
  };
  const existing = conns.findIndex((c) => c.label === label);
  if (existing >= 0) {
    conn.id = conns[existing].id;
    conns[existing] = conn;
  } else {
    conns.push(conn);
  }
  await env.KV.put(key(email, provider), JSON.stringify(conns));
  return conn;
}

export async function removeConnection(env: Env, email: string, provider: string, id: string): Promise<void> {
  const conns = (await listConnections(env, email, provider)).filter((c) => c.id !== id);
  await env.KV.put(key(email, provider), JSON.stringify(conns));
}

/** Resolve by id, label fragment, or default to the first connection. */
export async function pickConnection(
  env: Env,
  email: string,
  provider: string,
  selector?: string | null,
): Promise<Connection | null> {
  const conns = await listConnections(env, email, provider);
  if (!conns.length) return null;
  if (!selector) return conns[0];
  const q = selector.toLowerCase();
  return conns.find((c) => c.id === selector) || conns.find((c) => c.label.toLowerCase().includes(q)) || conns[0];
}

export async function updateConnectionTokens(
  env: Env,
  email: string,
  provider: string,
  id: string,
  tokens: unknown,
): Promise<void> {
  const conns = await listConnections(env, email, provider);
  const i = conns.findIndex((c) => c.id === id);
  if (i < 0) return;
  conns[i].sealed = await sealTokens(env, provider, tokens);
  await env.KV.put(key(email, provider), JSON.stringify(conns));
}

/** Status shape shared by all providers: labeled accounts, never a boolean. */
export async function connectionStatus(env: Env, email: string, provider: string): Promise<Response> {
  const conns = await listConnections(env, email, provider);
  return new Response(
    JSON.stringify({ ok: true, connections: conns.map((c) => ({ id: c.id, label: c.label, addedAt: c.addedAt })) }),
    { headers: { "content-type": "application/json" } },
  );
}
