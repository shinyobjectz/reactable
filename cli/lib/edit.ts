// Edit intel — Swing ① : does a FROZEN model, given our skeleton + an intent,
// propose a good edit? Feeds the enriched edit-skeleton + intent to MiniMax,
// gets an ordered keep/reorder/punch plan, renders it so we can eyeball whether
// the representation + a smart model already edit well (no training).
// docs/PLAN.omni-editing-model.work §9 (edit-direction go/no-go).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { minimaxChat } from "./minimax.ts";
import { decompile } from "./decompile.ts";
import { sidecarDir, type Ref } from "./video.ts";
import { renderEdit, type EditPlan } from "./edit-render.ts";
import { captureEpisode, editIntelDir } from "./edit-intel.ts";
import { captureTrajectory } from "./trajectory.ts";

const EDIT_SYSTEM = `You are a senior video editor. You get an edit-skeleton (a shot-by-shot analysis of ONE source clip) and an INTENT. Produce an edit as JSON ONLY — no prose:
{"keep":[{"shot":"s3","in_ms":N,"out_ms":N,"zoom":{"cx":0.5,"cy":0.4,"scale":1.4}}],"notes":"one line of editorial reasoning"}
Rules:
- Choose the shots that serve the INTENT and place them in the ORDER they should play (reorder freely — you need not keep source order).
- in_ms/out_ms must lie inside the chosen shot's [in..out]; tighten a shot to its strongest moment.
- Add "zoom" only where a punch-in helps (product reveal, a face): cx/cy normalized [0,1], scale 1.2–1.8. Omit otherwise.
- Honor any target duration in the INTENT (sum of kept durations ≈ target). Favor shots with strong action tags, motion, faces, or product.
- Output ONLY the JSON object.`;

function summarize(skel: any): string {
  const L: string[] = [`source: ${skel.source.width}x${skel.source.height}, ${Math.round(skel.source.duration_ms / 1000)}s, ${skel.timeline.length} shots`];
  for (const seg of skel.timeline) {
    const p = [`${seg.shot} [${seg.in_ms}..${seg.out_ms}]`];
    if (seg.camera_move) p.push(`cam=${seg.camera_move}`);
    if (seg.transition_in && seg.transition_in !== "cut") p.push(seg.transition_in);
    if (seg.visual_group != null) p.push(`g${seg.visual_group}`);
    if (seg.tags?.length) p.push(`tags=${seg.tags.join("|")}`);
    const txt = seg.layers.filter((l: any) => l.role !== "subject").length;
    if (txt) p.push(`text=${txt}`);
    L.push("  " + p.join(" "));
  }
  if (skel.match_cuts?.length) L.push("match-cuts: " + skel.match_cuts.map((m: any) => `${m.a}~${m.b}`).join(" "));
  return L.join("\n");
}

function parsePlan(reply: string): EditPlan | null {
  if (!reply) return null;
  const s = reply.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j < 0 || j < i) return null;
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    return Array.isArray(o.keep) ? o : null;
  } catch {
    return null;
  }
}

export async function proposeEdit(ref: Ref, intent: string, opts: { k?: number; render?: boolean } = {}): Promise<any> {
  const skel = decompile(ref);
  const prompt = `INTENT: ${intent}\n\nEDIT-SKELETON:\n${summarize(skel)}`;
  const k = opts.k ?? 1;
  let plan: EditPlan | null = null, model = "", err = "";
  for (let i = 0; i < k; i++) {
    const r = await minimaxChat(prompt, { system: EDIT_SYSTEM });
    if (!r.ok) { err = r.error ?? "call failed"; continue; }
    model = r.model ?? model;
    const p = parsePlan(r.reply ?? "");
    if (p) { plan = p; break; }
  }
  if (!plan) return { ref: ref.take ?? ref.media, intent, error: `no valid edit plan — ${err || "unparseable"}` };

  const dur = skel.source.duration_ms;
  plan.keep = (plan.keep ?? []).filter((kk) => kk.in_ms < kk.out_ms && kk.in_ms >= 0 && kk.out_ms <= dur + 1);
  const kept_ms = plan.keep.reduce((a, kk) => a + (kk.out_ms - kk.in_ms), 0);

  let render: string | null = null;
  if (opts.render && plan.keep.length) {
    const outDir = join(editIntelDir(), "edits");
    mkdirSync(outDir, { recursive: true });
    const base = (ref.media.split("/").pop() || "clip").replace(/\.[^.]+$/, "");
    render = renderEdit(ref.media, plan, join(outDir, `${base}-${Date.now().toString(36)}.mp4`));
  }

  captureEpisode({
    source: "edit",
    take: ref.take ?? null,
    media: ref.media,
    sidecar: join(sidecarDir(ref.media), "index.json"),
    intent,
    editSpec: plan,
    render,
    summary: `edit: "${intent.slice(0, 48)}" → ${plan.keep.length} shots, ${(kept_ms / 1000).toFixed(1)}s`,
    label: "model",
  });

  // Trajectory contract (SPEC.action-space.work) — the training/reward substrate.
  const lastShot = plan.keep[plan.keep.length - 1]?.shot;
  const lastShotTags = skel.timeline.find((s: any) => s.shot === lastShot)?.tags ?? [];
  const traj = captureTrajectory({
    sourceDigest: `${skel.source.width}x${skel.source.height} ${skel.timeline.length}sh`,
    intent, plan, render, producer: "minimax", label: "model",
    sourceDurationMs: dur, lastShotTags,
  });

  return {
    ref: ref.take ?? ref.media,
    reward: traj?.reward,
    intent,
    model,
    shots_kept: plan.keep.length,
    duration_s: +(kept_ms / 1000).toFixed(1),
    notes: plan.notes,
    plan: plan.keep.map((kk) => `${kk.shot ?? "?"} ${kk.in_ms}-${kk.out_ms}${kk.zoom ? ` +punch(${kk.zoom.scale}x)` : ""}`),
    render,
  };
}
