#!/bin/sh
# promptfoo sends anonymous telemetry and checks for updates by default; neither may leave this machine.
# Its database and cache go in this folder rather than ~/.promptfoo.
cd "$(dirname "$0")"
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_SHARING=1 PROMPTFOO_DISABLE_REMOTE_GENERATION=1 PROMPTFOO_CONFIG_DIR="$PWD/.promptfoo"
npx promptfoo eval -c promptfooconfig.yaml --no-cache --max-concurrency 1 -o results.json "$@"
