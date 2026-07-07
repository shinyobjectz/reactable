import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT, takePath } from "./paths.ts";
import { runTools } from "./tools.ts";

export function transcribeTake(id: string, model = "UsefulSensors/moonshine-tiny") {
  const dir = takePath(id);
  const stage = join(dir, "stage.mov");
  const cam = join(dir, "cam.mov");
  // Preference: mic-clean.wav (denoised) → mic.wav (voice sidecar) →
  // audio.wav (preprocessed) → stage.mov (system audio) → cam.mov (last resort).
  const candidates = [join(dir, "mic-clean.wav"), join(dir, "mic.wav"), join(dir, "audio.wav"), stage, cam];
  const input = candidates.find((p) => existsSync(p));
  if (!input) throw new Error(`no media in take ${id}`);

  const out = join(dir, "transcript.json");
  const args = ["transcribe", input, "--model", model, "--output", out];
  const r = runTools(args, PROJECT, true);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "transcribe failed");
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() || "{}";
  const summary = JSON.parse(line);
  return { ...summary, path: out };
}

export function removeFiller(id: string, aggressive = false) {
  const dir = takePath(id);
  const transcript = join(dir, "transcript.json");
  if (!existsSync(transcript)) throw new Error(`run: reactable takes transcribe ${id}`);
  const out = join(dir, "filler-cuts.json");
  const args = ["remove-filler", transcript, "--output", out];
  if (aggressive) args.push("--aggressive");
  const r = runTools(args, PROJECT, true);
  if (r.status !== 0) throw new Error(r.stderr || "remove-filler failed");
  return JSON.parse(r.stdout.split("\n").filter(Boolean).pop() || "{}");
}

export function trimSilence(id: string) {
  const dir = takePath(id);
  const wav = join(dir, "audio.wav");
  const src = existsSync(wav) ? wav : join(dir, "stage.mov");
  const out = join(dir, "audio-trimmed.wav");
  const r = runTools(["trim-silence", src, out, "--noise-db=-40"], PROJECT, true);
  if (r.status !== 0) throw new Error(r.stderr || "trim-silence failed");
  return { ok: true, output: out };
}

export function writeWordCaptions(id: string) {
  const dir = takePath(id);
  const transcript = join(dir, "transcript.json");
  if (!existsSync(transcript)) throw new Error("transcript missing");
  const t = JSON.parse(readFileSync(transcript, "utf8"));
  const words = t.words ?? [];
  const lines: string[] = ["WEBVTT", ""];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const start = fmtVtt(w.start ?? 0);
    const end = fmtVtt(w.end ?? (w.start ?? 0) + 0.5);
    lines.push(String(i + 1), `${start} --> ${end}`, w.word ?? "", "");
  }
  mkdirSync(join(dir, "out"), { recursive: true });
  const vtt = join(dir, "out", "captions.vtt");
  writeFileSync(vtt, lines.join("\n"));
  return vtt;
}

function fmtVtt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function applyFillerCutsToEdit(id: string) {
  const dir = takePath(id);
  const cutsPath = join(dir, "filler-cuts.json");
  if (!existsSync(cutsPath)) throw new Error("filler-cuts.json missing — run edit remove-filler first");
  const cuts = JSON.parse(readFileSync(cutsPath, "utf8"));
  const editPath = join(dir, "edit.json");
  const edit = existsSync(editPath) ? JSON.parse(readFileSync(editPath, "utf8")) : {};
  edit.speech = { ...(edit.speech ?? {}), fillerCuts: cuts.cuts ?? [] };
  writeFileSync(editPath, JSON.stringify(edit, null, 2));
  return editPath;
}
