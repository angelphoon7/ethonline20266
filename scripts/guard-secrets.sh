#!/usr/bin/env bash
# Risksir pre-commit guard, needed because an autonomous agent commits and pushes to a public repo.
#   1) Refuses to commit any .env file (except .env.example) and any *.pem or *.key file.
#   2) Refuses to commit if the value of any secret-like variable in .env appears in the staged diff.
# Never prints secret values.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"

while IFS= read -r f; do
  [ -z "$f" ] && continue
  base="${f##*/}"
  case "$base" in
    .env.example) ;;
    .env|.env.*|*.pem|*.key)
      echo "guard-secrets: refusing to commit '$f'. Unstage it with: git restore --staged '$f'" >&2
      exit 1 ;;
  esac
done <<<"$staged_files"

[ -f .env ] || exit 0

staged_diff="$(git diff --cached -U0 --no-color)"

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
  case "$line" in ''|'#'*) continue ;; esac
  line="${line#export }"
  case "$line" in *=*) ;; *) continue ;; esac
  name="${line%%=*}"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  case "$name" in
    *KEY*|*SECRET*|*TOKEN*|*PASSWORD*|*PRIVATE*|*MNEMONIC*|*SEED*) ;;
    *) continue ;;
  esac
  [ "${#value}" -ge 8 ] || continue
  if grep -qF -- "$value" <<<"$staged_diff"; then
    echo "guard-secrets: staged changes contain the value of $name. Commit blocked." >&2
    exit 1
  fi
  bare="${value#0x}"
  if [ "$bare" != "$value" ] && [ "${#bare}" -ge 8 ] && grep -qF -- "$bare" <<<"$staged_diff"; then
    echo "guard-secrets: staged changes contain the value of $name (without 0x). Commit blocked." >&2
    exit 1
  fi
done < .env

exit 0
