#!/usr/bin/env bash
set -e
ROOT="$(dirname "$0")"
"$ROOT/node_modules/.bin/ts-node" "$ROOT/compile.ts" "$@"
