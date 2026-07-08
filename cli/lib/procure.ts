// Edit intel — procurement (Engine B at scale, real content). Pulls real clips
// via the Scrape Creators-backed research proxy (key stays server-side),
// DOWNLOADS EVERYTHING we pull (video + image creative), and decompiles the
// videos to SKELETONS (structure kept, content stripped) into the corpus. The
// training artifact is the stripped skeleton — the leak check enforces that no
// verbatim source text survives. Images are kept raw for now (still-frame
// skeletonizing is a follow-up). Gated behind ToS/IP clearance (PLAN §11.1).
//
//   reactable procure "True Classic" --library facebook --n 5   brand ads (all creative)
//   reactable procure --url <video-url>                         one clip (also CC/PD URLs)
//
// NOTE (flagged follow-up): the SFT *input* for procured clips should be built
// from structural fields only (not the sidecar's verbatim OCR/transcript) so
// procured data is content-free on BOTH sides — a dataset.ts refinement.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { research } from "./intel.ts";
import { resolveRef, indexT0, sidecarDir } from "./video.ts";
import { decompile, writeSkeleton } from "./decompile.ts";
import { captureEpisode, editIntelDir } from "./edit-intel.ts";

type Media = { url: string; kind: "video" | "image" };

function procuredDir(): string {
  return join(editIntelDir(), "procured");
}

// classify a URL as video / image / not-media (by extension + CDN host)
function classify(u: string): "video" | "image" | null {
  let host = "";
  try { host = new URL(u).hostname; } catch { return null; }
  if (/\.mp4(\?|$)/i.test(u) || host.includes("video")) return "video"; // fbcdn video-*.xx.fbcdn.net
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(u) || host.includes("scontent")) return "image"; // fbcdn scontent-*
  return null;
}

// deep-scan an ad object for ALL media URLs (download-anything). Dedup by url.
function extractMedia(o: any): Media[] {
  const found: Media[] = [];
  const seen = new Set<string>();
  const seenObj = new Set<any>();
  const stack = [o];
  while (stack.length) {
    const x = stack.pop();
    if (!x || typeof x !== "object" || seenObj.has(x)) continue;
    seenObj.add(x);
    for (const v of Object.values(x)) {
      if (typeof v === "string" && /^https?:\/\//.test(v)) {
        const kind = classify(v);
        if (kind && !seen.has(v)) { seen.add(v); found.push({ url: v, kind }); }
      } else if (v && typeof v === "object") stack.push(v);
    }
  }
  return found;
}

async function gatherAds(query: string, library: string, n: number): Promise<any[]> {
  const ep = library === "tiktok" ? "/v1/tiktok/search/keyword" : "/v1/facebook/adLibrary/search/ads";
  const d = await research(ep, { query });
  const list: any[] = d.searchResults || d.ads || d.results || d.data || [];
  return list.slice(0, n);
}

async function download(url: string, dir: string, name: string, ext: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 45_000); // fbcdn can stall — fail fast
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000) throw new Error(`too small (${buf.length}B)`); // drops icons/pixels
    const file = join(dir, `${name}.${ext}`);
    writeFileSync(file, buf);
    return file;
  } finally {
    clearTimeout(to);
  }
}

export async function procure(opts: { url?: string; query?: string; library?: string; n?: number }): Promise<any> {
  const n = opts.n ?? 5;
  const dir = procuredDir();
  let items: Media[];
  if (opts.url) items = [{ url: opts.url, kind: "video" }];
  else if (opts.query) items = (await gatherAds(opts.query, opts.library ?? "facebook", n)).flatMap(extractMedia);
  else throw new Error("procure needs --url <video-url> or --query <brand> [--library facebook|tiktok]");
  if (!items.length) return { procured: 0, note: `no media found for "${opts.query}"` };

  const stamp = Date.now().toString(36);
  const results: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const { url, kind } = items[i];
    try {
      const file = await download(url, dir, `proc-${stamp}-${i}`, kind === "video" ? "mp4" : "jpg");
      if (kind === "image") {
        // keep raw for now — still-frame skeletonizing is a follow-up
        results.push({ kind, file, url: url.slice(0, 70), stored: true });
        continue;
      }
      const ref = resolveRef(file);
      indexT0(ref);
      const skeleton = decompile(ref, { verify: true }); // skeletonize + leak check
      if (skeleton.leak_check?.ok === false) throw new Error(`content leak — refused (${skeleton.leak_check.leaks.slice(0, 3).join(", ")})`);
      delete skeleton.leak_check;
      writeSkeleton(ref, skeleton);
      captureEpisode({
        source: "procured",
        media: file,
        sidecar: join(sidecarDir(file), "index.json"),
        intent: null,
        editSpec: skeleton, // content-stripped structure — the training target
        summary: `procured (${opts.query ?? "url"}): ${skeleton.timeline.length} shots${opts.query ? `, ${opts.library ?? "facebook"} ad` : ""}`,
        label: "gold",
        gate: { valid: true, leak_ok: true } as any,
      });
      results.push({ kind, file, url: url.slice(0, 70), shots: skeleton.timeline.length, leak_ok: true });
    } catch (e: any) {
      results.push({ kind, url: url.slice(0, 70), error: String(e?.message ?? e) });
    }
  }
  const ok = results.filter((r) => !r.error);
  return {
    query: opts.query ?? null,
    library: opts.query ? (opts.library ?? "facebook") : null,
    pulled: items.length,
    downloaded: { video: ok.filter((r) => r.kind === "video").length, image: ok.filter((r) => r.kind === "image").length },
    skeletonized: ok.filter((r) => r.kind === "video" && r.shots != null).length,
    failed: results.filter((r) => r.error).length,
    dir,
    results,
    note: "downloading ALL pulled creative (video+image); videos → content-stripped skeletons (leak-checked) in the corpus; images kept raw. Source clips local under edit-intel/procured/ (gitignored).",
  };
}
