#!/bin/bash
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20.16.0 >/dev/null
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/apps/web"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
export PORT="${PORT:-3010}"
exec npx next start --hostname "$HOSTNAME" --port "$PORT"
