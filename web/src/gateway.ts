/**
 * Model gateway — signed-in users spend credits to reach MiniMax through the
 * worker's key (MINIMAX_GATEWAY_KEY). SSE passes through byte-for-byte while
 * a tee'd reader tallies usage; the charge settles when the stream ends.
 * Pricing: 1 credit per 1,000 total tokens (min 1 per call).
 */
import type { Env } from "./types";
import { ledgerApply, ledgerBalance } from "./ledger";
import { econAdd } from "./econ";

const CREDITS_PER_1K_TOKENS = 1;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });

interface GatewayBody {
  system?: string;
  messages?: { role: string; content: string }[];
  max_tokens?: number;
  stream?: boolean;
}

function usageFromChunk(parsed: any): number {
  const u = parsed?.usage;
  if (!u) return 0;
  return Number(u.total_tokens || 0) || Number(u.prompt_tokens || 0) + Number(u.completion_tokens || 0);
}

export async function gatewayChat(email: string, req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.MINIMAX_GATEWAY_KEY) return json({ ok: false, error: "gateway not configured" }, { status: 503 });

  const balance = await ledgerBalance(env.LEDGER, email);
  if (balance <= 0) {
    return json({ ok: false, error: "out of credits", balance, topup: "/api/billing/checkout" }, { status: 402 });
  }

  const body = (await req.json()) as GatewayBody;
  const messages = [
    { role: "system", content: body.system || "You are a helpful assistant." },
    ...(body.messages || []),
  ];
  const upstream = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MINIMAX_GATEWAY_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "MiniMax-M3",
      messages,
      max_tokens: Math.min(body.max_tokens || 4096, 8192),
      stream: body.stream === true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    return json({ ok: false, error: `upstream ${upstream.status}` }, { status: 502 });
  }

  const charge = async (tokens: number, ref: string) => {
    const credits = Math.max(1, Math.ceil((tokens * CREDITS_PER_1K_TOKENS) / 1000));
    await econAdd(env, "spent:inference", credits);
    await econAdd(env, "tokens:inference", Math.round(tokens));
    return ledgerApply(env.LEDGER, email, "charge", credits, ref);
  };

  if (body.stream !== true) {
    const data = (await upstream.json()) as any;
    const tokens = usageFromChunk(data) || JSON.stringify(data).length / 4;
    ctx.waitUntil(charge(tokens, "chat"));
    return json(data);
  }

  // Stream: pass bytes through untouched; tally usage on a tee.
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(
    (async () => {
      const reader = toMeter.pipeThrough(new TextDecoderStream()).getReader();
      let tokens = 0;
      let chars = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chars += value.length;
        for (const line of value.split("\n")) {
          const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
          if (!payload || payload === "[DONE]") continue;
          try {
            tokens = Math.max(tokens, usageFromChunk(JSON.parse(payload)));
          } catch {}
        }
      }
      await charge(tokens || chars / 4, "chat-stream");
    })(),
  );

  return new Response(toClient, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

export async function gatewayBalance(email: string, env: Env): Promise<Response> {
  const balance = await ledgerBalance(env.LEDGER, email);
  return json({ ok: true, balance });
}

/** Balance + recent ledger entries — the dashboard's usage meter. */
export async function gatewayUsage(email: string, env: Env): Promise<Response> {
  const stub = env.LEDGER.get(env.LEDGER.idFromName(email.toLowerCase()));
  const res = await stub.fetch("https://ledger/log");
  return new Response(res.body, { headers: { "content-type": "application/json" } });
}
