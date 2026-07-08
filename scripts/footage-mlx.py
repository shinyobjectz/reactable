# Footage intel — LOCAL MLX runner (Apple Silicon GPU, no CUDA/cloud).
# The primary lane for footage passes; the Modal gateway is the fallback.
# docs/PLAN.footage-intel.work.
#
#   python footage-mlx.py sam3 <video> --concepts "car,person" --out result.json
#   python footage-mlx.py depth <video> --out result.json
#
# sam3: per-frame MLX SAM3 (mlx-community/sam3-image, text prompts) + a greedy
# IoU tracker to stitch detections into tracklets with persistent ids. Output
# matches gpu/modal_footage.py so cli/lib/video.ts foldPass is unchanged.
import argparse
import base64
import gc
import json
import os
import sys
from pathlib import Path


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ── resource guards ──────────────────────────────────────────────────
# This loads a multi-GB model and runs it per-frame; without limits it pins
# unified memory + the GPU on a laptop. Keep it polite: yield to the UI, cap
# how many frames run, downscale before inference, and free memory each frame.

def be_polite():
    try:
        os.nice(10)  # lower CPU priority so the desktop stays responsive
    except Exception:
        pass


def free_gib():
    """macOS *available* RAM (GiB): free + speculative + inactive + purgeable.
    NOT vm_page_free_count alone — macOS keeps almost nothing truly 'free'
    (it caches with inactive/purgeable pages), so free-only reads ~0 and lies.
    Returns None if unknown."""
    try:
        import subprocess

        page = 4096
        out = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3).stdout
        v = {}
        for ln in out.splitlines():
            if "page size of" in ln:
                page = int(ln.split("page size of")[1].split("bytes")[0].strip())
            for key in ("free", "speculative", "inactive", "purgeable"):
                if ln.lower().startswith(f"pages {key}"):
                    v[key] = int(ln.split(":")[1].strip().rstrip("."))
        avail = sum(v.get(k, 0) for k in ("free", "speculative", "inactive", "purgeable"))
        return avail * page / (1024**3)
    except Exception:
        return None


def guard_memory(min_gib, force):
    g = free_gib()
    if g is not None and g < min_gib and not force:
        log(f"only {g:.1f} GiB free — below the {min_gib} GiB floor for local MLX.")
        log("falling back to the cloud gateway (or pass --force to run anyway).")
        # exit code 3 = 'insufficient resources' → video.ts falls back to cloud
        sys.exit(3)
    if g is not None:
        log(f"{g:.1f} GiB free — ok to run local.")


def clear_gpu():
    try:
        import mlx.core as mx

        mx.clear_cache()
    except Exception:
        pass
    gc.collect()


def plan_frames(total_frames, fps, sample_fps, max_frames):
    """Pick a stride so we sample ≈sample_fps but never exceed max_frames."""
    if total_frames <= 0:
        return max(1, round(fps / sample_fps))
    by_fps = max(1, round(fps / sample_fps))
    wanted = total_frames / by_fps
    if wanted <= max_frames:
        return by_fps
    return max(by_fps, -(-total_frames // max_frames))  # ceil div to hit the cap


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x0, y0 = max(ax, bx), max(ay, by)
    x1, y1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    if inter == 0:
        return 0.0
    return inter / (aw * ah + bw * bh - inter)


def rle_from_mask(mask):
    import numpy as np
    from pycocotools import mask as coco

    enc = coco.encode(np.asfortranarray(mask.astype("uint8")))
    return {"size": enc["size"], "counts": base64.b64encode(enc["counts"]).decode()}


def cmd_sam3(video, concepts, out_path, conf, sample_fps, max_frames, max_dim, min_gib, force):
    be_polite()
    guard_memory(min_gib, force)
    import cv2
    import numpy as np
    from PIL import Image
    from sam3 import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = plan_frames(total, fps, sample_fps, max_frames)
    n_planned = min(max_frames, (total // step) if total else max_frames)
    log(f"loading MLX SAM3 — sampling ~{n_planned} frames (stride {step}, max {max_frames})…")

    model = build_sam3_image_model()
    proc = Sam3Processor(model, confidence_threshold=conf)

    # tracklets: {id, concept, frames:[{t_ms,bbox,conf,rle}], _last_bbox, _last_i}
    tracklets = []
    next_id = 0
    IOU_T = 0.3
    MAX_GAP = 5  # sampled frames a track can miss before it's closed

    idx = 0
    processed = 0
    while processed < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step != 0:
            idx += 1
            continue
        t_ms = round(idx * 1000 / fps)
        # downscale the long edge before inference — big frames = big memory
        h0, w0 = frame.shape[:2]
        scale = min(1.0, max_dim / max(h0, w0))
        if scale < 1.0:
            frame = cv2.resize(frame, (round(w0 * scale), round(h0 * scale)), interpolation=cv2.INTER_AREA)
        inv = 1.0 / scale  # map boxes/masks back to source pixels
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        st = proc.set_image(img)

        dets = []  # (concept, bbox[x,y,w,h], score, mask)
        for concept in concepts:
            st = proc.set_text_prompt(concept, st)
            scores = st.get("scores")
            if scores is None or len(scores) == 0:
                continue
            boxes = st["boxes"]
            masks = st.get("masks")
            boxes = boxes.tolist() if hasattr(boxes, "tolist") else list(boxes)
            scores = scores.tolist() if hasattr(scores, "tolist") else list(scores)
            for i, sc in enumerate(scores):
                x0, y0, x1, y1 = boxes[i]
                # boxes are in downscaled space → map back to source pixels
                bbox = [round(x0 * inv), round(y0 * inv), round((x1 - x0) * inv), round((y1 - y0) * inv)]
                m = None
                if masks is not None:
                    mm = masks[i]
                    m = np.array(mm) if not isinstance(mm, np.ndarray) else mm
                    if inv != 1.0 and m is not None and m.size:
                        m = cv2.resize(m.astype("uint8"), (w0, h0), interpolation=cv2.INTER_NEAREST)
                dets.append((concept, bbox, round(float(sc), 4), m))

        # greedy IoU association against open tracklets
        open_tracks = [t for t in tracklets if processed - t["_last_i"] <= MAX_GAP]
        used = set()
        for concept, bbox, score, mask in dets:
            best, best_iou = None, IOU_T
            for t in open_tracks:
                if t["concept"] != concept or id(t) in used:
                    continue
                v = iou(t["_last_bbox"], bbox)
                if v > best_iou:
                    best, best_iou = t, v
            if best is None:
                best = {"id": f"trk-{next_id}", "concept": concept, "pass": "sam31", "frames": []}
                next_id += 1
                tracklets.append(best)
            used.add(id(best))
            fr = {"t_ms": t_ms, "bbox": bbox, "conf": score}
            if mask is not None and mask.size:
                fr["rle"] = rle_from_mask(mask)
            best["frames"].append(fr)
            best["_last_bbox"] = bbox
            best["_last_i"] = processed

        processed += 1
        idx += 1
        clear_gpu()  # free Metal buffers each frame so memory stays flat
        if processed % 10 == 0:
            log(f"  {processed}/{n_planned} frames, {len(tracklets)} tracklets")

    cap.release()
    out = []
    for t in tracklets:
        if not t["frames"]:
            continue
        t.pop("_last_bbox", None)
        t.pop("_last_i", None)
        t["in_ms"] = t["frames"][0]["t_ms"]
        t["out_ms"] = t["frames"][-1]["t_ms"]
        out.append(t)

    Path(out_path).write_text(json.dumps({
        "pass": "sam31",
        "model": "mlx-community/sam3-image (local mlx)",
        "concepts": concepts,
        "fps_assumed": fps,
        "sample_fps": sample_fps,
        "timing": "cfr-approx",
        "tracklets": out,
    }))
    print(json.dumps({"pass": "sam31", "tracklets": len(out), "model": "mlx-local"}))


def cmd_depth(video, out_path, sample_fps, grid, max_frames, max_dim, min_gib, force):
    # Depth-Anything V2 small on MPS (torch). Local; no cloud. Same guards.
    be_polite()
    guard_memory(min_gib, force)
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from transformers import pipeline

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=dev)
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = plan_frames(total, fps, sample_fps, max_frames)
    frames, idx, processed = [], 0, 0
    while processed < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            h0, w0 = frame.shape[:2]
            scale = min(1.0, max_dim / max(h0, w0))
            if scale < 1.0:
                frame = cv2.resize(frame, (round(w0 * scale), round(h0 * scale)), interpolation=cv2.INTER_AREA)
            img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            with torch.no_grad():
                d = pipe(img)["predicted_depth"].squeeze().float().cpu().numpy()
            d = (d - d.min()) / (d.max() - d.min() + 1e-6)
            h = max(1, round(grid * d.shape[0] / d.shape[1]))
            small = cv2.resize(d, (grid, h), interpolation=cv2.INTER_AREA)
            frames.append({"t_ms": round(idx * 1000 / fps), "w": grid, "h": h,
                           "f32": base64.b64encode(small.astype(np.float32).tobytes()).decode()})
            processed += 1
            clear_gpu()
        idx += 1
    cap.release()
    Path(out_path).write_text(json.dumps({
        "pass": "depth", "model": "depth-anything/Depth-Anything-V2-Small-hf (mps)",
        "sample_fps": sample_fps, "frames": frames,
    }))
    print(json.dumps({"pass": "depth", "samples": len(frames), "model": "mps-local"}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    # shared resource guards
    def add_guards(p, dfps, dframes):
        p.add_argument("--sample-fps", type=float, default=dfps)
        p.add_argument("--max-frames", type=int, default=dframes, help="hard cap on frames processed")
        p.add_argument("--max-dim", type=int, default=1024, help="downscale long edge before inference")
        p.add_argument("--min-gib", type=float, default=5.0, help="free-RAM floor; below it, defer to cloud")
        p.add_argument("--force", action="store_true", help="run even below the RAM floor")

    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sam3")
    s.add_argument("video")
    s.add_argument("--concepts", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--conf", type=float, default=0.4)
    add_guards(s, 2.0, 90)
    d = sub.add_parser("depth")
    d.add_argument("video")
    d.add_argument("--out", required=True)
    d.add_argument("--grid", type=int, default=96)
    add_guards(d, 2.0, 120)
    a = ap.parse_args()
    if a.cmd == "sam3":
        cmd_sam3(a.video, [c.strip() for c in a.concepts.split(",") if c.strip()], a.out,
                 a.conf, a.sample_fps, a.max_frames, a.max_dim, a.min_gib, a.force)
    elif a.cmd == "depth":
        cmd_depth(a.video, a.out, a.sample_fps, a.grid, a.max_frames, a.max_dim, a.min_gib, a.force)
