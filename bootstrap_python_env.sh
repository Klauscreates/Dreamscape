#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

cat <<'EOF'

Python environment ready.

Activate it with:
  source .venv/bin/activate

Optional Essentia add-on:
  python -m pip install -r requirements-essentia.txt

Smoke check:
  python sound_analyzer.py "analog_mannequin - and all its contents.mp3" --out-dir analysis_output_smoke

EOF
