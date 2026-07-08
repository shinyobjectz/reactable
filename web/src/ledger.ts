/**
 * CreditLedger — one Durable Object per user (idFromName(email)): the atomic
 * truth for gateway credits. Webhooks grant, the gateway charges, /api/auth/me
 * reads. A DO serializes its requests, so two concurrent streams can never
 * double-spend past the balance.
 */

export interface LedgerEntry {
  at: string;
  delta: number;
  balance: number;
  ref: string;
}

export class CreditLedger {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const balance = (await this.state.storage.get<number>("balance")) ?? 0;

    if (req.method === "GET" && url.pathname === "/balance") {
      return Response.json({ ok: true, balance });
    }

    if (req.method === "POST" && (url.pathname === "/grant" || url.pathname === "/charge")) {
      const body = (await req.json()) as { amount?: number; ref?: string };
      const amount = Math.max(0, Math.floor(body.amount ?? 0));
      if (!amount) return Response.json({ ok: false, error: "amount required" }, { status: 400 });

      const delta = url.pathname === "/grant" ? amount : -amount;
      // Charges may drive the balance below zero once (a stream's true cost
      // lands after delivery); the gateway's pre-check then fails the NEXT
      // call — fail-closed at zero without clipping a paid-for stream.
      const next = balance + delta;
      await this.state.storage.put("balance", next);

      const log = (await this.state.storage.get<LedgerEntry[]>("log")) ?? [];
      log.push({ at: new Date().toISOString(), delta, balance: next, ref: body.ref || "" });
      await this.state.storage.put("log", log.slice(-200));

      return Response.json({ ok: true, balance: next });
    }

    if (req.method === "GET" && url.pathname === "/log") {
      const log = (await this.state.storage.get<LedgerEntry[]>("log")) ?? [];
      return Response.json({ ok: true, balance, log });
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
}

export async function ledgerBalance(ns: DurableObjectNamespace, email: string): Promise<number> {
  const stub = ns.get(ns.idFromName(email.toLowerCase()));
  const res = await stub.fetch("https://ledger/balance");
  const body = (await res.json()) as { balance?: number };
  return body.balance ?? 0;
}

export async function ledgerApply(
  ns: DurableObjectNamespace,
  email: string,
  kind: "grant" | "charge",
  amount: number,
  ref: string,
): Promise<number> {
  const stub = ns.get(ns.idFromName(email.toLowerCase()));
  const res = await stub.fetch(`https://ledger/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount, ref }),
  });
  const body = (await res.json()) as { balance?: number };
  return body.balance ?? 0;
}
