/**
 * Econ telemetry — global monthly counters for every sink and faucet, so the
 * pricing model in docs/UNIT-ECONOMICS.work is validated by LIVE numbers,
 * not assumptions. KV read-modify-write; races lose a count at worst —
 * acceptable for telemetry, the ledger stays the billing truth.
 */
import type { Env } from "./types";

const month = () => new Date().toISOString().slice(0, 7);

export async function econAdd(env: Env, key: string, n: number): Promise<void> {
  const k = `econ:${key}:${month()}`;
  const cur = parseInt((await env.KV.get(k)) || "0", 10);
  await env.KV.put(k, String(cur + n));
}

// Model constants (mirror docs/UNIT-ECONOMICS.work — update BOTH together).
export const MODEL = {
  creditRetailUsd: 0.002, // pack5 rate, conservative
  inferencePerMsgCr: 12,
  inferenceCogsUsd: 0.0093,
  researchCogsUsd: 0.00188,
  researchChargeCr: 3,
  allowanceCr: 10000,
  commonsDailyBudget: 1500,
  scUsdPerCall: 0.00188,
  minimaxInPerM: 0.6,
  minimaxOutPerM: 2.4,
  polarPct: 0.04,
  polarFlatUsd: 0.4,
  proPriceUsd: 100,
};

export async function econReport(env: Env): Promise<Record<string, unknown>> {
  const m = month();
  const g = async (k: string) => parseInt((await env.KV.get(`econ:${k}:${m}`)) || "0", 10);

  const inferenceCr = await g("spent:inference");
  const inferenceTok = await g("tokens:inference");
  const researchCr = await g("spent:research");
  const researchCalls = await g("calls:research");
  const grantedCr = await g("granted");
  const soldCr = await g("sold_credits");
  const revenueCents = await g("revenue_cents");
  const commonsCallsToday = parseInt((await env.KV.get(`econ:commons_calls:${new Date().toISOString().slice(0, 10)}`)) || "0", 10);
  const scRemaining = parseInt((await env.KV.get("econ:sc_remaining")) || "0", 10);

  // COGS actuals
  const inferenceCogs = (inferenceTok / 1_000_000) * ((MODEL.minimaxInPerM * 0.9) + (MODEL.minimaxOutPerM * 0.1)); // ~90/10 in/out mix
  const researchCogs = researchCalls * MODEL.scUsdPerCall;
  const commonsCogsMo = commonsCallsToday * 30 * MODEL.scUsdPerCall;

  // Revenue actuals (credits consumed at retail — allowance counted at $0)
  const paidShare = soldCr + grantedCr > 0 ? soldCr / (soldCr + grantedCr) : 0;
  const creditRevenueRecognized = (inferenceCr + researchCr) * MODEL.creditRetailUsd * paidShare;

  const marginInference = inferenceCr > 0 ? (inferenceCr * MODEL.creditRetailUsd) / Math.max(inferenceCogs, 0.0001) : null;
  const marginResearch = researchCr > 0 ? (researchCr * MODEL.creditRetailUsd) / Math.max(researchCogs, 0.0001) : null;

  const checks = {
    inference_margin_ok: marginInference === null || marginInference >= 1.8,
    research_margin_ok: marginResearch === null || marginResearch >= 2.0,
    commons_under_budget: commonsCallsToday <= MODEL.commonsDailyBudget,
    sc_balance_healthy: scRemaining === 0 || scRemaining > 2000,
    tokens_per_message_sane:
      inferenceCr === 0 || inferenceTok === 0 || inferenceTok / Math.max(1, inferenceCr / MODEL.inferencePerMsgCr) < 30000,
  };

  return {
    ok: true,
    month: m,
    sinks: {
      inference: { credits: inferenceCr, tokens: inferenceTok, cogsUsd: +inferenceCogs.toFixed(4) },
      research: { credits: researchCr, calls: researchCalls, cogsUsd: +researchCogs.toFixed(4) },
      commons: { callsToday: commonsCallsToday, dailyBudget: MODEL.commonsDailyBudget, projectedMoUsd: +commonsCogsMo.toFixed(2) },
      scCreditsRemaining: scRemaining,
    },
    faucets: {
      packRevenueCents: revenueCents,
      creditsSold: soldCr,
      allowanceGranted: grantedCr,
      consumedCreditRevenueUsd: +creditRevenueRecognized.toFixed(4),
    },
    margins: {
      inference: marginInference && +marginInference.toFixed(2),
      research: marginResearch && +marginResearch.toFixed(2),
    },
    model: MODEL,
    checks,
    verdict: Object.values(checks).every(Boolean) ? "PRICING MODEL HOLDS" : "DRIFT — see failing checks",
  };
}
