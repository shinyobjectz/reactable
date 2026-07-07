#!/usr/bin/env python3
"""Agentic eval for the Reactable local agent.

Each task is a natural-language instruction the agent must satisfy by editing/
building inside an ISOLATED workspace (fresh copy of scripts/eval/fixture,
restored before every trial). A deterministic checker then verifies the actual
environment mutation — not the model's prose. Runs N trials/task against the
real gemma-4 model through the nexus HTTP API, scores pass-rate + latency +
tool use, and writes a .work report.

Usage:
  python3 scripts/eval/run.py [--trials 3] [--port 4025] [--tasks id,id]
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "scripts" / "eval" / "fixture"
TASKS = ROOT / "scripts" / "eval" / "tasks.json"
CLI = ROOT / "cli" / "bin" / "reactable.ts"
TOOLS = ROOT / "dist" / "reactable-tools"


def rt(ws: Path, *args: str):
    """Run the reactable CLI against a workspace; return (code, stdout)."""
    p = subprocess.run(
        ["bun", "run", str(CLI), *args],
        cwd=str(ROOT),
        env={**os.environ, "WB_DATA": str(ws)},
        capture_output=True,
        text=True,
    )
    return p.returncode, p.stdout.strip()


def deck_json(ws: Path, slug: str):
    code, out = rt(ws, "decks", "get", slug, "--json")
    if code != 0:
        return None
    try:
        return json.loads(out)
    except Exception:
        return None


# ── Checkers: (ws, reply, tools) -> (passed: bool, detail: str) ──────────────

WORDS = {0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
         6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}


def check_reply_has_number(spec, ws, reply, tools):
    want = spec["value"]
    nums = re.findall(r"-?\d+", reply)
    word = WORDS.get(want)
    hit = str(want) in nums or (word and re.search(rf"\b{word}\b", reply.lower()))
    return (bool(hit), f"reply nums={nums} want={want}")


def check_reply_contains(spec, ws, reply, tools):
    v = spec["value"].lower()
    return (v in reply.lower(), f"looking for {spec['value']!r}")


def check_deck_slide(spec, ws, reply, tools):
    d = deck_json(ws, spec["deck"])
    if not d:
        return (False, "deck unreadable")
    ids = [s["id"] for s in d["slides"]]
    ok = spec["slide_id"] in ids and len(ids) >= spec["min_slides"]
    code, _ = rt(ws, "decks", "validate", spec["deck"])
    return (ok and code == 0, f"slides={ids} valid={code==0}")


def check_deck_title(spec, ws, reply, tools):
    d = deck_json(ws, spec["deck"])
    if not d:
        return (False, "deck unreadable")
    code, _ = rt(ws, "decks", "validate", spec["deck"])
    ok = d["title"].strip() == spec["title"] and code == 0
    return (ok, f"title={d['title']!r} valid={code==0}")


def check_new_deck_valid(spec, ws, reply, tools):
    with open(TASKS) as f:
        baseline = set(json.load(f)["meta"]["baseline_decks"])
    code, out = rt(ws, "decks", "list")
    if code != 0:
        return (False, "list failed")
    slugs = [s for s in out.splitlines() if s.strip()]
    new = [s for s in slugs if s not in baseline]
    for slug in new:
        d = deck_json(ws, slug)
        vcode, _ = rt(ws, "decks", "validate", slug)
        if d and vcode == 0 and spec["title_contains"] in d["title"].lower():
            return (True, f"new deck {slug!r} title={d['title']!r}")
    return (False, f"new={new}")


def check_deck_validates(spec, ws, reply, tools):
    code, out = rt(ws, "decks", "validate", spec["deck"])
    return (code == 0, out or "validate failed")


def check_file_bullets(spec, ws, reply, tools):
    p = ws / spec["path"]
    if not p.is_file():
        return (False, "file missing")
    lines = [l.strip() for l in p.read_text().splitlines()]
    bullets = [l for l in lines if l.startswith("- ") or l.startswith("* ")]
    return (len(bullets) >= spec["min_bullets"], f"bullets={len(bullets)}")


CHECKERS = {
    "reply_has_number": check_reply_has_number,
    "reply_contains": check_reply_contains,
    "deck_slide": check_deck_slide,
    "deck_title": check_deck_title,
    "new_deck_valid": check_new_deck_valid,
    "deck_validates": check_deck_validates,
    "file_bullets": check_file_bullets,
}


# ── Harness ──────────────────────────────────────────────────────────────────

def restore(ws: Path):
    """Reset the workspace to the frozen fixture. Route-defining surfaces
    (present/, skill/) are symlinked from the repo so the LIVE nexus routes +
    agent prompt load, while decks/takes/files stay isolated to the workspace."""
    if ws.exists():
        shutil.rmtree(ws)
    shutil.copytree(FIXTURE, ws)
    (ws / "present").symlink_to(ROOT / "present")
    (ws / "skill").symlink_to(ROOT / "skill")
    (ws / "dist").symlink_to(ROOT / "dist")  # nexus finds reactable-tools here


def chat(port, message):
    body = json.dumps({
        "message": message, "history": [], "deck": "demo", "max_turns": 6,
    }).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/reactable/agent/chat",
        body, {"content-type": "application/json"},
    )
    t = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    return data, time.time() - t


def wait_health(port, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/reactable/health", timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--port", type=int, default=4025)
    ap.add_argument("--tasks", default="")
    args = ap.parse_args()

    spec = json.loads(TASKS.read_text())
    tasks = spec["tasks"]
    if args.tasks:
        want = set(args.tasks.split(","))
        tasks = [t for t in tasks if t["id"] in want]

    # Preflight: model must be cached (no download inside the eval).
    st = subprocess.run([str(TOOLS), "agent-status"], capture_output=True, text=True)
    if '"ok": true' not in st.stdout:
        print("BLOCKER: model not ready — run: reactable agent pull", file=sys.stderr)
        print(st.stdout, file=sys.stderr)
        return 2

    ws = Path("/tmp") / f"reactable-eval-{os.getpid()}"
    restore(ws)

    # Free the port, boot nexus against the isolated workspace.
    subprocess.run(["bash", "-c", f"lsof -ti:{args.port} | xargs kill -9 2>/dev/null || true"])
    time.sleep(1)
    serve = subprocess.Popen(
        ["just", "serve"],
        cwd=str(ROOT),
        env={**os.environ, "PORT": str(args.port), "WB_DATA": str(ws)},
        stdout=open("/tmp/reactable-eval-serve.log", "w"),
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )
    try:
        if not wait_health(args.port):
            print("nexus did not come up", file=sys.stderr)
            return 1
        # Prewarm the model so trial-1 latency is not the cold start.
        try:
            urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{args.port}/reactable/agent/prewarm", b"{}",
                {"content-type": "application/json"}), timeout=120)
        except Exception:
            pass
        time.sleep(6)

        results = []
        for task in tasks:
            checker = CHECKERS[task["check"]["type"]]
            trials = []
            for n in range(args.trials):
                restore(ws)
                try:
                    data, dt = chat(args.port, task["instruction"])
                    reply = data.get("reply", "")
                    tools = data.get("tools", [])
                    passed, detail = checker(task["check"], ws, reply, tools)
                except Exception as e:
                    passed, detail, dt = False, f"error: {e}", 0.0
                    data, reply, tools = {}, "", []
                trials.append({
                    "pass": passed, "detail": detail, "secs": round(dt, 2),
                    "turns": data.get("turns", 0), "tools": len(tools),
                })
                mark = "✓" if passed else "✗"
                print(f"  {mark} {task['id']} trial {n+1}/{args.trials} "
                      f"({dt:.1f}s, {len(tools)} tools) — {detail}")
            passes = sum(1 for t in trials if t["pass"])
            results.append({
                "id": task["id"], "kind": task["kind"],
                "passes": passes, "trials": len(trials),
                "rate": passes / len(trials),
                "avg_secs": round(sum(t["secs"] for t in trials) / len(trials), 2),
                "avg_tools": round(sum(t["tools"] for t in trials) / len(trials), 1),
                "runs": trials,
            })
            print(f"  → {task['id']}: {passes}/{len(trials)}\n")
    finally:
        try:
            os.killpg(os.getpgid(serve.pid), signal.SIGTERM)
        except Exception:
            pass
        shutil.rmtree(ws, ignore_errors=True)

    write_report(spec, results, args)
    total_pass = sum(r["passes"] for r in results)
    total = sum(r["trials"] for r in results)
    print(f"\n═══ EVAL: {total_pass}/{total} "
          f"({100*total_pass/total:.0f}%) across {len(results)} tasks ═══")
    for r in results:
        bar = "█" * r["passes"] + "░" * (r["trials"] - r["passes"])
        print(f"  {r['id']:<14} {bar} {r['passes']}/{r['trials']}  {r['avg_secs']}s")
    return 0 if total_pass == total else 1


def write_report(spec, results, args):
    out_json = ROOT / "scripts" / "eval" / "last-run.json"
    out_json.write_text(json.dumps({"trials": args.trials, "results": results}, indent=2))

    total_pass = sum(r["passes"] for r in results)
    total = sum(r["trials"] for r in results)
    lines = [
        "# Local agent eval — real edits/builds",
        "",
        f"Model: `{spec['meta']['model']}` · trials/task: {args.trials} · "
        f"**{total_pass}/{total} ({100*total_pass/total:.0f}%)**",
        "",
        "Each task = a natural-language instruction the agent must satisfy by "
        "mutating an isolated workspace; a deterministic checker verifies the "
        "actual file/deck state, not the model's prose. Fixture restored per trial.",
        "",
        "| Task | Kind | Pass | Avg s | Avg tools |",
        "|------|------|------|-------|-----------|",
    ]
    for r in results:
        lines.append(
            f"| {r['id']} | {r['kind']} | {r['passes']}/{r['trials']} "
            f"| {r['avg_secs']} | {r['avg_tools']} |"
        )
    lines += ["", "Regenerate: `just eval` · raw: `scripts/eval/last-run.json`", ""]
    (ROOT / "scripts" / "eval" / "report.work").write_text("\n".join(lines))


if __name__ == "__main__":
    sys.exit(main())
