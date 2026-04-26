# Quantum Sound Lab

This workspace now contains a local sound-analysis lab built around the two MP3s in this folder.

## Primary entry point

Start the local server:

```bash
python3 lab_server.py
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

For the Python analysis stack, use the workspace venv:

```bash
source /Users/nikolaistoloff/Downloads/dreamscape/.venv/bin/activate
```

The app will try to auto-load these tracks:

- `analog_mannequin - and all its contents.mp3`
- `øneheart - watching the stars (sped up).mp3`

If auto-load is blocked by the browser, use the file picker and choose them manually.

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
- `Essentia` for beat tracking, rhythm confidence, key estimation, and HPCP pitch-class summaries
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
- [sound_analyzer.py](/Users/nikolaistoloff/Downloads/dreamscape/sound_analyzer.py): batch-analysis prototype for WAV-oriented workflows
