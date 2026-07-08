/**
 * Research proxy — the ONLY cloud piece of content intelligence. Holds the
 * vendor key (never named client-side), allowlists endpoints, meters the
 * credit ledger. Everything downstream (series, grading, briefs, media)
 * runs locally in the app per docs/PLAN.content-intelligence.work.
 */
import type { Env } from "./types";
import { ledgerApply, ledgerBalance } from "./ledger";

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
  const balance = await ledgerBalance(env.LEDGER, email);
  if (balance < cost) {
    return json({ ok: false, error: "out of credits", balance, topup: "/dashboard/usage" }, { status: 402 });
  }

  const target = new URL(UPSTREAM + path);
  for (const [k, v] of url.searchParams) {
    if (k !== "endpoint") target.searchParams.set(k, v);
  }

  const upstream = await fetch(target, {
    headers: { "x-api-key": env.SCRAPECREATORS_API_KEY },
  });
  const body = await upstream.text();

  // Charge only successful pulls; a 4xx/5xx upstream shouldn't cost the user.
  if (upstream.ok) {
    ctx.waitUntil(ledgerApply(env.LEDGER, email, "charge", cost, `research:${path.split("/").slice(1, 4).join("/")}`));
  }

  return new Response(body, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
