# Edit intel — P4 fine-tuning on Modal (QLoRA + DoRA, Unsloth).
# docs/PLAN.omni-editing-model.work §7 recipe, §9-P4.
#
# Trains the reconstruction task (footage-intel scene graph → edit-skeleton/1)
# from the SFT dataset exported by `reactable dataset export`
# (edit-intel/dataset/{train,val}.jsonl). Saves a LoRA adapter to a Volume.
#
# COST-GATED like the footage lane: the default entrypoint ESTIMATES only and
# does NOT train. Pass --run to dispatch a paid GPU job.
#
#   modal run gpu/modal_train.py                 # estimate (free, no GPU)
#   modal run gpu/modal_train.py --run           # dispatch training (paid)
#   modal run gpu/modal_train.py --run --base unsloth/Qwen2.5-Coder-7B-Instruct
#
# v1 base = a TEXT coder LLM: the task is text→text (the perception is already
# serialized), so a coder model is the cheap A/B baseline (§5). The Qwen3-VL
# path (raw frames + sidecar) is the follow-up once text-only is measured.
import json
from pathlib import Path

import modal

app = modal.App("reactable-train")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "unsloth",           # QLoRA/DoRA + fast kernels (single-GPU VLM/LLM)
        "trl>=0.12",         # SFTTrainer
        "transformers>=4.46",
        "datasets",
        "accelerate",
        "peft>=0.13",        # DoRA
        "bitsandbytes",      # 4-bit NF4
    )
)

VOL = modal.Volume.from_name("reactable-train", create_if_missing=True)

DEFAULT_BASE = "unsloth/Qwen2.5-Coder-7B-Instruct"
# L40S ≈ $1.95/hr (Modal, mid-2026) — best for a single-GPU LoRA (§7).
GPU = "L40S"


@app.function(image=image, gpu=GPU, volumes={"/vol": VOL}, timeout=60 * 60 * 3)
def train(rows: list[dict], base: str, epochs: int, run_name: str):
    from unsloth import FastLanguageModel
    from trl import SFTConfig, SFTTrainer
    from datasets import Dataset

    max_seq = 4096
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base,
        max_seq_length=max_seq,
        load_in_4bit=True,       # QLoRA (NF4)
        dtype=None,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        lora_alpha=32,           # α = 2r (§7)
        target_modules="all-linear",
        lora_dropout=0.0,
        bias="none",
        use_dora=True,           # DoRA (§7): recovers most of the full-FT gap
        use_gradient_checkpointing="unsloth",
        random_state=0,
    )

    def fmt(batch):
        return {"text": [tokenizer.apply_chat_template(m, tokenize=False) for m in batch["messages"]]}

    ds = Dataset.from_list(rows).map(fmt, batched=True)

    out = f"/vol/adapters/{run_name}"
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=ds,
        args=SFTConfig(
            dataset_text_field="text",
            max_seq_length=max_seq,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=8,
            num_train_epochs=epochs,
            learning_rate=1e-4,
            warmup_ratio=0.05,
            logging_steps=1,
            optim="adamw_8bit",
            lr_scheduler_type="cosine",
            output_dir=f"/vol/ckpt/{run_name}",
            save_strategy="epoch",
        ),
    )
    stats = trainer.train()
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    VOL.commit()
    return {"adapter": out, "train_runtime_s": round(stats.metrics.get("train_runtime", 0), 1), "rows": len(rows), "base": base}


def _load(split: str) -> list[dict]:
    p = Path("edit-intel/dataset") / f"{split}.jsonl"
    if not p.exists():
        raise SystemExit(f"no {p} — run: reactable dataset export")
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


@app.local_entrypoint()
def main(run: bool = False, base: str = DEFAULT_BASE, epochs: int = 3, name: str = "editor-v1"):
    rows = _load("train")
    chars = sum(len(m[-1]["content"]) + len(m[0]["content"]) for m in (r["messages"] for r in rows))
    tokens = chars // 4
    # very rough: ~1500 tok/s effective throughput for a 7B QLoRA on L40S
    est_min = round(tokens * epochs / 1500 / 60, 1)
    est_usd = round(est_min / 60 * 1.95, 2)
    print(json.dumps({
        "rows": len(rows), "base": base, "gpu": GPU, "epochs": epochs,
        "est_tokens": tokens, "est_minutes": est_min, "est_usd": est_usd,
        "dispatch": run,
    }, indent=2))
    if len(rows) < 200:
        print("WARNING: <200 training rows — scale the corpus (synth pairs + real takes) before a real run; §7 targets 2–5k.")
    if not run:
        print("estimate only — add --run to dispatch a PAID GPU job.")
        return
    print(train.remote(rows, base, epochs, name))
