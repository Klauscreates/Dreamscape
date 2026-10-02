# Working on Dreamscape

## Local workflow

1. Create a focused branch from `main`.
2. Serve the repository with `python3 -m http.server 8000 --bind 127.0.0.1`.
3. Make the smallest coherent change; preserve audio calculations unless explicitly fixing or improving them.
4. Run `sh scripts/check.sh`.
5. Test the affected flow in a browser and document exactly what was tested in your pull request.

The browser app uses native JavaScript modules, without a package install or build
step. Node.js and Python 3 are needed for the development checks. Heavy Python
analysis dependencies are optional and separate from the web product.

## Product standards

- Base charts, geometry and metrics on uploaded audio or microphone samples.
- Label State, task-fit and similarity scores as estimates, not measured brain response or interpersonal compatibility.
- Preserve mouse, keyboard and touch interaction, reduced motion, and readable light/dark themes.
- Check empty, loading, error and unavailable states; never substitute invented readings.
- Keep high-frequency visual updates out of DOM rebuilds; release audio and GPU resources.
- Library/history are session-only. Do not imply persistence without implementing and testing it.

## Before a release

Use two distinct audio files. Test upload, playback/seek, orb rotation/zoom,
Compare/Collision selection, Study, Cleanser and JSON export. Test Room Scan with
permission allowed and denied, named locations, and stopping capture. Inspect the
console and mobile/desktop layouts. Record actual device/browser coverage;
viewport emulation is not physical-device testing.

## Repository hygiene

Do not commit recordings, generated reports, local UI snapshots, environment files,
tokens, virtual environments or browser automation downloads. Keep documentation
under `docs/` and regression tests under `tests/`. Use your own permitted audio.
Report bugs with reproduction steps, not private recordings or raw personal data.
