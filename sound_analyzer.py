#!/usr/bin/env python3
"""
Audio forensics pipeline for exploratory music decoding.

This tool decomposes audio into spectral, rhythmic, and envelope-modulation
features, generates motif-like symbolic summaries, and optionally correlates
audio feature timelines against EEG/EMF CSV recordings.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import textwrap
import zlib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".mplconfig"))

MISSING_IMPORTS: List[str] = []

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    matplotlib = None
    plt = None
    MISSING_IMPORTS.append("matplotlib")

try:
    import librosa
except ImportError:
    librosa = None
    MISSING_IMPORTS.append("librosa")

try:
    import mne
except ImportError:
    mne = None
    MISSING_IMPORTS.append("mne")

try:
    import numpy as np
except ImportError:
    np = None
    MISSING_IMPORTS.append("numpy")

try:
    import pandas as pd
except ImportError:
    pd = None
    MISSING_IMPORTS.append("pandas")

try:
    import essentia.standard as es
except ImportError:  # pragma: no cover - optional runtime safeguard
    es = None


FRAME_SIZE = 4096
HOP_SIZE = 1024
MODULATION_RESAMPLE_HZ = 200.0
NGRAM_SIZE = 3
MAX_TOP_MOTIFS = 12
MAX_TOP_CORRELATIONS = 20
MAX_RECURRENCE_FRAMES = 768
BRAIN_BAND_LIMITS = {
    "delta": (0.5, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 12.0),
    "beta": (12.0, 30.0),
    "gamma": (30.0, 45.0),
}


@dataclass
class AudioData:
    sample_rate: int
    signal: np.ndarray
    channels: int


def ensure_runtime_dependencies() -> None:
    if not MISSING_IMPORTS:
        return

    missing = ", ".join(sorted(MISSING_IMPORTS))
    guidance = textwrap.dedent(
        f"""
        Missing Python dependencies for sound_analyzer.py: {missing}

        From the repo root, run:

          python3 -m venv .venv
          source .venv/bin/activate
          python -m pip install --upgrade pip
          python -m pip install -r requirements.txt

        Optional:
          python -m pip install -r requirements-essentia.txt

        The browser app can still analyze songs without this Python stack.
        This setup is only for the heavier batch-analysis path.
        """
    ).strip()
    raise SystemExit(guidance)


def slugify(path: Path) -> str:
    text = path.stem.lower()
    safe = []
    for char in text:
        if char.isalnum():
            safe.append(char)
        elif char in {" ", "-", "_"}:
            safe.append("-")
    slug = "".join(safe).strip("-")
    return slug or "audio"


def ensure_audio_loaded(source_path: Path) -> AudioData:
    signal, sample_rate = librosa.load(str(source_path), sr=None, mono=False)
    if signal.ndim == 1:
        signal = signal[np.newaxis, :]
    signal = signal.T.astype(np.float32)
    return AudioData(sample_rate=int(sample_rate), signal=signal, channels=int(signal.shape[1]))


def frame_signal(signal: np.ndarray, frame_size: int, hop_size: int) -> np.ndarray:
    if len(signal) < frame_size:
        pad = np.zeros(frame_size - len(signal), dtype=np.float32)
        signal = np.concatenate([signal, pad])
    frame_count = 1 + math.ceil((len(signal) - frame_size) / hop_size)
    padded_length = frame_size + hop_size * (frame_count - 1)
    if padded_length > len(signal):
        signal = np.pad(signal, (0, padded_length - len(signal)))

    shape = (frame_count, frame_size)
    strides = (signal.strides[0] * hop_size, signal.strides[0])
    return np.lib.stride_tricks.as_strided(signal, shape=shape, strides=strides).copy()


def pool_feature_frames(matrix: np.ndarray, max_frames: int) -> Tuple[np.ndarray, int]:
    frame_count = int(matrix.shape[1])
    if frame_count <= max_frames:
        return matrix.astype(np.float32, copy=False), 1

    stride = math.ceil(frame_count / max_frames)
    pooled = []
    for start in range(0, frame_count, stride):
        pooled.append(matrix[:, start : start + stride].mean(axis=1))
    return np.stack(pooled, axis=1).astype(np.float32), stride


def spectral_features(
    mono: np.ndarray, sample_rate: int
) -> Tuple[pd.DataFrame, np.ndarray, np.ndarray, Dict[str, object]]:
    stft = librosa.stft(mono, n_fft=FRAME_SIZE, hop_length=HOP_SIZE, window="hann", center=True)
    magnitude = np.abs(stft).T
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=FRAME_SIZE)
    frame_times = librosa.frames_to_time(np.arange(magnitude.shape[0]), sr=sample_rate, hop_length=HOP_SIZE)

    centroid = librosa.feature.spectral_centroid(S=np.abs(stft), sr=sample_rate)[0]
    spread = librosa.feature.spectral_bandwidth(S=np.abs(stft), sr=sample_rate)[0]
    rolloff = librosa.feature.spectral_rolloff(S=np.abs(stft), sr=sample_rate, roll_percent=0.85)[0]
    flatness = librosa.feature.spectral_flatness(S=np.abs(stft))[0]
    rms = librosa.feature.rms(y=mono, frame_length=FRAME_SIZE, hop_length=HOP_SIZE, center=True)[0]
    zcr = librosa.feature.zero_crossing_rate(mono, frame_length=FRAME_SIZE, hop_length=HOP_SIZE, center=True)[0]
    onset_envelope = librosa.onset.onset_strength(y=mono, sr=sample_rate, hop_length=HOP_SIZE)
    tempo = float(librosa.feature.tempo(onset_envelope=onset_envelope, sr=sample_rate, hop_length=HOP_SIZE)[0])
    tempogram = librosa.feature.tempogram(onset_envelope=onset_envelope, sr=sample_rate, hop_length=HOP_SIZE)
    chroma = librosa.feature.chroma_cqt(y=mono, sr=sample_rate, hop_length=HOP_SIZE)
    mfcc = librosa.feature.mfcc(y=mono, sr=sample_rate, n_mfcc=13, hop_length=HOP_SIZE)
    cqt = np.abs(librosa.cqt(y=mono, sr=sample_rate, hop_length=HOP_SIZE))
    pooled_mfcc, recurrence_stride = pool_feature_frames(mfcc, MAX_RECURRENCE_FRAMES)
    if pooled_mfcc.shape[1] > 1:
        recurrence = librosa.segment.recurrence_matrix(pooled_mfcc, mode="affinity", sym=True).astype(np.float32)
    else:
        recurrence = np.ones((pooled_mfcc.shape[1], pooled_mfcc.shape[1]), dtype=np.float32)

    flux = np.zeros(magnitude.shape[0], dtype=np.float32)
    if magnitude.shape[0] > 1:
        flux[1:] = np.sqrt(((magnitude[1:] - magnitude[:-1]) ** 2).sum(axis=1))

    dominant_index = np.argmax(magnitude[:, 1:], axis=1) + 1
    dominant_freq = freqs[dominant_index]

    phase = np.angle(stft).T
    phase_lock = np.zeros(len(frame_times), dtype=np.float32)
    if phase.shape[0] > 1:
        for index in range(1, phase.shape[0]):
            delta = phase[index] - phase[index - 1]
            weights = magnitude[index]
            phase_lock[index] = float((np.cos(delta) * weights).sum() / max(weights.sum(), 1e-12) * 0.5 + 0.5)
    phase_gradient_var = np.var(np.diff(phase, axis=1), axis=1)
    attack_strength = onset_envelope * np.maximum(rms, 1e-6)

    features = pd.DataFrame(
        {
            "time_s": frame_times,
            "rms": rms,
            "zcr": zcr,
            "spectral_centroid_hz": centroid,
            "spectral_spread_hz": spread,
            "spectral_rolloff_hz": rolloff,
            "spectral_flatness": flatness,
            "spectral_flux": flux,
            "dominant_freq_hz": dominant_freq,
            "phase_lock": phase_lock,
            "phase_gradient_var": phase_gradient_var,
            "attack_strength": attack_strength,
        }
    )
    advanced = {
        "tempo_bpm": tempo,
        "onset_envelope": onset_envelope,
        "tempogram": tempogram,
        "chroma": chroma,
        "mfcc": mfcc,
        "cqt": cqt,
        "recurrence": recurrence,
        "recurrence_frame_count": int(recurrence.shape[0]),
        "recurrence_stride": int(recurrence_stride),
    }
    return features, magnitude, freqs, advanced


def extract_essentia_features(mono: np.ndarray, sample_rate: int) -> Dict[str, object]:
    if es is None:
        return {"available": False, "note": "Essentia is not available in this runtime."}

    mono32 = mono.astype(np.float32)
    bpm, beats, confidence, _, _ = es.RhythmExtractor2013(method="multifeature")(mono32)
    key, scale, key_strength = es.KeyExtractor()(mono32)

    window = es.Windowing(type="hann")
    spectrum = es.Spectrum()
    spectral_peaks = es.SpectralPeaks()
    hpcp = es.HPCP(size=36)
    frame_gen = es.FrameGenerator(mono32, frameSize=FRAME_SIZE, hopSize=HOP_SIZE, startFromZero=True)
    hpcp_frames: List[np.ndarray] = []
    for frame in frame_gen:
        spec = spectrum(window(frame))
        freqs, mags = spectral_peaks(spec)
        if len(freqs):
            hpcp_frames.append(np.array(hpcp(freqs, mags), dtype=np.float32))
    mean_hpcp = np.mean(hpcp_frames, axis=0) if hpcp_frames else np.zeros(36, dtype=np.float32)
    top_pitch_classes = np.argsort(mean_hpcp)[-5:][::-1].tolist()

    return {
        "available": True,
        "tempo_bpm": float(bpm),
        "beat_count": int(len(beats)),
        "rhythm_confidence": float(confidence),
        "estimated_key": key,
        "estimated_scale": scale,
        "key_strength": float(key_strength),
        "mean_hpcp": mean_hpcp.round(6).tolist(),
        "top_pitch_class_bins": top_pitch_classes,
        "sample_rate_hz": sample_rate,
    }


def envelope_modulation(signal: np.ndarray, sample_rate: int) -> Tuple[pd.DataFrame, Dict[str, float]]:
    envelope = np.abs(signal)
    step = max(1, int(sample_rate / MODULATION_RESAMPLE_HZ))
    trimmed = envelope[: len(envelope) // step * step]
    if len(trimmed) == 0:
        trimmed = envelope
        step = 1
    coarse = trimmed.reshape(-1, step).mean(axis=1)
    coarse = coarse - coarse.mean()

    if len(coarse) < 4:
        coarse = np.pad(coarse, (0, 4 - len(coarse)))

    window = np.hanning(len(coarse))
    mod_spectrum = np.abs(np.fft.rfft(coarse * window))
    mod_freqs = np.fft.rfftfreq(len(coarse), 1.0 / (sample_rate / step))
    times = np.arange(len(coarse)) / (sample_rate / step)
    modulation = pd.DataFrame({"time_s": times, "envelope": coarse})

    band_powers: Dict[str, float] = {}
    total = max(float((mod_spectrum**2).sum()), 1e-12)
    for band_name, (low, high) in BRAIN_BAND_LIMITS.items():
        mask = (mod_freqs >= low) & (mod_freqs < high)
        band_powers[band_name] = float((mod_spectrum[mask] ** 2).sum() / total)

    valid = mod_freqs > 0.5
    dominant_modulation = float(mod_freqs[valid][np.argmax(mod_spectrum[valid])]) if np.any(valid) else 0.0
    band_powers["dominant_modulation_hz"] = dominant_modulation
    band_powers["modulation_sample_rate_hz"] = sample_rate / step
    modulation.attrs["freqs"] = mod_freqs
    modulation.attrs["spectrum"] = mod_spectrum
    return modulation, band_powers


def aggregate_spectrum(magnitude: np.ndarray, freqs: np.ndarray) -> Dict[str, List[float]]:
    mean_spectrum = magnitude.mean(axis=0)
    prominence = mean_spectrum.copy()
    if len(prominence) > 2:
        prominence[1:-1] = np.maximum(0.0, mean_spectrum[1:-1] - 0.5 * (mean_spectrum[:-2] + mean_spectrum[2:]))
    peak_indices = np.argsort(prominence)[-10:][::-1]
    peaks = []
    for index in peak_indices:
        frequency = float(freqs[index])
        amplitude = float(mean_spectrum[index])
        if frequency <= 0:
            continue
        peaks.append({"freq_hz": round(frequency, 2), "strength": round(amplitude, 6)})
    return {
        "freqs_hz": freqs.tolist(),
        "mean_magnitude": mean_spectrum.tolist(),
        "top_peaks": peaks,
    }


def quantile_bucket(values: np.ndarray, count: int = 3) -> np.ndarray:
    percentiles = np.percentile(values, np.linspace(0, 100, count + 1)[1:-1])
    return np.digitize(values, percentiles, right=True)


def symbolic_tokens(features: pd.DataFrame, modulation_bands: Dict[str, float]) -> Dict[str, object]:
    bucketed = {
        "E": quantile_bucket(features["rms"].to_numpy()),
        "B": quantile_bucket(features["spectral_centroid_hz"].to_numpy()),
        "M": quantile_bucket(features["spectral_flux"].to_numpy()),
        "P": quantile_bucket(features["phase_lock"].to_numpy()),
    }
    dominant_mod_band = max(
        (name for name in BRAIN_BAND_LIMITS),
        key=lambda band_name: modulation_bands.get(band_name, 0.0),
    ).upper()[:3]

    tokens = []
    for index in range(len(features)):
        parts = [f"{prefix}{int(series[index])}" for prefix, series in bucketed.items()]
        parts.append(dominant_mod_band)
        tokens.append("-".join(parts))

    ngrams = Counter(tuple(tokens[index : index + NGRAM_SIZE]) for index in range(max(0, len(tokens) - NGRAM_SIZE + 1)))
    compressed = len(zlib.compress(" ".join(tokens).encode("utf-8")))
    raw_size = max(len(" ".join(tokens).encode("utf-8")), 1)
    compression_ratio = compressed / raw_size

    return {
        "tokens": tokens,
        "unique_token_count": len(set(tokens)),
        "compression_ratio": compression_ratio,
        "top_motifs": [
            {"sequence": list(sequence), "count": count}
            for sequence, count in ngrams.most_common(MAX_TOP_MOTIFS)
        ],
    }


def build_structural_evidence(features: pd.DataFrame, band_powers: Dict[str, float], tokens: Dict[str, object]) -> Dict[str, object]:
    rms = features["rms"].to_numpy()
    centroid = features["spectral_centroid_hz"].to_numpy()
    flux = features["spectral_flux"].to_numpy()
    flatness = features["spectral_flatness"].to_numpy()

    repetition_index = float(1.0 - min(tokens["compression_ratio"], 1.0))
    attack_density = float(np.mean(flux >= np.percentile(flux, 85)))
    timbral_drift_hz = float(abs(np.mean(centroid[: len(centroid) // 3]) - np.mean(centroid[(2 * len(centroid)) // 3 :])))
    low_rate_modulation = float(band_powers.get("delta", 0.0) + band_powers.get("theta", 0.0))
    dominant_modulation_hz = float(band_powers.get("dominant_modulation_hz", 0.0))
    tonal_stability = float(1.0 - min(np.mean(flatness) * 12.0, 1.0))

    descriptors = []
    if repetition_index > 0.2:
        descriptors.append("high structural repetition")
    if attack_density > 0.12:
        descriptors.append("dense transient clusters")
    if timbral_drift_hz > 60:
        descriptors.append("strong timbral drift")
    if 0.5 <= dominant_modulation_hz < 4.0 and low_rate_modulation > band_powers.get("beta", 0.0):
        descriptors.append("slow envelope pulsing")
    if tonal_stability > 0.7:
        descriptors.append("stable tonal field")
    if not descriptors:
        descriptors.append("continuous low-evidence texture")

    return {
        "descriptors": descriptors,
        "scores": {
            "repetition_index": round(repetition_index, 3),
            "attack_density": round(attack_density, 3),
            "timbral_drift_hz": round(timbral_drift_hz, 3),
            "low_rate_modulation": round(low_rate_modulation, 3),
            "dominant_modulation_hz": round(dominant_modulation_hz, 3),
            "tonal_stability": round(tonal_stability, 3),
            "mean_rms": round(float(np.mean(rms)), 3),
        },
        "note": "These outputs summarize measured recurrence, transient density, modulation, and timbral drift. They are not semantic decoding.",
    }


def normalize_time_column(frame: pd.DataFrame) -> pd.DataFrame:
    time_aliases = ["time_s", "time", "timestamp", "seconds"]
    for alias in time_aliases:
        if alias in frame.columns:
            result = frame.copy()
            result["time_s"] = pd.to_numeric(result[alias], errors="coerce")
            break
    else:
        if "time_ms" in frame.columns:
            result = frame.copy()
            result["time_s"] = pd.to_numeric(result["time_ms"], errors="coerce") / 1000.0
        else:
            raise ValueError("Expected a time column like time_s or time_ms in biosignal CSV.")

    result = result[np.isfinite(result["time_s"])].copy()
    if result.empty:
        raise ValueError("No finite time values found in biosignal data.")
    result = result.sort_values("time_s", kind="stable")
    result = result.drop_duplicates(subset="time_s", keep="last")
    result.reset_index(drop=True, inplace=True)
    return result


def load_biosignal_frame(path: Path, label: str) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return normalize_time_column(pd.read_csv(path))

    if label != "EEG":
        raise ValueError(f"Unsupported non-CSV biosignal format for {label}: {path.suffix}")

    suffix = path.suffix.lower()
    if suffix == ".fif":
        raw = mne.io.read_raw_fif(path, preload=True, verbose="ERROR")
    elif suffix in {".edf", ".bdf"}:
        raw = mne.io.read_raw_edf(path, preload=True, verbose="ERROR")
    elif suffix == ".set":
        raw = mne.io.read_raw_eeglab(path, preload=True, verbose="ERROR")
    elif suffix == ".vhdr":
        raw = mne.io.read_raw_brainvision(path, preload=True, verbose="ERROR")
    else:
        raise ValueError(f"Unsupported EEG file format: {path.suffix}")

    data, times = raw.get_data(return_times=True)
    frame = pd.DataFrame(data.T, columns=raw.ch_names)
    frame.insert(0, "time_s", times)
    return frame


def interpolate_series(target_times: np.ndarray, source_times: np.ndarray, source_values: np.ndarray) -> np.ndarray:
    valid = np.isfinite(source_times) & np.isfinite(source_values)
    if valid.sum() < 2:
        return np.full_like(target_times, np.nan, dtype=np.float64)
    return np.interp(target_times, source_times[valid], source_values[valid], left=np.nan, right=np.nan)


def correlate_biosignal(
    audio_features: pd.DataFrame,
    biosignal_path: Path,
    label: str,
) -> Dict[str, object]:
    frame = load_biosignal_frame(biosignal_path, label)
    numeric_columns = [column for column in frame.columns if column != "time_s" and pd.api.types.is_numeric_dtype(frame[column])]
    if not numeric_columns:
        return {"label": label, "path": str(biosignal_path), "top_correlations": [], "note": "No numeric biosignal columns found."}

    reference_times = audio_features["time_s"].to_numpy()
    results = []
    lags = np.arange(-2.0, 2.01, 0.25)
    audio_columns = [column for column in audio_features.columns if column != "time_s"]

    for signal_column in numeric_columns:
        source_times = frame["time_s"].to_numpy(dtype=float)
        source_values = frame[signal_column].to_numpy(dtype=float)
        for audio_column in audio_columns:
            audio_values = audio_features[audio_column].to_numpy(dtype=float)
            best = None
            for lag in lags:
                shifted = interpolate_series(reference_times, source_times + lag, source_values)
                valid = np.isfinite(shifted) & np.isfinite(audio_values)
                if valid.sum() < 8:
                    continue
                corr = np.corrcoef(audio_values[valid], shifted[valid])[0, 1]
                if np.isnan(corr):
                    continue
                score = abs(float(corr))
                if best is None or score > best["score"]:
                    best = {
                        "audio_feature": audio_column,
                        "biosignal_feature": signal_column,
                        "pearson_r": float(corr),
                        "lag_s": float(lag),
                        "score": score,
                    }
            if best:
                results.append(best)

    results.sort(key=lambda item: item["score"], reverse=True)
    for item in results:
        item.pop("score", None)

    return {
        "label": label,
        "path": str(biosignal_path),
        "top_correlations": results[:MAX_TOP_CORRELATIONS],
        "note": "Correlations are exploratory only. They do not establish entrainment, causality, or message transfer.",
    }


def save_plot(
    output_path: Path,
    mono: np.ndarray,
    sample_rate: int,
    features: pd.DataFrame,
    spectrum_summary: Dict[str, List[float]],
    modulation: pd.DataFrame,
    advanced: Dict[str, object],
) -> None:
    seconds = np.arange(len(mono)) / sample_rate
    mod_freqs = modulation.attrs["freqs"]
    mod_spectrum = modulation.attrs["spectrum"]
    onset_envelope = np.array(advanced["onset_envelope"])
    onset_times = features["time_s"].to_numpy()[: len(onset_envelope)]

    fig, axes = plt.subplots(5, 1, figsize=(14, 17))
    axes[0].plot(seconds, mono, linewidth=0.6, color="#1f2937")
    axes[0].set_title("Waveform")
    axes[0].set_xlabel("Time (s)")
    axes[0].set_ylabel("Amplitude")

    axes[1].plot(features["time_s"], features["rms"], label="RMS", color="#0f766e")
    axes[1].plot(features["time_s"], features["spectral_flux"] / max(features["spectral_flux"].max(), 1e-9), label="Flux (norm)", color="#b45309")
    axes[1].plot(onset_times, onset_envelope / max(onset_envelope.max(), 1e-9), label="Onset (norm)", color="#0891b2")
    axes[1].set_title("Feature Trajectories")
    axes[1].set_xlabel("Time (s)")
    axes[1].legend(loc="upper right")

    spectrum_freqs = np.array(spectrum_summary["freqs_hz"])
    spectrum_values = np.array(spectrum_summary["mean_magnitude"])
    axes[2].plot(spectrum_freqs, spectrum_values, color="#4c1d95")
    axes[2].set_xlim(0, min(8000, spectrum_freqs.max() if len(spectrum_freqs) else 8000))
    axes[2].set_title("Average Spectrum")
    axes[2].set_xlabel("Frequency (Hz)")
    axes[2].set_ylabel("Magnitude")

    axes[3].imshow(
        advanced["chroma"],
        aspect="auto",
        origin="lower",
        interpolation="nearest",
        extent=[features["time_s"].iloc[0], features["time_s"].iloc[-1], 0, 12],
        cmap="magma",
    )
    axes[3].set_title("Chroma CQT")
    axes[3].set_xlabel("Time (s)")
    axes[3].set_ylabel("Pitch Class")

    axes[4].plot(mod_freqs, mod_spectrum, color="#be123c")
    axes[4].set_xlim(0, 45)
    axes[4].set_title("Envelope Modulation Spectrum")
    axes[4].set_xlabel("Modulation Frequency (Hz)")
    axes[4].set_ylabel("Magnitude")

    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def analyze_track(
    source_path: Path,
    output_root: Path,
    eeg_csv: Path | None,
    emf_csv: Path | None,
) -> Dict[str, object]:
    audio = ensure_audio_loaded(source_path)
    mono = audio.signal.mean(axis=1)
    mono = mono / max(np.max(np.abs(mono)), 1e-9)

    features, magnitude, freqs, advanced = spectral_features(mono, audio.sample_rate)
    modulation, band_powers = envelope_modulation(mono, audio.sample_rate)
    spectrum_summary = aggregate_spectrum(magnitude, freqs)
    tokens = symbolic_tokens(features, band_powers)
    evidence = build_structural_evidence(features, band_powers, tokens)
    essentia_features = extract_essentia_features(mono, audio.sample_rate)

    track_slug = slugify(source_path)
    track_dir = output_root / track_slug
    track_dir.mkdir(parents=True, exist_ok=True)

    biosignals = []
    if eeg_csv:
        biosignals.append(correlate_biosignal(features, eeg_csv, "EEG"))
    if emf_csv:
        biosignals.append(correlate_biosignal(features, emf_csv, "EMF"))

    summary = {
        "source_file": str(source_path),
        "decoded_channels": audio.channels,
        "sample_rate_hz": audio.sample_rate,
        "duration_s": round(len(mono) / audio.sample_rate, 4),
        "global_feature_means": {
            column: float(features[column].mean())
            for column in features.columns
            if column != "time_s"
        },
        "librosa_features": {
            "tempo_bpm": round(float(advanced["tempo_bpm"]), 3),
            "mean_mfcc": np.mean(advanced["mfcc"], axis=1).round(6).tolist(),
            "mean_chroma": np.mean(advanced["chroma"], axis=1).round(6).tolist(),
            "recurrence_mean_affinity": round(float(np.mean(advanced["recurrence"])), 6),
            "recurrence_frame_count": int(advanced["recurrence_frame_count"]),
            "recurrence_stride": int(advanced["recurrence_stride"]),
        },
        "essentia_features": essentia_features,
        "modulation_bands": band_powers,
        "spectrum_summary": {"top_peaks": spectrum_summary["top_peaks"]},
        "symbolic_structure": {
            "unique_token_count": tokens["unique_token_count"],
            "compression_ratio": tokens["compression_ratio"],
            "top_motifs": tokens["top_motifs"],
        },
        "structural_evidence": evidence,
        "biosignal_correlations": biosignals,
        "scientific_guardrails": [
            "This tool detects acoustic structure and statistical correlations, not hidden language or consciousness transfer.",
            "The modulation bands are audio-envelope frequencies that overlap EEG band names; they are not direct brain measurements.",
            "Any EEG/EMF correlation in this report is exploratory and should be validated with controlled experiments.",
        ],
    }

    (track_dir / "features.csv").write_text(features.to_csv(index=False))
    (track_dir / "modulation.csv").write_text(modulation.to_csv(index=False))
    (track_dir / "tokens.txt").write_text("\n".join(tokens["tokens"]))
    np.save(track_dir / "chroma.npy", advanced["chroma"])
    np.save(track_dir / "mfcc.npy", advanced["mfcc"])
    np.save(track_dir / "recurrence.npy", advanced["recurrence"])
    (track_dir / "report.json").write_text(json.dumps(summary, indent=2))

    plot_path = track_dir / "overview.png"
    save_plot(plot_path, mono, audio.sample_rate, features, spectrum_summary, modulation, advanced)

    summary_md = textwrap.dedent(
        f"""\
        # {source_path.name}

        Duration: {summary['duration_s']} s
        Sample rate: {audio.sample_rate} Hz
        Channels: {audio.channels}

        Structural evidence: {", ".join(evidence['descriptors'])}
        Repetition / Attack Density / Timbral Drift: {evidence['scores']['repetition_index']} / {evidence['scores']['attack_density']} / {evidence['scores']['timbral_drift_hz']}
        Librosa tempo estimate: {advanced['tempo_bpm']:.3f} BPM
        Essentia key estimate: {essentia_features.get('estimated_key', 'n/a')} {essentia_features.get('estimated_scale', '')} ({essentia_features.get('key_strength', 'n/a')})

        Dominant envelope modulation: {band_powers['dominant_modulation_hz']:.3f} Hz
        Envelope band weights:
        {json.dumps({k: round(v, 5) for k, v in band_powers.items() if k in BRAIN_BAND_LIMITS}, indent=2)}

        Top spectral peaks:
        {json.dumps(spectrum_summary['top_peaks'], indent=2)}

        Top symbolic motifs:
        {json.dumps(tokens['top_motifs'][:5], indent=2)}
        """
    )
    (track_dir / "summary.md").write_text(summary_md)
    return summary


def compare_tracks(reports: List[Dict[str, object]], output_root: Path) -> None:
    if len(reports) < 2:
        return

    feature_names = sorted(reports[0]["global_feature_means"].keys())
    matrix = np.array([[report["global_feature_means"][name] for name in feature_names] for report in reports], dtype=float)

    comparisons = []
    for index, left in enumerate(reports):
        for right_index in range(index + 1, len(reports)):
            right = reports[right_index]
            left_vector = np.sign(matrix[index]) * np.log1p(np.abs(matrix[index]))
            right_vector = np.sign(matrix[right_index]) * np.log1p(np.abs(matrix[right_index]))
            distance = float(np.linalg.norm(left_vector - right_vector))
            comparisons.append(
                {
                    "left": left["source_file"],
                    "right": right["source_file"],
                    "feature_distance": round(distance, 4),
                    "shared_modulation_bias": [
                        band
                        for band in BRAIN_BAND_LIMITS
                        if left["modulation_bands"][band] > 0.15 and right["modulation_bands"][band] > 0.15
                    ],
                }
            )

    payload = {"comparisons": comparisons, "feature_names": feature_names}
    (output_root / "combined_report.json").write_text(json.dumps(payload, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Exploratory audio analyzer and biosignal correlator.")
    parser.add_argument("audio_files", nargs="+", help="Audio files to analyze (.wav, .mp3, .flac, .ogg, .m4a).")
    parser.add_argument("--out-dir", default="analysis_output", help="Directory for generated reports and plots.")
    parser.add_argument("--eeg-csv", help="Optional EEG CSV with a time column (time_s or time_ms).")
    parser.add_argument("--eeg-file", help="Optional EEG file (.edf, .bdf, .fif, .set, .vhdr).")
    parser.add_argument("--emf-csv", help="Optional EMF CSV with a time column (time_s or time_ms).")
    return parser.parse_args()


def main() -> None:
    ensure_runtime_dependencies()
    args = parse_args()
    output_root = Path(args.out_dir).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    reports = []
    for audio_file in args.audio_files:
        report = analyze_track(
            source_path=Path(audio_file).resolve(),
            output_root=output_root,
            eeg_csv=Path(args.eeg_file).resolve() if args.eeg_file else (Path(args.eeg_csv).resolve() if args.eeg_csv else None),
            emf_csv=Path(args.emf_csv).resolve() if args.emf_csv else None,
        )
        reports.append(report)

    compare_tracks(reports, output_root)

    index = {
        "analyzed_files": [report["source_file"] for report in reports],
        "output_root": str(output_root),
    }
    (output_root / "index.json").write_text(json.dumps(index, indent=2))


if __name__ == "__main__":
    main()
