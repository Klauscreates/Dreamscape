#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

for source in app.js experience.js orb.js tests/analysis-smoke.mjs; do
  node --check "$source"
done
python3 smoke_check.py
node tests/analysis-smoke.mjs
git diff --check
printf '\nAll local checks passed. Browser/device QA is separate; see docs/QA.md.\n'
