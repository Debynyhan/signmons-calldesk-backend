#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
DEV_AUTH_TOKEN="${DEV_AUTH_TOKEN:-${DEV_AUTH_SECRET:-dev-auth-secret}}"
DEV_AUTH_ROLE="${DEV_AUTH_ROLE:-admin}"
DEV_AUTH_USER_ID="${DEV_AUTH_USER_ID:-dev-user}"

DEV_AUTH_ROLE="$(printf "%s" "$DEV_AUTH_ROLE" | tr '[:upper:]' '[:lower:]')"

if [[ -z "$DEV_AUTH_TOKEN" ]]; then
  echo "DEV_AUTH_TOKEN is required (or set DEV_AUTH_SECRET)." >&2
  exit 1
fi

request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  shift 3 || true
  local extra_headers=("$@")

  local response
  if [[ -n "$data" ]]; then
    response="$(
      curl -sS -X "$method" "$url" \
        -H "Content-Type: application/json" \
        -H "x-dev-auth: $DEV_AUTH_TOKEN" \
        -H "x-dev-role: $DEV_AUTH_ROLE" \
        -H "x-dev-user-id: $DEV_AUTH_USER_ID" \
        "${extra_headers[@]}" \
        -d "$data" \
        -w '\n%{http_code}'
    )"
  else
    response="$(
      curl -sS -X "$method" "$url" \
        -H "Content-Type: application/json" \
        -H "x-dev-auth: $DEV_AUTH_TOKEN" \
        -H "x-dev-role: $DEV_AUTH_ROLE" \
        -H "x-dev-user-id: $DEV_AUTH_USER_ID" \
        "${extra_headers[@]}" \
        -w '\n%{http_code}'
    )"
  fi

  local status
  status="$(printf "%s" "$response" | tail -n1)"
  local body
  body="$(printf "%s" "$response" | sed '$d')"

  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    echo "Request failed: $method $url (status $status)" >&2
    echo "$body" >&2
    exit 1
  fi

  printf "%s" "$body"
}

echo "==> Creating tenant"
tenant_payload='{"name":"demo_hvac","timezone":"UTC","settings":{"displayName":"Demo HVAC","instructions":"Handle calls, collect details, confirm fees."}}'
tenant_body="$(request POST "$API_BASE/tenants" "$tenant_payload")"
tenant_id="$(
  printf "%s" "$tenant_body" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(data.tenantId || "");
  '
)"

if [[ -z "$tenant_id" ]]; then
  echo "Failed to read tenantId from response." >&2
  echo "$tenant_body" >&2
  exit 1
fi

echo "==> Tenant created: $tenant_id"

session_id="smoke-$(date +%s)"
triage_payload="$(
  cat <<JSON
{"tenantId":"$tenant_id","sessionId":"$session_id","message":"My furnace stopped blowing warm air."}
JSON
)"

echo "==> Running AI triage"
triage_body="$(request POST "$API_BASE/ai/triage" "$triage_payload" -H "x-dev-tenant-id: $tenant_id")"
triage_status="$(
  printf "%s" "$triage_body" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(data.status || "");
  '
)"

if [[ "$triage_status" != "job_created" ]]; then
  echo "Expected job_created, got: $triage_status" >&2
  echo "$triage_body" >&2
  exit 1
fi

job_id="$(
  printf "%s" "$triage_body" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write((data.job && data.job.id) || "");
  '
)"

if [[ -z "$job_id" ]]; then
  echo "No job id returned from triage." >&2
  echo "$triage_body" >&2
  exit 1
fi

echo "==> Job created: $job_id"

echo "==> Listing jobs"
jobs_body="$(request GET "$API_BASE/jobs?tenantId=$tenant_id" "" -H "x-dev-tenant-id: $tenant_id")"
job_found="$(
  printf "%s" "$jobs_body" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const jobId = process.argv[1];
    const ok = Array.isArray(data) && data.some((job) => job.id === jobId);
    process.stdout.write(ok ? "yes" : "no");
  ' "$job_id"
)"

if [[ "$job_found" != "yes" ]]; then
  echo "Job not found in jobs list." >&2
  echo "$jobs_body" >&2
  exit 1
fi

echo "==> Listing conversations"
conversations_body="$(request GET "$API_BASE/conversations?tenantId=$tenant_id" "" -H "x-dev-tenant-id: $tenant_id")"
conversation_found="$(
  printf "%s" "$conversations_body" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const sessionId = process.argv[1];
    const ok =
      Array.isArray(data) &&
      data.some((conversation) => conversation.providerConversationId === sessionId);
    process.stdout.write(ok ? "yes" : "no");
  ' "$session_id"
)"

if [[ "$conversation_found" != "yes" ]]; then
  echo "Conversation for session not found." >&2
  echo "$conversations_body" >&2
  exit 1
fi

echo "==> Smoke test passed"
