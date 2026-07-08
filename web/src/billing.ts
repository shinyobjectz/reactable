/**
 * Polar billing — merchant of record for the Pro plan + credit packs.
 * Webhooks (Standard Webhooks spec) write the KV user record; /api/auth/me
 * reads it live, so plan flips reach the app without re-login.
 */
import type { Env, UserRecord } from "./types";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });

export async function userRecord(env: Env, email: string): Promise<UserRecord> {
  const raw = await env.KV.get(`user:${email.toLowerCase()}`);
  if (raw) {
    try {
      return JSON.parse(raw) as UserRecord;
    } catch {}
  }
  return { plan: "free", credits: 0, updatedAt: new Date(0).toISOString() };
}

export async function saveUserRecord(env: Env, email: string, record: UserRecord): Promise<void> {
  await env.KV.put(`user:${email.toLowerCase()}`, JSON.stringify(record));
}

/** GET /api/billing/checkout — signed-in user → Polar hosted checkout. */
export async function billingCheckout(email: string, env: Env): Promise<Response> {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_PRODUCT_PRO) {
    return json({ ok: false, error: "billing not configured" }, { status: 503 });
  }
  const api = env.POLAR_API || "https://api.polar.sh";
  const res = await fetch(`${api}/v1/checkouts/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      products: [env.POLAR_PRODUCT_PRO],
      customer_email: email,
      success_url: `${env.SITE_URL}/pro/welcome`,
    }),
  });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !body.url) {
    return json({ ok: false, error: body.error || `polar checkout failed (${res.status})` }, { status: 502 });
  }
  return new Response(null, { status: 302, headers: { location: body.url } });
}

/** Standard Webhooks signature check (webhook-id.timestamp.payload, HMAC-SHA256, base64). */
async function verifyWebhook(req: Request, payload: string, secret: string): Promise<boolean> {
  const id = req.headers.get("webhook-id") || "";
  const ts = req.headers.get("webhook-timestamp") || "";
  const sigHeader = req.headers.get("webhook-signature") || "";
  if (!id || !ts || !sigHeader) return false;
  // 5-minute tolerance window against replay.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${payload}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return sigHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    return sig === expected;
  });
}

function eventEmail(data: Record<string, any>): string {
  return String(
    data?.customer?.email || data?.customer_email || data?.user?.email || ""
  ).toLowerCase();
}

/** POST /api/webhooks/polar — verified, idempotent by webhook-id. */
export async function polarWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.POLAR_WEBHOOK_SECRET) return json({ ok: false, error: "webhooks not configured" }, { status: 503 });
  const payload = await req.text();
  if (!(await verifyWebhook(req, payload, env.POLAR_WEBHOOK_SECRET))) {
    return json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  const eventId = req.headers.get("webhook-id")!;
  if (await env.KV.get(`polarevt:${eventId}`)) return json({ ok: true, duplicate: true });

  const event = JSON.parse(payload) as { type: string; data: Record<string, any> };
  const email = eventEmail(event.data);
  if (email) {
    const record = await userRecord(env, email);
    switch (event.type) {
      case "subscription.created":
      case "subscription.active":
      case "subscription.updated": {
        const status = String(event.data?.status || "active");
        record.plan = ["active", "trialing"].includes(status) ? "pro" : record.plan;
        if (["canceled", "revoked", "unpaid"].includes(status)) record.plan = "free";
        break;
      }
      case "subscription.canceled":
      case "subscription.revoked":
        record.plan = "free";
        break;
      case "order.paid": {
        // Credit packs carry their grant in product metadata.
        const grant = Number(event.data?.product?.metadata?.credits || 0);
        if (grant > 0) record.credits += grant;
        break;
      }
      default:
        break;
    }
    record.polarCustomerId = String(event.data?.customer?.id || record.polarCustomerId || "");
    record.updatedAt = new Date().toISOString();
    await saveUserRecord(env, email, record);
  }

  await env.KV.put(`polarevt:${eventId}`, "1", { expirationTtl: 7 * 86400 });
  return json({ ok: true });
}

/** GET /api/billing/portal — Polar customer portal session for manage/cancel. */
export async function billingPortal(email: string, env: Env): Promise<Response> {
  if (!env.POLAR_ACCESS_TOKEN) return json({ ok: false, error: "billing not configured" }, { status: 503 });
  const record = await userRecord(env, email);
  if (!record.polarCustomerId) return json({ ok: false, error: "no billing account yet" }, { status: 404 });
  const api = env.POLAR_API || "https://api.polar.sh";
  const res = await fetch(`${api}/v1/customer-sessions/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ customer_id: record.polarCustomerId }),
  });
  const body = (await res.json()) as { customer_portal_url?: string };
  if (!res.ok || !body.customer_portal_url) return json({ ok: false, error: "portal unavailable" }, { status: 502 });
  return new Response(null, { status: 302, headers: { location: body.customer_portal_url } });
}
