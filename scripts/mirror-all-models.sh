#!/usr/bin/env bash
# Upload all three model tiers to R2, strictly ONE AT A TIME. Resumable (skips
# objects already in R2). Single-instance: a lock prevents duplicate runs from
# ever competing for bandwidth again.
set -uo pipefail
cd "$(dirname "$0")/.."
export CLOUDFLARE_ACCOUNT_ID=6d4b74aeb10f455fbf88141901e7595d
export HF_HUB_ENABLE_HF_TRANSFER=0

# ── single-instance lock (atomic mkdir) ──
LOCK="/tmp/reactable-mirror.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another mirror run holds $LOCK — exiting (no duplicates)."
  exit 0
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM

log(){ echo "[$(date +%H:%M:%S)] $*"; }

# One tier at a time; within a tier, upload-model-r2.sh uploads one part at a time.
for repo in mlx-community/gemma-4-e2b-it-4bit \
            mlx-community/gemma-4-e4b-it-4bit \
            mlx-community/gemma-4-12B-it-4bit; do
  cache="$HOME/.cache/huggingface/hub/models--${repo//\//--}"
  if ! ls "$cache"/snapshots/*/config.json >/dev/null 2>&1; then
    log "downloading $repo from HF…"
    uvx --from 'huggingface_hub[cli]' hf download "$repo" >/dev/null 2>&1
  fi
  log "mirroring $repo → R2 (sequential)…"
  bash scripts/upload-model-r2.sh "$repo"
  log "done $repo"
done
log "ALL TIERS MIRRORED"
