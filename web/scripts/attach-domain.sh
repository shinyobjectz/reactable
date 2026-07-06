#!/usr/bin/env bash
# Attach reactable.app to the reactable-web worker (wrangler routes fail on apex with code 10013).
set -euo pipefail
ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-6d4b74aeb10f455fbf88141901e7595d}"
ZONE="${REACTABLE_ZONE_ID:-36d72802fdd5d46f90f775aff8a8c6e1}"
TOKEN="${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"

curl -sf -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/domains" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"hostname\":\"reactable.app\",\"service\":\"reactable-web\",\"environment\":\"production\",\"zone_id\":\"$ZONE\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('attached:', d['result']['hostname'], '→', d['result']['service'])"
