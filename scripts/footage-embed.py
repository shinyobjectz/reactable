# Footage intel T1 — SigLIP-2 shot embeddings + SmolVLM shot captions.
# Runs via uv (deps resolved ad hoc, cached):
#   uv run --with torch --with torchvision --with transformers --with pillow --with numpy \
#     scripts/footage-embed.py t1 <sidecar-dir>
#   … footage-embed.py query <sidecar-dir> "<text>" [topk]
# Writes embeddings/siglip2.f32 (+ .meta.json) and shots[].caption into
# index.json. Schema: docs/PLAN.footage-intel.work (footage-intel/1).
import json
import sys
from pathlib import Path

import numpy as np

EMBED_MODEL = "google/siglip2-base-patch16-256"
CAPTION_MODEL = "HuggingFaceTB/SmolVLM-500M-Instruct"


def device():
    import torch

    return "mps" if torch.backends.mps.is_available() else "cpu"


def pooled(out):
    # transformers v5 returns BaseModelOutputWithPooling; v4 returned a tensor
    import torch

    if torch.is_tensor(out):
        return out
    return out.pooler_output


def load_index(sidecar: Path) -> dict:
    return json.loads((sidecar / "index.json").read_text())


def keyframes(sidecar: Path, index: dict) -> list[tuple[str, Path, int]]:
    out = []
    for shot in index.get("shots", []):
        kf = shot.get("keyframe")
        if kf and (sidecar / kf).exists():
            mid = (shot["in_ms"] + shot["out_ms"]) // 2
            out.append((shot["id"], sidecar / kf, mid))
    return out


def cmd_t1(sidecar: Path) -> None:
    import torch
    from PIL import Image
    from transformers import (
        AutoModel,
        AutoModelForImageTextToText,
        AutoProcessor,
    )

    index = load_index(sidecar)
    kfs = keyframes(sidecar, index)
    if not kfs:
        print(json.dumps({"error": "no keyframes — run t0 first"}))
        return
    dev = device()

    # embeddings
    proc = AutoProcessor.from_pretrained(EMBED_MODEL)
    model = AutoModel.from_pretrained(EMBED_MODEL, torch_dtype=torch.float32).to(dev).eval()
    vecs = []
    with torch.no_grad():
        for _, path, _ in kfs:
            img = Image.open(path).convert("RGB")
            inputs = proc(images=img, return_tensors="pt").to(dev)
            v = pooled(model.get_image_features(**inputs))[0]
            v = v / v.norm()
            vecs.append(v.cpu().float().numpy())
    mat = np.stack(vecs)
    emb_dir = sidecar / "embeddings"
    emb_dir.mkdir(exist_ok=True)
    mat.astype(np.float32).tofile(emb_dir / "siglip2.f32")
    (emb_dir / "siglip2.meta.json").write_text(
        json.dumps(
            {
                "model": EMBED_MODEL,
                "dim": int(mat.shape[1]),
                "rows": [{"shot": s, "t_ms": t} for s, _, t in kfs],
            }
        )
    )
    del model

    # captions
    cproc = AutoProcessor.from_pretrained(CAPTION_MODEL)
    cmodel = (
        AutoModelForImageTextToText.from_pretrained(CAPTION_MODEL, torch_dtype=torch.float32)
        .to(dev)
        .eval()
    )
    captions: dict[str, str] = {}
    prompt = "Describe this video frame in one short sentence."
    for shot_id, path, _ in kfs:
        img = Image.open(path).convert("RGB")
        messages = [
            {
                "role": "user",
                "content": [{"type": "image"}, {"type": "text", "text": prompt}],
            }
        ]
        text = cproc.apply_chat_template(messages, add_generation_prompt=True)
        inputs = cproc(text=text, images=[img], return_tensors="pt").to(dev)
        with __import__("torch").no_grad():
            out = cmodel.generate(**inputs, max_new_tokens=48, do_sample=False)
        reply = cproc.batch_decode(out, skip_special_tokens=True)[0]
        captions[shot_id] = reply.split("Assistant:")[-1].strip()

    for shot in index["shots"]:
        if shot["id"] in captions:
            shot["caption"] = captions[shot["id"]]
            shot["caption_model"] = CAPTION_MODEL
    index["passes"]["t1"] = {
        "at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "embed_model": EMBED_MODEL,
        "caption_model": CAPTION_MODEL,
    }
    (sidecar / "index.json").write_text(json.dumps(index, indent=2))
    print(json.dumps({"shots": len(kfs), "dim": int(mat.shape[1]), "captions": len(captions)}))


def cmd_query(sidecar: Path, text: str, topk: int) -> None:
    import torch
    from transformers import AutoModel, AutoProcessor

    meta_path = sidecar / "embeddings" / "siglip2.meta.json"
    if not meta_path.exists():
        print(json.dumps({"error": "no embeddings — reactable video index <ref> --tier t1"}))
        return
    meta = json.loads(meta_path.read_text())
    mat = np.fromfile(sidecar / "embeddings" / "siglip2.f32", dtype=np.float32).reshape(
        -1, meta["dim"]
    )
    dev = device()
    proc = AutoProcessor.from_pretrained(meta["model"])
    model = AutoModel.from_pretrained(meta["model"], torch_dtype=torch.float32).to(dev).eval()
    with torch.no_grad():
        inputs = proc(text=[text], return_tensors="pt", padding="max_length", max_length=64).to(dev)
        q = pooled(model.get_text_features(**inputs))[0]
        q = (q / q.norm()).cpu().float().numpy()
    scores = mat @ q
    order = np.argsort(-scores)[:topk]
    hits = [
        {
            "shot": meta["rows"][i]["shot"],
            "t_ms": meta["rows"][i]["t_ms"],
            "score": round(float(scores[i]), 4),
        }
        for i in order
    ]
    print(json.dumps({"query": text, "model": meta["model"], "hits": hits}))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "t1":
        cmd_t1(Path(sys.argv[2]))
    elif cmd == "query":
        cmd_query(Path(sys.argv[2]), sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 5)
    else:
        print(json.dumps({"error": f"unknown command {cmd}"}))
        sys.exit(1)
