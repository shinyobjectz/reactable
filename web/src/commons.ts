/**
 * The Commons — centrally collected trend series, the thing the subscription
 * buys. Runs on a CF cron trigger with a HARD daily call budget (the
 * official fixed cost: ≤1,500 upstream calls/day ≈ $85/mo at entry rate).
 * Same pure grading as the local intel (ported), same series shape.
 */
import type { Env } from "./types";

const UPSTREAM = "https://api.scrapecreators.com";
export const DAILY_CALL_BUDGET = 1500;

export interface CommonsTopic {
  q: string;
  niche: string;
  firstSeen: string;
  grade: string;
  series: { d: string; src: Record<string, number> }[];
}

// Seed taxonomy — grows via anonymized demand seeding later (opt-in).
export const SEED_TAXONOMY: { q: string; niche: string }[] = [
  { q: "ai avatars", niche: "ai-tools" }, { q: "ai agents", niche: "ai-tools" },
  { q: "claude code", niche: "ai-tools" }, { q: "cursor ai", niche: "ai-tools" },
  { q: "veo 3", niche: "ai-video" }, { q: "ai video generator", niche: "ai-video" },
  { q: "ugc ads", niche: "creator-economy" }, { q: "faceless youtube", niche: "creator-economy" },
  { q: "youtube automation", niche: "creator-economy" }, { q: "tiktok shop", niche: "commerce" },
  { q: "dropshipping 2026", niche: "commerce" }, { q: "print on demand", niche: "commerce" },
  { q: "home gym", niche: "fitness" }, { q: "zone 2 training", niche: "fitness" },
  { q: "creatine", niche: "fitness" }, { q: "glp-1", niche: "health" },
  { q: "cold plunge", niche: "health" }, { q: "red light therapy", niche: "health" },
  { q: "meal prep", niche: "food" }, { q: "high protein recipes", niche: "food" },
  { q: "matcha", niche: "food" }, { q: "van life", niche: "lifestyle" },
  { q: "slow living", niche: "lifestyle" }, { q: "digital minimalism", niche: "lifestyle" },
  { q: "notion templates", niche: "productivity" }, { q: "second brain", niche: "productivity" },
  { q: "obsidian", niche: "productivity" }, { q: "mechanical keyboards", niche: "tech" },
  { q: "home lab", niche: "tech" }, { q: "raspberry pi projects", niche: "tech" },
  { q: "smart home", niche: "tech" }, { q: "personal finance", niche: "money" },
  { q: "side hustle", niche: "money" }, { q: "index funds", niche: "money" },
  { q: "day in the life", niche: "formats" }, { q: "desk setup", niche: "formats" },
];

// ── grading: same thresholds as cli/lib/intel.ts (keep in lockstep) ──
function total(p: { src: Record<string, number> }): number {
  return Object.values(p.src).reduce((a, b) => a + b, 0);
}
function slope(series: CommonsTopic["series"], days: number): number {
  const cut = series.slice(-days);
  if (cut.length < 2) return 0;
  const first = total(cut[0]);
  const last = total(cut[cut.length - 1]);
  if (first === 0) return last > 0 ? 1 : 0;
  return (last - first) / first;
}
export function grade(t: Pick<CommonsTopic, "series" | "firstSeen">, vols: number[]): string {
  const s = t.series;
  if (s.length < 2) return "watching";
  const r7 = slope(s, 7);
  const span30 = Math.min(30, s.length);
  const r30w = slope(s, span30) * (7 / span30);
  const accel = r7 - r30w;
  const breadth = Object.entries(s[s.length - 1].src).filter(([k, v]) => {
    const prev = s.length > 7 ? s[s.length - 8].src[k] ?? 0 : s[0].src[k] ?? 0;
    return v > prev;
  }).length;
  const vol = total(s[s.length - 1]);
  const sorted = vols.slice().sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : Infinity;
  const age = (Date.now() - new Date(t.firstSeen).getTime()) / 86_400_000;
  if (age > 180 && Math.abs(r30w) < 0.05 && vol >= p50) return "evergreen";
  if (r7 < -0.1 && vol >= p50) return "peaked";
  if (accel > 0.5 && r7 > 0.3 && breadth >= 2) return "exploding";
  if (r7 > 0.1) return "rising";
  return "watching";
}

async function pull(env: Env, endpoint: string, params: Record<string, string>): Promise<any | null> {
  const url = new URL(UPSTREAM + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-api-key": env.SCRAPECREATORS_API_KEY! } });
  if (!res.ok) return null;
  const body = (await res.json()) as any;
  if (typeof body.credits_remaining === "number") {
    await env.KV.put("econ:sc_remaining", String(body.credits_remaining));
  }
  return body;
}

async function countFor(env: Env, q: string, platform: string): Promise<number> {
  try {
    if (platform === "tiktok") {
      const d = await pull(env, "/v1/tiktok/search/keyword", { query: q });
      const vids = d?.search_item_list || [];
      return vids.reduce((a: number, v: any) => a + (v.aweme_info?.statistics?.play_count || 0), 0) || vids.length;
    }
    if (platform === "youtube") {
      const d = await pull(env, "/v1/youtube/search", { query: q });
      const vids = d?.videos || [];
      return vids.reduce((a: number, v: any) => a + (parseInt(v.viewCountInt || v.viewCount || "0", 10) || 0), 0) || vids.length;
    }
    const d = await pull(env, "/v1/reddit/search", { query: q, sort: "new", timeframe: "week" });
    const posts = d?.posts || [];
    return posts.reduce((a: number, p: any) => a + (p.score || 0) + (p.num_comments || 0), 0) || posts.length;
  } catch {
    return -1;
  }
}

export async function commonsSnapshot(env: Env, limit = Infinity): Promise<{ ok: boolean; calls: number; topics: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const budgetKey = `econ:commons_calls:${today}`;
  let used = parseInt((await env.KV.get(budgetKey)) || "0", 10);

  const raw = await env.KV.get("commons:taxonomy");
  const taxonomy: { q: string; niche: string }[] = raw ? JSON.parse(raw) : SEED_TAXONOMY;
  let snapped = 0;

  for (const item of taxonomy) {
    if (snapped >= limit) break;
    if (used + 3 > DAILY_CALL_BUDGET) break;
    const key = `commons:topic:${item.q}`;
    const stored = await env.KV.get(key);
    const topic: CommonsTopic = stored
      ? JSON.parse(stored)
      : { q: item.q, niche: item.niche, firstSeen: new Date().toISOString(), grade: "watching", series: [] };
    if (topic.series.some((p) => p.d === today)) continue;

    const src: Record<string, number> = {};
    const results = await Promise.all(
      ["tiktok", "youtube", "reddit"].map(async (platform) => [platform, await countFor(env, item.q, platform)] as const),
    );
    used += 3;
    for (const [platform, n] of results) {
      if (n >= 0) src[platform] = n;
    }
    if (Object.keys(src).length) {
      topic.series.push({ d: today, src });
      if (topic.series.length > 400) topic.series = topic.series.slice(-400);
    }
    await env.KV.put(key, JSON.stringify(topic));
    snapped++;
  }

  // Regrade with cohort volumes + freeze forward predictions (G2, communal).
  const vols: number[] = [];
  const topics: CommonsTopic[] = [];
  for (const item of taxonomy) {
    const stored = await env.KV.get(`commons:topic:${item.q}`);
    if (!stored) continue;
    const t = JSON.parse(stored) as CommonsTopic;
    topics.push(t);
    vols.push(t.series.length ? total(t.series[t.series.length - 1]) : 0);
  }
  const index: any[] = [];
  for (const t of topics) {
    t.grade = grade(t, vols);
    await env.KV.put(`commons:topic:${t.q}`, JSON.stringify(t));
    index.push({
      q: t.q, niche: t.niche, grade: t.grade, firstSeen: t.firstSeen,
      volume: t.series.length ? total(t.series[t.series.length - 1]) : 0,
      spark: t.series.slice(-14).map(total),
    });
  }
  await env.KV.put("commons:index", JSON.stringify({ updated: new Date().toISOString(), topics: index }));
  await env.KV.put(budgetKey, String(used), { expirationTtl: 3 * 86400 });
  await env.KV.put(`commons:predictions:${today}`, JSON.stringify(index.map((t) => ({ q: t.q, grade: t.grade, vol: t.volume }))));
  return { ok: true, calls: used, topics: snapped };
}

export async function commonsTrends(env: Env): Promise<Response> {
  const raw = await env.KV.get("commons:index");
  return new Response(raw || JSON.stringify({ updated: null, topics: [] }), {
    headers: { "content-type": "application/json" },
  });
}
