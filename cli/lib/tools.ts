import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT } from "./paths.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export function toolsBinary(root = PROJECT): string | null {
  const env = process.env.REACTABLE_TOOLS;
  if (env && existsSync(env)) return env;

  const candidates = [
    join(root, "dist", "reactable-tools"),
    join(root, "tools", "target", "release", "reactable-tools"),
    join(root, "tools", "target", "debug", "reactable-tools"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return which("reactable-tools");
}

function which(cmd: string): string | null {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return null;
}

export function runTools(args: string[], root = PROJECT, json = false) {
  const bin = toolsBinary(root);
  if (!bin) throw new Error("reactable-tools not found — run: bash scripts/build-tools.sh");
  const r = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WB_DATA: root },
    stdio: json ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function resolveFfmpeg(root = PROJECT): string | null {
  if (process.env.REACTABLE_FFMPEG && existsSync(process.env.REACTABLE_FFMPEG)) {
    return process.env.REACTABLE_FFMPEG;
  }
  const bundled = join(dirname(toolsBinary(root) ?? ""), "ffmpeg");
  if (bundled && existsSync(bundled)) return bundled;
  const r = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function resolveHyperframes(): { ok: boolean; via: string; detail?: string } {
  const global = spawnSync("hyperframes", ["--version"], { stdio: "ignore" });
  if (global.status === 0) return { ok: true, via: "global" };
  const npx = spawnSync("npx", ["hyperframes", "--version"], { stdio: "ignore" });
  if (npx.status === 0) return { ok: true, via: "npx" };
  return { ok: false, via: "none", detail: "npm i -g hyperframes or npx hyperframes" };
}

export type ToolCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export function toolsDoctor(root = PROJECT): { ok: boolean; checks: ToolCheck[] } {
  const checks: ToolCheck[] = [];

  const sidecar = toolsBinary(root);
  checks.push({
    name: "reactable-tools",
    ok: !!sidecar,
    detail: sidecar ?? "bash scripts/build-tools.sh",
  });

  if (sidecar) {
    const r = runTools(["doctor"], root, true);
    try {
      const report = JSON.parse(r.stdout);
      checks.push({
        name: "ml-backend",
        ok: report.backend === "rust-mlx",
        detail: report.backend ?? "unknown",
      });
      for (const t of report.tools ?? []) {
        checks.push({
          name: t.name,
          ok: t.ok,
          detail: t.detail ?? t.path,
        });
      }
    } catch {
      checks.push({ name: "tools-sidecar", ok: false, detail: r.stderr || "doctor parse failed" });
    }
  }

  const ff = resolveFfmpeg(root);
  if (!checks.some((c) => c.name === "ffmpeg" && c.ok)) {
    checks.push({ name: "ffmpeg", ok: !!ff, detail: ff ?? "brew install ffmpeg" });
  }

  const hf = resolveHyperframes();
  checks.push({ name: "hyperframes", ok: hf.ok, detail: hf.detail ?? hf.via });

  const ok =
    checks.some((c) => c.name === "ffmpeg" && c.ok) &&
    checks.some((c) => c.name === "reactable-tools" && c.ok) &&
    checks.some((c) => c.name === "mlx-stt" && c.ok);

  return { ok, checks };
}

export function installHyperframesSkills() {
  return spawnSync("npx", ["hyperframes", "init"], { stdio: "inherit" }).status === 0;
}
