#!/usr/bin/env sh
# The day-one flow from the plan, end to end, against a stub that is already running:
#
#   npm start            # or: docker compose -f docker-compose.stub.yml up
#   examples/day-one.sh  # in another terminal
#
# A partner sends: GET /v2/customers/{id}, returns a customer, 404 when unknown.
# Two rules, and the integration can be written today.
set -eu

BASE="${STUB_URL:-http://localhost:4010}"

echo "1. Is the stub up?"
curl -s "$BASE/health"
echo

echo "2. The success the partner documented."
curl -sX POST "$BASE/stub/rules" -H 'content-type: application/json' -d '{
  "method": "GET",
  "path": "/v2/customers/:id",
  "status": 200,
  "body": { "id": "C-1", "name": "Ada", "tier": "GOLD" },
  "description": "partner docs, GET /v2/customers/{id} example response",
  "sessionId": "onboarding"
}' > /dev/null

echo "3. The failure the ticket names."
curl -sX POST "$BASE/stub/rules" -H 'content-type: application/json' -d '{
  "method": "GET",
  "path": "/v2/customers/missing",
  "status": 404,
  "body": { "error": "CUSTOMER_NOT_FOUND" },
  "description": "ticket INT-214, unknown customer",
  "times": 1
}' > /dev/null

echo "4. Call them. The first needs the session header; without it the rule is invisible."
curl -s -H 'x-stub-session: onboarding' "$BASE/v2/customers/C-1"
echo
curl -s -o /dev/null -w 'without the session header: %{http_code}\n' "$BASE/v2/customers/C-1"

echo "5. The 404, once."
curl -s -w ' (%{http_code})\n' "$BASE/v2/customers/missing"
curl -s -o /dev/null -w 'again: %{http_code}\n' "$BASE/v2/customers/missing"

echo "6. What the application actually sent, 404s included."
curl -s "$BASE/stub/requests?path=customers" | tr -d '\n' | cut -c1-400
echo

echo "7. Make one call fail, without installing a rule."
curl -sX POST "$BASE/stub/failures" -H 'content-type: application/json' \
  -d '{"key":"C-9","status":409,"body":{"error":"TOO_SOON"}}' > /dev/null
curl -s -w ' (%{http_code})\n' "$BASE/v2/customers/C-9?key=C-9"

echo "8. Clean up."
curl -sX DELETE "$BASE/stub/failures" > /dev/null
curl -sX DELETE "$BASE/stub/rules?sessionId=onboarding" > /dev/null
curl -sX DELETE "$BASE/stub/rules" > /dev/null
echo done
