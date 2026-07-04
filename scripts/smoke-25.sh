#!/usr/bin/env bash
# smoke-25.sh — consumer-visible smoke for issue #25 (apex reachability + shapes).
#
# Hard checks (reachability — the #25 contract):
#   1. GET /health                                    -> 200, {ok:true, service:"inventory-api"}
#   2. GET /.well-known/beacon.json                   -> 200 (BeaconV3 declaration, PR #18)
#   3. GET /nfts/:mibera/owner/:holder?pageSize=6     -> 200, valid NFTCollection shape
#
# Data check (known-degraded until Mibera is kitchen-ingested onto the belt —
# see bead bd-5o6a): nfts non-empty AND holdings envelope not "degraded".
# Warn-only by default; --strict-data promotes it to a hard check.
#
# Usage: scripts/smoke-25.sh [--base URL] [--holder ADDR] [--strict-data]

set -euo pipefail

BASE="https://inventory.0xhoneyjar.xyz"
CONTRACT="0x6666397DFe9a8c469BF65dc744CB1C733416c420"
HOLDER="0x06704960F02b234808732F11aDf495429361B7E0" # verified via ownerOf(1) on Berachain 80094
STRICT_DATA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)        BASE="$2"; shift 2 ;;
    --holder)      HOLDER="$2"; shift 2 ;;
    --strict-data) STRICT_DATA=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null || { echo "FAIL deps: jq required" >&2; exit 1; }

failures=0
check() { # check <name> <ok:0|1> <detail>
  if [[ "$2" -eq 0 ]]; then echo "ok   $1 — $3"; else echo "FAIL $1 — $3" >&2; failures=$((failures+1)); fi
}

# 1. /health
body=$(curl -sS -m 15 -w '\n%{http_code}' "$BASE/health" 2>&1) || body=$'\n000'
code="${body##*$'\n'}"; json="${body%$'\n'*}"
if [[ "$code" == "200" ]] && jq -e '.ok == true and .service == "inventory-api"' <<<"$json" >/dev/null 2>&1; then
  check health 0 "$json"
else
  check health 1 "http=$code body=${json:0:120}"
fi

# 2. beacon.json
code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$BASE/.well-known/beacon.json" 2>&1) || code=000
[[ "$code" == "200" ]] && check beacon 0 "http=200" || check beacon 1 "http=$code (needs PR #18 merged + deployed)"

# 3. nfts endpoint shape
body=$(curl -sS -m 20 -w '\n%{http_code}' "$BASE/nfts/$CONTRACT/owner/$HOLDER?pageSize=6" 2>&1) || body=$'\n000'
code="${body##*$'\n'}"; json="${body%$'\n'*}"
if [[ "$code" == "200" ]] && jq -e '.contractAddress and (.nfts | type == "array")' <<<"$json" >/dev/null 2>&1; then
  check nfts-shape 0 "http=200, nfts=$(jq '.nfts | length' <<<"$json")"
else
  check nfts-shape 1 "http=$code body=${json:0:120}"
fi

# 4. data check (holder actually resolves; envelope not degraded)
nft_count=$(jq '.nfts | length' <<<"$json" 2>/dev/null || echo 0)
envelope=$(curl -sS -m 15 "$BASE/holdings/$HOLDER" 2>/dev/null | jq -r '.completeness.complete // "unreachable"' 2>/dev/null) || envelope="unreachable"
if [[ "$nft_count" -gt 0 && "$envelope" != "degraded" ]]; then
  check data 0 "nfts=$nft_count envelope=$envelope"
elif [[ "$STRICT_DATA" -eq 1 ]]; then
  check data 1 "nfts=$nft_count envelope=$envelope (Mibera not on belt — bd-5o6a)"
else
  echo "warn data — nfts=$nft_count envelope=$envelope (known gap bd-5o6a: Mibera awaits kitchen ingest; not a #25 reachability failure)"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "SMOKE-25 FAIL base=$BASE failures=$failures" >&2
  exit 1
fi
echo "SMOKE-25 PASS base=$BASE ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
