#!/usr/bin/env bash
# Prints SET or MISSING for every variable listed in .env.example. It never prints values.
# This is the only sanctioned way for an agent to learn which credentials are available.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

[ -f .env.example ] || { echo "env-status: .env.example not found" >&2; exit 1; }

set_names=""
if [ -f .env ]; then
  # Keep only NAME=<non-empty value> lines, then strip everything from '=' so values never reach output.
  set_names="$(grep -E '^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_]+=[^[:space:]#]' .env \
    | grep -vE '=(""|'"''"')[[:space:]]*$' \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=.*$//' || true)"
else
  echo "env-status: no .env file (copy .env.example to .env and fill it in)"
fi

while IFS= read -r name; do
  [ -z "$name" ] && continue
  if grep -qx -- "$name" <<<"$set_names"; then
    echo "SET      $name"
  else
    echo "MISSING  $name"
  fi
done < <(grep -E '^[A-Za-z0-9_]+=' .env.example | sed 's/=.*$//')
