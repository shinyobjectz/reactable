#!/usr/bin/env python3
"""Video-decision eval for the Reactable agent.

Grades JUDGMENT, not pixels: given a real video-production ask, does the agent
route each sub-task to the correct lane (pipeline / omni-edit / veo-fast /
veo-hero / image / composite), avoid the expensive anti-patterns (generating
what the deterministic pipeline does free and exact; asking a video model for
a still; quoting Veo dialogue so it burns in as subtitles), and prompt the
models correctly?

Ground truth is deterministic keyword logic over the agent's real streamed
reply + tool events. The harness plays the human: it auto-skips any generation
approval (records that a gate fired) so nothing spends credits or hangs.

Usage: python3 scripts/eval/video.py [--trials 2] [--tasks id,id]
"""
import argparse
import json
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:4020"
PLAN_ONLY = " Plan and costs only — do NOT execute any tool that spends credits."


def post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _one_run(message, deck, timeout):
    started = post("/reactable/agent/chat",
                   {"message": message, "history": [], "deck": deck, "stream": True, "max_turns": 8})
    run = started.get("run")
    if not run:
        return {"reply": "", "tools": [], "approvals": 0}
    tools, approvals, reply = [], 0, ""
    url = f"{BASE}/live/agent?run={run}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            try:
                e = json.loads(line[5:].strip())
            except Exception:
                continue
            t = e.get("type")
            if t == "tool.start":
                tools.append(e.get("tool") or {})
            elif t == "tool.approval":
                approvals += 1
                tools.append(e.get("tool") or {})
                # Harness = the human: auto-skip synchronously so the run's
                # server process unblocks before we read on.
                try:
                    post("/reactable/agent/approve", {"id": e.get("id"), "decision": "skip"})
                except Exception:
                    pass
            elif t == "reply.done":
                reply = e.get("reply") or ""
            elif t in ("error", "end"):
                if t == "error" and not reply:
                    reply = "[error] " + str(e.get("error"))
                break
    return {"reply": reply, "tools": tools, "approvals": approvals}


def app_up():
    try:
        urllib.request.urlopen(BASE + "/reactable/stage", timeout=4)
        return True
    except Exception:
        return False


def wait_for_app(secs=40):
    for _ in range(secs // 5):
        if app_up():
            return True
        time.sleep(5)
    return app_up()


def _is_bad(reply):
    r = (reply or "").strip()
    if not r or r.startswith(("[error]", "[harness error]")):
        return True
    # A lone tool block as the final reply = truncated/never-answered.
    return r.startswith("```tool") and r.rstrip().endswith("```") and len(r) < 260


def run_agent(message, deck="showcase", timeout=220):
    """Consume the SSE run, auto-skip approvals. Retries on empty/truncated/
    infra reply; waits out an app restart. Returns infra=True if it never
    produced a real answer (excluded from judgment scoring)."""
    for attempt in range(3):
        if not app_up() and not wait_for_app():
            return {"reply": "", "tools": [], "approvals": 0, "infra": True}
        try:
            r = _one_run(message, deck, timeout)
        except Exception as e:
            r = {"reply": f"[harness error] {e}", "tools": [], "approvals": 0}
        if not _is_bad(r["reply"]):
            r["infra"] = False
            return r
        time.sleep(4)
    r["infra"] = True
    return r


def has(text, *alts):
    t = text.lower()
    return any(a.lower() in t for a in alts)


# ── Tasks: prompt + ground-truth graders. Each grader returns list of
# (check_name, passed, weight). Task passes if weighted score >= 0.7 AND no
# check tagged critical fails. ──

def g_captions(r):
    txt, gen = r["reply"], r["approvals"]
    return [
        ("routes to pipeline (transcribe/captions/render)",
         has(txt, "caption", "transcribe", "takes render", "edit captions"), 1),
        ("frames it as free / no credits", has(txt, "free", "0 credit", "no credit", "zero credit"), 1),
        ("CRITICAL: does NOT generate captions (no gen fired, no video-model routing)",
         gen == 0 and not has(txt, "veo", "omni") or has(txt, "misspell", "ocr", "exact", "pipeline"), 2),
    ]


def g_titlecard(r):
    txt = r["reply"]
    return [
        ("routes to island or image (exact/still lane)",
         has(txt, "island", "client", "image", "nano", "fal", "still", "html"), 2),
        ("CRITICAL: rejects a VIDEO model for a still",
         not has(txt, "veo-3") or has(txt, "not a video", "never ask a video", "wrong here", "still"), 2),
        ("cost awareness", has(txt, "credit", "free"), 1),
    ]


def g_broll_fast(r):
    txt = r["reply"]
    return [
        ("routes to videogen", has(txt, "veo", "videogen", "generat"), 1),
        ("picks FAST for transitional b-roll", has(txt, "fast"), 2),
        ("CRITICAL: recommends FAST, not standard veo-3, for throwaway b-roll",
         has(txt, "fast") and not re.search(r"recommend[^.]{0,40}veo-3(?!-?\s*fast)", txt.lower()), 2),
        ("surfaces credit cost (per-second)", has(txt, "credit", "/s", "per second", "150"), 1),
    ]


def g_hero(r):
    txt = r["reply"].lower()
    # No stock-VIDEO source is connected. Recommending Pexels/Coverr video as
    # a real path = hallucinated capability = miss.
    stock_video = ("coverr" in txt) or bool(re.search(r"(pexels|stock)[^.]{0,30}(video|clip|footage|b-roll)", txt))
    return [
        ("routes to videogen veo-3 for the hero shot", has(txt, "veo-3", "veo 3"), 2),
        ("CRITICAL: does NOT recommend unconnected stock video", not stock_video, 2),
        ("cost awareness (credits/dollars per second)",
         has(txt, "credit", "$", "/s", "per second", "3200", "400"), 1),
    ]


def g_object_removal(r):
    txt = r["reply"]
    return [
        ("routes to omni-flash EDIT (alter real footage)",
         has(txt, "omni") or (has(txt, "edit") and not has(txt, "veo")), 2),
        ("uses preservation clause (keep/unchanged)",
         has(txt, "preserv", "keep", "unchanged", "untouched", "leave"), 2),
        ("CRITICAL: does not regenerate the whole clip with veo",
         not has(txt, "veo") or has(txt, "omni"), 2),
        ("mentions cutting the <=10s window", has(txt, "10s", "10 second", "segment", "window", "clip the"), 1),
    ]


def g_cleanup(r):
    txt, gen = r["reply"], r["approvals"]
    return [
        ("routes to pipeline (remove-filler / trim-silence)",
         has(txt, "remove-filler", "filler", "trim", "silence", "edit "), 2),
        ("frames it free / no generation", has(txt, "free", "credit", "pipeline") and gen == 0, 2),
        ("CRITICAL: no generation for an editing-of-real-footage cleanup", gen == 0, 2),
    ]


def g_zoom(r):
    txt, gen = r["reply"], r["approvals"]
    return [
        ("routes to takes render auto-zoom from click events",
         has(txt, "zoom", "takes render", "event", "click"), 2),
        ("frames it free / deterministic", has(txt, "free", "automatic", "event", "record"), 1),
        ("CRITICAL: no generation", gen == 0, 2),
    ]


def g_veo_prompt(r):
    txt = r["reply"]
    # Grade dialogue formatting in the actual PROMPT (fenced block), not the
    # model's prose explaining the rule (which legitimately mentions quotes).
    fence = re.search(r"```(?!tool)[a-z]*\n(.*?)```", txt, re.S)
    prompt_txt = fence.group(1) if fence else txt
    quoted_dialogue = bool(re.search(r'says?\s*["“]', prompt_txt.lower()))
    colon_dialogue = bool(re.search(r'says?\s*:', prompt_txt.lower()))
    txt = prompt_txt
    return [
        ("uses COLON dialogue, not quotes (anti burned-subtitles)",
         colon_dialogue, 2),
        ("CRITICAL: does NOT quote the spoken line", not quoted_dialogue, 2),
        ("includes an audio cue line (SFX/ambient)", has(txt, "sfx", "ambient", "sound"), 1),
        ("leads with / names camera work", has(txt, "shot", "camera", "dolly", "pan", "close-up", "wide", "macro", "handheld"), 1),
        ("states aspect ratio", has(txt, "16:9", "9:16", "aspect"), 1),
    ]


def g_thumbnail(r):
    txt = r["reply"]
    return [
        ("routes to image lane", has(txt, "image", "nano", "fal", "thumbnail", "still"), 2),
        ("picks a text-capable model (Pro-image for dense text)",
         has(txt, "pro", "text", "readable", "nano banana pro", "pro-image"), 1),
        ("CRITICAL: does not use a video model for a still",
         not has(txt, "veo") or has(txt, "not video", "still", "image"), 2),
    ]


def g_polish(r):
    txt = r["reply"]
    return [
        ("routes to pipeline/composite (takes render or hf)",
         has(txt, "takes render", "hyperframes", "takes hf", "composite", "pipeline", "captions"), 2),
        ("CRITICAL: does NOT regenerate the take with a video model",
         not has(txt, "veo") or has(txt, "keep", "real footage", "pipeline", "not regenerat"), 2),
        ("handles music/audio sensibly (tts or asset, not hallucinated)",
         has(txt, "music", "tts", "audio", "asset"), 1),
    ]


TASKS = [
    ("captions-pipeline", "Add burned-in captions to my last take." + PLAN_ONLY, g_captions),
    ("title-card", "Make a title card that says REACTABLE in big type for the intro." + PLAN_ONLY, g_titlecard),
    ("broll-fast", "I need 6 seconds of b-roll of rain on a window to use as a transition." + PLAN_ONLY, g_broll_fast),
    ("hero-shot", "This is my hero opening shot: a cinematic aerial over misty mountains at dawn, 8 seconds." + PLAN_ONLY, g_hero),
    ("object-removal", "Remove the coffee cup from the background of one of my take clips." + PLAN_ONLY, g_object_removal),
    ("cleanup", "Cut the ums and dead air and tighten the boring middle of my last take." + PLAN_ONLY, g_cleanup),
    ("zoom", "Make it zoom in whenever I click a button in my screen recording take." + PLAN_ONLY, g_zoom),
    ("veo-prompt", "Write me a Veo prompt: a barista says welcome back to a regular, espresso machine sounds, cozy morning cafe, vertical for Reels.", g_veo_prompt),
    ("thumbnail", "Make a YouTube thumbnail with big bold readable text for this video." + PLAN_ONLY, g_thumbnail),
    ("full-polish", "Turn my 30-second take into a polished video with captions and background music." + PLAN_ONLY, g_polish),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=2)
    ap.add_argument("--tasks", type=str, default="")
    args = ap.parse_args()
    only = set(args.tasks.split(",")) if args.tasks else None

    try:
        urllib.request.urlopen(BASE + "/reactable/stage", timeout=5)
    except Exception:
        print("nexus not reachable on :4020 — launch the app first", file=sys.stderr)
        sys.exit(2)

    rows, total_pass, total_trials, debug = [], 0, 0, {}
    for tid, prompt, grader in TASKS:
        if only and tid not in only:
            continue
        passes, scores, notes, replies = 0, [], [], []
        for _ in range(args.trials):
            time.sleep(1.0)
            t0 = time.time()
            try:
                r = run_agent(prompt)
            except Exception as e:
                r = {"reply": f"[harness error] {e}", "tools": [], "approvals": 0}
            checks = grader(r)
            wsum = sum(w for _, _, w in checks)
            got = sum(w for _, ok, w in checks if ok)
            critical_fail = any((not ok) for name, ok, w in checks if "CRITICAL" in name)
            score = got / wsum if wsum else 0
            ok = score >= 0.7 and not critical_fail
            passes += 1 if ok else 0
            scores.append(score)
            if not ok:
                fails = [name for name, o, w in checks if not o]
                notes.append(f"{time.time()-t0:.0f}s score={score:.2f} miss={fails[:2]}")
            replies.append(r.get("reply", "")[:600])
            total_trials += 1
        total_pass += passes
        avg = sum(scores) / len(scores) if scores else 0
        rows.append((tid, passes, args.trials, avg, "; ".join(notes[:2])))
        debug[tid] = replies
        print(f"{'✓' if passes==args.trials else '✗'} {tid:<16} {passes}/{args.trials}  avg {avg:.2f}  {notes[0] if notes else ''}")

    print(f"\n{total_pass}/{total_trials} trials passed "
          f"({100*total_pass//max(1,total_trials)}%)")
    out = ROOT / "scripts" / "eval" / "video-last-run.json"
    out.write_text(json.dumps(
        {"trials": args.trials, "total_pass": total_pass, "total_trials": total_trials,
         "rows": [{"task": t, "pass": p, "of": o, "avg_score": round(a, 3), "notes": n}
                  for t, p, o, a, n in rows]}, indent=2))
    (ROOT / "scripts" / "eval" / "video-debug.json").write_text(json.dumps(debug, indent=2))
    print(f"raw: {out}")
    sys.exit(0 if total_pass >= 0.8 * total_trials else 1)


if __name__ == "__main__":
    main()
