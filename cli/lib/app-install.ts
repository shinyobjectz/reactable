import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const DEFAULT_URL = "https://reactable.app/download/Reactable.dmg";

export async function downloadDmg(url = process.env.REACTABLE_DOWNLOAD_URL || DEFAULT_URL) {
  const dest = join("/tmp", `Reactable-${Date.now()}.dmg`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), createWriteStream(dest));
  return dest;
}

export function installMacApp(dmgPath: string, dest = "/Applications/Reactable.app") {
  if (process.platform !== "darwin") {
    throw new Error("reactable install app is macOS only");
  }
  const mount = spawnSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-quiet"], { encoding: "utf8" });
  if (mount.status !== 0) throw new Error(`hdiutil attach failed: ${mount.stderr || mount.stdout}`);

  const vol = mount.stdout.trim().split("\n").pop()?.split("\t").pop()?.trim();
  if (!vol) throw new Error("could not parse dmg mount volume");

  try {
    const src = join(vol, "Reactable.app");
    if (!existsSync(src)) throw new Error(`Reactable.app not found on volume ${vol}`);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    mkdirSync("/Applications", { recursive: true });
    const cp = spawnSync("cp", ["-R", src, dest], { stdio: "inherit" });
    if (cp.status !== 0) throw new Error("copy to /Applications failed");
    return dest;
  } finally {
    spawnSync("hdiutil", ["detach", vol, "-quiet"]);
  }
}

export async function installAppFromWeb() {
  const dmg = await downloadDmg();
  const dest = installMacApp(dmg);
  rmSync(dmg, { force: true });
  return dest;
}
