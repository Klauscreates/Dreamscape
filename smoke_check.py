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
    experience_js = (ROOT / "experience.js").read_text(encoding="utf-8")
    orb_js = (ROOT / "orb.js").read_text(encoding="utf-8")

    required_html = {
        "audio input": 'id="audio-files"',
        "hero orb": 'id="hero-orb"',
        "analyze button": 'id="analyze-button"',
        "export button": 'id="export-button"',
        "track results shell": 'id="track-results"',
    }
    required_js = {
        "geometric orb renderer": "function drawGeometricOrb(canvas, report, view)",
        "room heatmap renderer": "function drawRoomHeatmap(canvas)",
        "room scan advice": "function buildRoomScanAdvice(room)",
        "state score engine": "function buildStateEngineering(report)",
        "compare engine": "function buildCompareRead(left, right)",
        "collision engine": "function buildCollisionRead(left, right)",
        "visual loop": "function startVisualLoop()",
    }

    for label, needle in required_html.items():
        require(index_html, needle, label)
    for label, needle in required_js.items():
        require(app_js, needle, label)
    for name in ("renderExperience", "updateRoomUI", "drawPlayer"):
        require(experience_js, f"export function {name}(", name)
    for name in ("drawFingerprint", "bindOrb", "disposeDetachedOrbs"):
        require(orb_js, f"export function {name}(", name)

    print("Static smoke check passed: module and analysis hooks are present. See docs/QA.md for browser verification.")


if __name__ == "__main__":
    main()
