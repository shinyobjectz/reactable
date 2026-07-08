/**
 * Research proxy — the ONLY cloud piece of content intelligence. Holds the
 * vendor key (never named client-side), allowlists endpoints, meters the
 * credit ledger. Everything downstream (series, grading, briefs, media)
 * runs locally in the app per docs/PLAN.content-intelligence.work.
 */
import type { Env } from "./types";
import { ledgerApply, ledgerBalance } from "./ledger";
import { econAdd } from "./econ";

const UPSTREAM = "https://api.scrapecreators.com";

// Prefix allowlist per platform family — no arbitrary upstream paths.
const ALLOWED_PREFIXES = [
  "/v1/tiktok/", "/v2/tiktok/", "/v3/tiktok/",
  "/v1/instagram/", "/v2/instagram/",
  "/v1/youtube/",
  "/v1/reddit/",
  "/v1/twitter/",
  "/v1/threads/",
  "/v1/bluesky/",
  "/v1/linkedin/",
  "/v1/facebook/",
  "/v1/pinterest/",
  "/v1/google/",
  "/v1/twitch/",
  "/v1/rumble/",
];

// Credit pricing: upstream cost + margin. Flat default, heavier calls named.
function costFor(path: string, params: URLSearchParams): number {
  if (path.includes("/audience")) return 60; // upstream 26 SC credits
  if (path.includes("transcript")) {
    return params.get("use_ai_as_fallback") === "true" ? 15 : 4; // fallback = +10 upstream
  }
  return 3;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });

export async function researchRaw(email: string, req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.SCRAPECREATORS_API_KEY) return json({ ok: false, error: "research not configured" }, { status: 503 });

  const url = new URL(req.url);
  const path = url.searchParams.get("endpoint") || "";
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    return json({ ok: false, error: "endpoint not allowed" }, { status: 400 });
  }

  const cost = costFor(path, url.searchParams);
  // Charge UPFRONT through the DO (atomic — parallel bursts can't outrun the
  // balance); refunded below if upstream fails.
  const balance = await ledgerBalance(env.LEDGER, email);
  if (balance < cost) {
    return json({ ok: false, error: "out of credits", balance, topup: "/dashboard/usage" }, { status: 402 });
  }
  const ref = `research:${path.split("/").slice(1, 4).join("/")}`;
  const after = await ledgerApply(env.LEDGER, email, "charge", cost, ref);
  if (after < -50) {
    // Burst raced past zero — refund and refuse (fail-closed backstop).
    await ledgerApply(env.LEDGER, email, "grant", cost, `refund:${ref}`);
    return json({ ok: false, error: "out of credits", topup: "/dashboard/usage" }, { status: 402 });
  }

  // Rate backstop independent of credits: 120 research calls / hour / user.
  const hour = new Date().toISOString().slice(0, 13);
  const rlKey = `rl:research:${email.toLowerCase()}:${hour}`;
  const rl = parseInt((await env.KV.get(rlKey)) || "0", 10);
  if (rl > 120) return json({ ok: false, error: "rate limit — try again shortly" }, { status: 429 });
  await env.KV.put(rlKey, String(rl + 1), { expirationTtl: 7200 });

  const target = new URL(UPSTREAM + path);
  for (const [k, v] of url.searchParams) {
    if (k !== "endpoint") target.searchParams.set(k, v);
  }

  const upstream = await fetch(target, {
    headers: { "x-api-key": env.SCRAPECREATORS_API_KEY },
  });
  const body = await upstream.text();

  ctx.waitUntil(
    (async () => {
      if (upstream.ok) {
        await econAdd(env, "spent:research", cost);
        await econAdd(env, "calls:research", 1);
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.credits_remaining === "number") {
            await env.KV.put("econ:sc_remaining", String(parsed.credits_remaining));
          }
        } catch {}
      } else {
        // Failed pulls are free: refund the upfront charge.
        await ledgerApply(env.LEDGER, email, "grant", cost, `refund:${ref}`);
      }
    })(),
  );

  return new Response(body, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
