import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { takePath } from "./paths.ts";

// Voiceover cleanup — DeepFilterNet3 (ML denoiser) with an ffmpeg spectral
// fallback. Produces mic-clean.wav next to mic.wav; composite and transcribe
// prefer the cleaned track automatically.

const DF_VERSION = "0.5.6";

export function deepFilterPath(): string | null {
  const candidates = [
    process.env.REACTABLE_DEEP_FILTER,
    join(homedir(), ".reactable", "tools", "deep-filter"),
  ].filter(Boolean) as string[];
  for (const p of candidates) if (existsSync(p)) return p;
  const which = spawnSync("which", ["deep-filter"], { encoding: "utf8" });
  const found = which.stdout?.trim();
  return found ? found : null;
}

export function installDeepFilter(): string {
  const dir = join(homedir(), ".reactable", "tools");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "deep-filter");
  if (existsSync(dest)) return dest;
  const arch = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${DF_VERSION}/deep-filter-${DF_VERSION}-${arch}`;
  const r = spawnSync("curl", ["-fsSL", "-o", dest, url], { stdio: "inherit" });
  if (r.status !== 0 || !existsSync(dest)) throw new Error(`download failed: ${url}`);
  chmodSync(dest, 0o755);
  return dest;
}

/** Clean background noise from a take's voice track → mic-clean.wav. */
export function cleanVoice(id: string, opts: { aggressive?: boolean } = {}) {
  const dir = takePath(id);
  // Prefer the voice sidecar; fall back to extracting audio from stage.mov.
  let input = join(dir, "mic.wav");
  if (!existsSync(input)) {
    const stage = join(dir, "stage.mov");
    if (!existsSync(stage)) throw new Error(`no mic.wav or stage.mov in take ${id}`);
    input = join(dir, "mic-extracted.wav");
    const ex = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", stage, "-vn", "-ac", "1", "-ar", "48000", input],
      { encoding: "utf8" }
    );
    if (ex.status !== 0) throw new Error(ex.stderr || "audio extract failed");
  }

  const out = join(dir, "mic-clean.wav");
  const df = deepFilterPath();
  if (df) {
    const tmp = join(dir, ".df-out");
    mkdirSync(tmp, { recursive: true });
    const atten = opts.aggressive ? "100" : "60";
    const r = spawnSync(df, ["--pf", "-a", atten, "-o", tmp, input], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || "deep-filter failed");
    renameSync(join(tmp, input.split("/").pop()!), out);
    return { ok: true, engine: `DeepFilterNet3 v${DF_VERSION}`, input, output: out };
  }

  // Fallback: ffmpeg spectral denoise + high-pass + loudness normalize.
  const nf = opts.aggressive ? "-30" : "-22";
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", input, "-af",
     `highpass=f=80,afftdn=nf=${nf}:tn=1,loudnorm=I=-16:TP=-1.5`, out],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(r.stderr || "ffmpeg denoise failed");
  return {
    ok: true,
    engine: "ffmpeg afftdn (fallback — run: reactable tools install deep-filter)",
    input,
    output: out,
  };
}
