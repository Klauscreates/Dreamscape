# Redesign verification

## Installation and offline verification: October 2, 2026

- Manifest validates with a standalone display, stable app identity and PNG icons at 192/512 pixels, plus a maskable icon and Apple touch icon.
- Inspected the actual icon, launch image and mobile installation dialog. Tested the iPhone guide with a simulated iPhone user agent; physical iPhone installation and launch images still need device validation.
- Downloaded the app shell in Chromium, disconnected the browser, reloaded, uploaded two real local MP3s, generated their analyses, compared their distinct IDs and exported both reports while offline. Playback and the five Study tasks also worked offline.
- Inspected cache keys: only the 17 explicitly listed app assets were present. Recordings, reports and API routes bypass the cache.
- Simulated a new worker release: the update banner appeared, the current analyzed track stayed intact while the update waited, explicit Update and reload activated the new worker, and the previous app cache was removed.
- `tests/offline-smoke.mjs` checks failed precache rollback, user-triggered activation, old-cache cleanup, private/external request bypass and integrity-checked recovery of evicted files. An asset from a different release returns unavailable rather than entering the current cache.
- Fresh browser testing reported no uncaught errors. Chromium's isolated test context reported installation blocked by private browsing; the regular browser session emitted a native installation event. Native app installation was not completed by automation.

The older evidence below applies to the audio/UI redesign; installation is an
additional layer and does not change the DSP calculations.

Verified locally on September 25, 2026 using Chromium browser automation and
the static app served at `http://127.0.0.1:8040/`. No deployment or push was made.

## Functional evidence

- Uploaded and analyzed both real local MP3 fixtures: `analog_mannequin - and all its contents.mp3` and `øneheart - watching the stars (sped up).mp3` (20 seconds each). Distinct reports and scores populated; appending another upload retained the earlier library entry.
- Navigated Now Playing, Library, Compare, Collision, Study, Room, Cleanser, History, Exports and Settings. Checked visible content for NaN, undefined and null output.
- Swapped Track A/B using the selectors. Selection stayed distinct; downloaded JSON contained the matching left/right IDs and both named reports.
- Tested player pause/resume: position remained at 1.10 seconds while paused and advanced to 1.65 after resuming. Seeking near the end with loop enabled wrapped to 0.55 seconds. Restart, volume control, and a keyboard-focused seek bar were exercised.
- Mouse drag changed orb yaw/pitch, wheel changed zoom, and Home reset the camera. Chromium touch emulation changed rotation and pinch zoom with no stuck pointers. Fullscreen entered and exited. Reduced-motion screenshots were identical across frames when paused.
- Browser microphone capture produced live spectrum samples and changing metrics. Marked Desk and Window, verified both summaries, and stopped capture. A room-only session exported JSON without requiring a song.
- Corrupt MP3 decoding displayed a readable failure and retained both existing analyses. Unsupported dropped text files displayed a format error.
- Tested empty and one-track Compare states and empty Room metrics. No environmental scores appeared without samples.
- Simulated NotAllowedError and NotFoundError from getUserMedia to verify denied/missing microphone messages and empty metrics. Simulated unavailable WebGL to verify the visible fallback. Simulated export creation failure to verify the retry message.
- Inspected light mobile and dark desktop screenshots. Checked six viewport sizes: 390x844, 430x932, 768x1024, 1024x768, 1440x900, 1920x1080. Now, Compare, Room, Study, Library and Cleanser had no horizontal document overflow at those sizes.
- Final browser console check reported no errors or warnings.

## Analysis preservation

Compared the original pre-redesign pipeline with the revised pipeline using a
generated 220/660 Hz signal. Frame features, advanced MFCC/chroma/HPCP/CQT-style
summaries, modulation, evidence, segmentation and symbolic output were identical.
The original source was kept outside the repository for this comparison, not
introduced into production.

`node tests/analysis-smoke.mjs` is a repeatable dependency-free DSP smoke test. It
runs the actual analyzer, verifies deterministic repeated input, finite numeric
outputs, distinct low/high-frequency measurements and bounded State scores.
`python3 smoke_check.py` verifies static UI/module contracts only.

## Fixes and boundaries

Repaired pause offsets, stale unversioned asset caching, canvas/event recreation
during room updates, no-data room readings, error rollback, and focused seek-bar
updates. Removed disconnected legacy renderers and obsolete EEG product claims.
Added accessible navigation, session library/history, custom playback controls,
named room markers, settings, and shader-based orbs without replacing the DSP.

This is Chromium QA, not physical iPhone/iPad or Safari certification. Touch was
emulated. Microphone capture was exercised in the browser environment; acoustic
accuracy and calibrated sound-pressure levels were not validated. State/task
scores remain the existing heuristic estimates, not measured cognitive effects.
Library and history remain session-only. Long-duration/high-memory uploads and
weak-GPU sustained performance need separate device testing.
