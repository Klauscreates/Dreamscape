#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

for source in app.js experience.js orb.js pwa.js sw.js scripts/sync-offline-version.mjs tests/analysis-smoke.mjs; do
  node --check "$source"
done
node scripts/sync-offline-version.mjs --check
python3 smoke_check.py
node tests/analysis-smoke.mjs
node tests/offline-smoke.mjs
git diff --check
printf '\nAll local checks passed. Browser/device QA is separate; see docs/QA.md.\n'
