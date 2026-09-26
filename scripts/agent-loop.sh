#!/usr/bin/env bash
# Risksir autonomous loop. Each iteration starts a fresh headless Claude Code session.
# That session reads CLAUDE.md and HANDOFF.md, completes up to 3 milestones, commits and pushes.
#
# The loop stops when any of these happens:
#   - HANDOFF.md says AGENT_STATUS: HUMAN_REQUIRED or ALL_DONE
#   - .agent/STOP exists (create it to stop gracefully: touch .agent/STOP)
#   - two iterations in a row produce no new commit
#   - MAX_ITER is reached
#
# Usage:  ./scripts/agent-loop.sh              (default 6 iterations)
#         MAX_ITER=12 ./scripts/agent-loop.sh
set -euo pipefail

MAX_ITER="${MAX_ITER:-6}"
MODE="${PERMISSION_MODE:-acceptEdits}"

cd "$(git rev-parse --show-toplevel)"
mkdir -p .agent
command -v claude >/dev/null || { echo "[loop] 'claude' CLI not found on PATH" >&2; exit 1; }

no_progress=0
for i in $(seq 1 "$MAX_ITER"); do
  if [ -f .agent/STOP ]; then
    echo "[loop] .agent/STOP found. Stopping."
    rm -f .agent/STOP
    break
  fi

  if [ -f SPEC.md ] && [ -f EXECUTION_PLAN.md ]; then
    prompt_file="prompts/NEXT.md"
  else
    prompt_file="prompts/00_BOOTSTRAP.md"
  fi

  before="$(git rev-parse HEAD 2>/dev/null || echo none)"
  echo "[loop] iteration $i/$MAX_ITER using $prompt_file ($(date '+%H:%M:%S'))"

  claude -p "$(cat "$prompt_file")" --permission-mode "$MODE" 2>&1 \
    | tee -a ".agent/loop-$(date +%Y%m%d).log"

  after="$(git rev-parse HEAD 2>/dev/null || echo none)"
  status="$(grep -m1 -E '^AGENT_STATUS:' HANDOFF.md 2>/dev/null | awk '{print $2}' || true)"
  echo "[loop] AGENT_STATUS=${status:-UNKNOWN}  HEAD ${before:0:7} -> ${after:0:7}"

  case "${status:-}" in
    HUMAN_REQUIRED|ALL_DONE)
      echo "[loop] Stopping. Read HANDOFF.md (HUMAN_ACTIONS)."
      grep -m1 -E '^HUMAN_ACTIONS:' HANDOFF.md 2>/dev/null || true
      break ;;
  esac

  if [ "$before" = "$after" ]; then
    no_progress=$((no_progress + 1))
    if [ "$no_progress" -ge 2 ]; then
      echo "[loop] No new commits in 2 iterations. Stopping. Check .agent/ logs and HANDOFF.md."
      break
    fi
  else
    no_progress=0
  fi
done
