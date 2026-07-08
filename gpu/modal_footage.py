# ⚠ DEV SPIKE ONLY — NOT PART OF THE PRODUCT. ⚠
# Modal is a scratch/prototyping tool for the agent to validate footage models
# (SAM3, depth) before porting them to the on-device native lane (CoreML/ANE in
# native/vision, MLX in reactable-tools). NOTHING in the shipped app references
# this file — the product runs passes ON-DEVICE only, no cloud GPU lane.
# Keep this for spiking new models; never wire it into cli/, web/, or the bundle.
#
#   modal run gpu/modal_footage.py --kind sam31 --video clip.mp4 \
#     --concepts "red car" --out /tmp/pass.json      # (spike)
import base64
import json
from pathlib import Path

import modal

app = modal.App("reactable-footage")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "git")
    .pip_install(
        "ultralytics>=8.3.240",
        "huggingface_hub",
        "opencv-python-headless",
        "pycocotools",
        "transformers",
        "pillow",
        "torch",
        "torchvision",
        "git+https://github.com/ultralytics/CLIP.git",  # SAM3 text encoder
    )
)

secrets = [modal.Secret.from_name("huggingface-token")]
CACHE = modal.Volume.from_name("reactable-footage-cache", create_if_missing=True)


@app.function(image=image, gpu="L4", secrets=secrets, timeout=3600, volumes={"/cache": CACHE})
def sam31(
    video: bytes,
    concepts: list[str],
    conf: float = 0.25,
    imgsz: int = 1024,
    hf_repo: str = "facebook/sam3",
    hf_file: str = "sam3.pt",
) -> dict:
    import cv2
    import numpy as np
    from huggingface_hub import hf_hub_download
    from pycocotools import mask as rle
    from ultralytics.models.sam import SAM3VideoSemanticPredictor

    weights = hf_hub_download(
        hf_repo, hf_file, cache_dir="/cache/hf", local_files_only=False
    )
    CACHE.commit()

    src = Path("/tmp/input.mp4")
    src.write_bytes(video)
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    predictor = SAM3VideoSemanticPredictor(
        overrides=dict(
            conf=conf, task="segment", mode="predict", imgsz=imgsz,
            model=weights, quantize=16, save=False, verbose=False,
        )
    )
    tracklets: dict[int, dict] = {}
    frame_idx = 0
    for r in predictor(source=str(src), text=list(concepts), stream=True):
        t_ms = round(frame_idx * 1000 / fps)
        boxes = r.boxes
        if boxes is not None and boxes.id is not None:
            ids = boxes.id.int().tolist()
            xyxy = boxes.xyxy.tolist()
            confs = boxes.conf.tolist()
            clss = boxes.cls.int().tolist() if boxes.cls is not None else [0] * len(ids)
            masks = r.masks.data.cpu().numpy().astype("uint8") if r.masks is not None else None
            for i, tid in enumerate(ids):
                trk = tracklets.setdefault(
                    tid,
                    {
                        "id": f"trk-{tid}",
                        "concept": concepts[clss[i]] if clss[i] < len(concepts) else concepts[0],
                        "pass": "sam31",
                        "frames": [],
                    },
                )
                frame: dict = {
                    "t_ms": t_ms,
                    "bbox": [
                        round(xyxy[i][0]), round(xyxy[i][1]),
                        round(xyxy[i][2] - xyxy[i][0]), round(xyxy[i][3] - xyxy[i][1]),
                    ],
                    "conf": round(confs[i], 4),
                }
                if masks is not None and i < len(masks):
                    enc = rle.encode(np.asfortranarray(masks[i]))
                    frame["rle"] = {
                        "size": enc["size"],
                        "counts": base64.b64encode(enc["counts"]).decode(),
                    }
                trk["frames"].append(frame)
        frame_idx += 1

    out = []
    for trk in tracklets.values():
        trk["in_ms"] = trk["frames"][0]["t_ms"]
        trk["out_ms"] = trk["frames"][-1]["t_ms"]
        out.append(trk)
    return {
        "pass": "sam31",
        "model": f"{hf_repo}/{hf_file} (ultralytics)",
        "concepts": concepts,
        "fps_assumed": fps,
        "timing": "cfr-approx",
        "frames_processed": frame_idx,
        "tracklets": out,
    }


@app.function(image=image, gpu="L4", secrets=secrets, timeout=1800, volumes={"/cache": CACHE})
def depth(video: bytes, sample_fps: float = 2.0, grid: int = 96) -> dict:
    """Relative depth on sampled frames. Returns small depth grids (base64
    f32) — enough for fg/mid/bg zoning of tracklets; full-res maps are a P3
    asset pass."""
    import cv2
    import numpy as np
    import torch
    from PIL import Image as PILImage
    from transformers import pipeline

    pipe = pipeline(
        "depth-estimation",
        model="depth-anything/Depth-Anything-V2-Small-hf",
        device=0 if torch.cuda.is_available() else -1,
        model_kwargs={"cache_dir": "/cache/hf"},
    )
    CACHE.commit()

    src = Path("/tmp/input.mp4")
    src.write_bytes(video)
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / sample_fps))
    frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            img = PILImage.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            d = pipe(img)["predicted_depth"].squeeze().float().numpy()
            d = (d - d.min()) / (d.max() - d.min() + 1e-6)  # 0=far … 1=near (relative)
            h = max(1, round(grid * d.shape[0] / d.shape[1]))
            small = cv2.resize(d, (grid, h), interpolation=cv2.INTER_AREA)
            frames.append(
                {
                    "t_ms": round(idx * 1000 / fps),
                    "w": grid,
                    "h": h,
                    "f32": base64.b64encode(small.astype(np.float32).tobytes()).decode(),
                }
            )
        idx += 1
    cap.release()
    return {
        "pass": "depth",
        "model": "depth-anything/Depth-Anything-V2-Small-hf",
        "sample_fps": sample_fps,
        "frames": frames,
    }


# (No web endpoint — the product has no cloud GPU lane. This file is a spike;
#  invoke functions via `modal run … main` locally.)


@app.local_entrypoint()
def main(
    kind: str,
    video: str,
    out: str,
    concepts: str = "",
    conf: float = 0.25,
    hf_repo: str = "facebook/sam3",
    hf_file: str = "sam3.pt",
):
    data = Path(video).read_bytes()
    if kind == "sam31":
        cs = [c.strip() for c in concepts.split(",") if c.strip()]
        if not cs:
            raise SystemExit("sam31 needs --concepts \"a,b\"")
        result = sam31.remote(data, cs, conf, hf_repo=hf_repo, hf_file=hf_file)
    elif kind == "depth":
        result = depth.remote(data)
    else:
        raise SystemExit(f"unknown kind {kind}")
    Path(out).write_text(json.dumps(result))
    print(json.dumps({k: v for k, v in result.items() if k not in ("tracklets", "frames")}))
