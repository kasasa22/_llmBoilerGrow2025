#!/usr/bin/env bash
# Correlated log tail by trace_id across Flask + worker.
# Usage:
#   scripts/trace.sh <trace_id>
#   MODE=compose scripts/trace.sh <trace_id>   # tail docker compose services
#   MODE=k8s     scripts/trace.sh <trace_id>   # tail kubectl deploy/{app,worker}
#
# Requires: jq. For MODE=compose: docker. For MODE=k8s: kubectl.
set -euo pipefail

TID="${1:-}"
if [ -z "$TID" ]; then
  echo "usage: $0 <trace_id> [MODE=compose|k8s]"; exit 2
fi
MODE="${MODE:-compose}"

filter='select(.trace_id == $t) | {ts, service, level, trace_id, job_id, span_id, msg: (.msg // .message // .phase // .")}'

case "$MODE" in
  compose)
    (docker compose logs -f --no-color flask   2>/dev/null | \
      awk 'sub(/^flask-1[[:space:]]*\| /,"") {print}' | \
      jq --arg t "$TID" -c "$filter" 2>/dev/null) &
    (docker compose logs -f --no-color worker  2>/dev/null | \
      awk 'sub(/^worker-1[[:space:]]*\| /,"") {print}' | \
      jq --arg t "$TID" -c "$filter" 2>/dev/null) &
    wait
    ;;
  k8s)
    (kubectl -n apps logs -f deploy/app    | jq --arg t "$TID" -c "$filter" 2>/dev/null) &
    (kubectl -n apps logs -f deploy/worker | jq --arg t "$TID" -c "$filter" 2>/dev/null) &
    wait
    ;;
  *) echo "unknown MODE=$MODE"; exit 2;;
esac
