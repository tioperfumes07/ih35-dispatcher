#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT:-3100}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[smoke-check] Base URL: $BASE_URL"

health_code="$(curl -sS -o "$TMP_DIR/health.json" -w '%{http_code}' "$BASE_URL/api/health")"
if [[ "$health_code" != "200" ]]; then
  echo "[smoke-check] FAIL /api/health http=$health_code"
  exit 1
fi
echo "[smoke-check] OK /api/health"

board_code="$(curl -sS -o "$TMP_DIR/board.json" -w '%{http_code}' "$BASE_URL/api/board")"
if [[ "$board_code" != "200" ]]; then
  echo "[smoke-check] FAIL /api/board http=$board_code"
  exit 1
fi

vehicles_count="$(python3 -c 'import json,sys; data=json.load(open(sys.argv[1], "r", encoding="utf-8")); v=data.get("vehicles") if isinstance(data, dict) else []; print(len(v) if isinstance(v, list) else 0)' "$TMP_DIR/board.json")"
if [[ "$vehicles_count" -le 0 ]]; then
  echo "[smoke-check] FAIL /api/board vehicles=$vehicles_count (expected > 0)"
  exit 1
fi
echo "[smoke-check] OK /api/board vehicles=$vehicles_count"

hub_code="$(curl -sS -o "$TMP_DIR/hub.html" -w '%{http_code}' "$BASE_URL/fleet-reports/index.html")"
if [[ "$hub_code" != "200" ]]; then
  echo "[smoke-check] FAIL /fleet-reports/index.html http=$hub_code"
  exit 1
fi
echo "[smoke-check] OK /fleet-reports/index.html"

echo "[smoke-check] PASS"
