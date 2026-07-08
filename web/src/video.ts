/**
 * Video models on the gateway — Gemini Omni Flash (generate + EDIT, ≤10s)
 * and Veo 3 / Veo 3 Fast. Billed to OUR GCP project (GEMINI_API_KEY), sold
 * as gateway credits at ~2× COGS. Charges are UPFRONT-ATOMIC per the
 * security rule; failed generations refund.
 *
 * COGS (2026-07): omni-flash ≈ $0.10/s out · veo-3 $0.40/s · veo-3-fast $0.15/s
 * Retail (credits @ $0.002): omni 100 cr/s · veo3 400 cr/s · veo3fast 150 cr/s
 */
import type { Env } from "./types";
import { ledgerApply } from "./ledger";
import { econAdd } from "./econ";

const GL = "https://generativelanguage.googleapis.com/v1beta";

export const VIDEO_PRICING: Record<string, { crPerSec: number; cogsPerSec: number; maxSec: number }> = {
  "omni-flash": { crPerSec: 100, cogsPerSec: 0.1, maxSec: 10 },
  "veo-3": { crPerSec: 400, cogsPerSec: 0.4, maxSec: 8 },
  "veo-3-fast": { crPerSec: 150, cogsPerSec: 0.15, maxSec: 8 },
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });

async function uploadToFilesApi(env: Env, bytes: ArrayBuffer, mime: string): Promise<string> {
  const start = await fetch(`${GL}/files?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime,
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "reactable-edit-input" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("files api: no upload url");
  const fin = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0" },
    body: bytes,
  });
  const file = ((await fin.json()) as any).file;
  // Wait for ACTIVE (short poll — videos process fast at these sizes).
  for (let i = 0; i < 30; i++) {
    if (file.state === "ACTIVE") break;
    await new Promise((r) => setTimeout(r, 2000));
    const check = (await (await fetch(`${GL}/${file.name}?key=${env.GEMINI_API_KEY}`)).json()) as any;
    if (check.state === "ACTIVE") break;
    if (check.state === "FAILED") throw new Error("files api: processing failed");
  }
  return file.uri || file.name;
}

export async function gatewayVideo(email: string, req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ ok: false, error: "video models not configured" }, { status: 503 });
  const body = (await req.json()) as {
    model?: string; prompt?: string; seconds?: number; videoUrl?: string; action?: string;
  };
  const model = body.model || "omni-flash";
  const pricing = VIDEO_PRICING[model];
  if (!pricing) return json({ ok: false, error: `model must be one of: ${Object.keys(VIDEO_PRICING).join(", ")}` }, { status: 400 });
  const seconds = Math.min(Math.max(1, body.seconds || 8), pricing.maxSec);
  const cost = seconds * pricing.crPerSec;
  const ref = `video:${model}:${seconds}s`;

  // Upfront-atomic charge; refund on any failure below.
  const after = await ledgerApply(env.LEDGER, email, "charge", cost, ref);
  if (after < 0) {
    await ledgerApply(env.LEDGER, email, "grant", cost, `refund:${ref}`);
    return json({ ok: false, error: "out of credits", needed: cost, topup: "/dashboard/usage" }, { status: 402 });
  }
  const refund = () => ledgerApply(env.LEDGER, email, "grant", cost, `refund:${ref}`);

  try {
    if (model === "omni-flash") {
      // Interactions API: generation, or editing when videoUrl provided.
      let input: unknown = body.prompt || "";
      if (body.videoUrl) {
        const src = await fetch(body.videoUrl);
        if (!src.ok) throw new Error("could not fetch videoUrl");
        const uri = await uploadToFilesApi(env, await src.arrayBuffer(), src.headers.get("content-type") || "video/mp4");
        input = [{ type: "document", uri }, { type: "text", text: body.prompt || "" }];
      }
      const res = await fetch(`${GL}/interactions?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-omni-flash-preview",
          input,
          response_format: { type: "video", delivery: "uri" },
        }),
      });
      const d = (await res.json()) as any;
      if (!res.ok) throw new Error(d.error?.message || `omni ${res.status}`);
      const steps = d.steps || [];
      let uri = "", inline = "";
      for (const s of steps) for (const c of s.content || []) {
        if (c.uri) uri = c.uri;
        if (c.data) inline = "inline";
      }
      await econAdd(env, "spent:video", cost);
      await econAdd(env, "video_seconds", seconds);
      return json({ ok: true, model, charged: cost, uri: uri || undefined, inline: inline || undefined, raw_steps: uri ? undefined : steps.length });
    }

    // Veo: long-running operation; return op name + poll route.
    const veoModel = model === "veo-3" ? "veo-3.1-generate-001" : "veo-3.1-fast-generate-001";
    const res = await fetch(`${GL}/models/${veoModel}:predictLongRunning?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: body.prompt || "" }],
        parameters: { durationSeconds: seconds, aspectRatio: "16:9" },
      }),
    });
    const d = (await res.json()) as any;
    if (!res.ok || !d.name) throw new Error(d.error?.message || `veo ${res.status}`);
    await econAdd(env, "spent:video", cost);
    await econAdd(env, "video_seconds", seconds);
    return json({ ok: true, model, charged: cost, operation: d.name, poll: `/api/gateway/video/status?op=${encodeURIComponent(d.name)}` });
  } catch (e) {
    ctx.waitUntil(refund());
    return json({ ok: false, error: e instanceof Error ? e.message : String(e), refunded: cost }, { status: 502 });
  }
}

export async function gatewayVideoStatus(req: Request, env: Env): Promise<Response> {
  const op = new URL(req.url).searchParams.get("op") || "";
  if (!op) return json({ ok: false, error: "op required" }, { status: 400 });
  const res = await fetch(`${GL}/${op}?key=${env.GEMINI_API_KEY}`);
  const d = (await res.json()) as any;
  const uri = d.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    || d.response?.generatedVideos?.[0]?.video?.uri;
  return json({ ok: true, done: !!d.done, uri, error: d.error?.message });
}
