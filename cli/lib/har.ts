import { PROJECT } from "./paths.ts";
import { runTools } from "./tools.ts";

export function harCapture(url: string, project = "default") {
  const r = runTools(["har-capture", url, "--project", project], PROJECT, true);
  if (r.status !== 0) throw new Error(r.stderr || "har capture failed");
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() || "{}";
  return JSON.parse(line);
}

export function harList(project = "default") {
  const r = runTools(["har-list", "--project", project], PROJECT, true);
  if (r.status !== 0) throw new Error(r.stderr || "har list failed");
  return JSON.parse(r.stdout);
}

export async function blitzReplay(ref: string, project: string, port: string) {
  const res = await fetch(`http://127.0.0.1:${port}/reactable/blitz/replay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref, project }),
  });
  return res.json();
}
