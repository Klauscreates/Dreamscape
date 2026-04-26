#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise SystemExit(f"Missing {label}: {needle}")


def main() -> None:
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (ROOT / "app.js").read_text(encoding="utf-8")

    required_html = {
        "audio input": 'id="audio-files"',
        "spotify input": 'id="spotify-url"',
        "analyze button": 'id="analyze-button"',
        "export button": 'id="export-button"',
        "track results shell": 'id="track-results"',
    }
    required_js = {
        "single/two track renderer": "function renderTrackCards(reports)",
        "state score engine": "function buildStateEngineering(report)",
        "compare engine": "function buildCompareRead(left, right)",
        "collision engine": "function buildCollisionRead(left, right)",
        "visual loop": "function startVisualLoop()",
    }

    for label, needle in required_html.items():
      require(index_html, needle, label)
    for label, needle in required_js.items():
      require(app_js, needle, label)

    print("Smoke check passed: critical UI and analysis hooks are present.")


if __name__ == "__main__":
    main()
