#!/bin/bash
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20.16.0 >/dev/null
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# Nest cwd is apps/api so pipeline + templates resolve from repo root via relative fallbacks.
cd "$ROOT/apps/api"
exec node dist/main.js
