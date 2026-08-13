#!/usr/bin/env bash
# Builds store-ready artifacts into release/:
#   beldex-wallet-chrome-v<V>.zip   — upload to Chrome Web Store
#   beldex-wallet-firefox-v<V>.zip  — upload to AMO
#   beldex-wallet-source-v<V>.zip   — AMO source-review zip (clean tree at HEAD,
#                                     includes patches/, excludes node_modules
#                                     and build output via git archive)
# Run via: npm run package   (builds both targets first)
#
# NOTE: the source zip is taken from git HEAD — commit everything before
# packaging or the source won't match the uploaded binaries.
set -euo pipefail
cd "$(dirname "$0")/.."

V=$(node -p "require('./package.json').version")

if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: working tree is dirty — source zip (git HEAD) may not match the builds." >&2
fi

mkdir -p release
rm -f "release/beldex-wallet-chrome-v$V.zip" \
      "release/beldex-wallet-firefox-v$V.zip" \
      "release/beldex-wallet-source-v$V.zip"

(cd dist && zip -qr "../release/beldex-wallet-chrome-v$V.zip" .)
(cd firefox && zip -qr "../release/beldex-wallet-firefox-v$V.zip" .)
git archive HEAD -o "release/beldex-wallet-source-v$V.zip"

echo "Artifacts:"
ls -l release/*-v"$V".zip
