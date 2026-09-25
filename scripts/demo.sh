#!/usr/bin/env bash
# Start the API and console, then submit the example workloads for a live demo.
# Usage: pnpm demo   (MockLLM + LocalSandbox, no keys)
set -euo pipefail
cd "$(dirname "$0")/.."

export KERNEL_DB_PATH="${KERNEL_DB_PATH:-./data/demo.db}"
export MOCK_LATENCY_MS="${MOCK_LATENCY_MS:-700}"
export OTEL_SDK_DISABLED="${OTEL_SDK_DISABLED:-true}"
API="${API_URL:-http://localhost:4000}"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

echo "building console..."
pnpm --silent --filter @kernelagent/console build >/dev/null

pnpm --silent --filter @kernelagent/api start & pids+=($!)
pnpm --silent --filter @kernelagent/console start >/dev/null & pids+=($!)

until curl -sf "$API/health" >/dev/null; do sleep 0.5; done
until curl -sf -o /dev/null http://localhost:3000; do sleep 0.5; done
echo
echo "console: http://localhost:3000"
echo "api:     $API"
echo

submit() { curl -s -XPOST "$API/jobs" -H 'content-type: application/json' -d @"$1"; echo; }

sleep 3
echo "submitting research-pipeline"; submit examples/research-pipeline/job.json
sleep 6
echo "submitting coding-task";       submit examples/coding-task/job.json
sleep 4
echo "submitting approval-gate (open its PID in the console and press approve)"
submit examples/approval-gate.json

echo
echo "Ctrl-C to stop."
wait
