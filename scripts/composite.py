#!/usr/bin/env python3
"""Deterministic take composite — cam PIP, click auto-zoom, padding, multi-aspect export."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

DEFAULT_EDIT = {
    "trim": {"in": 0, "out": None},
    "speed": 1.0,
    "zoom": {"enabled": True, "scale": 1.5, "duration": 1.0},
    "cam": {"pip": True, "x": 0.88, "y": 0.08, "size": 0.14, "mirror": True},
    "style": {"padding": 28, "radius": 16, "background": "#111111", "shadow": True},
    "aspect": "16:9",
    "captions": {"enabled": False},
}

ASPECTS = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)}


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), file=sys.stderr)
    subprocess.run(cmd, check=True)


def probe_video(path: Path) -> dict:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration",
            "-of", "json", str(path),
        ]
    )
    s = json.loads(out)["streams"][0]
    return {"w": int(s["width"]), "h": int(s["height"]), "duration": float(s.get("duration") or 0)}


def load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    with path.open() as f:
        return {**default, **json.load(f)}


def load_events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def norm_click(ev: dict, vw: int, vh: int) -> tuple[float, float]:
    x, y = float(ev.get("x", vw / 2)), float(ev.get("y", vh / 2))
    if x > vw or y > vh:
        x = x * vw / 1920.0
        y = vh - (y * vh / 1080.0)
    return max(0, min(vw, x)), max(0, min(vh, y))


def zoom_exprs(clicks: list[tuple[float, float, float]], vw: int, vh: int, scale: float, dur: float, fps: int = 30):
    if not clicks:
        return "1", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"

    def nest(cases: list[tuple[str, str]], default: str) -> str:
        expr = default
        for cond, val in reversed(cases):
            expr = f"if({cond},{val},{expr})"
        return expr

    z_cases, x_cases, y_cases = [], [], []
    for t, cx, cy in clicks:
        start = int(t * fps)
        ramp = max(4, int(0.2 * fps))
        hold = max(8, int(dur * fps))
        end = start + ramp + hold + ramp
        cond = f"between(in,{start},{end})"
        z_cases.append((cond, str(scale)))
        x_cases.append((cond, f"{cx}-(iw/zoom/2)"))
        y_cases.append((cond, f"{cy}-(ih/zoom/2)"))

    return (
        nest(z_cases, "1"),
        nest(x_cases, "iw/2-(iw/zoom/2)"),
        nest(y_cases, "ih/2-(ih/zoom/2)"),
    )


def write_captions(events: list[dict], out: Path) -> None:
    slides = [e for e in events if e.get("type") == "slide"]
    lines = []
    for i, ev in enumerate(slides):
        start = float(ev.get("t", 0))
        end = float(slides[i + 1]["t"]) if i + 1 < len(slides) else start + 3
        idx = int(ev.get("idx", i))
        sid = ev.get("id", f"slide-{idx}")
        lines += [str(i + 1), f"{fmt_srt(start)} --> {fmt_srt(end)}", f"Slide {idx + 1}: {sid}", ""]
    out.write_text("\n".join(lines))


def fmt_srt(sec: float) -> str:
    h, rem = divmod(int(sec), 3600)
    m, s = divmod(rem, 60)
    ms = int((sec - int(sec)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def render_take(take_dir: Path, aspects: list[str] | None = None) -> dict:
    take_dir = take_dir.resolve()
    stage = take_dir / "stage.mov"
    cam = take_dir / "cam.mov"
    if not stage.exists():
        raise SystemExit(f"missing {stage}")

    edit = load_json(take_dir / "edit.json", DEFAULT_EDIT)
    events = load_events(take_dir / "events.jsonl")
    info = probe_video(stage)
    vw, vh = info["w"], info["h"]

    trim_in = float(edit.get("trim", {}).get("in", 0))
    trim_out = edit.get("trim", {}).get("out")
    speed = float(edit.get("speed", 1))
    zoom_cfg = edit.get("zoom", {})
    cam_cfg = edit.get("cam", {})
    style = edit.get("style", {})

    clicks = []
    if zoom_cfg.get("enabled", True):
        for ev in events:
            if ev.get("type") == "click":
                cx, cy = norm_click(ev, vw, vh)
                clicks.append((float(ev["t"]), cx, cy))

    out_dir = take_dir / "out"
    out_dir.mkdir(exist_ok=True)
    captions = out_dir / "captions.srt"
    write_captions(events, captions)

    aspects = aspects or ["16:9", "9:16", "1:1"]
    outputs: dict[str, str] = {}

    for aspect in aspects:
        tw, th = ASPECTS[aspect]
        pad = int(style.get("padding", 28))
        bg = style.get("background", "#111111").lstrip("#")
        inner_w, inner_h = tw - pad * 2, th - pad * 2

        z_expr, x_expr, y_expr = zoom_exprs(
            clicks, vw, vh, float(zoom_cfg.get("scale", 1.5)), float(zoom_cfg.get("duration", 1.0))
        )

        inputs = ["-i", str(stage)]
        has_cam = cam.exists() and cam_cfg.get("pip", True)
        if has_cam:
            inputs += ["-i", str(cam)]

        chain = "[0:v]"
        if trim_in > 0 or trim_out is not None:
            t = f"{chain}trim=start={trim_in}"
            if trim_out is not None:
                t += f":end={trim_out}"
            chain = "[trim]"
            trim_node = t + ",setpts=PTS-STARTPTS" + chain
        else:
            trim_node = ""

        if speed != 1.0:
            spd = f"{chain}setpts=PTS/{speed}[spd]"
            chain = "[spd]"
        else:
            spd = ""

        zoom = (
            f"{chain}zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':d=1:s={vw}x{vh}:fps=30[zoomed];"
            f"[zoomed]scale={inner_w}:{inner_h}:force_original_aspect_ratio=decrease,"
            f"pad={inner_w}:{inner_h}:(ow-iw)/2:(oh-ih)/2:color=black@0[fitted];"
            f"color=c=0x{bg}:s={tw}x{th}:r=30[bg];"
            f"[bg][fitted]overlay={pad}:{pad}[padded]"
        )

        parts = [p for p in [trim_node, spd, zoom] if p]
        last = "[padded]"

        if has_cam:
            size = max(80, int(min(tw, th) * float(cam_cfg.get("size", 0.14))))
            ox = int(pad + (inner_w - size) * float(cam_cfg.get("x", 0.88)))
            oy = int(pad + (inner_h - size) * float(cam_cfg.get("y", 0.08)))
            flip = "hflip," if cam_cfg.get("mirror", True) else ""
            parts.append(
                f"[1:v]{flip}scale={size}:{size}:force_original_aspect_ratio=increase,"
                f"crop={size}:{size},format=rgba,"
                f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
                f"a='if(lte(hypot(X-{size//2},Y-{size//2}),{size//2 - 2}),255,0)'[cam];"
                f"{last}[cam]overlay={ox}:{oy}:format=auto[outv]"
            )
            last = "[outv]"

        fc = ";".join(parts)
        out_path = out_dir / f"final-{aspect.replace(':', 'x')}.mp4"
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error", *inputs,
            "-filter_complex", fc, "-map", last, "-map", "0:a?",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out_path),
        ]
        run(cmd)
        outputs[aspect] = str(out_path)

    gif_path = out_dir / "final-1x1.gif"
    if "1:1" in outputs:
        run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", outputs["1:1"],
            "-vf", "fps=10,scale=480:-1:flags=lanczos", "-loop", "0", str(gif_path),
        ])
        outputs["gif"] = str(gif_path)

    primary = out_dir / "final.mp4"
    if primary.exists() or primary.is_symlink():
        primary.unlink(missing_ok=True)
    primary.symlink_to(Path(outputs["16:9"]).name)

    manifest = {"ok": True, "take": take_dir.name, "outputs": outputs, "captions": str(captions)}
    (out_dir / "render.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))
    return manifest


if __name__ == "__main__":
    td = Path(sys.argv[1] if len(sys.argv) > 1 else "")
    if not td.is_dir():
        print("usage: composite.py <take-dir> [aspects...]", file=sys.stderr)
        sys.exit(1)
    render_take(td, sys.argv[2:] or None)
