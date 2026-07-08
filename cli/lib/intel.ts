/**
 * Content intelligence, local-first (docs/PLAN.content-intelligence.work).
 * Series, grading, and briefs live in the ACTIVE PROJECT; the cloud is only
 * the metered research proxy. Every verb supports --json; every error names
 * the verb that fixes it. REACTABLE_INTEL_STUB=1 reads fixtures instead of
 * the network — deterministic for tests and evals (G5/G8).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DATA_ROOT, PROJECT } from "./paths.ts";
import { loadCredentials } from "./auth.ts";

const INTEL_DIR = resolve(DATA_ROOT, ".reactable", "intel");
const TOPICS = join(INTEL_DIR, "topics.json");
const COMPETITORS = join(INTEL_DIR, "competitors.json");
const PREDICTIONS = join(INTEL_DIR, "predictions.jsonl"); // G2: frozen forward calls

export type Grade = "watching" | "rising" | "exploding" | "peaked" | "evergreen";

export interface SeriesPoint {
  d: string; // YYYY-MM-DD
  src: Record<string, number>;
}

export interface Topic {
  id: string;
  q: string;
  platforms: string[];
  firstSeen: string;
  grade: Grade;
  series: SeriesPoint[];
}

export interface Competitor {
  id: string;
  platform: string;
  handle: string;
  baseline: { p50: number; p90: number };
  lastVideos: { id: string; title: string; views: number; at: string }[];
}

// ── storage ──
function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(INTEL_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export const topics = () => readJson<Topic[]>(TOPICS, []);
export const competitors = () => readJson<Competitor[]>(COMPETITORS, []);

// ── research proxy ──
async function research(endpoint: string, params: Record<string, string>): Promise<any> {
  if (process.env.REACTABLE_INTEL_STUB === "1") {
    const name = endpoint.replace(/\//g, "_").replace(/^_/, "");
    const fix = resolve(PROJECT, "scripts", "eval", "fixture", "intel", `${name}.json`);
    if (existsSync(fix)) return JSON.parse(readFileSync(fix, "utf8"));
    return { stub: true, results: [], videos: [], posts: [] };
  }
  const creds = loadCredentials();
  if (!creds?.access_token) {
    throw new Error("research needs a signed-in account — sign in from the app's Settings");
  }
  const base = creds.api_base || "https://reactable.app";
  const url = new URL(`${base}/api/research/raw`);
  url.searchParams.set("endpoint", endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { cookie: `reactable_session=${creds.access_token}` } });
  const body = (await res.json()) as any;
  if (res.status === 402) throw new Error(body.error === "out of credits" ? "out of credits — top up at reactable.app/dashboard/usage" : "research is part of Pro — reactable.app/pro");
  if (!res.ok) throw new Error(body.error || `research failed (${res.status})`);
  return body;
}

// ── grading: pure, deterministic (unit-tested by scripts/test-intel.ts) ──
function total(p: SeriesPoint): number {
  return Object.values(p.src).reduce((a, b) => a + b, 0);
}

function slope(series: SeriesPoint[], days: number): number {
  if (series.length < 2) return 0;
  const cut = series.slice(-days);
  if (cut.length < 2) return 0;
  const first = total(cut[0]);
  const last = total(cut[cut.length - 1]);
  if (first === 0) return last > 0 ? 1 : 0;
  return (last - first) / first;
}

export function gradeTopic(t: Pick<Topic, "series" | "firstSeen">, allVolumes: number[] = []): Grade {
  const s = t.series;
  if (s.length < 2) return "watching";
  // Weekly-normalized rates so 7-day and 30-day slopes are comparable.
  const r7 = slope(s, 7);
  const span30 = Math.min(30, s.length);
  const r30w = slope(s, span30) * (7 / span30);
  const accel = r7 - r30w;
  const breadth = Object.entries(s[s.length - 1].src).filter(([k, v]) => {
    const prev = s.length > 7 ? s[s.length - 8].src[k] ?? 0 : s[0].src[k] ?? 0;
    return v > prev;
  }).length;
  const vol = total(s[s.length - 1]);
  const sorted = allVolumes.slice().sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : Infinity;
  const ageDays = (Date.now() - new Date(t.firstSeen).getTime()) / 86_400_000;

  if (ageDays > 180 && Math.abs(r30w) < 0.05 && vol >= p50) return "evergreen";
  if (r7 < -0.1 && vol >= p50) return "peaked";
  if (accel > 0.5 && r7 > 0.3 && breadth >= 2) return "exploding";
  if (r7 > 0.1) return "rising";
  return "watching";
}

// ── snapshot sources: bounded counts per (topic, platform) ──
async function countFor(q: string, platform: string): Promise<number> {
  try {
    switch (platform) {
      case "tiktok": {
        const d = await research("/v1/tiktok/search/keyword", { query: q });
        const vids = d.search_item_list || d.videos || d.results || [];
        return vids.reduce((a: number, v: any) => a + (v.aweme_info?.statistics?.play_count || v.views || 0), 0) || vids.length;
      }
      case "youtube": {
        const d = await research("/v1/youtube/search", { query: q });
        const vids = d.videos || [];
        return vids.reduce((a: number, v: any) => a + (parseInt(v.viewCountInt || v.viewCount || "0", 10) || 0), 0) || vids.length;
      }
      case "reddit": {
        const d = await research("/v1/reddit/search", { query: q, sort: "new", timeframe: "week" });
        const posts = d.posts || d.results || [];
        return posts.reduce((a: number, p: any) => a + (p.score || 0) + (p.num_comments || 0), 0) || posts.length;
      }
      default:
        return 0;
    }
  } catch (e) {
    process.stderr.write(`snapshot ${platform}:${q}: ${e}\n`);
    return -1; // marks a gap, not a zero
  }
}

// ── verbs ──
export function track(kind: "topic" | "competitor", q: string, platforms: string[]): string {
  if (kind === "topic") {
    const list = topics();
    if (list.some((t) => t.q === q)) return `already tracking "${q}"`;
    list.push({
      id: `t-${Date.now().toString(36)}`,
      q,
      platforms: platforms.length ? platforms : ["tiktok", "youtube", "reddit"],
      firstSeen: new Date().toISOString(),
      grade: "watching",
      series: [],
    });
    writeJson(TOPICS, list);
    return `tracking topic "${q}" — run \`reactable intel snapshot\` to start the series`;
  }
  const list = competitors();
  const platform = platforms[0] || "youtube";
  if (list.some((c) => c.handle === q && c.platform === platform)) return `already tracking ${q}`;
  list.push({ id: `c-${Date.now().toString(36)}`, platform, handle: q, baseline: { p50: 0, p90: 0 }, lastVideos: [] });
  writeJson(COMPETITORS, list);
  return `tracking competitor ${q} on ${platform} — run \`reactable intel snapshot\``;
}

export function untrack(id: string): string {
  const t = topics().filter((x) => x.id !== id && x.q !== id);
  const c = competitors().filter((x) => x.id !== id && x.handle !== id);
  writeJson(TOPICS, t);
  writeJson(COMPETITORS, c);
  return `untracked ${id}`;
}

export async function snapshot(budget = 40, force = false): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const list = topics();
  const comps = competitors();
  if (!list.length && !comps.length) {
    return 'nothing tracked — `reactable intel track topic "<q>"` first';
  }
  let calls = 0;
  const lines: string[] = [];

  for (const t of list) {
    if (!force && t.series.some((p) => p.d === today)) continue;
    const src: Record<string, number> = {};
    for (const p of t.platforms) {
      if (calls >= budget) break;
      calls++;
      const n = await countFor(t.q, p);
      if (n >= 0) src[p] = n;
    }
    if (Object.keys(src).length) t.series.push({ d: today, src });
    const volumes = list.map((x) => (x.series.length ? total(x.series[x.series.length - 1]) : 0));
    const prev = t.grade;
    t.grade = gradeTopic(t, volumes);
    if (t.grade !== prev) lines.push(`${t.q}: ${prev} → ${t.grade}`);
    // G2: freeze today's grade as a forward prediction
    mkdirSync(INTEL_DIR, { recursive: true });
    writeFileSync(PREDICTIONS, `${JSON.stringify({ d: today, id: t.id, q: t.q, grade: t.grade, vol: t.series.length ? total(t.series[t.series.length - 1]) : 0 })}\n`, { flag: "a" });
  }

  for (const c of comps) {
    if (calls >= budget) break;
    calls++;
    try {
      const d = c.platform === "youtube"
        ? await research("/v1/youtube/channel-videos", { handle: c.handle })
        : await research("/v3/tiktok/profile/videos", { handle: c.handle });
      const vids = (d.videos || d.aweme_list || []).slice(0, 20).map((v: any) => ({
        id: String(v.id || v.aweme_id || ""),
        title: String(v.title || v.desc || "").slice(0, 80),
        views: parseInt(v.viewCountInt || v.viewCount || v.statistics?.play_count || "0", 10) || 0,
        at: String(v.publishedTime || v.create_time || ""),
      }));
      if (vids.length) {
        const sorted = vids.map((v: any) => v.views).sort((a: number, b: number) => a - b);
        c.baseline = { p50: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)] };
        c.lastVideos = vids;
      }
    } catch (e) {
      process.stderr.write(`snapshot ${c.handle}: ${e}\n`);
    }
  }

  writeJson(TOPICS, list);
  writeJson(COMPETITORS, comps);
  return [`snapshot ${today}: ${calls} calls`, ...lines].join("\n");
}

export function trends(): { topics: (Omit<Topic, "series"> & { volume: number; spark: number[] })[] } {
  return {
    topics: topics().map((t) => ({
      id: t.id,
      q: t.q,
      platforms: t.platforms,
      firstSeen: t.firstSeen,
      grade: t.grade,
      volume: t.series.length ? total(t.series[t.series.length - 1]) : 0,
      spark: t.series.slice(-14).map(total),
    })),
  };
}

export function breakouts(): { breakouts: { handle: string; platform: string; video: string; title: string; views: number; ratio: number }[] } {
  const out: any[] = [];
  for (const c of competitors()) {
    if (!c.baseline.p50) continue;
    for (const v of c.lastVideos) {
      const ratio = v.views / Math.max(1, c.baseline.p50);
      if (ratio >= 3) out.push({ handle: c.handle, platform: c.platform, video: v.id, title: v.title, views: v.views, ratio: Math.round(ratio * 10) / 10 });
    }
  }
  out.sort((a, b) => b.ratio - a.ratio);
  return { breakouts: out };
}

export async function radar(q: string, platform = "youtube"): Promise<any> {
  const d = platform === "tiktok"
    ? await research("/v1/tiktok/search/keyword", { query: q })
    : await research("/v1/youtube/search", { query: q, sortBy: "views" });
  const vids = (d.videos || d.search_item_list || []).slice(0, 10).map((v: any) => ({
    id: String(v.id || v.aweme_info?.aweme_id || ""),
    title: String(v.title || v.aweme_info?.desc || "").slice(0, 100),
    channel: v.channel?.title || v.aweme_info?.author?.nickname || "",
    views: parseInt(v.viewCountInt || v.viewCount || v.aweme_info?.statistics?.play_count || "0", 10) || 0,
  }));
  return { q, platform, top: vids };
}

export async function ads(company: string, library = "facebook"): Promise<any> {
  const d = library === "tiktok"
    ? await research("/v1/tiktok/adLibrary/search", { query: company })
    : await research("/v1/facebook/adLibrary/search", { query: company });
  return { company, library, ads: (d.ads || d.results || d.data || []).slice(0, 10) };
}
