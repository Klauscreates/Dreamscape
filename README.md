# Dreamscape

Dreamscape is a browser-first sound analysis app for understanding what audio is doing to focus, energy, and environment.

The main product is the deployed web app. Upload a song, playlist tracks, or scan a room with the microphone, and Dreamscape turns measured audio structure into a visual and human-readable dashboard.

## What the app does

Dreamscape analyzes sound in the browser and surfaces eight product features:

- `Orb`: an interactive liquid-glass sound orb built from the uploaded track's real spectrum, novelty, modulation, recurrence, and harmonic profile
- `State`: a focus / hype / chill style read based on measured attack density, modulation behavior, loudness, and spectral structure
- `Energy`: a pressure and intensity read based on RMS, peaks, dynamic lift, and transient density
- `Compare`: a side-by-side comparison of two tracks across brightness, attack pressure, recurrence, and harmonic alignment
- `Collision`: a compatibility / clash read that estimates how well two sonic signatures merge
- `Study Sound Coach`: task-fit guidance for reading, writing, coding, memorization, and recovery
- `Room Scan`: live microphone scanning for calm vs chaos, interruption pressure, hidden noise patterns, and focus fit
- `Playlist Cleanser`: identifies tracks in a loaded set that are most likely to help or break concentration

## Browser-side analysis stack

The deployed app performs real analysis in the browser. It is not just a static UI.

Browser-side analyzers include:

- waveform decoding with Web Audio
- frame-level spectral features
- modulation-band analysis
- structural segmentation
- transient / attack analysis
- browser-native MFCC summaries
- chroma analysis
- HPCP-style harmonic profiles
- recurrence affinity summaries
- browser-side key / scale estimation
- room spectrum heatmap rendering
- optional EEG / EMF CSV correlation

These analyzers are implemented in [app.js](/Users/nikolaistoloff/Downloads/dreamscape/app.js).

## Primary product surface

The app is designed to run as a public web app.

### Deploy on Vercel

```bash
npx vercel
```

Production deploy:

```bash
npx vercel --prod
```

The repo includes:

- [vercel.json](/Users/nikolaistoloff/Downloads/dreamscape/vercel.json)
- [.vercelignore](/Users/nikolaistoloff/Downloads/dreamscape/.vercelignore)

Why Vercel fits this app:

- static deployment is enough for the main product
- browser-side analyzers run on the user's machine
- HTTPS allows `Room Scan` microphone access in normal browsers

## Local preview

For local preview, start the lightweight server:

```bash
python3 lab_server.py
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

`lab_server.py` is only a tiny local preview server. It is not a second product surface.

## Optional heavier Python path

The only major capability outside the deployed browser app is the heavier batch-analysis path in [sound_analyzer.py](/Users/nikolaistoloff/Downloads/dreamscape/sound_analyzer.py).

Use it when you want:

- local offline analysis runs
- heavier Python-side feature extraction
- native EEG file loading
- artifact export from the Python pipeline

### Set up the repo-local Python environment

```bash
./bootstrap_python_env.sh
source .venv/bin/activate
```

Core Python dependencies:

- [requirements.txt](/Users/nikolaistoloff/Downloads/dreamscape/requirements.txt)

Optional Essentia layer:

```bash
python -m pip install -r requirements-essentia.txt
```

Without Essentia, the Python analyzer still runs, but some rhythm-confidence, key, and HPCP extras are reduced.

### Example Python run

```bash
python sound_analyzer.py "path/to/your-track.mp3" --out-dir analysis_output_smoke
```

## Python analysis stack

The optional Python analyzer uses:

- `librosa` for STFT, onset strength, tempo, MFCC, chroma CQT, CQT, and recurrence
- optional `Essentia` for beat tracking, rhythm confidence, key estimation, and HPCP pitch-class summaries
- `mne` for native EEG loading from `.edf`, `.bdf`, `.fif`, `.set`, and `.vhdr`

## EEG / EMF support

The browser app can optionally correlate audio features against EEG or EMF CSV data.

Example CSV:

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

The Python path can also read native EEG files:

- `.edf`
- `.bdf`
- `.fif`
- `.set`
- `.vhdr`

## Scientific guardrails

- Dreamscape detects acoustic structure, measured variation, and statistical correlation. It does not decode hidden language or consciousness.
- Matching an audio modulation band to a brainwave band label does not mean the audio has become a brainwave.
- Compatibility, state, and study-fit outputs are evidence-backed interpretations built on measured audio features, not clinical truth claims.
- Any EEG / EMF match should be treated as exploratory until validated with controlled experiments.

## Repo contents

This repository intentionally keeps only the files needed to run and judge the project:

- [index.html](/Users/nikolaistoloff/Downloads/dreamscape/index.html): app shell
- [styles.css](/Users/nikolaistoloff/Downloads/dreamscape/styles.css): liquid-glass UI and responsive layout
- [app.js](/Users/nikolaistoloff/Downloads/dreamscape/app.js): browser-side analysis, visuals, room scan, compare, and export logic
- [lab_server.py](/Users/nikolaistoloff/Downloads/dreamscape/lab_server.py): lightweight local preview server
- [sound_analyzer.py](/Users/nikolaistoloff/Downloads/dreamscape/sound_analyzer.py): optional heavier Python batch-analysis path
- [smoke_check.py](/Users/nikolaistoloff/Downloads/dreamscape/smoke_check.py): lightweight smoke check
- [bootstrap_python_env.sh](/Users/nikolaistoloff/Downloads/dreamscape/bootstrap_python_env.sh): one-command repo-local venv bootstrap
- [requirements.txt](/Users/nikolaistoloff/Downloads/dreamscape/requirements.txt): core Python dependency list
- [requirements-essentia.txt](/Users/nikolaistoloff/Downloads/dreamscape/requirements-essentia.txt): optional Essentia dependency layer

Local exports, caches, screenshots, temporary artifacts, and local MP3 assets are intentionally ignored so the repo stays focused on the runnable product.
