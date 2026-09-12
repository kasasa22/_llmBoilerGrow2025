#!/usr/bin/env bash
# Idempotency smoke:
#   T1: double-POST with the same query returns the same job_id and only one
#       Inngest execution happens.
#   T2: double-POST with the same Idempotency-Key => same job_id, dedup hit.
#   T3: same Idempotency-Key with a different body => HTTP 409.
#   T4: late subscriber gets the final event replayed.
set -euo pipefail

FLASK_URL="${FLASK_URL:-http://localhost:8080}"
QUERY="${QUERY:-Give me the top 3 stable release milestones of Kubernetes 1.30 with sources.}"
IDEM_KEY="${IDEM_KEY:-bosmart-idem-$(date +%s)}"

post() {
  local body=$1
  local key=${2:-}
  local headers=(-H 'content-type: application/json')
  [ -n "$key" ] && headers+=(-H "Idempotency-Key: $key")
  curl -sS -D - "${headers[@]}" -d "$body" "${FLASK_URL}/api/chat"
}

split_status() { printf '%s\n' "$1" | head -n1 | awk '{print $2}'; }
split_body()   { printf '%s\n' "$1" | awk 'BEGIN{p=0}/^\r?$/{p=1;next}p'; }
split_header() { printf '%s\n' "$1" | tr -d '\r' | awk -F': ' -v k="$2" 'tolower($1)==tolower(k){print $2; exit}'; }

echo "== T1: bare double-POST =="
b=$(jq -n --arg q "$QUERY" '{query:$q}')
r1=$(post "$b"); j1=$(split_body "$r1" | jq -r '.job_id')
r2=$(post "$b"); j2=$(split_body "$r2" | jq -r '.job_id'); s2=$(split_status "$r2")
echo "  1st job_id=$j1 (should be 202)"
echo "  2nd job_id=$j2 (should be 200)"
[ "$j1" = "$j2" ] || { echo "FAIL T1 job_ids differ"; exit 2; }
[ "$s2" = "200" ] || { echo "FAIL T1 second call not a dedup hit (status=$s2)"; exit 2; }

echo "== T2: Idempotency-Key double-POST =="
r3=$(post "$b" "$IDEM_KEY"); j3=$(split_body "$r3" | jq -r '.job_id')
r4=$(post "$b" "$IDEM_KEY"); j4=$(split_body "$r4" | jq -r '.job_id'); s4=$(split_status "$r4")
echo "  1st job_id=$j3   2nd job_id=$j4 (status=$s4)"
[ "$j3" = "$j4" ] || { echo "FAIL T2 job_ids differ"; exit 2; }
[ "$s4" = "200" ] || { echo "FAIL T2 status $s4 (want 200)"; exit 2; }

echo "== T3: Idempotency-Key reused with different body =="
b2=$(jq -n --arg q "totally different question" '{query:$q}')
r5=$(post "$b2" "$IDEM_KEY"); s5=$(split_status "$r5")
echo "  status=$s5 (should be 409)"
[ "$s5" = "409" ] || { echo "FAIL T3 expected 409 got $s5"; exit 2; }

echo "== T4: late subscriber gets final replay =="
# Wait up to 90s for T1's job to reach 'done'.
for _ in $(seq 1 45); do
  st=$(curl -sS "${FLASK_URL}/api/jobs/${j1}" | jq -r '.state // empty')
  if [ "$st" = "done" ] || [ "$st" = "failed" ] || [ "$st" = "budget_exhausted" ]; then break; fi
  sleep 2
done
echo "  job state: $st"

tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
timeout 10 curl -sS -N "${FLASK_URL}/api/jobs/${j1}/stream" > "$tmp" || true
if grep -q '^event: final' "$tmp"; then
  echo "  OK final replayed to late subscriber"
else
  echo "FAIL T4 no final event replayed" >&2; exit 3
fi

echo "ALL PASS"
