// Edit intel — the edit executor (Swing ①). Renders a model-proposed edit plan
// against a source clip so we can EYEBALL whether the frozen model cut well.
// Approach: extract each kept range to its own temp segment (accurate output
// seek + optional per-segment punch-in), then concat them in the model's order.
// (Doing it in one filtergraph fails — an input pad [0:v] can't be reused N
// times without split; that bug produced N× full-source renders.)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { PROJECT } from "./paths.ts";
import { resolveFfmpeg } from "./tools.ts";

export type EditKeep = { shot?: string; in_ms: number; out_ms: number; zoom?: { cx: number; cy: number; scale: number } };
export type EditPlan = { keep: EditKeep[]; notes?: string };

function probeMeta(ffprobe: string, clip: string): { W: number; H: number; hasAudio: boolean } {
  const j = JSON.parse(execFileSync(existsSync(ffprobe) ? ffprobe : "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", clip], { encoding: "utf8" }));
  const v = j.streams.find((s: any) => s.codec_type === "video");
  return { W: v.width, H: v.height, hasAudio: j.streams.some((s: any) => s.codec_type === "audio") };
}

export function renderEdit(clip: string, plan: EditPlan, outPath: string): string {
  const ffmpeg = resolveFfmpeg(PROJECT);
  if (!ffmpeg) throw new Error("ffmpeg not found");
  const { W, H, hasAudio } = probeMeta(join(dirname(ffmpeg), "ffprobe"), clip);
  const fps = 30;
  const keep = (plan.keep ?? []).filter((k) => k.out_ms > k.in_ms);
  if (!keep.length) throw new Error("edit plan has no valid keep segments");

  const work = join(tmpdir(), `edit-${Date.now().toString(36)}-${Math.round(keep.length)}`);
  mkdirSync(work, { recursive: true });
  const segs: string[] = [];
  try {
    keep.forEach((k, i) => {
      const dur = (k.out_ms - k.in_ms) / 1000;
      const seg = join(work, `seg${String(i).padStart(3, "0")}.mp4`);
      let vf = `fps=${fps},setsar=1`;
      if (k.zoom) {
        const DF = Math.max(2, Math.round(dur * fps));
        const R = Math.max(1, Math.round(0.4 * fps));
        const DZ = (k.zoom.scale - 1).toFixed(3);
        const SC = k.zoom.scale;
        const z = `if(lt(on,${R}),1+${DZ}*on/${R},if(lt(on,${DF - R}),${SC},${SC}-${DZ}*(on-${DF - R})/${R}))`;
        vf += `,zoompan=z='${z}':x='iw*${(+k.zoom.cx).toFixed(3)}-(iw/zoom)/2':y='ih*${(+k.zoom.cy).toFixed(3)}-(ih/zoom)/2':d=1:s=${W}x${H}:fps=${fps}`;
      }
      // -ss AFTER -i = accurate (output) seek; -t = duration
      const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", clip, "-ss", (k.in_ms / 1000).toFixed(3), "-t", dur.toFixed(3), "-vf", vf, "-r", String(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-video_track_timescale", "30000"];
      if (hasAudio) args.push("-c:a", "aac", "-ar", "48000", "-ac", "2"); else args.push("-an");
      args.push(seg);
      execFileSync(ffmpeg, args, { maxBuffer: 512 * 1024 * 1024 });
      if (existsSync(seg)) segs.push(seg);
    });
    if (!segs.length) throw new Error("no segments rendered");
    const listF = join(work, "list.txt");
    writeFileSync(listF, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    // concat the uniformly-encoded segments (stream copy; params match by construction)
    try {
      execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listF, "-c", "copy", outPath], { maxBuffer: 512 * 1024 * 1024 });
    } catch {
      // fallback: re-encode the concat if copy trips on a param mismatch
      execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listF, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(hasAudio ? ["-c:a", "aac"] : ["-an"]), outPath], { maxBuffer: 512 * 1024 * 1024 });
    }
    return outPath;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
