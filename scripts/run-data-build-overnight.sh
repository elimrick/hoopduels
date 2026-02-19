#!/usr/bin/env bash
set -u

cd "$(dirname "$0")/.."

LOG_PATH="data/build-overnight.log"
PID_PATH="data/build.pid"

MAX_ATTEMPTS="${MAX_ATTEMPTS:-50}"
SLEEP_SECONDS="${SLEEP_SECONDS:-20}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] starting overnight build runner" >> "$LOG_PATH"

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] attempt ${attempt}/${MAX_ATTEMPTS}" >> "$LOG_PATH"

  if npm run data:build:strict >> "$LOG_PATH" 2>&1; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] build+validate succeeded" >> "$LOG_PATH"
    if npm run db:seed >> "$LOG_PATH" 2>&1; then
      echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] db seed succeeded; done" >> "$LOG_PATH"
      exit 0
    fi
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] db seed failed; retrying after ${SLEEP_SECONDS}s" >> "$LOG_PATH"
  else
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] build+validate failed; retrying after ${SLEEP_SECONDS}s" >> "$LOG_PATH"
  fi

  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] exhausted retries (${MAX_ATTEMPTS})" >> "$LOG_PATH"
exit 1
