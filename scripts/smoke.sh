#!/usr/bin/env bash
# End-to-end smoke: POST /api/chat, tail SSE, assert we saw a `final` event.
# Usage:
#   FLASK_URL=http://localhost:8080 scripts/smoke.sh
#   FLASK_URL=http://<lb-ip>        scripts/smoke.sh   # against the cluster
set -euo pipefail

FLASK_URL="${FLASK_URL:-http://localhost:8080}"
QUERY="${QUERY:-Summarise the current Civo Kubernetes offering with at least one citation.}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"

echo ">> POST ${FLASK_URL}/api/chat"
resp=$(curl -sS -D - -H 'content-type: application/json' \
  -d "$(jq -n --arg q "$QUERY" '{query:$q}')" \
  "${FLASK_URL}/api/chat")

status=$(printf '%s\n' "$resp" | head -n1 | awk '{print $2}')
body=$(printf '%s\n' "$resp" | awk 'BEGIN{p=0}/^\r?$/{p=1;next}p')
trace_id=$(printf '%s\n' "$resp" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-trace-id"{print $2; exit}')
echo ">> HTTP $status | trace_id=$trace_id"
echo "$body" | jq . || echo "(body not JSON)"

job_id=$(printf '%s\n' "$body" | jq -r '.job_id // empty')
if [ -z "$job_id" ]; then
  echo "!! no job_id in response"; exit 2
fi

echo ">> tailing SSE for up to ${TIMEOUT_SECONDS}s..."
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
if command -v timeout >/dev/null 2>&1; then
  set +e
  timeout --foreground "${TIMEOUT_SECONDS}" \
    curl -sS -N -H 'accept: text/event-stream' "${FLASK_URL}/api/jobs/${job_id}/stream" > "$tmp"
  rc=$?
  set -e
else
  echo "(no timeout(1) available; will read until EOF)"
  curl -sS -N -H 'accept: text/event-stream' "${FLASK_URL}/api/jobs/${job_id}/stream" > "$tmp" || true
fi

echo ">> SSE captured ($(wc -l < "$tmp") lines):"
# Print event summary lines only (event: <phase>).
grep -E '^event:' "$tmp" || true

if grep -q '^event: final' "$tmp"; then
  echo "OK  final event received."
else
  echo "FAIL  no final event in stream" >&2
  exit 3
fi
