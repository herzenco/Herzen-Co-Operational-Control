#!/usr/bin/env bash
set -euo pipefail

OCC_KEYCHAIN_SERVICE="${OCC_KEYCHAIN_SERVICE:-herzenco-occ}"
OCC_KEYCHAIN_ACCOUNT="${OCC_KEYCHAIN_ACCOUNT:-lupe}"
export OCC_PUBLIC_URL="${OCC_PUBLIC_URL:-https://operations.herzenco.co}"
export OCC_API_KEY="$(security find-generic-password -s "$OCC_KEYCHAIN_SERVICE" -a "$OCC_KEYCHAIN_ACCOUNT" -w)"
unset LUPE_API_TOKEN

if [[ "$OCC_API_KEY" != occ_agent_* ]]; then
  echo "The Keychain item is not an OCC agent credential." >&2
  exit 1
fi

exec "$@"
