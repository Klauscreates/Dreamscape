# Quantum Sound Lab

This workspace contains a local sound-analysis lab with a browser app and an optional heavier Python batch-analysis path.

## What is included in the repo

This repository intentionally keeps only the files needed to run and judge the project:

- the app source: `index.html`, `styles.css`, `app.js`
- the local server: `lab_server.py`
- the smoke check: `smoke_check.py`
- the batch-analysis prototype: `sound_analyzer.py`
- the Python environment/bootstrap files: `requirements.txt`, `requirements-essentia.txt`, `bootstrap_python_env.sh`

Local analysis exports, caches, screenshots, temporary artifacts, and local MP3 assets are ignored on purpose so the repo stays focused on the runnable app and reproducible environment.

## Primary entry point

Start the local server:

```bash
python3 lab_server.py
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

For the Python batch-analysis stack, create the workspace venv:

```bash
./bootstrap_python_env.sh
```

Then activate it when needed:

```bash
source .venv/bin/activate
```

What this fixes:

- creates `.venv` inside the repo
- installs the required Python packages for `sound_analyzer.py`
- keeps `Essentia` optional instead of pretending it is guaranteed

Core Python requirements live in:

- `requirements.txt`

Optional Essentia add-on:

```bash
python -m pip install -r requirements-essentia.txt
```

Without Essentia, `sound_analyzer.py` still runs, but key-estimation and HPCP-style extras are reduced.

The browser app accepts local audio uploads such as `.mp3`, `.wav`, `.m4a`, `.ogg`, and `.aac`.
If you keep local demo MP3s in this folder, you can use them through the file picker, but they are not tracked in git.

## Python heavy-analysis smoke check

Once the venv is ready, run:

```bash
python sound_analyzer.py "path/to/your-track.mp3" --out-dir analysis_output_smoke
```

If you happen to have the local demo file used during development, this also works:

```bash
python sound_analyzer.py "analog_mannequin - and all its contents.mp3" --out-dir analysis_output_smoke
```

## QRNG API

The local server now exposes a QRNG-ready API:

- `GET /api/qrng/providers`
- `GET /api/qrng/health`
- `GET /api/qrng?provider=anu&fallback=system&count=16&bits=16`

Example:

```bash
curl "http://127.0.0.1:8000/api/qrng?provider=anu&fallback=system&count=8&bits=16"
```

Supported providers:

- `anu`: public ANU QRNG endpoint
- `qci`: QCI QRNG endpoint, requires `QCI_API_TOKEN` as the QCI refresh token
- `system`: local cryptographic fallback from Python `secrets`

Configure QCI by exporting:

```bash
export QCI_API_TOKEN="your-token-here"
```

The browser UI also includes a QRNG Console for manual fetches.

## What the lab does

- decodes audio locally in the browser with Web Audio
- breaks each track into frame-level spectral and rhythmic features
- measures envelope-modulation bands aligned to delta/theta/alpha/beta/gamma ranges
- extracts repeated symbolic motifs from acoustic state changes
- derives structural evidence from recurrence, phase stability, segmentation, and transient density
- optionally correlates audio features against EEG or EMF CSV data
- exports the full report as JSON

The Python batch analyzer now uses:

- `librosa` for STFT, onset strength, tempo, MFCC, chroma CQT, CQT, and recurrence
- `Essentia` optionally for beat tracking, rhythm confidence, key estimation, and HPCP pitch-class summaries
- `mne` for native EEG loading from `.edf`, `.bdf`, `.fif`, `.set`, and `.vhdr`

## EEG / EMF CSV format

Use a CSV with a time column and numeric signal columns:

```csv
time_s,eeg_fz,eeg_cz,theta_power
0.00,12.2,8.1,0.42
0.25,11.9,8.4,0.45
0.50,12.7,8.0,0.43
```

Accepted time columns:

- `time_s`
- `time`
- `timestamp`
- `seconds`
- `time_ms`

For EEG you can also pass native files to the batch analyzer:

- `.edf`
- `.bdf`
- `.fif`
- `.set`
- `.vhdr`

## Scientific guardrails

- The lab detects acoustic structure and statistical correlation, not hidden language or consciousness transfer.
- Matching an audio modulation band to an EEG band name does not mean the audio has become a brainwave.
- Any EEG / EMF match in the UI is exploratory and should be validated with controlled experiments.

## Files

- [index.html](/Users/nikolaistoloff/Downloads/dreamscape/index.html): the analyzer UI
- [app.js](/Users/nikolaistoloff/Downloads/dreamscape/app.js): decoding, feature extraction, motif analysis, biosignal correlation
- [styles.css](/Users/nikolaistoloff/Downloads/dreamscape/styles.css): interface styling
- [lab_server.py](/Users/nikolaistoloff/Downloads/dreamscape/lab_server.py): local server plus QRNG API
- [sound_analyzer.py](/Users/nikolaistoloff/Downloads/dreamscape/sound_analyzer.py): heavier batch-analysis path for local audio files
- [requirements.txt](/Users/nikolaistoloff/Downloads/dreamscape/requirements.txt): core Python dependencies for the batch-analysis path
- [requirements-essentia.txt](/Users/nikolaistoloff/Downloads/dreamscape/requirements-essentia.txt): optional Essentia dependency layer
- [bootstrap_python_env.sh](/Users/nikolaistoloff/Downloads/dreamscape/bootstrap_python_env.sh): one-command repo-local venv bootstrap
