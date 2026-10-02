import { drawFingerprint, disposeDetachedOrbs } from "./orb.js";
import {
  mountExperience,
  renderExperience,
  updateRoomUI,
  drawPlayer,
  ui,
  timeLabel,
} from "./experience.js";

const DEFAULT_CONFIG = {
  frameSize: 2048,
  hopSize: 512,
  modulationResampleHz: 200,
  segmentationQuantile: 0.9,
  motifSpan: 4,
};

const FEATURE_FIELDS = [
  "rms",
  "zcr",
  "spectral_centroid_hz",
  "spectral_spread_hz",
  "spectral_rolloff_hz",
  "spectral_flatness",
  "spectral_flux",
  "dominant_freq_hz",
  "phase_lock",
  "phase_gradient_var",
  "attack_strength",
];

const BRAIN_BANDS = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 12],
  beta: [12, 30],
  gamma: [30, 45],
};

const state = {
  reports: [],
  derivedReports: [],
  config: { ...DEFAULT_CONFIG },
  selectedTrackId: null,
  comparison: {
    leftId: null,
    rightId: null,
  },
};

const audioInput = document.querySelector("#audio-files");
const analyzeButton = document.querySelector("#analyze-button");
const exportButton = document.querySelector("#export-button");
const statusLine = document.querySelector("#status-line");
const headerStatus = document.querySelector("#header-status");
const trackResults = document.querySelector("#track-results");
const fileList = document.querySelector("#file-list");
const dropZone = document.querySelector("#drop-zone");
const orbLabel = document.querySelector("#orb-label");
const orbPlayBtn = document.querySelector("#orb-play-btn");

const liveState = {
  analyser: null,
  liveFreqData: null,
  isPlaying: false,
  sourceNode: null,
  playingReportId: null,
  audioBuffers: new Map(), // report.id → AudioBuffer
  buildSpectrum: null,
  buildHzPerBin: 1,
  buildProgress: 0,
  isBuilding: false,
  buildMeta: null,
  offset: 0,
  startedAt: 0,
  volume: 0.8,
  loop: false,
  gain: null,
  timeData: null,
};

const roomState = {
  isScanning: false,
  stream: null,
  sourceNode: null,
  analyser: null,
  freqData: null,
  timeData: null,
  previousSpectrum: null,
  heatmapFrames: [],
  rollingFrames: [],
  spots: [],
  summary: null,
  error: null,
  sampleRate: 0,
  fftSize: 1024,
  lastUiRefreshAt: 0,
  events: [],
  frameCounter: 0,
  pending: false,
  requestId: 0,
  lastSampleAt: 0,
};

// ─── Math helpers ────────────────────────────────────────────────────────────

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const left = Math.floor(index);
  const right = Math.ceil(index);
  if (left === right) return sorted[left];
  const ratio = index - left;
  return sorted[left] * (1 - ratio) + sorted[right] * ratio;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 0) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function normalizeScore(value, minimum, maximum) {
  if (maximum === minimum) return 0;
  return clamp((value - minimum) / (maximum - minimum), 0, 1);
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1)
    total += left[index] * right[index];
  return total;
}

function matVec(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

function norm(vector) {
  return Math.sqrt(dot(vector, vector));
}

function withIndefiniteArticle(label) {
  const value = String(label || "");
  return /^[aeiou]/i.test(value) ? `an ${value}` : `a ${value}`;
}

// ─── FFT ─────────────────────────────────────────────────────────────────────

function nextPow2(value) {
  let power = 1;
  while (power < value) power <<= 1;
  return power;
}

function fftComplex(samples) {
  const size = nextPow2(samples.length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(samples);

  let j = 0;
  for (let i = 0; i < size; i += 1) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let m = size >> 1;
    while (j >= m && m >= 2) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenCos = Math.cos(angle);
    const wLenSin = Math.sin(angle);
    for (let start = 0; start < size; start += len) {
      let wRe = 1;
      let wIm = 0;
      for (let offset = 0; offset < len / 2; offset += 1) {
        const even = start + offset;
        const odd = even + len / 2;
        const oddRe = re[odd] * wRe - im[odd] * wIm;
        const oddIm = re[odd] * wIm + im[odd] * wRe;
        re[odd] = re[even] - oddRe;
        im[odd] = im[even] - oddIm;
        re[even] += oddRe;
        im[even] += oddIm;
        const nextRe = wRe * wLenCos - wIm * wLenSin;
        wIm = wRe * wLenSin + wIm * wLenCos;
        wRe = nextRe;
      }
    }
  }

  return { re, im, size };
}

function fftReal(samples) {
  const { re, im, size } = fftComplex(samples);
  const half = size / 2 + 1;
  const magnitudes = new Float64Array(half);
  for (let index = 0; index < half; index += 1) {
    magnitudes[index] = Math.hypot(re[index], im[index]);
  }
  return magnitudes;
}

// ─── Signal processing ───────────────────────────────────────────────────────

function downmix(buffer) {
  const channelCount = buffer.numberOfChannels;
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      mono[index] += channelData[index] / channelCount;
    }
  }
  let maxAbs = 0;
  for (let index = 0; index < mono.length; index += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(mono[index]));
  }
  if (maxAbs > 0) {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] /= maxAbs;
    }
  }
  return mono;
}

function extractFrames(signal, frameSize, hopSize) {
  const frames = [];
  for (let start = 0; start < signal.length; start += hopSize) {
    const frame = new Float32Array(frameSize);
    const remaining = Math.min(frameSize, signal.length - start);
    frame.set(signal.subarray(start, start + remaining));
    frames.push(frame);
    if (start + frameSize >= signal.length) break;
  }
  return frames;
}

function hzToMel(value) {
  return 2595 * Math.log10(1 + value / 700);
}

function melToHz(value) {
  return 700 * (10 ** (value / 2595) - 1);
}

function createMelFilterBank(
  sampleRate,
  fftSize,
  bandCount = 24,
  lowHz = 40,
  highHz = 8000,
) {
  const nyquist = sampleRate / 2;
  const maxHz = Math.min(highHz, nyquist);
  const lowMel = hzToMel(lowHz);
  const highMel = hzToMel(maxHz);
  const melPoints = Array.from(
    { length: bandCount + 2 },
    (_, index) => lowMel + ((highMel - lowMel) * index) / (bandCount + 1),
  );
  const hzPoints = melPoints.map(melToHz);
  const bins = hzPoints.map((hz) =>
    Math.floor(((fftSize + 1) * hz) / sampleRate),
  );
  const filters = Array.from(
    { length: bandCount },
    () => new Float64Array(fftSize / 2 + 1),
  );

  for (let band = 0; band < bandCount; band += 1) {
    const left = bins[band];
    const center = bins[band + 1];
    const right = bins[band + 2];
    for (let bin = left; bin < center; bin += 1) {
      if (bin >= 0 && bin < filters[band].length && center !== left) {
        filters[band][bin] = (bin - left) / (center - left);
      }
    }
    for (let bin = center; bin < right; bin += 1) {
      if (bin >= 0 && bin < filters[band].length && right !== center) {
        filters[band][bin] = (right - bin) / (right - center);
      }
    }
  }

  return filters;
}

function dctTypeII(values, coefficientCount = 13) {
  const result = new Array(coefficientCount).fill(0);
  const scale = Math.PI / Math.max(values.length, 1);
  for (let coefficient = 0; coefficient < coefficientCount; coefficient += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[index] * Math.cos((index + 0.5) * coefficient * scale);
    }
    result[coefficient] = total;
  }
  return result;
}

function inferKeyFromChroma(chroma) {
  const labels = [
    "C",
    "C#",
    "D",
    "Eb",
    "E",
    "F",
    "F#",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
  ];
  const majorTemplate = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
  ];
  const minorTemplate = [
    6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
  ];
  const total = chroma.reduce((sum, value) => sum + value, 0) || 1;
  const normalized = chroma.map((value) => value / total);
  let best = { key: "Unknown", scale: "unknown", strength: 0 };

  for (let shift = 0; shift < 12; shift += 1) {
    const majorScore = normalized.reduce(
      (sum, value, index) =>
        sum + value * majorTemplate[(index - shift + 12) % 12],
      0,
    );
    if (majorScore > best.strength) {
      best = { key: labels[shift], scale: "major", strength: majorScore };
    }
    const minorScore = normalized.reduce(
      (sum, value, index) =>
        sum + value * minorTemplate[(index - shift + 12) % 12],
      0,
    );
    if (minorScore > best.strength) {
      best = { key: labels[shift], scale: "minor", strength: minorScore };
    }
  }

  return best;
}

function pooledFrameStep(frameCount, targetCount = 192) {
  return Math.max(1, Math.ceil(frameCount / Math.max(targetCount, 1)));
}

function computeRecurrenceSummary(mfccFrames, targetCount = 192) {
  if (!mfccFrames.length) {
    return {
      meanAffinity: 0,
      frameCount: 0,
      stride: 1,
      strongestLink: 0,
    };
  }

  const stride = pooledFrameStep(mfccFrames.length, targetCount);
  const pooled = [];
  for (let index = 0; index < mfccFrames.length; index += stride) {
    const slice = mfccFrames.slice(index, index + stride);
    const meanVector = new Array(mfccFrames[0].length).fill(0);
    for (const row of slice) {
      for (let dim = 0; dim < meanVector.length; dim += 1)
        meanVector[dim] += row[dim];
    }
    for (let dim = 0; dim < meanVector.length; dim += 1)
      meanVector[dim] /= slice.length;
    pooled.push(meanVector);
  }

  if (pooled.length <= 1) {
    return {
      meanAffinity: 1,
      frameCount: pooled.length,
      stride,
      strongestLink: 1,
    };
  }

  const distances = [];
  for (let i = 0; i < pooled.length; i += 1) {
    for (let j = i + 1; j < pooled.length; j += 1) {
      let sum = 0;
      for (let dim = 0; dim < pooled[i].length; dim += 1) {
        const diff = pooled[i][dim] - pooled[j][dim];
        sum += diff * diff;
      }
      distances.push(Math.sqrt(sum));
    }
  }

  const sigma = percentile(distances, 0.5) || 1;
  let affinitySum = 0;
  let affinityCount = 0;
  let strongestLink = 0;
  for (let i = 0; i < pooled.length; i += 1) {
    for (let j = i + 1; j < pooled.length; j += 1) {
      let sum = 0;
      for (let dim = 0; dim < pooled[i].length; dim += 1) {
        const diff = pooled[i][dim] - pooled[j][dim];
        sum += diff * diff;
      }
      const affinity = Math.exp(-sum / (2 * sigma * sigma));
      affinitySum += affinity;
      affinityCount += 1;
      strongestLink = Math.max(strongestLink, affinity);
    }
  }

  return {
    meanAffinity: affinitySum / Math.max(affinityCount, 1),
    frameCount: pooled.length,
    stride,
    strongestLink,
  };
}

async function computeAdvancedBrowserAnalysis(signal, sampleRate, config) {
  const frameSize = config.frameSize;
  const hopSize = config.hopSize;
  const window = new Float32Array(frameSize);
  for (let index = 0; index < frameSize; index += 1) {
    window[index] =
      0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
  }
  const frames = extractFrames(signal, frameSize, hopSize);
  const hzPerBin = sampleRate / frameSize;
  const melFilters = createMelFilterBank(sampleRate, frameSize, 24);
  const meanChroma = new Float64Array(12);
  const meanHpcp = new Float64Array(36);
  const cqtLike = new Float64Array(48);
  const mfccFrames = [];
  const chromaFrames = [];

  let advancedFrame = 0;
  for (const source of frames) {
    if (++advancedFrame % 96 === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
    const windowed = new Float32Array(frameSize);
    for (let index = 0; index < frameSize; index += 1) {
      windowed[index] = source[index] * window[index];
    }
    const magnitude = fftReal(windowed);
    const power = new Float64Array(magnitude.length);
    for (let bin = 0; bin < magnitude.length; bin += 1) {
      power[bin] = magnitude[bin] * magnitude[bin];
    }

    const melBands = melFilters.map((filter) => {
      let total = 0;
      for (let bin = 0; bin < filter.length; bin += 1)
        total += power[bin] * filter[bin];
      return Math.log10(1 + total);
    });
    const mfcc = dctTypeII(melBands, 13);
    mfccFrames.push(mfcc);

    const chromaFrame = new Float64Array(12);
    const hpcpFrame = new Float64Array(36);
    const cqtFrame = new Float64Array(48);
    for (let bin = 1; bin < power.length; bin += 1) {
      const freq = bin * hzPerBin;
      if (freq < 27.5 || freq > Math.min(sampleRate / 2, 5000)) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      if (!Number.isFinite(midi)) continue;
      const chromaIndex = ((Math.round(midi) % 12) + 12) % 12;
      const hpcpIndex = ((Math.round(midi * 3) % 36) + 36) % 36;
      const cqtIndex = clamp(Math.round((midi - 24) * (48 / 72)), 0, 47);
      chromaFrame[chromaIndex] += power[bin];
      hpcpFrame[hpcpIndex] += power[bin];
      cqtFrame[cqtIndex] += power[bin];
    }

    chromaFrames.push(Array.from(chromaFrame));
    for (let index = 0; index < 12; index += 1)
      meanChroma[index] += chromaFrame[index];
    for (let index = 0; index < 36; index += 1)
      meanHpcp[index] += hpcpFrame[index];
    for (let index = 0; index < 48; index += 1)
      cqtLike[index] += cqtFrame[index];
  }

  const normalize = (arrayLike) => {
    const total =
      Array.from(arrayLike).reduce((sum, value) => sum + value, 0) || 1;
    return Array.from(arrayLike, (value) => value / total);
  };

  const chroma = normalize(meanChroma);
  const hpcp = normalize(meanHpcp);
  const cqt = normalize(cqtLike);
  const keyEstimate = inferKeyFromChroma(chroma);
  const recurrence = computeRecurrenceSummary(mfccFrames);
  const strongestCqtBins = cqt
    .map((value, index) => ({ bin: index, strength: value }))
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 6);

  return {
    mean_mfcc: mfccFrames.length
      ? mfccFrames[0].map((_, dim) => mean(mfccFrames.map((row) => row[dim])))
      : new Array(13).fill(0),
    mean_chroma: chroma,
    mean_hpcp: hpcp,
    cqt_profile: cqt,
    cqt_top_bins: strongestCqtBins,
    estimated_key: keyEstimate.key,
    estimated_scale: keyEstimate.scale,
    key_strength: keyEstimate.strength,
    recurrence_mean_affinity: recurrence.meanAffinity,
    recurrence_frame_count: recurrence.frameCount,
    recurrence_stride: recurrence.stride,
    recurrence_strongest_link: recurrence.strongestLink,
  };
}

async function analyzeFrames(signal, sampleRate, config, onProgress) {
  const frameSize = config.frameSize;
  const hopSize = config.hopSize;
  const window = new Float32Array(frameSize);
  for (let index = 0; index < frameSize; index += 1) {
    window[index] =
      0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
  }
  const frames = extractFrames(signal, frameSize, hopSize);
  const hzPerBin = sampleRate / frameSize;
  const features = [];
  let previousSpectrum = null;
  let previousPhase = null;
  const averageSpectrum = new Float64Array(frameSize / 2 + 1);

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const source = frames[frameIndex];
    const windowed = new Float32Array(frameSize);
    let rmsSum = 0;
    let zcr = 0;

    for (let index = 0; index < frameSize; index += 1) {
      const value = source[index] * window[index];
      windowed[index] = value;
      rmsSum += value * value;
      if (
        index > 0 &&
        Math.sign(source[index]) !== Math.sign(source[index - 1])
      ) {
        zcr += 1;
      }
    }

    const fft = fftComplex(windowed);
    const magnitude = new Float64Array(frameSize / 2 + 1);
    const phase = new Float64Array(frameSize / 2 + 1);
    for (let bin = 0; bin < magnitude.length; bin += 1) {
      magnitude[bin] = Math.hypot(fft.re[bin], fft.im[bin]);
      phase[bin] = Math.atan2(fft.im[bin], fft.re[bin]);
    }

    let powerSum = 0;
    let centroidNumerator = 0;
    let spreadNumerator = 0;
    let flatnessLog = 0;
    let flatnessArithmetic = 0;
    let dominantIndex = 1;

    for (let bin = 1; bin < magnitude.length; bin += 1) {
      const power = magnitude[bin] * magnitude[bin];
      const frequency = bin * hzPerBin;
      powerSum += power;
      centroidNumerator += power * frequency;
      flatnessLog += Math.log(Math.max(magnitude[bin], 1e-12));
      flatnessArithmetic += magnitude[bin];
      averageSpectrum[bin] += magnitude[bin];
      if (magnitude[bin] > magnitude[dominantIndex]) dominantIndex = bin;
    }

    const centroid = centroidNumerator / Math.max(powerSum, 1e-12);
    for (let bin = 1; bin < magnitude.length; bin += 1) {
      const power = magnitude[bin] * magnitude[bin];
      const frequency = bin * hzPerBin;
      spreadNumerator += power * (frequency - centroid) ** 2;
    }

    let cumulative = 0;
    let rolloff = 0;
    for (let bin = 1; bin < magnitude.length; bin += 1) {
      cumulative += magnitude[bin] * magnitude[bin];
      if (cumulative >= powerSum * 0.85) {
        rolloff = bin * hzPerBin;
        break;
      }
    }

    let flux = 0;
    if (previousSpectrum) {
      for (let bin = 1; bin < magnitude.length; bin += 1) {
        const diff = magnitude[bin] - previousSpectrum[bin];
        flux += diff * diff;
      }
      flux = Math.sqrt(flux);
    }
    previousSpectrum = magnitude;

    let phaseLock = 0;
    let phaseWeight = 0;
    if (previousPhase) {
      for (let bin = 1; bin < magnitude.length; bin += 1) {
        const delta = phase[bin] - previousPhase[bin];
        const weight = magnitude[bin];
        phaseLock += Math.cos(delta) * weight;
        phaseWeight += weight;
      }
      phaseLock = (phaseLock / Math.max(phaseWeight, 1e-12) + 1) * 0.5;
    }
    previousPhase = phase;

    let localPhaseVariance = 0;
    let localPhaseCount = 0;
    for (let bin = 2; bin < phase.length; bin += 1) {
      const gradient = phase[bin] - phase[bin - 1];
      localPhaseVariance += gradient * gradient;
      localPhaseCount += 1;
    }

    const flatness =
      Math.exp(flatnessLog / Math.max(magnitude.length - 1, 1)) /
      Math.max(flatnessArithmetic / Math.max(magnitude.length - 1, 1), 1e-12);
    const attackStrength =
      Math.max(0, flux) * Math.max(0, Math.sqrt(rmsSum / frameSize));

    features.push({
      time_s: (frameIndex * hopSize) / sampleRate,
      rms: Math.sqrt(rmsSum / frameSize),
      zcr: zcr / frameSize,
      spectral_centroid_hz: centroid,
      spectral_spread_hz: Math.sqrt(
        spreadNumerator / Math.max(powerSum, 1e-12),
      ),
      spectral_rolloff_hz: rolloff,
      spectral_flatness: flatness,
      spectral_flux: flux,
      dominant_freq_hz: dominantIndex * hzPerBin,
      phase_lock: phaseLock,
      phase_gradient_var: localPhaseVariance / Math.max(localPhaseCount, 1),
      attack_strength: attackStrength,
    });

    // Yield to browser every 32 frames so the orb can repaint during analysis
    if (onProgress && frameIndex % 32 === 31) {
      const n = frameIndex + 1;
      const partial = Float64Array.from(averageSpectrum, (v) => v / n);
      onProgress(partial, n / frames.length);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  for (let index = 0; index < averageSpectrum.length; index += 1) {
    averageSpectrum[index] /= Math.max(features.length, 1);
  }

  return {
    features,
    averageSpectrum,
    spectrumFreqs: Array.from(
      { length: averageSpectrum.length },
      (_, index) => index * hzPerBin,
    ),
  };
}

function modulationAnalysis(signal, sampleRate, config) {
  const step = Math.max(
    1,
    Math.floor(sampleRate / Math.max(config.modulationResampleHz, 1)),
  );
  const coarse = [];
  for (let index = 0; index < signal.length; index += step) {
    const slice = signal.subarray(index, Math.min(signal.length, index + step));
    coarse.push(mean(Array.from(slice, (value) => Math.abs(value))));
  }
  const centered = coarse.map((value) => value - mean(coarse));
  const spectrum = fftReal(Float32Array.from(centered));
  const actualRate = sampleRate / step;
  const freqStep = actualRate / Math.max((spectrum.length - 1) * 2, 1);
  const freqs = Array.from(
    { length: spectrum.length },
    (_, index) => index * freqStep,
  );
  const totalPower =
    spectrum.reduce((sum, value) => sum + value * value, 0) || 1;
  const bands = {};

  for (const [name, [low, high]] of Object.entries(BRAIN_BANDS)) {
    let bandPower = 0;
    for (let index = 0; index < freqs.length; index += 1) {
      if (freqs[index] >= low && freqs[index] < high)
        bandPower += spectrum[index] * spectrum[index];
    }
    bands[name] = bandPower / totalPower;
  }

  let dominantModulationHz = 0;
  let dominantMagnitude = 0;
  for (let index = 1; index < freqs.length; index += 1) {
    if (freqs[index] < 0.5 || freqs[index] > 45) continue;
    if (spectrum[index] > dominantMagnitude) {
      dominantMagnitude = spectrum[index];
      dominantModulationHz = freqs[index];
    }
  }

  return {
    modulationFreqs: freqs,
    modulationSpectrum: Array.from(spectrum),
    bands: {
      ...bands,
      dominant_modulation_hz: dominantModulationHz,
      modulation_sample_rate_hz: actualRate,
    },
  };
}

function zscoreColumns(matrix) {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  const means = Array(cols).fill(0);
  const stdevs = Array(cols).fill(0);
  for (let col = 0; col < cols; col += 1) {
    means[col] = mean(matrix.map((row) => row[col]));
    stdevs[col] =
      Math.sqrt(mean(matrix.map((row) => (row[col] - means[col]) ** 2))) || 1;
  }
  return matrix.map((row) =>
    row.map((value, col) => (value - means[col]) / stdevs[col]),
  );
}

function powerIteration(matrix, iterations = 32) {
  if (!matrix.length) return { vector: [], eigenvalue: 0 };
  let vector = Array(matrix.length)
    .fill(0)
    .map((_, index) => (index === 0 ? 1 : 0.5));
  for (let step = 0; step < iterations; step += 1) {
    const next = matVec(matrix, vector);
    const magnitude = norm(next) || 1;
    vector = next.map((value) => value / magnitude);
  }
  const eigenvalue = dot(vector, matVec(matrix, vector));
  return { vector, eigenvalue };
}

function computeEmbeddings(features) {
  const base = features.map((item) => [
    item.rms,
    item.zcr,
    item.spectral_centroid_hz,
    item.spectral_spread_hz,
    item.spectral_rolloff_hz,
    item.spectral_flatness,
    item.spectral_flux,
    item.dominant_freq_hz,
    item.phase_lock,
    item.phase_gradient_var,
    item.attack_strength,
  ]);
  if (!base.length) return [];
  const standardized = zscoreColumns(base);
  const dims = standardized[0]?.length || 0;
  const covariance = Array.from({ length: dims }, () => Array(dims).fill(0));
  for (const row of standardized) {
    for (let i = 0; i < dims; i += 1) {
      for (let j = 0; j < dims; j += 1) {
        covariance[i][j] += row[i] * row[j];
      }
    }
  }
  for (let i = 0; i < dims; i += 1) {
    for (let j = 0; j < dims; j += 1) {
      covariance[i][j] /= Math.max(standardized.length - 1, 1);
    }
  }

  const components = [];
  let working = covariance.map((row) => [...row]);
  for (
    let componentIndex = 0;
    componentIndex < Math.min(3, dims);
    componentIndex += 1
  ) {
    const { vector, eigenvalue } = powerIteration(working);
    if (!vector.length) break;
    components.push(vector);
    for (let i = 0; i < dims; i += 1) {
      for (let j = 0; j < dims; j += 1) {
        working[i][j] -= eigenvalue * vector[i] * vector[j];
      }
    }
  }

  return standardized.map((row) =>
    components.map((component) => dot(row, component)),
  );
}

function detectSegments(embeddings, features, config) {
  const novelty = embeddings.map((_, index) => {
    if (index === 0 || index === embeddings.length - 1) return 0;
    const prev = embeddings[index - 1];
    const current = embeddings[index];
    const next = embeddings[index + 1];
    const left = Math.sqrt(
      current.reduce((sum, value, dim) => sum + (value - prev[dim]) ** 2, 0),
    );
    const right = Math.sqrt(
      current.reduce((sum, value, dim) => sum + (value - next[dim]) ** 2, 0),
    );
    return left + right;
  });
  const threshold = percentile(novelty, config.segmentationQuantile);
  const boundaries = [];
  let lastBoundary = -999;

  for (let index = 1; index < novelty.length - 1; index += 1) {
    if (
      novelty[index] >= threshold &&
      novelty[index] >= novelty[index - 1] &&
      novelty[index] >= novelty[index + 1]
    ) {
      if (index - lastBoundary >= 16) {
        boundaries.push({
          frame: index,
          time_s: features[index]?.time_s || 0,
          novelty: novelty[index],
        });
        lastBoundary = index;
      }
    }
  }

  return { novelty, boundaries };
}

function nearestCode(value, centers) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const distance = Math.sqrt(
      value.reduce(
        (sum, item, dim) => sum + (item - centers[index][dim]) ** 2,
        0,
      ),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function buildStructuralCodebook(features, embeddings, bandWeights, config) {
  const clusterCount = Math.max(
    4,
    Math.min(8, Math.round(Math.sqrt(Math.max(embeddings.length, 1) / 24))),
  );
  let centers = embeddings.slice(0, clusterCount).map((row) => [...row]);
  if (!centers.length) centers = [[0, 0, 0]];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const buckets = Array.from({ length: centers.length }, () => []);
    for (const row of embeddings) {
      buckets[nearestCode(row, centers)].push(row);
    }
    centers = centers.map((center, index) => {
      if (!buckets[index].length) return center;
      return center.map((_, dim) =>
        mean(buckets[index].map((row) => row[dim])),
      );
    });
  }

  const modulationLabel = Object.entries(BRAIN_BANDS)
    .sort(
      (left, right) =>
        (bandWeights[right[0]] || 0) - (bandWeights[left[0]] || 0),
    )[0][0]
    .toUpperCase()
    .slice(0, 3);

  const attackThreshold = percentile(
    features.map((item) => item.attack_strength),
    0.8,
  );
  const phaseThreshold = percentile(
    features.map((item) => item.phase_lock),
    0.66,
  );
  const tokens = embeddings.map((row, index) => {
    const cluster = nearestCode(row, centers);
    const attack =
      features[index].attack_strength > attackThreshold ? "A1" : "A0";
    const phase = features[index].phase_lock > phaseThreshold ? "P1" : "P0";
    return `C${cluster}-${attack}-${phase}-${modulationLabel}`;
  });

  const motifCounter = new Map();
  const motifSpan = clamp(config.motifSpan, 3, 6);
  for (let index = 0; index <= tokens.length - motifSpan; index += 1) {
    const motif = tokens.slice(index, index + motifSpan).join(" | ");
    const entry = motifCounter.get(motif) || { count: 0, occurrences: [] };
    entry.count += 1;
    entry.occurrences.push({
      frame: index,
      time_s: features[index]?.time_s || 0,
    });
    motifCounter.set(motif, entry);
  }

  const motifs = [...motifCounter.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 12)
    .map(([sequence, entry]) => ({
      sequence: sequence.split(" | "),
      count: entry.count,
      occurrences: entry.occurrences.slice(0, 12),
    }));

  const frequencies = new Map();
  for (const token of tokens)
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const probabilities = [...frequencies.values()].map(
    (count) => count / Math.max(tokens.length, 1),
  );
  const entropy = -probabilities.reduce(
    (sum, probability) =>
      sum + probability * Math.log2(Math.max(probability, 1e-12)),
    0,
  );
  const maxEntropy = Math.log2(Math.max(frequencies.size, 2));

  return {
    tokens,
    cluster_count: centers.length,
    unique_token_count: frequencies.size,
    sequence_entropy: entropy / Math.max(maxEntropy, 1),
    compression_ratio: tokens.length
      ? new Blob([tokens.join(" ")]).size / Math.max(tokens.length * 12, 1)
      : 0,
    top_motifs: motifs,
  };
}

function buildEvidenceModel(features, modulationBands, codebook, segmentation) {
  const phaseStability = mean(features.map((item) => item.phase_lock));
  const attackStrengths = features.map((item) => item.attack_strength);
  const attackThreshold = percentile(attackStrengths, 0.85);
  const attackDensity =
    attackStrengths.filter((value) => value >= attackThreshold).length /
    Math.max(attackStrengths.length, 1);
  const head = features.slice(0, Math.max(1, Math.floor(features.length / 3)));
  const tail = features.slice(
    Math.max(0, Math.floor((2 * features.length) / 3)),
  );
  const timbralDrift = Math.abs(
    mean(head.map((item) => item.spectral_centroid_hz)) -
      mean(tail.map((item) => item.spectral_centroid_hz)),
  );
  const repetitionIndex = 1 - codebook.sequence_entropy;
  const dominantModulation = modulationBands.dominant_modulation_hz;

  const descriptors = [];
  if (repetitionIndex > 0.45) descriptors.push("high structural repetition");
  if (phaseStability > 0.82) descriptors.push("stable phase field");
  if (attackDensity > 0.12) descriptors.push("dense transient clusters");
  if (timbralDrift > 60) descriptors.push("strong timbral drift");
  if (dominantModulation > 0.5 && dominantModulation < 4)
    descriptors.push("slow envelope pulsing");
  if (segmentation.boundaries.length >= 3)
    descriptors.push("clear section boundaries");
  if (!descriptors.length) descriptors.push("low-evidence continuous texture");

  return {
    descriptors,
    scores: {
      repetition_index: repetitionIndex,
      phase_stability: phaseStability,
      attack_density: attackDensity,
      timbral_drift_hz: timbralDrift,
      dominant_modulation_hz: dominantModulation,
      boundary_count: segmentation.boundaries.length,
    },
    note: "These outputs are measurement-driven structural evidence derived from recurrence, transients, modulation, and phase behavior. They are not claims of literal semantic decoding.",
  };
}

function topPeaks(freqs, spectrum) {
  const entries = [];
  for (let index = 2; index < spectrum.length - 2; index += 1) {
    const local = spectrum[index];
    const prominence =
      local - 0.5 * (spectrum[index - 1] + spectrum[index + 1]);
    if (prominence <= 0) continue;
    entries.push({ freq_hz: freqs[index], strength: local, prominence });
  }
  return entries
    .sort((left, right) => right.prominence - left.prominence)
    .slice(0, 10);
}

// ─── Feature interpretation ───────────────────────────────────────────────────

function summarizeReportMetrics(report) {
  const features = Array.isArray(report?.features) ? report.features : [];
  const centroidMean = mean(
    features.map((item) => item.spectral_centroid_hz || 0),
  );
  const flatnessMean = mean(
    features.map((item) => item.spectral_flatness || 0),
  );
  const spreadMean = mean(features.map((item) => item.spectral_spread_hz || 0));
  const fluxMean = mean(features.map((item) => item.spectral_flux || 0));
  const attackMean = mean(features.map((item) => item.attack_strength || 0));
  const zcrMean = mean(features.map((item) => item.zcr || 0));
  const phaseMean = mean(features.map((item) => item.phase_lock || 0));
  const rmsMean = mean(features.map((item) => item.rms || 0));
  const attackDensity = report?.evidence?.scores?.attack_density || 0;
  const repetitionIndex = report?.evidence?.scores?.repetition_index || 0;
  const modulationHz = report?.modulationBands?.dominant_modulation_hz || 0;
  const dominantPeak = report?.topPeaks?.[0]?.freq_hz || 0;
  const recurrenceAffinity = report?.advanced?.recurrence_mean_affinity || 0;
  const keyStrength = report?.advanced?.key_strength || 0;
  return {
    centroidMean,
    flatnessMean,
    spreadMean,
    fluxMean,
    attackMean,
    zcrMean,
    phaseMean,
    rmsMean,
    attackDensity,
    repetitionIndex,
    modulationHz,
    dominantPeak,
    recurrenceAffinity,
    keyStrength,
  };
}

function describeVibe(report) {
  const metrics = summarizeReportMetrics(report);
  const rageScore =
    metrics.attackDensity * 3.2 +
    metrics.attackMean * 2.3 +
    metrics.fluxMean * 1.8 +
    metrics.zcrMean * 3.6 +
    (metrics.centroidMean > 1700 ? 0.8 : 0) +
    (metrics.dominantPeak < 180 ? 0.7 : 0);
  const tenseScore =
    metrics.spreadMean / 1800 +
    metrics.flatnessMean * 1.8 +
    metrics.zcrMean * 2.4 +
    (metrics.phaseMean < 0.55 ? 0.8 : 0);
  const meditativeScore =
    (metrics.modulationHz >= 3 && metrics.modulationHz <= 8 ? 1.4 : 0) +
    (metrics.phaseMean > 0.72 ? 1.1 : 0) +
    Math.max(0, 0.22 - metrics.attackDensity) * 4 +
    (metrics.centroidMean < 1500 ? 0.5 : 0);
  const chillScore =
    (metrics.centroidMean < 1400 ? 1 : 0) +
    (metrics.attackDensity < 0.1 ? 1.2 : 0) +
    (metrics.fluxMean < 0.18 ? 0.8 : 0) +
    (metrics.flatnessMean < 0.18 ? 0.4 : 0);
  const drivingScore =
    metrics.repetitionIndex * 1.4 +
    metrics.attackDensity * 1.8 +
    (metrics.modulationHz >= 1.5 && metrics.modulationHz <= 6 ? 0.9 : 0) +
    (metrics.rmsMean > 0.12 ? 0.8 : 0);

  const candidates = [
    { label: "Rage / Aggressive", score: rageScore },
    { label: "Anxious / Tense", score: tenseScore },
    { label: "Meditative / Trance", score: meditativeScore },
    { label: "Chill / Spacey", score: chillScore },
    { label: "Driving / Ritual", score: drivingScore },
  ].sort((left, right) => right.score - left.score);

  const [best, second] = candidates;
  if (!best || best.score < 1.2) return "Balanced / Searching";
  if (second && best.score - second.score < 0.22)
    return `${best.label} with ${second.label.toLowerCase()} traits`;
  return best.label;
}

function buildStateEngineering(report) {
  const metrics = summarizeReportMetrics(report);
  const vibe = describeVibe(report).toLowerCase();
  const energy = buildEnergyRead(report);
  const hype = clamp(
    8 +
      normalizeScore(metrics.rmsMean, 0.03, 0.28) * 32 +
      normalizeScore(metrics.attackDensity, 0.03, 0.22) * 26 +
      normalizeScore(metrics.fluxMean, 0.04, 0.35) * 18 +
      normalizeScore(metrics.zcrMean, 0.015, 0.12) * 14 +
      normalizeScore(metrics.centroidMean, 700, 4200) * 12,
    0,
    100,
  );
  const focus = clamp(
    22 +
      normalizeScore(metrics.phaseMean, 0.4, 0.95) * 30 +
      normalizeScore(metrics.repetitionIndex, 0.02, 0.45) * 18 +
      normalizeScore(metrics.modulationHz, 5, 14) * 10 -
      normalizeScore(metrics.attackDensity, 0.05, 0.24) * 14 -
      normalizeScore(metrics.flatnessMean, 0.08, 0.42) * 8,
    0,
    100,
  );
  const chill = clamp(
    26 +
      normalizeScore(metrics.phaseMean, 0.45, 0.95) * 20 +
      normalizeScore(1500 - metrics.centroidMean, -1800, 1200) * 16 +
      normalizeScore(0.18 - metrics.attackDensity, -0.1, 0.16) * 20 +
      normalizeScore(8 - metrics.modulationHz, -10, 5) * 12 -
      normalizeScore(metrics.rmsMean, 0.05, 0.25) * 10,
    0,
    100,
  );

  let adjustedHype = hype;
  let adjustedFocus = focus;
  let adjustedChill = chill;

  if (vibe.includes("rage") || vibe.includes("aggressive")) adjustedHype += 18;
  if (vibe.includes("rage") || vibe.includes("aggressive")) adjustedChill -= 18;
  if (vibe.includes("anxious") || vibe.includes("tense")) adjustedHype += 10;
  if (vibe.includes("meditative") || vibe.includes("trance"))
    adjustedChill += 16;
  if (vibe.includes("chill") || vibe.includes("spacey")) adjustedChill += 18;
  if (vibe.includes("driving") || vibe.includes("ritual")) adjustedFocus += 10;

  if (energy.label === "Explosive") adjustedHype += 16;
  else if (energy.label === "Aggressive") adjustedHype += 12;
  else if (energy.label === "Driving") adjustedFocus += 8;
  else if (energy.label === "Calm" || energy.label === "Soft")
    adjustedChill += 10;

  const entries = [
    { label: "Hype", score: Math.round(clamp(adjustedHype, 0, 100)) },
    { label: "Focus", score: Math.round(clamp(adjustedFocus, 0, 100)) },
    { label: "Chill", score: Math.round(clamp(adjustedChill, 0, 100)) },
  ].sort((left, right) => right.score - left.score);

  const top = entries[0];
  let verdict = `${top.score}% ${top.label} profile`;
  let guidance =
    "Balanced enough to move between work, transit, and casual listening.";

  if (top.label === "Hype") {
    guidance =
      top.score >= 80
        ? "High structural friction and power. Good for lifting, sprinting, or adrenaline. Poor fit for deep work."
        : "Leans kinetic and activating. Better for movement than quiet concentration.";
  } else if (top.label === "Focus") {
    guidance =
      top.score >= 75
        ? "Stable enough for concentration with controlled drive. Best fit for coding, study blocks, or task execution."
        : "Moderately structured and lockable. Usable for work if the room is already calm.";
  } else if (top.label === "Chill") {
    guidance =
      top.score >= 75
        ? "Low-pressure and low-threat. Best fit for decompression, reading, or winding down."
        : "More cooling than pushing. Better for recovery than performance output.";
  }

  return { entries, verdict, guidance };
}

function buildEnergyRead(report) {
  const metrics = summarizeReportMetrics(report);
  const rmsValues = report.features.map((item) => item.rms);
  const peakEnergy = percentile(rmsValues, 0.95);
  const dynamicLift = Math.max(0, peakEnergy - metrics.rmsMean);
  const energyScore = clamp(
    normalizeScore(metrics.rmsMean, 0.02, 0.28) * 45 +
      normalizeScore(peakEnergy, 0.04, 0.35) * 25 +
      normalizeScore(metrics.attackDensity, 0.02, 0.22) * 18 +
      normalizeScore(metrics.fluxMean, 0.04, 0.35) * 12,
    0,
    100,
  );
  const shockScore = clamp(
    normalizeScore(dynamicLift, 0.01, 0.16) * 55 +
      normalizeScore(metrics.attackMean, 0.002, 0.16) * 45,
    0,
    100,
  );

  let label = "Calm";
  if (energyScore >= 78 || shockScore >= 70) label = "Explosive";
  else if (energyScore >= 60) label = "Aggressive";
  else if (energyScore >= 38) label = "Driving";
  else if (energyScore >= 20) label = "Soft";

  const copy =
    label === "Explosive"
      ? "The track surges hard, with obvious energy spikes and impact transitions."
      : label === "Aggressive"
        ? "The track stays forceful and forward, but without constant full detonation."
        : label === "Driving"
          ? "The track keeps momentum alive without feeling fully overwhelming."
          : label === "Soft"
            ? "The track carries motion, but it stays restrained and fairly gentle."
            : "The track stays low-pressure and subdued for most of its runtime.";

  return {
    label,
    energyScore: Math.round(energyScore),
    shockScore: Math.round(shockScore),
    peakEnergy,
    copy,
  };
}

function buildCompareRead(left, right) {
  if (!left || !right) {
    return {
      title: "Compare Songs unlocks when two files are loaded.",
      summary:
        "Upload a second track and this card will explain where they diverge in brightness, impact, repetition, and pulse.",
      stats: [],
    };
  }

  const leftMetrics = summarizeReportMetrics(left);
  const rightMetrics = summarizeReportMetrics(right);
  const brighter =
    leftMetrics.centroidMean >= rightMetrics.centroidMean ? left : right;
  const harder =
    leftMetrics.attackDensity >= rightMetrics.attackDensity ? left : right;
  const steadier =
    leftMetrics.repetitionIndex >= rightMetrics.repetitionIndex ? left : right;
  const rougher = leftMetrics.zcrMean >= rightMetrics.zcrMean ? left : right;
  const brightnessGap = Math.abs(
    leftMetrics.centroidMean - rightMetrics.centroidMean,
  );
  const attackGap = Math.abs(
    leftMetrics.attackDensity - rightMetrics.attackDensity,
  );
  const repetitionGap = Math.abs(
    leftMetrics.repetitionIndex - rightMetrics.repetitionIndex,
  );
  const recurrenceGap = Math.abs(
    leftMetrics.recurrenceAffinity - rightMetrics.recurrenceAffinity,
  );
  const keyMatch =
    left.advanced?.estimated_key &&
    left.advanced?.estimated_key === right.advanced?.estimated_key &&
    left.advanced?.estimated_scale === right.advanced?.estimated_scale;

  const summary = [
    `${brighter.name} comes across brighter and more top-end forward.`,
    `${harder.name} hits harder on transients and structural friction.`,
    `${steadier.name} is the more pattern-locked track, while ${rougher.name} reads rougher at the waveform level.`,
    keyMatch
      ? `Both tracks center on ${left.advanced.estimated_key} ${left.advanced.estimated_scale}, so the harmonic center is relatively aligned.`
      : "Their harmonic centers diverge, so the contrast is not just energy-deep but tonal too.",
  ].join(" ");

  return {
    title: `${left.name} vs ${right.name}`,
    summary,
    stats: [
      {
        label: "Brightness Gap",
        value: `${brightnessGap.toFixed(0)} Hz`,
        note: brightnessGap < 1 ? "Effectively tied" : `${brighter.name} leads`,
      },
      {
        label: "Attack Gap",
        value: attackGap < 0.0005 ? "< 0.001" : attackGap.toFixed(3),
        note:
          attackGap < 0.0005
            ? "Virtually tied on attack density"
            : `${harder.name} hits harder`,
      },
      {
        label: "Pattern Lock",
        value: repetitionGap < 0.0005 ? "< 0.001" : repetitionGap.toFixed(3),
        note:
          repetitionGap < 0.0005
            ? "Virtually tied on repetition"
            : `${steadier.name} repeats more tightly`,
      },
      {
        label: "Recurrence",
        value: recurrenceGap < 0.0005 ? "< 0.001" : recurrenceGap.toFixed(3),
        note:
          recurrenceGap < 0.0005
            ? "Virtually tied on MFCC recurrence"
            : leftMetrics.recurrenceAffinity >= rightMetrics.recurrenceAffinity
              ? `${left.name} has the stickier MFCC recurrence field`
              : `${right.name} has the stickier MFCC recurrence field`,
      },
    ],
  };
}

function buildCollisionRead(left, right) {
  if (!left || !right) {
    return {
      score: null,
      label: "Waiting for a second track.",
      summary:
        "Load two songs and the experimental collision engine will estimate whether the signatures merge, wobble, or clash.",
    };
  }

  const leftMetrics = summarizeReportMetrics(left);
  const rightMetrics = summarizeReportMetrics(right);
  const centroidDistance = normalizeScore(
    Math.abs(leftMetrics.centroidMean - rightMetrics.centroidMean),
    0,
    3200,
  );
  const modulationDistance = normalizeScore(
    Math.abs(leftMetrics.modulationHz - rightMetrics.modulationHz),
    0,
    14,
  );
  const phaseDistance = normalizeScore(
    Math.abs(leftMetrics.phaseMean - rightMetrics.phaseMean),
    0,
    0.8,
  );
  const repetitionDistance = normalizeScore(
    Math.abs(leftMetrics.repetitionIndex - rightMetrics.repetitionIndex),
    0,
    0.4,
  );
  const peakDistance = normalizeScore(
    Math.abs(
      (left.topPeaks[0]?.freq_hz || 0) - (right.topPeaks[0]?.freq_hz || 0),
    ),
    0,
    1800,
  );
  const harmonyScore = Math.round(
    clamp(
      100 -
        (centroidDistance * 26 +
          modulationDistance * 20 +
          phaseDistance * 18 +
          repetitionDistance * 16 +
          peakDistance * 20),
      0,
      100,
    ),
  );

  let label = "Hard Clash";
  let summary =
    "The signatures collide with a lot of mismatch, so the visual should feel unstable and shard-heavy.";
  if (harmonyScore >= 74) {
    label = "Clean Merge";
    summary =
      "The signatures line up well enough to merge into a shared glowing core instead of breaking apart.";
  } else if (harmonyScore >= 48) {
    label = "Unstable Blend";
    summary =
      "The signatures partially merge but keep fighting each other, which should read as wobble and intermittent fracture.";
  }

  return { score: harmonyScore, label, summary };
}

function buildStudySoundCoach(report) {
  const metrics = summarizeReportMetrics(report);
  const energy = buildEnergyRead(report);
  const stateScore = buildStateEngineering(report);
  const vibe = describeVibe(report);
  const harmonicField =
    report.advanced?.key_strength >= 0.34
      ? `${report.advanced?.estimated_key || "n/a"} ${report.advanced?.estimated_scale || ""}`.trim()
      : "ambiguous tonal center";

  const reading = clamp(
    34 +
      normalizeScore(metrics.phaseMean, 0.45, 0.95) * 24 +
      normalizeScore(0.16 - metrics.attackDensity, -0.12, 0.14) * 22 +
      normalizeScore(1800 - metrics.centroidMean, -2200, 1500) * 14 +
      normalizeScore(0.2 - metrics.fluxMean, -0.2, 0.16) * 12,
    0,
    100,
  );
  const writing = clamp(
    28 +
      normalizeScore(metrics.phaseMean, 0.42, 0.92) * 18 +
      normalizeScore(metrics.repetitionIndex, 0.02, 0.38) * 18 +
      normalizeScore(0.18 - metrics.attackDensity, -0.1, 0.14) * 16 +
      normalizeScore(10 - metrics.modulationHz, -10, 7) * 12,
    0,
    100,
  );
  const coding = clamp(
    26 +
      normalizeScore(
        stateScore.entries.find((entry) => entry.label === "Focus")?.score || 0,
        35,
        95,
      ) *
        34 +
      normalizeScore(metrics.repetitionIndex, 0.03, 0.45) * 18 +
      normalizeScore(metrics.phaseMean, 0.45, 0.94) * 12 +
      normalizeScore(metrics.rmsMean, 0.03, 0.17) * 8 -
      normalizeScore(metrics.flatnessMean, 0.14, 0.44) * 8,
    0,
    100,
  );
  const memorization = clamp(
    30 +
      normalizeScore(metrics.repetitionIndex, 0.04, 0.45) * 22 +
      normalizeScore(0.17 - metrics.attackDensity, -0.1, 0.14) * 18 +
      normalizeScore(metrics.phaseMean, 0.45, 0.95) * 16 +
      normalizeScore(7 - Math.abs(metrics.modulationHz - 6), -7, 7) * 10,
    0,
    100,
  );
  const recovery = clamp(
    24 +
      normalizeScore(
        stateScore.entries.find((entry) => entry.label === "Chill")?.score || 0,
        35,
        95,
      ) *
        32 +
      normalizeScore(0.16 - metrics.attackDensity, -0.1, 0.14) * 18 +
      normalizeScore(1500 - metrics.centroidMean, -2500, 1600) * 14 +
      normalizeScore(0.16 - metrics.rmsMean, -0.18, 0.12) * 12,
    0,
    100,
  );

  const tasks = [
    {
      label: "Reading",
      score: Math.round(reading),
      note:
        reading >= 70
          ? "Steady enough to sit behind dense material without constantly poking your attention."
          : "May add more motion than dense reading usually wants.",
    },
    {
      label: "Writing",
      score: Math.round(writing),
      note:
        writing >= 70
          ? "Patterned enough to keep you moving while leaving room for language generation."
          : "Could push too hard or wander too much for drafting.",
    },
    {
      label: "Coding",
      score: Math.round(coding),
      note:
        coding >= 70
          ? "Locks into task cadence well and carries enough drive for longer focus blocks."
          : "Structure is weaker or rougher than ideal for long implementation sessions.",
    },
    {
      label: "Memorization",
      score: Math.round(memorization),
      note:
        memorization >= 70
          ? "Repeats and breathes in a way that supports recall rather than surprise."
          : "Too jumpy or too shapeless to be ideal for flashcards and retention.",
    },
    {
      label: "Recovery",
      score: Math.round(recovery),
      note:
        recovery >= 70
          ? "This one cools the system down and gives your attention a chance to unclench."
          : "Still carries too much tension or motion for real recovery.",
    },
  ].sort((left, right) => right.score - left.score);

  const best = tasks[0];
  const worst = tasks[tasks.length - 1];
  const headline =
    best.score >= 78
      ? `Best fit: ${best.label}`
      : best.score >= 60
        ? `Usable for ${best.label.toLowerCase()}`
        : "Mixed study fit";

  const summary =
    best.score >= 78
      ? `${report.name} is strongest for ${best.label.toLowerCase()}. ${worst.label} is the weakest fit, mostly because the track reads ${vibe.toLowerCase()}.`
      : `${report.name} is not a universal study track. It leans most toward ${best.label.toLowerCase()}, while ${worst.label.toLowerCase()} is the weakest use case.`;

  const cautionFlags = [];
  if (energy.label === "Explosive" || energy.label === "Aggressive")
    cautionFlags.push("impact-heavy");
  if (metrics.attackDensity > 0.14) cautionFlags.push("transient-spiky");
  if (metrics.spreadMean > 1900 || metrics.flatnessMean > 0.28)
    cautionFlags.push("texture-distracting");
  if (metrics.modulationHz > 10) cautionFlags.push("fast-pulsing");
  if (metrics.recurrenceAffinity > 0.58)
    cautionFlags.push("high recurrence lock");
  cautionFlags.push(harmonicField);
  if (!cautionFlags.length) cautionFlags.push("stable-background");

  return { headline, summary, tasks, cautionFlags };
}

function buildPlaylistCleanser(reports) {
  if (!reports.length) {
    return {
      headline: "Load a playlist to audit it.",
      summary:
        "Dreamscape will flag the tracks that are most likely to break concentration.",
      tracks: [],
      safest: null,
      riskiest: null,
    };
  }

  const tracks = reports.map((report) => {
    const metrics = summarizeReportMetrics(report);
    const energy = buildEnergyRead(report);
    const stateScore = buildStateEngineering(report);
    const shock = energy.shockScore;
    const studyBreak = clamp(
      normalizeScore(metrics.attackDensity, 0.03, 0.22) * 24 +
        normalizeScore(metrics.fluxMean, 0.04, 0.35) * 18 +
        normalizeScore(metrics.zcrMean, 0.015, 0.12) * 16 +
        normalizeScore(metrics.spreadMean, 800, 3600) * 14 +
        normalizeScore(shock, 25, 90) * 18 +
        normalizeScore(metrics.centroidMean, 900, 4200) * 10,
      0,
      100,
    );
    const studySupport = clamp(
      normalizeScore(
        stateScore.entries.find((entry) => entry.label === "Focus")?.score || 0,
        35,
        95,
      ) *
        36 +
        normalizeScore(metrics.phaseMean, 0.42, 0.94) * 18 +
        normalizeScore(metrics.repetitionIndex, 0.02, 0.45) * 18 +
        normalizeScore(0.18 - metrics.attackDensity, -0.1, 0.16) * 14 +
        normalizeScore(0.18 - metrics.flatnessMean, -0.2, 0.14) * 14,
      0,
      100,
    );

    const tags = [];
    if (studyBreak >= 62) tags.push({ label: "breaks focus", tone: "warn" });
    if (shock >= 60) tags.push({ label: "spike-heavy", tone: "warn" });
    if (metrics.centroidMean > 2400 || metrics.spreadMean > 2100)
      tags.push({ label: "top-end busy", tone: "warn" });
    if (studySupport >= 64)
      tags.push({ label: "holds concentration", tone: "good" });
    if (metrics.repetitionIndex >= 0.18)
      tags.push({ label: "pattern-locked", tone: "good" });
    if (!tags.length) tags.push({ label: "neutral", tone: "" });

    return {
      id: report.id,
      name: report.name,
      disruption: Math.round(studyBreak),
      support: Math.round(studySupport),
      note:
        studyBreak >= 62
          ? "Likely to interrupt reading or deep work because it jumps, flashes, or crowds the top end."
          : studySupport >= 64
            ? "Safer study pick. It stays more locked-in and less interruption-heavy."
            : "Middle-of-the-road. Usable, but not a dedicated study weapon.",
      tags,
    };
  });

  const riskiest = [...tracks].sort(
    (left, right) => right.disruption - left.disruption,
  )[0];
  const safest = [...tracks].sort(
    (left, right) => right.support - left.support,
  )[0];
  const sorted = [...tracks].sort(
    (left, right) =>
      right.disruption - right.support - (left.disruption - left.support),
  );

  return {
    headline:
      reports.length > 1
        ? "Playlist Cleanser active."
        : "Single-track cleanser preview.",
    summary:
      safest && riskiest
        ? `${safest.name} is the safest study hold. ${riskiest.name} is the most likely to snap concentration.`
        : "Load more tracks to compare study safety across a playlist.",
    tracks: sorted,
    safest,
    riskiest,
  };
}

function bucketAverage(values, start, end) {
  const safeStart = Math.max(0, Math.floor(start));
  const safeEnd = Math.min(
    values.length,
    Math.max(safeStart + 1, Math.ceil(end)),
  );
  let total = 0;
  for (let index = safeStart; index < safeEnd; index += 1)
    total += values[index];
  return total / Math.max(1, safeEnd - safeStart);
}

function bandAverage(values, sampleRate, fftSize, lowHz, highHz) {
  const hzPerBin = sampleRate / fftSize;
  return bucketAverage(values, lowHz / hzPerBin, highHz / hzPerBin);
}

function getRoomScanAvailability() {
  if (!window.isSecureContext && location.protocol !== "file:") {
    return {
      supported: false,
      reason:
        "Room Scan needs a secure context. Open Dreamscape on localhost or HTTPS to use the microphone.",
    };
  }
  if (location.protocol === "file:") {
    return {
      supported: false,
      reason:
        "Room Scan is blocked on file:// in most browsers. Start the local server and open Dreamscape on http://127.0.0.1:8000.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      reason: "This browser does not expose microphone capture for Room Scan.",
    };
  }
  return { supported: true, reason: "" };
}

function buildRoomSummary(history, spots) {
  if (!history.length) {
    let bestSeat =
      "Mark multiple spots while walking around to find the calmest seat.";
    if (spots.length >= 2) {
      const sortedSpots = [...spots].sort(
        (left, right) => left.focusFit - right.focusFit,
      );
      const best = sortedSpots[sortedSpots.length - 1];
      const worst = sortedSpots[0];
      bestSeat = `${best.label} was the calmest saved position. ${worst.label} was the noisiest.`;
    } else if (spots.length === 1) {
      bestSeat = `${spots[0].label} is the only stored spot so far.`;
    }
    return {
      status: "Mic idle",
      roomTone: "Start a room scan to profile the space.",
      focusFit: 0,
      chaosScore: 0,
      speechScore: 0,
      rumbleScore: 0,
      interruptions: "No live room data yet.",
      hiddenNoises: [
        "Microphone input is off, so there is no room signature to inspect yet.",
      ],
      bestSeat,
    };
  }

  const avg = (key) => mean(history.map((frame) => frame[key] || 0));
  const chaosScore = Math.round(clamp(avg("chaos") * 100, 0, 100));
  const speechScore = Math.round(clamp(avg("speech") * 100, 0, 100));
  const rumbleScore = Math.round(clamp(avg("rumble") * 100, 0, 100));
  const humScore = avg("hum");
  const buzzScore = avg("buzz");
  const keyboardScore = avg("keyboard");
  const slamScore = avg("slam");
  const focusFit = Math.round(
    clamp(
      100 - (chaosScore * 0.5 + speechScore * 0.28 + rumbleScore * 0.18),
      0,
      100,
    ),
  );

  let roomTone = "Calm and work-friendly.";
  if (chaosScore >= 70) roomTone = "Chaotic and interruption-heavy.";
  else if (speechScore >= 62)
    roomTone = "Speech-contaminated and socially busy.";
  else if (rumbleScore >= 60) roomTone = "Low-frequency energy is prominent.";
  else if (focusFit >= 72)
    roomTone = "Steady enough for reading, coding, and longer focus blocks.";

  const hiddenNoises = [];
  if (humScore >= 0.34)
    hiddenNoises.push(
      "Persistent low hum suggests HVAC, AC, or building systems.",
    );
  if (buzzScore >= 0.26)
    hiddenNoises.push(
      "A bright narrow buzz suggests fluorescent lighting, chargers, or electronics.",
    );
  if (speechScore >= 48)
    hiddenNoises.push(
      "Voice-range activity is present, even if the room does not feel obviously loud.",
    );
  if (keyboardScore >= 0.22)
    hiddenNoises.push(
      "Short high-frequency clicks resemble keyboard chatter or utensil/clatter noise.",
    );
  if (slamScore >= 0.2)
    hiddenNoises.push(
      "Sudden broadband bursts suggest doors, dropped objects, or abrupt interruptions.",
    );
  if (rumbleScore >= 54)
    hiddenNoises.push(
      "Elevated low-frequency activity may be worth comparing at another location.",
    );
  if (!hiddenNoises.length)
    hiddenNoises.push(
      "No single hidden noise dominates. The room signature is comparatively smooth.",
    );

  const interruptions =
    chaosScore >= 65 && speechScore < 45
      ? "This room is not just loud. It is interruption-heavy, with unstable spikes that will keep yanking attention."
      : speechScore >= 55
        ? "Voice-range activity is prominent in the recent samples."
        : focusFit >= 72
          ? "The room stays fairly even. You are mostly fighting baseline ambience, not random interruption bursts."
          : "The room is workable, but it has enough instability that long focus blocks will probably feel harder than they should.";

  let bestSeat =
    "Mark a few spots while moving around the room and Dreamscape will tell you which one is calmest.";
  if (spots.length >= 2) {
    const sortedSpots = [...spots].sort(
      (left, right) => left.focusFit - right.focusFit,
    );
    const best = sortedSpots[sortedSpots.length - 1];
    const worst = sortedSpots[0];
    bestSeat = `${best.label} is currently the calmest saved position. ${worst.label} is the noisiest.`;
  } else if (spots.length === 1) {
    bestSeat = `${spots[0].label} is saved. Mark at least one more spot to compare seating positions.`;
  }

  return {
    status: roomState.isScanning ? "Live room scan" : "Last room scan",
    roomTone,
    focusFit,
    chaosScore,
    speechScore,
    rumbleScore,
    interruptions,
    hiddenNoises,
    bestSeat,
  };
}

function buildRoomScanAdvice(room) {
  const reading = clamp(
    Math.round(room.focusFit - room.speechScore * 0.35 - room.chaosScore * 0.2),
    0,
    100,
  );
  const coding = clamp(
    Math.round(
      room.focusFit - room.chaosScore * 0.28 - room.rumbleScore * 0.12,
    ),
    0,
    100,
  );
  const memorization = clamp(
    Math.round(
      room.focusFit - room.speechScore * 0.52 - room.chaosScore * 0.18,
    ),
    0,
    100,
  );
  const recovery = clamp(
    Math.round(100 - room.chaosScore * 0.45 - room.rumbleScore * 0.18),
    0,
    100,
  );
  const entries = [
    { label: "Reading", score: reading },
    { label: "Coding", score: coding },
    { label: "Memory", score: memorization },
    { label: "Recovery", score: recovery },
  ].sort((left, right) => right.score - left.score);

  let action =
    "Start scanning, then walk around and mark a few seats. Dreamscape will call out the calmest spot.";
  if (room.focusFit > 0) {
    if (room.speechScore >= 58) {
      action =
        "Move away from conversations, counters, doors, or shared tables. The speech band is the attention leak.";
    } else if (room.chaosScore >= 62) {
      action =
        "Avoid doors, printers, hard surfaces, and traffic paths. The room is spike-heavy even if it is not loud.";
    } else if (room.rumbleScore >= 58) {
      action =
        "Try a different wall or corner and compare the low-frequency activity.";
    } else if (room.focusFit >= 72) {
      action =
        "This is a solid focus pocket. Save this spot and use it for longer reading, coding, or writing blocks.";
    } else {
      action =
        "This room is usable, but not clean. Mark a few positions to find the smoothest seat.";
    }
  }

  return {
    bestTask: entries[0],
    entries,
    action,
  };
}

function computeRoomFrameSummary() {
  if (!roomState.analyser || !roomState.freqData || !roomState.timeData)
    return null;
  roomState.analyser.getFloatFrequencyData(roomState.freqData);
  roomState.analyser.getFloatTimeDomainData(roomState.timeData);

  const normalizedSpectrum = Array.from(roomState.freqData, (value) =>
    normalizeScore(value, -105, -20),
  );
  const compactSpectrum = Array.from({ length: 72 }, (_, index) => {
    const start = (index / 72) * normalizedSpectrum.length;
    const end = ((index + 1) / 72) * normalizedSpectrum.length;
    return bucketAverage(normalizedSpectrum, start, end);
  });

  let sumSquares = 0;
  let peak = 0;
  let zeroCrossings = 0;
  for (let index = 0; index < roomState.timeData.length; index += 1) {
    const sample = roomState.timeData[index];
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    if (
      index > 0 &&
      Math.sign(roomState.timeData[index - 1]) !== Math.sign(sample)
    )
      zeroCrossings += 1;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, roomState.timeData.length));
  const zcr = zeroCrossings / Math.max(1, roomState.timeData.length - 1);

  let flux = 0;
  if (roomState.previousSpectrum) {
    for (let index = 0; index < compactSpectrum.length; index += 1) {
      flux += Math.abs(
        compactSpectrum[index] - roomState.previousSpectrum[index],
      );
    }
    flux /= compactSpectrum.length;
  }
  roomState.previousSpectrum = compactSpectrum;

  const sampleRate = roomState.sampleRate || audioContext.sampleRate;
  const fftSize = roomState.fftSize;
  const speech = bandAverage(
    normalizedSpectrum,
    sampleRate,
    fftSize,
    250,
    4000,
  );
  const rumble = bandAverage(normalizedSpectrum, sampleRate, fftSize, 25, 140);
  const hum = Math.max(
    bandAverage(normalizedSpectrum, sampleRate, fftSize, 48, 62),
    bandAverage(normalizedSpectrum, sampleRate, fftSize, 58, 72),
  );
  const buzz = bandAverage(
    normalizedSpectrum,
    sampleRate,
    fftSize,
    7000,
    12000,
  );
  const keyboard =
    bandAverage(normalizedSpectrum, sampleRate, fftSize, 1800, 6500) *
    clamp(flux * 4.2, 0, 1);
  const slam = clamp((peak - rms) * 2.8 + flux * 2.6, 0, 1);
  const chaos = clamp(
    flux * 2.2 + (peak - rms) * 1.3 + zcr * 3.6 + speech * 0.35,
    0,
    1,
  );

  return {
    compactSpectrum,
    rms,
    zcr,
    flux,
    speech,
    rumble,
    hum,
    buzz,
    keyboard,
    slam,
    chaos,
    focusFit: clamp(1 - (chaos * 0.52 + speech * 0.28 + rumble * 0.2), 0, 1),
  };
}

// ─── Canvas / orb rendering ───────────────────────────────────────────────────

function buildLiveRenderReport() {
  if (!liveState.isBuilding || !liveState.buildSpectrum || !liveState.buildMeta)
    return null;
  return {
    name: liveState.buildMeta.name,
    sample_rate_hz: liveState.buildMeta.sampleRate,
    averageSpectrum: liveState.buildSpectrum,
    features: [],
    evidence: { scores: {} },
    advanced: {},
    modulationBands: {},
    topPeaks: [],
  };
}

function drawGeometricOrb(canvas, report, view) {
  drawFingerprint(canvas, report, {
    ...ui.settings,
    activity: visualActivity,
    liveBands: visualBands,
    building: liveState.isBuilding,
    progress: liveState.buildProgress,
  });
}

function drawRoomHeatmap(canvas) {
  if (!canvas || !canvas.getClientRects().length) return;
  const rect = canvas.getBoundingClientRect(),
    ratio = Math.min(devicePixelRatio || 1, 2);
  const w = rect.width,
    h = rect.height;
  if (
    canvas.width !== Math.round(w * ratio) ||
    canvas.height !== Math.round(h * ratio)
  ) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#15181e";
  ctx.fillRect(0, 0, w, h);
  const left = 46,
    top = 40,
    bottom = h - 30,
    width = w - left - 14,
    height = bottom - top;
  const frames = roomState.heatmapFrames,
    nyquist = (roomState.sampleRate || audioContext.sampleRate) / 2;
  const colors = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100;
    return `rgb(${Math.round(22 + 190 * t * t)},${Math.round(28 + 184 * t * t)},${Math.round(38 + 160 * t)})`;
  });
  const step = width / 180;
  frames.forEach((f, x) =>
    f.forEach((v, y) => {
      ctx.fillStyle = colors[Math.round(clamp(v, 0, 1) * 100)];
      ctx.fillRect(
        left + (180 - frames.length + x) * step,
        top + height - ((y + 1) / f.length) * height,
        step + 0.4,
        height / f.length + 0.4,
      );
    }),
  );
  ctx.font = "10px -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  for (const hz of [1000, 5000, 10000, 20000].filter((h) => h < nyquist)) {
    const y = bottom - (hz / nyquist) * height;
    ctx.fillStyle = "#929da9";
    ctx.fillText(hz >= 1000 ? hz / 1000 + "k Hz" : hz + " Hz", 4, y);
    ctx.strokeStyle = "#ffffff0c";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - 14, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#a6b0ba";
  ctx.fillText(
    roomState.isScanning
      ? "Listening live"
      : frames.length
        ? "Scan paused"
        : "Microphone off",
    left,
    18,
  );
  ctx.fillText("18 seconds ago", left, h - 12);
  ctx.textAlign = "right";
  ctx.fillText("Now", w - 14, h - 12);
  ctx.textAlign = "left";
  if (!frames.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#bec5cf";
    ctx.fillText("Start a scan to see the sound around you.", w / 2, h / 2);
    ctx.textAlign = "left";
    return;
  }
  const latest = frames[frames.length - 1];
  ctx.strokeStyle = "#beced9";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  latest.forEach((v, i) => {
    const x = left + (i / (latest.length - 1)) * width,
      y = 32 - v * 22;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.strokeStyle = "#d2dccb";
  ctx.beginPath();
  ctx.moveTo(w - 14, top);
  ctx.lineTo(w - 14, bottom);
  ctx.stroke();
}

function refreshRoomSummary() {
  roomState.summary = buildRoomSummary(
    roomState.rollingFrames,
    roomState.spots,
  );
}

function updateRoomScanFrame() {
  if (!roomState.isScanning || !roomState.analyser) return;
  const now = performance.now();
  if (now - roomState.lastSampleAt < 100) return;
  roomState.lastSampleAt = now;
  const frame = computeRoomFrameSummary();
  if (!frame) return;
  roomState.heatmapFrames.push(frame.compactSpectrum);
  roomState.rollingFrames.push(frame);
  if (roomState.heatmapFrames.length > 180) roomState.heatmapFrames.shift();
  if (roomState.rollingFrames.length > 180) roomState.rollingFrames.shift();
  refreshRoomSummary();
  if (now - roomState.lastUiRefreshAt > 500) {
    roomState.lastUiRefreshAt = now;
    updateRoomUI();
  }
}

let visualActivity = [0, 0, 0];
let visualBands = null;
let visualLoopStarted = false;
let animationId = 0;
function renderFeatureVisuals() {
  updateRoomScanFrame();
  const primary = getSelectedTrack(),
    [left, right] = getComparisonPair();
  if (liveState.isPlaying && liveState.analyser && liveState.timeData) {
    liveState.analyser.getFloatTimeDomainData(liveState.timeData);
    let sum = 0,
      peak = 0;
    for (const v of liveState.timeData) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = Math.sqrt(sum / liveState.timeData.length);
    visualActivity = [clamp(rms * 3, 0, 1), clamp((peak - rms) * 2, 0, 1), 0];
    liveState.analyser.getFloatFrequencyData(liveState.liveFreqData);
    const powers = [0, 0, 0],
      step = audioContext.sampleRate / liveState.analyser.fftSize;
    liveState.liveFreqData.forEach((db, i) => {
      if (i * step <= 16000)
        powers[i * step < 250 ? 0 : i * step < 4000 ? 1 : 2] += 10 ** (db / 10);
    });
    const total = powers.reduce((a, b) => a + b, 0) || 1;
    visualBands = powers.map((v) => Math.sqrt(v / total));
  } else {
    visualActivity = [0, 0, 0];
    visualBands = null;
  }
  const options = {
    ...ui.settings,
    activity: visualActivity,
    liveBands: visualBands,
  };
  if (ui.route === "now") {
    drawGeometricOrb(
      document.querySelector("#hero-orb"),
      buildLiveRenderReport() || primary,
    );
    drawPlayer(playbackPosition());
  }
  if (ui.route === "compare") {
    drawFingerprint(document.querySelector("#compare-left"), left, {
      ...options,
      liveBands: liveState.playingReportId === left?.id ? visualBands : null,
      activity:
        liveState.playingReportId === left?.id ? visualActivity : [0, 0, 0],
    });
    drawFingerprint(document.querySelector("#compare-right"), right, {
      ...options,
      liveBands: liveState.playingReportId === right?.id ? visualBands : null,
      activity:
        liveState.playingReportId === right?.id ? visualActivity : [0, 0, 0],
    });
  }
  if (ui.route === "collision" && left && right)
    drawFingerprint(document.querySelector("#collision-canvas"), left, {
      ...options,
      right,
      similarity: buildCollisionRead(left, right).score,
    });
  if (ui.route === "room")
    drawRoomHeatmap(document.querySelector("#room-heatmap"));
}
function startVisualLoop() {
  if (visualLoopStarted) return;
  visualLoopStarted = true;
  let last = 0,
    reported = false;
  const tick = (now) => {
    if (now - last >= 1000 / 30 && !document.hidden) {
      last = now;
      try {
        renderFeatureVisuals();
        reported = false;
      } catch (error) {
        if (!reported) {
          console.error("Visual rendering failed", error);
          setStatus(
            "The visualization is unavailable. Your analysis is still accessible.",
          );
          reported = true;
        }
      }
    }
    animationId = requestAnimationFrame(tick);
  };
  animationId = requestAnimationFrame(tick);
}

// ─── State helpers ────────────────────────────────────────────────────────────

function getAllReports() {
  return [...state.reports, ...state.derivedReports];
}

function getReportById(id) {
  return getAllReports().find((report) => report.id === id) || null;
}

function getSelectedTrack() {
  return getReportById(state.selectedTrackId) || getAllReports()[0] || null;
}

function getComparisonPair() {
  const reports = getAllReports().filter((report) => !report.isDerived);
  if (reports.length < 2) return [reports[0] || null, null];
  const left = getReportById(state.comparison.leftId) || reports[0];
  const right =
    getReportById(state.comparison.rightId) ||
    reports.find((report) => report.id !== left.id) ||
    reports[1];
  return [left, right];
}

function syncSelectionDefaults() {
  const all = getAllReports();
  const baseReports = all.filter((report) => !report.isDerived);
  if (!all.length) {
    state.selectedTrackId = null;
    state.comparison.leftId = null;
    state.comparison.rightId = null;
    return;
  }
  if (!getReportById(state.selectedTrackId)) state.selectedTrackId = all[0].id;
  if (!baseReports.length) {
    state.comparison.leftId = null;
    state.comparison.rightId = null;
    return;
  }
  if (!baseReports.some((report) => report.id === state.comparison.leftId))
    state.comparison.leftId = baseReports[0].id;
  if (!baseReports.some((report) => report.id === state.comparison.rightId)) {
    state.comparison.rightId = baseReports[1]?.id || baseReports[0].id;
  }
  if (
    baseReports.length > 1 &&
    state.comparison.leftId === state.comparison.rightId
  ) {
    state.comparison.rightId =
      baseReports.find((report) => report.id !== state.comparison.leftId)?.id ||
      baseReports[1].id;
  }
}

function setSelectedTrack(id) {
  if (state.selectedTrackId !== id) {
    stopPlayback();
  }
  state.selectedTrackId = id;
  renderAll();
}

function setComparisonTrack(side, id) {
  if (side === "left") {
    state.comparison.leftId = id;
  } else {
    state.comparison.rightId = id;
  }
  syncSelectionDefaults();
  renderAll();
}

async function startRoomScan() {
  if (roomState.isScanning || roomState.pending) return;
  const availability = getRoomScanAvailability();
  if (!availability.supported) {
    roomState.error = availability.reason;
    updateRoomUI();
    return;
  }
  roomState.pending = true;
  roomState.error = null;
  const requestId = ++roomState.requestId;
  updateRoomUI();
  let stream;
  try {
    await audioContext.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (requestId !== roomState.requestId) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const source = audioContext.createMediaStreamSource(stream),
      analyser = audioContext.createAnalyser();
    analyser.fftSize = roomState.fftSize;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    Object.assign(roomState, {
      stream,
      sourceNode: source,
      analyser,
      freqData: new Float32Array(analyser.frequencyBinCount),
      timeData: new Float32Array(analyser.fftSize),
      previousSpectrum: null,
      heatmapFrames: [],
      rollingFrames: [],
      events: [],
      frameCounter: 0,
      error: null,
      sampleRate: audioContext.sampleRate,
      isScanning: true,
      lastUiRefreshAt: 0,
      lastSampleAt: 0,
    });
    stream.getTracks().forEach((track) =>
      track.addEventListener("ended", () => {
        if (roomState.stream === stream) stopRoomScan();
      }),
    );
    refreshRoomSummary();
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    if (requestId === roomState.requestId)
      roomState.error =
        error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow microphone access in your browser's site settings, then try again."
          : error.name === "NotFoundError"
            ? "No microphone was found. Connect a microphone and try again."
            : "The microphone could not start. Check whether another app is using it, then try again.";
  } finally {
    if (requestId === roomState.requestId) {
      roomState.pending = false;
      updateRoomUI();
    }
  }
}
function stopRoomScan() {
  roomState.requestId++;
  roomState.pending = false;
  roomState.sourceNode?.disconnect();
  roomState.analyser?.disconnect();
  roomState.stream?.getTracks().forEach((t) => t.stop());
  Object.assign(roomState, {
    isScanning: false,
    stream: null,
    sourceNode: null,
    analyser: null,
    freqData: null,
    timeData: null,
    previousSpectrum: null,
  });
  refreshRoomSummary();
  updateRoomUI();
  exportButton.disabled =
    !getAllReports().length && !roomState.rollingFrames.length;
}
function markRoomSpot() {
  if (!roomState.isScanning || !roomState.rollingFrames.length) return;
  const input = document.querySelector("#spot-label");
  const label =
    input?.value.trim().slice(0, 40) || `Spot ${roomState.spots.length + 1}`;
  roomState.spots.push({
    label,
    focusFit: roomState.summary.focusFit,
    chaosScore: roomState.summary.chaosScore,
    speechScore: roomState.summary.speechScore,
    marked_at: new Date().toISOString(),
  });
  roomState.spots = roomState.spots.slice(-6);
  if (input) input.value = "";
  refreshRoomSummary();
  updateRoomUI();
}

// ─── Dashboard rendering ─────────────────────────────────────────────────────

function renderAll() {
  syncSelectionDefaults();
  exportButton.disabled =
    !getAllReports().length && !roomState.rollingFrames.length;
  renderExperience();
  const primary = getSelectedTrack();
  if (orbLabel)
    orbLabel.textContent =
      liveState.isBuilding && liveState.buildMeta
        ? `Mapping ${liveState.buildMeta.name} · ${Math.round(liveState.buildProgress * 100)}%`
        : primary
          ? `${timeLabel(primary.duration_s)} · ${primary.channels === 1 ? "Mono" : "Stereo"} · ${(primary.sample_rate_hz / 1000).toFixed(1)} kHz · Analyzed on your device`
          : "Choose a track to reveal its audio fingerprint.";
  updatePlayBtn();
}

function playbackPosition() {
  const r = getSelectedTrack();
  if (!r) return 0;
  const p =
    liveState.offset +
    (liveState.isPlaying ? audioContext.currentTime - liveState.startedAt : 0);
  return liveState.loop ? p % r.duration_s : Math.min(p, r.duration_s);
}
function updatePlayBtn() {
  if (!orbPlayBtn) return;
  orbPlayBtn.disabled = !getSelectedTrack() || analysisBusy;
  orbPlayBtn.textContent = liveState.isPlaying ? "Ⅱ" : "▶";
  orbPlayBtn.setAttribute("aria-label", liveState.isPlaying ? "Pause" : "Play");
}
function stopPlayback(reset = true) {
  const position = playbackPosition();
  if (liveState.sourceNode) liveState.sourceNode.onended = null;
  try {
    liveState.sourceNode?.stop();
  } catch {}
  liveState.sourceNode?.disconnect();
  liveState.analyser?.disconnect();
  liveState.gain?.disconnect();
  Object.assign(liveState, {
    isPlaying: false,
    playingReportId: null,
    sourceNode: null,
    analyser: null,
    gain: null,
    liveFreqData: null,
    timeData: null,
    offset: reset ? 0 : position,
  });
  updatePlayBtn();
}
async function startPlayback(report) {
  if (!report) return;
  const buffer = liveState.audioBuffers.get(report.id);
  if (!buffer) {
    setStatus("Audio is unavailable. Add this file again to listen.");
    return;
  }
  try {
    await audioContext.resume();
    if (getSelectedTrack()?.id !== report.id) return;
    stopPlayback(false);
    if (liveState.offset >= buffer.duration - 0.01) liveState.offset = 0;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const source = audioContext.createBufferSource(),
      gain = audioContext.createGain();
    source.buffer = buffer;
    source.loop = liveState.loop;
    gain.gain.value = liveState.volume;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(audioContext.destination);
    liveState.startedAt = audioContext.currentTime;
    Object.assign(liveState, {
      analyser,
      gain,
      sourceNode: source,
      isPlaying: true,
      playingReportId: report.id,
      liveFreqData: new Float32Array(analyser.frequencyBinCount),
      timeData: new Float32Array(analyser.fftSize),
    });
    source.onended = () => {
      if (liveState.sourceNode === source) {
        stopPlayback();
      }
    };
    source.start(0, liveState.offset);
    updatePlayBtn();
  } catch (error) {
    stopPlayback(false);
    setStatus("Playback could not start. Try pressing Play again.");
  }
}
function togglePlayback() {
  if (liveState.isPlaying) stopPlayback(false);
  else startPlayback(getSelectedTrack());
}
function seekPlayback(value) {
  const r = getSelectedTrack();
  if (!r) return;
  const playing = liveState.isPlaying;
  stopPlayback();
  liveState.offset = clamp(Number(value) || 0, 0, r.duration_s);
  if (playing) startPlayback(r);
}

// ─── Audio file pipeline ──────────────────────────────────────────────────────

const audioContext = new AudioContext();

async function buildReportFromSignal(
  { name, mono, sampleRate, channels, audioUrl },
  onProgress,
) {
  const frameReport = await analyzeFrames(
    mono,
    sampleRate,
    state.config,
    onProgress,
  );
  const modulation = modulationAnalysis(mono, sampleRate, state.config);
  const embeddings = computeEmbeddings(frameReport.features);
  const segmentation = detectSegments(
    embeddings,
    frameReport.features,
    state.config,
  );
  const symbolic = buildStructuralCodebook(
    frameReport.features,
    embeddings,
    modulation.bands,
    state.config,
  );
  const evidence = buildEvidenceModel(
    frameReport.features,
    modulation.bands,
    symbolic,
    segmentation,
  );
  const advanced = await computeAdvancedBrowserAnalysis(
    mono,
    sampleRate,
    state.config,
  );

  return {
    id: `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    duration_s: mono.length / sampleRate,
    sample_rate_hz: sampleRate,
    channels,
    features: frameReport.features,
    modulationBands: modulation.bands,
    modulationFreqs: modulation.modulationFreqs,
    modulationSpectrum: modulation.modulationSpectrum,
    topPeaks: topPeaks(frameReport.spectrumFreqs, frameReport.averageSpectrum),
    symbolic,
    evidence,
    advanced,
    segmentation,
    averageSpectrum: Array.from(frameReport.averageSpectrum),
    spectrumFreqs: frameReport.spectrumFreqs,
    audio_url: audioUrl,
  };
}

async function decodeFile(file) {
  const arrayBuffer = file.arrayBuffer ? await file.arrayBuffer() : await file;
  return audioContext.decodeAudioData(arrayBuffer.slice(0));
}

async function analyzeFile(file) {
  const buffer = await decodeFile(file);
  if (!buffer.length || !buffer.duration)
    throw new Error("This file has no decodable audio.");
  const mono = downmix(buffer);
  const audioUrl = URL.createObjectURL(file);

  liveState.isBuilding = true;
  liveState.buildProgress = 0;
  liveState.buildSpectrum = null;
  liveState.buildHzPerBin = buffer.sampleRate / state.config.frameSize;
  liveState.buildMeta = {
    name: file.name,
    sampleRate: buffer.sampleRate,
  };
  renderAll();

  let report = null;
  try {
    report = await buildReportFromSignal(
      {
        name: file.name,
        mono,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        audioUrl,
      },
      (partialSpectrum, progress) => {
        liveState.buildSpectrum = partialSpectrum;
        liveState.buildProgress = progress;
        if (orbLabel) {
          orbLabel.textContent = `Constructing ${file.name} · ${Math.round(progress * 100)}%`;
        }
      },
    );
    report.analyzed_at = new Date().toISOString();
    report.waveform = Array.from({ length: 256 }, (_, i) => {
      let peak = 0;
      const start = Math.floor((i * mono.length) / 256),
        end = Math.floor(((i + 1) * mono.length) / 256);
      for (let j = start; j < end; j++)
        peak = Math.max(peak, Math.abs(mono[j]));
      return peak;
    });
    if (buffer.numberOfChannels > 1) {
      const left = buffer.getChannelData(0),
        right = buffer.getChannelData(1);
      let side = 0,
        total = 0;
      for (let i = 0; i < left.length; i++) {
        side += (left[i] - right[i]) ** 2;
        total += left[i] ** 2 + right[i] ** 2;
      }
      report.stereo_width = clamp(side / Math.max(total * 2, 1e-12), 0, 1);
    } else report.stereo_width = 0;
    liveState.audioBuffers.set(report.id, buffer);
    return report;
  } catch (error) {
    URL.revokeObjectURL(audioUrl);
    throw error;
  } finally {
    liveState.isBuilding = false;
    liveState.buildSpectrum = null;
    liveState.buildProgress = 0;
    liveState.buildMeta = null;
    renderAll();
  }
}

async function loadSelectedFiles() {
  if (audioInput.files && audioInput.files.length) return [...audioInput.files];
  return [];
}

function cleanupReportUrls(reports) {
  for (const report of reports) {
    if (report?.audio_url?.startsWith("blob:"))
      URL.revokeObjectURL(report.audio_url);
  }
}

function setStatus(message) {
  statusLine.textContent = message;
  if (headerStatus) headerStatus.textContent = message;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFileList(files) {
  analyzeButton.disabled = analysisBusy || !files?.length;
  if (!fileList) return;
  if (!files || !files.length) {
    fileList.innerHTML = "";
    return;
  }
  fileList.innerHTML = [...files]
    .map(
      (file) => `
        <div class="file-chip">
          <div class="file-chip-dot"></div>
          <div class="file-chip-name">${escapeHtml(file.name)}</div>
          <div class="file-chip-size">${formatBytes(file.size)}</div>
        </div>
      `,
    )
    .join("");
}

// ─── Export ───────────────────────────────────────────────────────────────────

function serializeReport(report) {
  const { audio_url, energy_curve, ...data } = report;
  return {
    ...data,
    state: buildStateEngineering(report),
    energy: buildEnergyRead(report),
    study_sound_coach: buildStudySoundCoach(report),
  };
}
function exportResults() {
  if (!getAllReports().length && !roomState.rollingFrames.length) {
    setStatus("Analyze a sound or scan a room before exporting.");
    return;
  }
  try {
    const [left, right] = getComparisonPair();
    const payload = {
      schema_version: 2,
      created_at: new Date().toISOString(),
      config: state.config,
      active_track_id: getSelectedTrack()?.id || null,
      reports: getAllReports().map(serializeReport),
      comparison:
        left && right
          ? {
              left_id: left.id,
              right_id: right.id,
              readout: buildCompareRead(left, right),
              collision: buildCollisionRead(left, right),
            }
          : null,
      playlist_cleanser: buildPlaylistCleanser(getAllReports()),
      room_scan:
        roomState.rollingFrames.length || roomState.spots.length
          ? {
              summary: roomState.summary,
              spots: roomState.spots,
              task_fit: roomState.rollingFrames.length
                ? buildRoomScanAdvice(roomState.summary)
                : null,
            }
          : null,
      interpretation:
        "State, task-fit and similarity scores are acoustic heuristics; they do not measure cognitive or physiological effects.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dreamscape-analysis.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ui.exports.unshift(new Date().toLocaleString());
    setStatus("Analysis JSON downloaded.");
    if (ui.route === "exports") renderExperience();
  } catch (error) {
    setStatus("The export could not be created. Please try again.");
  }
}

let analysisBusy = false;
async function runAnalysis() {
  if (analysisBusy) return;
  const files = await loadSelectedFiles();
  if (!files.length) {
    setStatus("Choose one or more audio files first.");
    return;
  }
  if (
    files.some(
      (file) => !file.size || !/\.(mp3|wav|m4a|ogg|aac)$/i.test(file.name),
    )
  ) {
    setStatus(
      "Choose supported audio: MP3, WAV, M4A, OGG or AAC. Empty files cannot be analyzed.",
    );
    return;
  }
  analysisBusy = true;
  analyzeButton.disabled = true;
  audioInput.disabled = true;
  const reports = [];
  try {
    stopPlayback();
    for (const file of files) {
      setStatus(`Mapping sound: ${file.name}`);
      reports.push(await analyzeFile(file));
    }
    state.reports.push(...reports);
    state.selectedTrackId = reports[0].id;
    ui.history.unshift(
      ...reports.map((r) => ({
        id: r.id,
        name: r.name,
        date: r.analyzed_at,
        duration: r.duration_s,
      })),
    );
    audioInput.value = "";
    renderFileList([]);
    setStatus(
      `Analysis complete for ${reports.length} sound${reports.length === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    cleanupReportUrls(reports);
    reports.forEach((r) => liveState.audioBuffers.delete(r.id));
    setStatus(
      "This audio could not be analyzed. Try another file or convert it to WAV or MP3. Your previous analyses are still available.",
    );
  } finally {
    analysisBusy = false;
    audioInput.disabled = false;
    analyzeButton.disabled = !audioInput.files?.length;
    renderAll();
  }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

analyzeButton.addEventListener("click", runAnalysis);
exportButton.addEventListener("click", exportResults);
if (orbPlayBtn) orbPlayBtn.addEventListener("click", togglePlayback);

audioInput.addEventListener("change", () => {
  renderFileList(audioInput.files);
});

if (dropZone) {
  const body = document.body;
  body.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  body.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) dropZone.classList.remove("drag-over");
  });
  body.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (analysisBusy) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const dt = new DataTransfer();
    [...files]
      .filter((f) => /\.(mp3|wav|m4a|ogg|aac)$/i.test(f.name))
      .forEach((f) => dt.items.add(f));
    if (dt.files.length) {
      audioInput.files = dt.files;
      renderFileList(dt.files);
      location.hash = "now";
    } else
      setStatus(
        "That file type is not supported. Choose MP3, WAV, M4A, OGG or AAC.",
      );
  });
}

trackResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "focus-track") {
    setSelectedTrack(button.dataset.trackId);
  } else if (button.dataset.action === "set-compare-left") {
    setComparisonTrack("left", button.dataset.trackId);
  } else if (button.dataset.action === "set-compare-right") {
    setComparisonTrack("right", button.dataset.trackId);
  } else if (button.dataset.action === "start-room-scan") {
    startRoomScan();
  } else if (button.dataset.action === "stop-room-scan") {
    stopRoomScan();
  } else if (button.dataset.action === "mark-room-spot") {
    markRoomSpot();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

refreshRoomSummary();
mountExperience({
  reports: getAllReports,
  active: getSelectedTrack,
  pair: getComparisonPair,
  select: setSelectedTrack,
  selectPair: setComparisonTrack,
  metrics: summarizeReportMetrics,
  stateScore: buildStateEngineering,
  energy: buildEnergyRead,
  coach: buildStudySoundCoach,
  collision: buildCollisionRead,
  cleanser: buildPlaylistCleanser,
  room: roomState,
  roomAdvice: buildRoomScanAdvice,
  roomAvailability: getRoomScanAvailability,
  live: liveState,
  export: exportResults,
});
document
  .querySelector("#seek")
  .addEventListener("input", (e) => seekPlayback(e.target.value));
document
  .querySelector("#restart-button")
  .addEventListener("click", () => seekPlayback(0));
document.querySelector("#volume").addEventListener("input", (e) => {
  liveState.volume = Number(e.target.value);
  if (liveState.gain)
    liveState.gain.gain.setTargetAtTime(
      liveState.volume,
      audioContext.currentTime,
      0.03,
    );
});
document.querySelector("#loop-button").addEventListener("click", (e) => {
  liveState.loop = !liveState.loop;
  if (liveState.sourceNode) liveState.sourceNode.loop = liveState.loop;
  e.currentTarget.setAttribute("aria-pressed", String(liveState.loop));
});
window.addEventListener("pagehide", () => {
  stopPlayback();
  stopRoomScan();
  cancelAnimationFrame(animationId);
  visualLoopStarted = false;
  disposeDetachedOrbs(true);
  audioContext.suspend();
});
window.addEventListener("pageshow", () => startVisualLoop());
refreshRoomSummary();
renderAll();
startVisualLoop();
