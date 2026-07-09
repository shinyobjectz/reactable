// Edit intel — brand profile (corpus-level identity). Aggregates ACROSS a set
// of clips' sidecars to derive, UNSUPERVISED: the brand(s), the hero product(s),
// and the category — from what RECURS, never from a per-clip label and never
// from a brand-specific list. Multi-brand + temporal aware (partnerships,
// reviews). Confidence-gated so it won't force a winner on ambiguous sets.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mvcTextEmbed } from "./video.ts";

// Generic English wordlist → separate BRANDs (non-dictionary proper nouns) from
// descriptor words (dictionary). No brand-specific entries.
function loadDict(): Set<string> {
  for (const p of ["/usr/share/dict/words", "/usr/share/dict/web2"]) {
    if (existsSync(p)) return new Set(readFileSync(p, "utf8").split("\n").map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3));
  }
  return new Set();
}

const STOP = new Set("the and for with you your are this that not from all now new out off our can get one see how why who what when more most best make take use com www http https inc llc official".split(/\s+/));

// The ONLY vocab — broad DTC categories, generic. Used solely to NAME the
// recurring product; the winner emerges from the footage.
const CATEGORY_VOCAB = ["sunglasses", "eyewear", "goggles", "apparel", "clothing", "footwear", "shoes", "watch", "jewelry", "handbag", "backpack", "cosmetics", "skincare", "makeup", "haircare", "food", "beverage", "cookware", "kitchenware", "furniture", "home decor", "electronics", "headphones", "smartphone", "camera", "car", "bicycle", "fitness equipment", "supplements", "toys", "tools", "pet products", "luggage"];

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

type Tok = { clips: Set<string>; hits: number; tcs: { clip: string; t_ms: number }[]; dict: boolean };

// fuzzy-merge near-duplicate OCR reads (rvo≈revo≈rev) — generic, by edit
// distance / substring, NOT a hand-mapping.
function mergeCandidates(entries: [string, Tok][]): any[] {
  const sorted = entries.sort((a, b) => b[1].hits - a[1].hits);
  const groups: { canon: string; variants: string[]; clips: Set<string>; hits: number; tcs: any[] }[] = [];
  for (const [w, e] of sorted) {
    const g = groups.find((g) => g.variants.some((v) => (w.length >= 3 && (v.includes(w) || w.includes(v))) || lev(v, w) <= 1));
    if (g) { g.variants.push(w); e.clips.forEach((c) => g.clips.add(c)); g.hits += e.hits; g.tcs.push(...e.tcs); }
    else groups.push({ canon: w, variants: [w], clips: new Set(e.clips), hits: e.hits, tcs: [...e.tcs] });
  }
  return groups.map((g) => ({ name: g.canon.toUpperCase(), variants: g.variants, clips: g.clips.size, hits: g.hits, tcs: g.tcs })).sort((a, b) => b.clips - a.clips || b.hits - a.hits);
}

const norm = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0) / (norm(a) * norm(b));

// Zero-shot category by per-shot CONFIDENT voting: each shot votes its top
// category only if it clears a score + margin gate (so ambiguous shots abstain,
// avoiding over-tagging). Category ranked by cross-clip votes.
function visualCategory(shotEmb: { clip: string; emb: number[] }[]): any {
  const vocabEmb = CATEGORY_VOCAB.map((c) => ({ c, e: mvcTextEmbed(c) })).filter((x) => x.e) as { c: string; e: number[] }[];
  if (vocabEmb.length < 3 || !shotEmb.length) return null;
  const votes: Record<string, Set<string>> = {}, hits: Record<string, number> = {};
  let voted = 0;
  for (const s of shotEmb) {
    const scored = vocabEmb.map((v) => ({ c: v.c, sc: cos(s.emb, v.e) * 100 })).sort((a, b) => b.sc - a.sc);
    if (scored[0].sc > 2.0 && scored[0].sc - scored[1].sc > 0.5) { // confident vote only
      (votes[scored[0].c] ||= new Set()).add(s.clip); hits[scored[0].c] = (hits[scored[0].c] ?? 0) + 1; voted++;
    }
  }
  const ranked = Object.entries(votes).map(([c, cl]) => ({ category: c, clips: cl.size, shots: hits[c] })).sort((a, b) => b.clips - a.clips || b.shots - a.shots);
  return { ranked: ranked.slice(0, 4), shots_voted: voted, shots_total: shotEmb.length };
}

export function brandProfile(dir: string): any {
  const dict = loadDict();
  const clips = readdirSync(dir).filter((f) => f.endsWith(".intel")).filter((d) => existsSync(join(dir, d, "index.json")));
  const tok: Record<string, Tok> = {};
  const shotEmb: { clip: string; emb: number[] }[] = [];
  let withMvc = 0;

  for (const c of clips) {
    const name = c.replace(".intel", "");
    const idx = JSON.parse(readFileSync(join(dir, c, "index.json"), "utf8"));
    const seen = new Set<string>();
    for (const f of idx.ocr ?? []) for (const item of f.items ?? []) {
      for (const raw of String(item.text ?? "").split(/\s+/)) {
        const w = raw.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
        if (w.length < 3 || STOP.has(w) || /^\d/.test(w)) continue;
        const e = (tok[w] ||= { clips: new Set(), hits: 0, tcs: [], dict: dict.size ? dict.has(w) : false });
        e.hits++; e.tcs.push({ clip: name, t_ms: f.t_ms });
        if (!seen.has(w)) { e.clips.add(name); seen.add(w); }
      }
    }
    const mvcp = join(dir, c, "assets", "mvc-clips.json");
    if (existsSync(mvcp)) {
      try { for (const x of JSON.parse(readFileSync(mvcp, "utf8")).clips ?? []) if (x.emb) shotEmb.push({ clip: name, emb: x.emb }); withMvc++; } catch { /* skip */ }
    }
  }

  // BRAND candidates: non-dictionary tokens, fuzzy-merged, recurring across ≥2
  // clips. Also exclude generic category words (catches compound/inflected
  // descriptors the system wordlist misses, e.g. "sunglasses").
  const catSet = new Set(CATEGORY_VOCAB.flatMap((c) => c.split(/\s+/)));
  const nonDict = Object.entries(tok).filter(([w, e]) => !e.dict && !catSet.has(w));
  const merged = mergeCandidates(nonDict).filter((b) => b.clips >= 2);
  const brands = merged.map((b) => ({
    name: b.name, variants: b.variants, clips: b.clips, mentions: b.hits,
    coverage: +(b.clips / clips.length).toFixed(2),
    // temporal: where this brand appears (clip → mention count)
    where: Object.entries(b.tcs.reduce((a: any, t: any) => { a[t.clip] = (a[t.clip] ?? 0) + 1; return a; }, {})).map(([clip, n]) => ({ clip, mentions: n })).sort((x: any, y: any) => y.mentions - x.mentions),
  }));

  // CATEGORY: recurring dictionary OCR words (descriptors) + zero-shot visual
  const ocrDescriptors = Object.entries(tok).filter(([, e]) => e.dict && e.clips.size >= 2).map(([w, e]) => ({ word: w, clips: e.clips.size })).sort((a, b) => b.clips - a.clips).slice(0, 8);
  const visual = shotEmb.length >= 3 ? visualCategory(shotEmb) : null;

  // confidence: strong single brand if the top covers most clips and dominates
  const top = brands[0];
  const conf = !top ? "none" : top.coverage >= 0.6 && (!brands[1] || top.clips >= brands[1].clips * 2) ? "high" : brands.length > 1 ? "multi/ambiguous" : "low";

  return {
    dir, clips: clips.length, clips_with_visual: withMvc, dict_loaded: dict.size > 0,
    brands: brands.slice(0, 6),
    category: { from_ocr: ocrDescriptors.map((d) => d.word), visual: visual?.ranked ?? null, visual_coverage: visual ? `${visual.shots_voted}/${visual.shots_total} shots voted` : "no mvc pass yet" },
    confidence: conf,
    note: dict.size ? undefined : "no system dictionary found — brand/descriptor split degraded (treated all as brand candidates)",
  };
}
