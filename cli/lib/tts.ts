import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT } from "./paths.ts";
import { runTools } from "./tools.ts";

export function ttsSpeak(
  text: string,
  output: string,
  voice = "af_heart",
  speed = 1.0,
) {
  const out = output.startsWith("/") ? output : join(PROJECT, output);
  mkdirSync(join(out, ".."), { recursive: true });
  const args = ["tts-speak", "--text", text, "--output", out, "--voice", voice, "--speed", String(speed)];
  const r = runTools(args, PROJECT, true);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "kokoro speak failed");
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() || "{}";
  return JSON.parse(line);
}

export function ttsDoctor() {
  const r = runTools(["doctor"], PROJECT, true);
  try {
    const report = JSON.parse(r.stdout);
    const stt = report.tools?.find((t: { name: string }) => t.name === "mlx-stt");
    const tts = report.tools?.find((t: { name: string }) => t.name === "mlx-tts");
    return {
      backend: report.backend ?? "rust-mlx",
      moonshine: { ok: Boolean(stt?.ok), via: stt?.detail ?? "voice-stt + MLX" },
      kokoro: { ok: Boolean(tts?.ok), via: tts?.detail ?? "voice-tts + MLX" },
    };
  } catch {
    return {
      backend: "rust-mlx",
      moonshine: { ok: false, via: "reactable-tools doctor failed" },
      kokoro: { ok: false, via: "reactable-tools doctor failed" },
    };
  }
}

export function ttsAvailable() {
  return ttsDoctor().kokoro.ok;
}
