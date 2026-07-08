#!/usr/bin/env bash
# Create the local MLX footage-intel venv (.venv-mlx) — the primary, on-device
# pass lane (Apple Silicon GPU). Idempotent. docs/PLAN.footage-intel.work.
#
# The MLX SAM3 port ships weights but not the CLIP BPE vocab it tokenizes text
# with, so we fetch that too. reactable-tools/video.ts finds this venv via
# .venv-mlx/bin/python (or $REACTABLE_MLX_PYTHON).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv-mlx"

if [[ "$(uname -sm)" != "Darwin arm64" ]]; then
  echo "setup-mlx: local MLX lane is Apple-Silicon only — skipping (cloud gateway will be used)." >&2
  exit 0
fi

echo "→ creating $VENV (python 3.13)…"
uv venv --python 3.13 "$VENV" >/dev/null

echo "→ installing MLX SAM3 + depth deps…"
uv pip install --python "$VENV/bin/python" -q \
  "git+https://github.com/Deekshith-Dade/mlx_sam3.git" \
  mlx mlx-vlm \
  "transformers>=4.44" torch torchvision \
  opencv-python-headless pillow numpy pycocotools

SP="$("$VENV/bin/python" -c 'import sam3,os;print(os.path.dirname(os.path.dirname(sam3.__file__)))')"
BPE_URL="https://github.com/openai/CLIP/raw/main/clip/bpe_simple_vocab_16e6.txt.gz"
for d in "$SP/assets" "$SP/sam3/assets"; do
  mkdir -p "$d"
  [[ -f "$d/bpe_simple_vocab_16e6.txt.gz" ]] || curl -sL "$BPE_URL" -o "$d/bpe_simple_vocab_16e6.txt.gz"
done

echo "→ done. Local footage passes will run on the Mac GPU (MLX)."
echo "  verify: $VENV/bin/python $ROOT/scripts/footage-mlx.py sam3 <video> --concepts car --out /tmp/x.json"
