#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo compiling TypeScript
node_modules/.bin/tsc
echo compiling PEG.js
node_modules/.bin/pegjs -o parse-generated.js parse.pegjs
cp parse-generated.js tracing.js ts-dist
echo bundling modules
node_modules/.bin/browserify --node --no-bundle-external ts-dist/compile.js -o dist/compile.js
