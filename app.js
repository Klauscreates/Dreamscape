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
  visuals: {
    artifact: { yaw: 0.32, pitch: 0.18, zoom: 1, dragging: false, lastX: 0, lastY: 0 },
    collision: { yaw: 0.18, pitch: -0.12, zoom: 1, dragging: false, lastX: 0, lastY: 0 },
  },
};

window.__quantumSoundLab = { state };

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

function lerp(a, b, t) { return a + (b - a) * t; }

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function normalizeScore(value, minimum, maximum) {
  if (maximum === minimum) return 0;
  return clamp((value - minimum) / (maximum - minimum), 0, 1);
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
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

function createMelFilterBank(sampleRate, fftSize, bandCount = 24, lowHz = 40, highHz = 8000) {
  const nyquist = sampleRate / 2;
  const maxHz = Math.min(highHz, nyquist);
  const lowMel = hzToMel(lowHz);
  const highMel = hzToMel(maxHz);
  const melPoints = Array.from({ length: bandCount + 2 }, (_, index) =>
    lowMel + ((highMel - lowMel) * index) / (bandCount + 1)
  );
  const hzPoints = melPoints.map(melToHz);
  const bins = hzPoints.map((hz) => Math.floor((fftSize + 1) * hz / sampleRate));
  const filters = Array.from({ length: bandCount }, () => new Float64Array(fftSize / 2 + 1));

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
  const labels = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const majorTemplate = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorTemplate = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const total = chroma.reduce((sum, value) => sum + value, 0) || 1;
  const normalized = chroma.map((value) => value / total);
  let best = { key: "Unknown", scale: "unknown", strength: 0 };

  for (let shift = 0; shift < 12; shift += 1) {
    const majorScore = normalized.reduce(
      (sum, value, index) => sum + value * majorTemplate[(index - shift + 12) % 12],
      0
    );
    if (majorScore > best.strength) {
      best = { key: labels[shift], scale: "major", strength: majorScore };
    }
    const minorScore = normalized.reduce(
      (sum, value, index) => sum + value * minorTemplate[(index - shift + 12) % 12],
      0
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
      for (let dim = 0; dim < meanVector.length; dim += 1) meanVector[dim] += row[dim];
    }
    for (let dim = 0; dim < meanVector.length; dim += 1) meanVector[dim] /= slice.length;
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

function computeAdvancedBrowserAnalysis(signal, sampleRate, config) {
  const frameSize = config.frameSize;
  const hopSize = config.hopSize;
  const window = new Float32Array(frameSize);
  for (let index = 0; index < frameSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
  }
  const frames = extractFrames(signal, frameSize, hopSize);
  const hzPerBin = sampleRate / frameSize;
  const melFilters = createMelFilterBank(sampleRate, frameSize, 24);
  const meanChroma = new Float64Array(12);
  const meanHpcp = new Float64Array(36);
  const cqtLike = new Float64Array(48);
  const mfccFrames = [];
  const chromaFrames = [];

  for (const source of frames) {
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
      for (let bin = 0; bin < filter.length; bin += 1) total += power[bin] * filter[bin];
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
    for (let index = 0; index < 12; index += 1) meanChroma[index] += chromaFrame[index];
    for (let index = 0; index < 36; index += 1) meanHpcp[index] += hpcpFrame[index];
    for (let index = 0; index < 48; index += 1) cqtLike[index] += cqtFrame[index];
  }

  const normalize = (arrayLike) => {
    const total = Array.from(arrayLike).reduce((sum, value) => sum + value, 0) || 1;
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
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
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
      if (index > 0 && Math.sign(source[index]) !== Math.sign(source[index - 1])) {
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
    const attackStrength = Math.max(0, flux) * Math.max(0, Math.sqrt(rmsSum / frameSize));

    features.push({
      time_s: (frameIndex * hopSize) / sampleRate,
      rms: Math.sqrt(rmsSum / frameSize),
      zcr: zcr / frameSize,
      spectral_centroid_hz: centroid,
      spectral_spread_hz: Math.sqrt(spreadNumerator / Math.max(powerSum, 1e-12)),
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
    spectrumFreqs: Array.from({ length: averageSpectrum.length }, (_, index) => index * hzPerBin),
  };
}

function modulationAnalysis(signal, sampleRate, config) {
  const step = Math.max(1, Math.floor(sampleRate / Math.max(config.modulationResampleHz, 1)));
  const coarse = [];
  for (let index = 0; index < signal.length; index += step) {
    const slice = signal.subarray(index, Math.min(signal.length, index + step));
    coarse.push(mean(Array.from(slice, (value) => Math.abs(value))));
  }
  const centered = coarse.map((value) => value - mean(coarse));
  const spectrum = fftReal(Float32Array.from(centered));
  const actualRate = sampleRate / step;
  const freqStep = actualRate / Math.max((spectrum.length - 1) * 2, 1);
  const freqs = Array.from({ length: spectrum.length }, (_, index) => index * freqStep);
  const totalPower = spectrum.reduce((sum, value) => sum + value * value, 0) || 1;
  const bands = {};

  for (const [name, [low, high]] of Object.entries(BRAIN_BANDS)) {
    let bandPower = 0;
    for (let index = 0; index < freqs.length; index += 1) {
      if (freqs[index] >= low && freqs[index] < high) bandPower += spectrum[index] * spectrum[index];
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
    stdevs[col] = Math.sqrt(mean(matrix.map((row) => (row[col] - means[col]) ** 2))) || 1;
  }
  return matrix.map((row) => row.map((value, col) => (value - means[col]) / stdevs[col]));
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
  for (let componentIndex = 0; componentIndex < Math.min(3, dims); componentIndex += 1) {
    const { vector, eigenvalue } = powerIteration(working);
    if (!vector.length) break;
    components.push(vector);
    for (let i = 0; i < dims; i += 1) {
      for (let j = 0; j < dims; j += 1) {
        working[i][j] -= eigenvalue * vector[i] * vector[j];
      }
    }
  }

  return standardized.map((row) => components.map((component) => dot(row, component)));
}

function detectSegments(embeddings, features, config) {
  const novelty = embeddings.map((_, index) => {
    if (index === 0 || index === embeddings.length - 1) return 0;
    const prev = embeddings[index - 1];
    const current = embeddings[index];
    const next = embeddings[index + 1];
    const left = Math.sqrt(current.reduce((sum, value, dim) => sum + (value - prev[dim]) ** 2, 0));
    const right = Math.sqrt(current.reduce((sum, value, dim) => sum + (value - next[dim]) ** 2, 0));
    return left + right;
  });
  const threshold = percentile(novelty, config.segmentationQuantile);
  const boundaries = [];
  let lastBoundary = -999;

  for (let index = 1; index < novelty.length - 1; index += 1) {
    if (novelty[index] >= threshold && novelty[index] >= novelty[index - 1] && novelty[index] >= novelty[index + 1]) {
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
    const distance = Math.sqrt(value.reduce((sum, item, dim) => sum + (item - centers[index][dim]) ** 2, 0));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function buildStructuralCodebook(features, embeddings, bandWeights, config) {
  const clusterCount = Math.max(4, Math.min(8, Math.round(Math.sqrt(Math.max(embeddings.length, 1) / 24))));
  let centers = embeddings.slice(0, clusterCount).map((row) => [...row]);
  if (!centers.length) centers = [[0, 0, 0]];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const buckets = Array.from({ length: centers.length }, () => []);
    for (const row of embeddings) {
      buckets[nearestCode(row, centers)].push(row);
    }
    centers = centers.map((center, index) => {
      if (!buckets[index].length) return center;
      return center.map((_, dim) => mean(buckets[index].map((row) => row[dim])));
    });
  }

  const modulationLabel = Object.entries(BRAIN_BANDS)
    .sort((left, right) => (bandWeights[right[0]] || 0) - (bandWeights[left[0]] || 0))[0][0]
    .toUpperCase()
    .slice(0, 3);

  const attackThreshold = percentile(features.map((item) => item.attack_strength), 0.8);
  const phaseThreshold = percentile(features.map((item) => item.phase_lock), 0.66);
  const tokens = embeddings.map((row, index) => {
    const cluster = nearestCode(row, centers);
    const attack = features[index].attack_strength > attackThreshold ? "A1" : "A0";
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
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const probabilities = [...frequencies.values()].map((count) => count / Math.max(tokens.length, 1));
  const entropy = -probabilities.reduce((sum, probability) => sum + probability * Math.log2(Math.max(probability, 1e-12)), 0);
  const maxEntropy = Math.log2(Math.max(frequencies.size, 2));

  return {
    tokens,
    cluster_count: centers.length,
    unique_token_count: frequencies.size,
    sequence_entropy: entropy / Math.max(maxEntropy, 1),
    compression_ratio: tokens.length ? new Blob([tokens.join(" ")]).size / Math.max(tokens.length * 12, 1) : 0,
    top_motifs: motifs,
  };
}

function buildEvidenceModel(features, modulationBands, codebook, segmentation) {
  const phaseStability = mean(features.map((item) => item.phase_lock));
  const attackStrengths = features.map((item) => item.attack_strength);
  const attackThreshold = percentile(attackStrengths, 0.85);
  const attackDensity = attackStrengths.filter((value) => value >= attackThreshold).length / Math.max(attackStrengths.length, 1);
  const head = features.slice(0, Math.max(1, Math.floor(features.length / 3)));
  const tail = features.slice(Math.max(0, Math.floor((2 * features.length) / 3)));
  const timbralDrift = Math.abs(
    mean(head.map((item) => item.spectral_centroid_hz)) - mean(tail.map((item) => item.spectral_centroid_hz))
  );
  const repetitionIndex = 1 - codebook.sequence_entropy;
  const dominantModulation = modulationBands.dominant_modulation_hz;

  const descriptors = [];
  if (repetitionIndex > 0.45) descriptors.push("high structural repetition");
  if (phaseStability > 0.82) descriptors.push("stable phase field");
  if (attackDensity > 0.12) descriptors.push("dense transient clusters");
  if (timbralDrift > 60) descriptors.push("strong timbral drift");
  if (dominantModulation > 0.5 && dominantModulation < 4) descriptors.push("slow envelope pulsing");
  if (segmentation.boundaries.length >= 3) descriptors.push("clear section boundaries");
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
    note:
      "These outputs are measurement-driven structural evidence derived from recurrence, transients, modulation, and phase behavior. They are not claims of literal semantic decoding.",
  };
}

function topPeaks(freqs, spectrum) {
  const entries = [];
  for (let index = 2; index < spectrum.length - 2; index += 1) {
    const local = spectrum[index];
    const prominence = local - 0.5 * (spectrum[index - 1] + spectrum[index + 1]);
    if (prominence <= 0) continue;
    entries.push({ freq_hz: freqs[index], strength: local, prominence });
  }
  return entries.sort((left, right) => right.prominence - left.prominence).slice(0, 10);
}

// ─── Feature interpretation ───────────────────────────────────────────────────

function summarizeReportMetrics(report) {
  const centroidMean = mean(report.features.map((item) => item.spectral_centroid_hz));
  const flatnessMean = mean(report.features.map((item) => item.spectral_flatness));
  const spreadMean = mean(report.features.map((item) => item.spectral_spread_hz));
  const fluxMean = mean(report.features.map((item) => item.spectral_flux));
  const attackMean = mean(report.features.map((item) => item.attack_strength));
  const zcrMean = mean(report.features.map((item) => item.zcr));
  const phaseMean = mean(report.features.map((item) => item.phase_lock));
  const rmsMean = mean(report.features.map((item) => item.rms));
  const attackDensity = report.evidence.scores.attack_density || 0;
  const repetitionIndex = report.evidence.scores.repetition_index || 0;
  const modulationHz = report.modulationBands.dominant_modulation_hz || 0;
  const dominantPeak = report.topPeaks[0]?.freq_hz || 0;
  const recurrenceAffinity = report.advanced?.recurrence_mean_affinity || 0;
  const keyStrength = report.advanced?.key_strength || 0;
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

function getDominantBand(report) {
  if (!report) return "n/a";
  return Object.keys(BRAIN_BANDS).sort((left, right) => report.modulationBands[right] - report.modulationBands[left])[0];
}

function classifyTimbreSignature(report) {
  const centroidMean = mean(report.features.map((item) => item.spectral_centroid_hz));
  const flatnessMean = mean(report.features.map((item) => item.spectral_flatness));
  const spreadMean = mean(report.features.map((item) => item.spectral_spread_hz));
  const dominantPeak = report.topPeaks[0]?.freq_hz || 0;
  const descriptors = [];

  if (centroidMean >= 2800) descriptors.push("celestial shimmer");
  else if (centroidMean >= 1400) descriptors.push("luminous air");
  else descriptors.push("grounded resonance");

  if (flatnessMean >= 0.42) descriptors.push("grain-rich vibration");
  else if (flatnessMean >= 0.2) descriptors.push("balanced overtone field");
  else descriptors.push("pure-tone stability");

  if (spreadMean >= 2600) descriptors.push("wide spectral halo");
  else descriptors.push("focused harmonic core");

  if (dominantPeak <= 180 && dominantPeak > 0) descriptors.push("deep drone anchor");
  else if (dominantPeak >= 1600) descriptors.push("high-frequency shimmer band");

  return {
    label: descriptors.join(", "),
    centroid_mean_hz: centroidMean,
    flatness_mean: flatnessMean,
    spread_mean_hz: spreadMean,
    dominant_peak_hz: dominantPeak,
    dominant_band: getDominantBand(report),
  };
}

function analyzeUniversalTuning(report) {
  const peaks = report.topPeaks
    .map((peak) => peak.freq_hz)
    .filter((value) => value >= 40 && value <= 2000);
  const references = [432, 440, 528];
  const matches = peaks
    .map((peak) => {
      const candidates = references.map((reference) => {
        const multiplier = Math.max(1, Math.round(peak / reference));
        const target = reference * multiplier;
        const cents = 1200 * Math.log2(peak / target);
        return {
          reference_hz: reference,
          harmonic_multiple: multiplier,
          target_hz: Number(target.toFixed(2)),
          cents_off: Number(cents.toFixed(2)),
          absolute_cents: Math.abs(cents),
          observed_peak_hz: peak,
        };
      });
      return candidates.sort((left, right) => left.absolute_cents - right.absolute_cents)[0];
    })
    .sort((left, right) => left.absolute_cents - right.absolute_cents)
    .slice(0, 6);

  return { strongest_match: matches[0] || null, matches };
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
  if (second && best.score - second.score < 0.22) return `${best.label} with ${second.label.toLowerCase()} traits`;
  return best.label;
}

function describeSoundQuality(report) {
  const metrics = summarizeReportMetrics(report);
  const peaks = report.topPeaks.map((item) => item.freq_hz).slice(0, 6);
  let dissonanceHint = "stable harmonic spacing";

  for (let index = 0; index < peaks.length; index += 1) {
    for (let compare = index + 1; compare < peaks.length; compare += 1) {
      const cents = Math.abs(1200 * Math.log2(peaks[compare] / peaks[index]));
      const wrapped = Math.min(cents % 1200, 1200 - (cents % 1200));
      if (wrapped > 70 && wrapped < 130) {
        dissonanceHint = "close-frequency clash detected";
        break;
      }
    }
  }

  const brightness = metrics.centroidMean >= 2400 ? "Bright" : metrics.centroidMean >= 1300 ? "Balanced" : "Dark";
  const texture =
    metrics.flatnessMean >= 0.35
      ? "Harsh / Gritty"
      : metrics.flatnessMean >= 0.18
        ? "Clouded / Noisy"
        : metrics.attackDensity > 0.15 && metrics.zcrMean > 0.06
          ? "Heavy / Distorted"
          : "Warm / Pure";
  const harmonicField =
    metrics.keyStrength >= 0.34
      ? `key field favors ${(report.advanced?.estimated_key || "n/a")} ${(report.advanced?.estimated_scale || "")}`.trim()
      : "key field is ambiguous";
  return { brightness, texture, dissonance: dissonanceHint, harmonicField };
}

function describeTuningLabel(report) {
  const tuning = analyzeUniversalTuning(report);
  const best = tuning.strongest_match;
  if (!best) return "Undetermined";
  if (best.reference_hz === 432 && best.absolute_cents <= 12) return "Earth-Tuned (432Hz family)";
  if (best.reference_hz === 440 && best.absolute_cents <= 12) return "Standard Concert Tuning (440Hz family)";
  if (best.reference_hz === 528 && best.absolute_cents <= 18) return "528Hz-adjacent harmonic family";
  return `Closest to ${best.reference_hz}Hz family`;
}

function buildHumanReadout(report) {
  const cosmic = classifyTimbreSignature(report);
  const quality = describeSoundQuality(report);
  const dominantBand = getDominantBand(report);
  let bodyState = "Open Listening";
  if (dominantBand === "beta" || dominantBand === "gamma") bodyState = "Focus Mode";
  else if (dominantBand === "alpha" || dominantBand === "theta") bodyState = "Meditation / Trance";
  else if (dominantBand === "delta") bodyState = "Grounded / Heavy Drift";

  return {
    vibe: describeVibe(report),
    quality: `${quality.brightness} • ${quality.texture}`,
    body: bodyState,
    tuning: describeTuningLabel(report),
    spiritual: cosmic.label,
    details: {
      harmony_alignment: quality.dissonance === "stable harmonic spacing" ? "Aligned" : "Tension present",
      dissonance: quality.dissonance,
      harmonic_field: quality.harmonicField,
    },
  };
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
    100
  );
  const focus = clamp(
    22 +
      normalizeScore(metrics.phaseMean, 0.4, 0.95) * 30 +
      normalizeScore(metrics.repetitionIndex, 0.02, 0.45) * 18 +
      normalizeScore(metrics.modulationHz, 5, 14) * 10 -
      normalizeScore(metrics.attackDensity, 0.05, 0.24) * 14 -
      normalizeScore(metrics.flatnessMean, 0.08, 0.42) * 8,
    0,
    100
  );
  const chill = clamp(
    26 +
      normalizeScore(metrics.phaseMean, 0.45, 0.95) * 20 +
      normalizeScore(1500 - metrics.centroidMean, -1800, 1200) * 16 +
      normalizeScore(0.18 - metrics.attackDensity, -0.1, 0.16) * 20 +
      normalizeScore(8 - metrics.modulationHz, -10, 5) * 12 -
      normalizeScore(metrics.rmsMean, 0.05, 0.25) * 10,
    0,
    100
  );

  let adjustedHype = hype;
  let adjustedFocus = focus;
  let adjustedChill = chill;

  if (vibe.includes("rage") || vibe.includes("aggressive")) adjustedHype += 18;
  if (vibe.includes("rage") || vibe.includes("aggressive")) adjustedChill -= 18;
  if (vibe.includes("anxious") || vibe.includes("tense")) adjustedHype += 10;
  if (vibe.includes("meditative") || vibe.includes("trance")) adjustedChill += 16;
  if (vibe.includes("chill") || vibe.includes("spacey")) adjustedChill += 18;
  if (vibe.includes("driving") || vibe.includes("ritual")) adjustedFocus += 10;

  if (energy.label === "Explosive") adjustedHype += 16;
  else if (energy.label === "Aggressive") adjustedHype += 12;
  else if (energy.label === "Driving") adjustedFocus += 8;
  else if (energy.label === "Calm" || energy.label === "Soft") adjustedChill += 10;

  const entries = [
    { label: "Hype", score: Math.round(clamp(adjustedHype, 0, 100)) },
    { label: "Focus", score: Math.round(clamp(adjustedFocus, 0, 100)) },
    { label: "Chill", score: Math.round(clamp(adjustedChill, 0, 100)) },
  ].sort((left, right) => right.score - left.score);

  const top = entries[0];
  let verdict = `${top.score}% ${top.label} profile`;
  let guidance = "Balanced enough to move between work, transit, and casual listening.";

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
    100
  );
  const shockScore = clamp(
    normalizeScore(dynamicLift, 0.01, 0.16) * 55 +
      normalizeScore(metrics.attackMean, 0.002, 0.16) * 45,
    0,
    100
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
      summary: "Upload a second track and this card will explain where they diverge in brightness, impact, repetition, and pulse.",
      stats: [],
    };
  }

  const leftMetrics = summarizeReportMetrics(left);
  const rightMetrics = summarizeReportMetrics(right);
  const brighter = leftMetrics.centroidMean >= rightMetrics.centroidMean ? left : right;
  const harder = leftMetrics.attackDensity >= rightMetrics.attackDensity ? left : right;
  const steadier = leftMetrics.repetitionIndex >= rightMetrics.repetitionIndex ? left : right;
  const rougher = leftMetrics.zcrMean >= rightMetrics.zcrMean ? left : right;
  const brightnessGap = Math.abs(leftMetrics.centroidMean - rightMetrics.centroidMean);
  const attackGap = Math.abs(leftMetrics.attackDensity - rightMetrics.attackDensity);
  const repetitionGap = Math.abs(leftMetrics.repetitionIndex - rightMetrics.repetitionIndex);
  const recurrenceGap = Math.abs(leftMetrics.recurrenceAffinity - rightMetrics.recurrenceAffinity);
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
        note: attackGap < 0.0005 ? "Virtually tied on attack density" : `${harder.name} hits harder`,
      },
      {
        label: "Pattern Lock",
        value: repetitionGap < 0.0005 ? "< 0.001" : repetitionGap.toFixed(3),
        note: repetitionGap < 0.0005 ? "Virtually tied on repetition" : `${steadier.name} repeats more tightly`,
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
      summary: "Load two songs and the experimental collision engine will estimate whether the signatures merge, wobble, or clash.",
    };
  }

  const leftMetrics = summarizeReportMetrics(left);
  const rightMetrics = summarizeReportMetrics(right);
  const centroidDistance = normalizeScore(Math.abs(leftMetrics.centroidMean - rightMetrics.centroidMean), 0, 3200);
  const modulationDistance = normalizeScore(Math.abs(leftMetrics.modulationHz - rightMetrics.modulationHz), 0, 14);
  const phaseDistance = normalizeScore(Math.abs(leftMetrics.phaseMean - rightMetrics.phaseMean), 0, 0.8);
  const repetitionDistance = normalizeScore(Math.abs(leftMetrics.repetitionIndex - rightMetrics.repetitionIndex), 0, 0.4);
  const peakDistance = normalizeScore(
    Math.abs((left.topPeaks[0]?.freq_hz || 0) - (right.topPeaks[0]?.freq_hz || 0)),
    0,
    1800
  );
  const harmonyScore = Math.round(
    clamp(100 - (centroidDistance * 26 + modulationDistance * 20 + phaseDistance * 18 + repetitionDistance * 16 + peakDistance * 20), 0, 100)
  );

  let label = "Hard Clash";
  let summary = "The signatures collide with a lot of mismatch, so the visual should feel unstable and shard-heavy.";
  if (harmonyScore >= 74) {
    label = "Clean Merge";
    summary = "The signatures line up well enough to merge into a shared glowing core instead of breaking apart.";
  } else if (harmonyScore >= 48) {
    label = "Unstable Blend";
    summary = "The signatures partially merge but keep fighting each other, which should read as wobble and intermittent fracture.";
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
    100
  );
  const writing = clamp(
    28 +
      normalizeScore(metrics.phaseMean, 0.42, 0.92) * 18 +
      normalizeScore(metrics.repetitionIndex, 0.02, 0.38) * 18 +
      normalizeScore(0.18 - metrics.attackDensity, -0.1, 0.14) * 16 +
      normalizeScore(10 - metrics.modulationHz, -10, 7) * 12,
    0,
    100
  );
  const coding = clamp(
    26 +
      normalizeScore(stateScore.entries.find((entry) => entry.label === "Focus")?.score || 0, 35, 95) * 34 +
      normalizeScore(metrics.repetitionIndex, 0.03, 0.45) * 18 +
      normalizeScore(metrics.phaseMean, 0.45, 0.94) * 12 +
      normalizeScore(metrics.rmsMean, 0.03, 0.17) * 8 -
      normalizeScore(metrics.flatnessMean, 0.14, 0.44) * 8,
    0,
    100
  );
  const memorization = clamp(
    30 +
      normalizeScore(metrics.repetitionIndex, 0.04, 0.45) * 22 +
      normalizeScore(0.17 - metrics.attackDensity, -0.1, 0.14) * 18 +
      normalizeScore(metrics.phaseMean, 0.45, 0.95) * 16 +
      normalizeScore(7 - Math.abs(metrics.modulationHz - 6), -7, 7) * 10,
    0,
    100
  );
  const recovery = clamp(
    24 +
      normalizeScore(stateScore.entries.find((entry) => entry.label === "Chill")?.score || 0, 35, 95) * 32 +
      normalizeScore(0.16 - metrics.attackDensity, -0.1, 0.14) * 18 +
      normalizeScore(1500 - metrics.centroidMean, -2500, 1600) * 14 +
      normalizeScore(0.16 - metrics.rmsMean, -0.18, 0.12) * 12,
    0,
    100
  );

  const tasks = [
    {
      label: "Reading",
      score: Math.round(reading),
      note: reading >= 70 ? "Steady enough to sit behind dense material without constantly poking your attention." : "May add more motion than dense reading usually wants.",
    },
    {
      label: "Writing",
      score: Math.round(writing),
      note: writing >= 70 ? "Patterned enough to keep you moving while leaving room for language generation." : "Could push too hard or wander too much for drafting.",
    },
    {
      label: "Coding",
      score: Math.round(coding),
      note: coding >= 70 ? "Locks into task cadence well and carries enough drive for longer focus blocks." : "Structure is weaker or rougher than ideal for long implementation sessions.",
    },
    {
      label: "Memorization",
      score: Math.round(memorization),
      note: memorization >= 70 ? "Repeats and breathes in a way that supports recall rather than surprise." : "Too jumpy or too shapeless to be ideal for flashcards and retention.",
    },
    {
      label: "Recovery",
      score: Math.round(recovery),
      note: recovery >= 70 ? "This one cools the system down and gives your attention a chance to unclench." : "Still carries too much tension or motion for real recovery.",
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
  if (energy.label === "Explosive" || energy.label === "Aggressive") cautionFlags.push("impact-heavy");
  if (metrics.attackDensity > 0.14) cautionFlags.push("transient-spiky");
  if (metrics.spreadMean > 1900 || metrics.flatnessMean > 0.28) cautionFlags.push("texture-distracting");
  if (metrics.modulationHz > 10) cautionFlags.push("fast-pulsing");
  if (metrics.recurrenceAffinity > 0.58) cautionFlags.push("high recurrence lock");
  cautionFlags.push(harmonicField);
  if (!cautionFlags.length) cautionFlags.push("stable-background");

  return { headline, summary, tasks, cautionFlags };
}

function buildPlaylistCleanser(reports) {
  if (!reports.length) {
    return {
      headline: "Load a playlist to audit it.",
      summary: "Dreamscape will flag the tracks that are most likely to break concentration.",
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
      100
    );
    const studySupport = clamp(
      normalizeScore(stateScore.entries.find((entry) => entry.label === "Focus")?.score || 0, 35, 95) * 36 +
        normalizeScore(metrics.phaseMean, 0.42, 0.94) * 18 +
        normalizeScore(metrics.repetitionIndex, 0.02, 0.45) * 18 +
        normalizeScore(0.18 - metrics.attackDensity, -0.1, 0.16) * 14 +
        normalizeScore(0.18 - metrics.flatnessMean, -0.2, 0.14) * 14,
      0,
      100
    );

    const tags = [];
    if (studyBreak >= 62) tags.push({ label: "breaks focus", tone: "warn" });
    if (shock >= 60) tags.push({ label: "spike-heavy", tone: "warn" });
    if (metrics.centroidMean > 2400 || metrics.spreadMean > 2100) tags.push({ label: "top-end busy", tone: "warn" });
    if (studySupport >= 64) tags.push({ label: "holds concentration", tone: "good" });
    if (metrics.repetitionIndex >= 0.18) tags.push({ label: "pattern-locked", tone: "good" });
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

  const riskiest = [...tracks].sort((left, right) => right.disruption - left.disruption)[0];
  const safest = [...tracks].sort((left, right) => right.support - left.support)[0];
  const sorted = [...tracks].sort((left, right) => (right.disruption - right.support) - (left.disruption - left.support));

  return {
    headline: reports.length > 1 ? "Playlist Cleanser active." : "Single-track cleanser preview.",
    summary: safest && riskiest
      ? `${safest.name} is the safest study hold. ${riskiest.name} is the most likely to snap concentration.`
      : "Load more tracks to compare study safety across a playlist.",
    tracks: sorted,
    safest,
    riskiest,
  };
}

function bucketAverage(values, start, end) {
  const safeStart = Math.max(0, Math.floor(start));
  const safeEnd = Math.min(values.length, Math.max(safeStart + 1, Math.ceil(end)));
  let total = 0;
  for (let index = safeStart; index < safeEnd; index += 1) total += values[index];
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
      reason: "Room Scan needs a secure context. Open Dreamscape on localhost or HTTPS to use the microphone.",
    };
  }
  if (location.protocol === "file:") {
    return {
      supported: false,
      reason: "Room Scan is blocked on file:// in most browsers. Start the local server and open Dreamscape on http://127.0.0.1:8000.",
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
    let bestSeat = "Mark multiple spots while walking around to find the calmest seat.";
    if (spots.length >= 2) {
      const sortedSpots = [...spots].sort((left, right) => left.focusFit - right.focusFit);
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
      hiddenNoises: ["Microphone input is off, so there is no room signature to inspect yet."],
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
  const focusFit = Math.round(clamp(100 - (chaosScore * 0.5 + speechScore * 0.28 + rumbleScore * 0.18), 0, 100));

  let roomTone = "Calm and work-friendly.";
  if (chaosScore >= 70) roomTone = "Chaotic and interruption-heavy.";
  else if (speechScore >= 62) roomTone = "Speech-contaminated and socially busy.";
  else if (rumbleScore >= 60) roomTone = "Low-end heavy and physically fatiguing.";
  else if (focusFit >= 72) roomTone = "Steady enough for reading, coding, and longer focus blocks.";

  const hiddenNoises = [];
  if (humScore >= 0.34) hiddenNoises.push("Persistent low hum suggests HVAC, AC, or building systems.");
  if (buzzScore >= 0.26) hiddenNoises.push("A bright narrow buzz suggests fluorescent lighting, chargers, or electronics.");
  if (speechScore >= 48) hiddenNoises.push("Voice-range activity is present, even if the room does not feel obviously loud.");
  if (keyboardScore >= 0.22) hiddenNoises.push("Short high-frequency clicks resemble keyboard chatter or utensil/clatter noise.");
  if (slamScore >= 0.2) hiddenNoises.push("Sudden broadband bursts suggest doors, dropped objects, or abrupt interruptions.");
  if (rumbleScore >= 54) hiddenNoises.push("Low-end rumble is elevated enough to wear on concentration over time.");
  if (!hiddenNoises.length) hiddenNoises.push("No single hidden noise dominates. The room signature is comparatively smooth.");

  const interruptions =
    chaosScore >= 65 && speechScore < 45
      ? "This room is not just loud. It is interruption-heavy, with unstable spikes that will keep yanking attention."
      : speechScore >= 55
        ? "The room’s main problem is voice-range activity. It may feel manageable, but your language system will keep noticing it."
        : focusFit >= 72
          ? "The room stays fairly even. You are mostly fighting baseline ambience, not random interruption bursts."
          : "The room is workable, but it has enough instability that long focus blocks will probably feel harder than they should.";

  let bestSeat = "Mark a few spots while moving around the room and Dreamscape will tell you which one is calmest.";
  if (spots.length >= 2) {
    const sortedSpots = [...spots].sort((left, right) => left.focusFit - right.focusFit);
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

function computeRoomFrameSummary() {
  if (!roomState.analyser || !roomState.freqData || !roomState.timeData) return null;
  roomState.analyser.getFloatFrequencyData(roomState.freqData);
  roomState.analyser.getFloatTimeDomainData(roomState.timeData);

  const normalizedSpectrum = Array.from(roomState.freqData, (value) => normalizeScore(value, -105, -20));
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
    if (index > 0 && Math.sign(roomState.timeData[index - 1]) !== Math.sign(sample)) zeroCrossings += 1;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, roomState.timeData.length));
  const zcr = zeroCrossings / Math.max(1, roomState.timeData.length - 1);

  let flux = 0;
  if (roomState.previousSpectrum) {
    for (let index = 0; index < compactSpectrum.length; index += 1) {
      flux += Math.abs(compactSpectrum[index] - roomState.previousSpectrum[index]);
    }
    flux /= compactSpectrum.length;
  }
  roomState.previousSpectrum = compactSpectrum;

  const sampleRate = roomState.sampleRate || audioContext.sampleRate;
  const fftSize = roomState.fftSize;
  const speech = bandAverage(normalizedSpectrum, sampleRate, fftSize, 250, 4000);
  const rumble = bandAverage(normalizedSpectrum, sampleRate, fftSize, 25, 140);
  const hum = Math.max(
    bandAverage(normalizedSpectrum, sampleRate, fftSize, 48, 62),
    bandAverage(normalizedSpectrum, sampleRate, fftSize, 58, 72)
  );
  const buzz = bandAverage(normalizedSpectrum, sampleRate, fftSize, 7000, 12000);
  const keyboard = bandAverage(normalizedSpectrum, sampleRate, fftSize, 1800, 6500) * clamp(flux * 4.2, 0, 1);
  const slam = clamp((peak - rms) * 2.8 + flux * 2.6, 0, 1);
  const chaos = clamp(flux * 2.2 + (peak - rms) * 1.3 + zcr * 3.6 + speech * 0.35, 0, 1);

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

function resizeCanvasToDisplay(canvas) {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function rotatePoint(point, yaw, pitch) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const x1 = point.x * cosYaw - point.z * sinYaw;
  const z1 = point.x * sinYaw + point.z * cosYaw;
  const y2 = point.y * cosPitch - z1 * sinPitch;
  const z2 = point.y * sinPitch + z1 * cosPitch;
  return { x: x1, y: y2, z: z2 };
}

function buildOrbProfile(report, steps = 72) {
  const spectrum = report.averageSpectrum || [];
  const novelty = report.segmentation?.novelty || [];
  const spectrumMax = Math.max(...spectrum, 1e-6);
  const noveltyMax = Math.max(...novelty, 1e-6);
  return Array.from({ length: steps }, (_, index) => {
    const si = Math.floor((index / steps) * Math.max(spectrum.length - 1, 1));
    const ni = Math.floor((index / steps) * Math.max(novelty.length - 1, 1));
    return ((spectrum[si] || 0) / spectrumMax) * 0.72 + ((novelty[ni] || 0) / noveltyMax) * 0.28;
  });
}

function buildLiveRenderReport() {
  if (!liveState.isBuilding || !liveState.buildSpectrum || !liveState.buildMeta) return null;
  return {
    id: "__building__",
    name: liveState.buildMeta.name,
    sample_rate_hz: liveState.buildMeta.sampleRate,
    averageSpectrum: liveState.buildSpectrum,
    segmentation: { novelty: [] },
    modulationBands: {
      delta: 0,
      theta: 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
      dominant_modulation_hz: 0,
    },
    features: [],
    evidence: { scores: { attack_density: 0 } },
  };
}

function drawGeometricOrb(canvas, report, view) {
  if (!canvas || !report) return;
  resizeCanvasToDisplay(canvas);
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.width / ratio;
  const h = canvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  let spectrum = report.averageSpectrum || [];
  let hzPerBin = report.sample_rate_hz / (2 * Math.max(spectrum.length - 1, 1));

  // Live playback: read real-time FFT from AnalyserNode
  if (liveState.isPlaying && liveState.playingReportId === report.id && liveState.analyser && liveState.liveFreqData) {
    liveState.analyser.getFloatFrequencyData(liveState.liveFreqData);
    // Convert dBFS → linear magnitude
    spectrum = Array.from(liveState.liveFreqData, (db) => Math.pow(10, db / 20));
    hzPerBin = audioContext.sampleRate / liveState.analyser.fftSize;
  } else if (liveState.isBuilding && liveState.buildSpectrum) {
    // Construction phase: show partially accumulated spectrum
    spectrum = liveState.buildSpectrum;
    hzPerBin = liveState.buildHzPerBin;
  }

  const novelty = report.segmentation?.novelty || [];
  const specMax = Math.max(...spectrum, 1e-6);
  const noveltyMax = Math.max(...novelty, 1e-6);
  const metrics = summarizeReportMetrics(report);

  const baseRadius = Math.min(w, h) * 0.25 * view.zoom;
  const cx = w * 0.5;
  const cy = h * 0.52;
  const focal = baseRadius * 3.4;
  const time = performance.now() * 0.001;
  // Breathing speed and amplitude from actual modulation Hz
  const breatheAmp = 0.018 + metrics.rmsMean * 0.04;
  const breathe = 1 + Math.sin(time * (0.5 + metrics.modulationHz * 0.038)) * breatheAmp;

  // ── Color entirely from real data ──────────────────────────────────────────
  // Dominant band → base hue
  const bandRGB = {
    delta: [167, 139, 250],   // violet   — slow, deep
    theta: [192, 100, 252],   // magenta  — dreamlike
    alpha: [110, 231, 255],   // cyan     — meditative
    beta:  [74,  222, 128],   // green    — alert
    gamma: [255, 255, 200],   // bright   — intense
  };
  const dominantBand = getDominantBand(report);
  const [br, bg, bb] = bandRGB[dominantBand] || bandRGB.alpha;

  // Spectral centroid shifts color temperature (low=warm, high=cool)
  const centroidNorm = clamp((metrics.centroidMean - 300) / 3700, 0, 1);
  const cr = Math.round(lerp(br, 160, centroidNorm));
  const cg = Math.round(lerp(bg, 230, centroidNorm));
  const cb = Math.round(lerp(bb, 255, centroidNorm));

  // Overall brightness from rms energy
  const energyBright = clamp(0.3 + metrics.rmsMean * 5.5, 0.3, 1.0);

  // Attack density controls surface sharpness via power curve
  // low attack → smooth round sphere   high attack → sharp spiky peaks
  const spikeExponent = 1.0 + (1.0 - clamp(metrics.attackDensity, 0, 1)) * 2.0;

  const uSteps = 36;
  const vSteps = 18;

  // ── Build 3D vertices ──────────────────────────────────────────────────────
  const verts = [];
  for (let vi = 0; vi <= vSteps; vi++) {
    const vt = vi / vSteps;
    const phi = vt * Math.PI; // colatitude 0→π
    for (let ui = 0; ui <= uSteps; ui++) {
      const ut = ui / uSteps;
      const theta = ut * 2 * Math.PI; // longitude 0→2π

      // Map longitude → frequency bin (log scale 30Hz–18kHz)
      const logMin = Math.log(30);
      const logMax = Math.log(Math.min(report.sample_rate_hz / 2, 18000));
      const freqHz = Math.exp(logMin + ut * (logMax - logMin));
      const binIdx = clamp(Math.round(freqHz / hzPerBin), 0, spectrum.length - 1);
      const specVal = (spectrum[binIdx] || 0) / specMax; // 0→1, real spectrum data

      // Map latitude → structural novelty (variation over time)
      const novIdx = Math.floor(vt * Math.max(novelty.length - 1, 0));
      const novVal = novelty.length ? (novelty[novIdx] || 0) / noveltyMax : 0;

      // Displacement = exactly the data, shaped by attack density
      const rawDisp = specVal * 0.44 + novVal * 0.10;
      const disp = Math.pow(clamp(rawDisp, 0, 1), spikeExponent);
      const r = baseRadius * breathe * (1 + disp * 0.9);

      // Spherical → Cartesian
      const sinPhi = Math.sin(phi);
      const x3 = r * sinPhi * Math.cos(theta);
      const y3 = r * Math.cos(phi);
      const z3 = r * sinPhi * Math.sin(theta);

      const rot = rotatePoint({ x: x3, y: y3, z: z3 }, view.yaw, view.pitch);
      const s = focal / Math.max(focal + rot.z, 0.01);

      verts.push({
        px: cx + rot.x * s,
        py: cy + rot.y * s,
        z: rot.z,
        energy: specVal, // per-vertex spectral energy
      });
    }
  }

  // ── Build quads, depth-sort (painter's algorithm) ──────────────────────────
  const stride = uSteps + 1;
  const faces = [];
  for (let vi = 0; vi < vSteps; vi++) {
    for (let ui = 0; ui < uSteps; ui++) {
      const i0 = vi * stride + ui;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      const avgZ = (verts[i0].z + verts[i1].z + verts[i2].z + verts[i3].z) * 0.25;
      const avgE = (verts[i0].energy + verts[i1].energy + verts[i2].energy + verts[i3].energy) * 0.25;
      faces.push({ i0, i1, i2, i3, z: avgZ, energy: avgE });
    }
  }
  faces.sort((a, b) => a.z - b.z);

  // ── Render ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(5,8,22,0.92)";
  ctx.fillRect(0, 0, w, h);

  for (const f of faces) {
    const a = verts[f.i0], b = verts[f.i1], c = verts[f.i2], d = verts[f.i3];
    // depthFade: 0 = fully behind, 1 = fully in front
    const depthFade = clamp((f.z / baseRadius + 1) * 0.5, 0, 1);
    const fillA = (depthFade * f.energy * energyBright * 0.28).toFixed(3);
    const edgeA = (depthFade * (0.06 + f.energy * 0.72) * energyBright).toFixed(3);

    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.lineTo(d.px, d.py);
    ctx.lineTo(c.px, c.py);
    ctx.closePath();

    ctx.fillStyle = `rgba(${cr},${cg},${cb},${fillA})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${edgeA})`;
    ctx.lineWidth = 0.55;
    ctx.stroke();
  }

  // ── Central glow — radius driven by energy ─────────────────────────────────
  const glowR = baseRadius * (1.1 + metrics.rmsMean * 0.8);
  const glow = ctx.createRadialGradient(cx, cy, baseRadius * 0.06, cx, cy, glowR);
  glow.addColorStop(0, `rgba(${cr},${cg},${cb},${(0.2 * energyBright).toFixed(3)})`);
  glow.addColorStop(0.4, `rgba(${cr},${cg},${cb},${(0.07 * energyBright).toFixed(3)})`);
  glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fill();
}

function drawCollision(canvas, left, right, collision) {
  if (!canvas) return;
  resizeCanvasToDisplay(canvas);
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.width / ratio;
  const h = canvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(5, 11, 25, 0.92)";
  ctx.fillRect(0, 0, w, h);

  if (!left || !right || collision.score === null) {
    ctx.fillStyle = "rgba(238, 244, 255, 0.72)";
    ctx.font = '600 16px "Avenir Next", sans-serif';
    ctx.fillText("Load two tracks to render the collision visual.", 24, h / 2);
    return;
  }

  const harmony = collision.score / 100;
  const time = performance.now() * 0.001;
  const view = state.visuals.collision;
  const spreadShift = Math.sin(view.yaw) * 18;
  const leftX = w * (0.31 + Math.sin(time * 0.8) * 0.01) - spreadShift;
  const rightX = w * (0.69 - Math.sin(time * 0.8) * 0.01) + spreadShift;
  const centerY = h * 0.52;
  const merge = harmony > 0.7 ? 0.24 : harmony > 0.45 ? 0.13 : 0.05;
  const leftProfile = buildOrbProfile(left, 48);
  const rightProfile = buildOrbProfile(right, 48);
  const leftRadius = Math.min(w, h) * (0.16 + merge * 0.16) * view.zoom;
  const rightRadius = Math.min(w, h) * (0.16 + merge * 0.16) * view.zoom;

  const drawSimpleOrb = (cx, radius, profile, stroke, fill) => {
    ctx.beginPath();
    profile.forEach((lift, index) => {
      const angle = (index / profile.length) * Math.PI * 2;
      const r = radius * (1 + lift * 0.24 + Math.sin(time * 1.2 + angle * 3) * 0.02);
      const x = cx + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r * 0.88;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  };

  drawSimpleOrb(leftX, leftRadius, leftProfile, "rgba(110, 231, 255, 0.9)", "rgba(110, 231, 255, 0.12)");
  drawSimpleOrb(rightX, rightRadius, rightProfile, "rgba(255, 123, 156, 0.9)", "rgba(255, 123, 156, 0.12)");

  if (harmony >= 0.74) {
    const glow = ctx.createRadialGradient(w * 0.5, centerY, 10, w * 0.5, centerY, 100);
    glow.addColorStop(0, "rgba(255, 211, 111, 0.5)");
    glow.addColorStop(1, "rgba(255, 211, 111, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(w * 0.5, centerY, 110 + Math.sin(time * 2) * 8, 0, Math.PI * 2);
    ctx.fill();
  } else if (harmony < 0.48) {
    ctx.strokeStyle = "rgba(255, 95, 95, 0.75)";
    ctx.lineWidth = 1.5;
    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2 + time * 0.8;
      const start = 50;
      const end = 90 + (index % 3) * 22;
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + Math.cos(angle) * start, centerY + Math.sin(angle) * start);
      ctx.lineTo(w * 0.5 + Math.cos(angle) * end, centerY + Math.sin(angle) * end);
      ctx.stroke();
    }
  }
}

function drawRoomHeatmap(canvas) {
  if (!canvas) return;
  resizeCanvasToDisplay(canvas);
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.width / ratio;
  const h = canvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(5, 11, 25, 0.96)";
  ctx.fillRect(0, 0, w, h);

  const frames = roomState.heatmapFrames;
  if (!frames.length) {
    ctx.fillStyle = "rgba(238, 244, 255, 0.72)";
    ctx.font = '600 16px "Avenir Next", sans-serif';
    ctx.fillText("Start Room Scan to render the live spectrum heat view.", 22, h / 2);
    return;
  }

  const columns = Math.min(frames.length, 160);
  const rows = frames[0].length;
  const columnWidth = w / columns;
  const rowHeight = h / rows;

  for (let x = 0; x < columns; x += 1) {
    const frame = frames[frames.length - columns + x];
    for (let y = 0; y < rows; y += 1) {
      const intensity = clamp(frame[y], 0, 1);
      const hue = lerp(210, 12, intensity);
      const lightness = lerp(8, 64, intensity);
      ctx.fillStyle = `hsl(${hue} 90% ${lightness}%)`;
      ctx.fillRect(x * columnWidth, h - (y + 1) * rowHeight, columnWidth + 1, rowHeight + 1);
    }
  }
}

function refreshRoomSummary() {
  roomState.summary = buildRoomSummary(roomState.rollingFrames, roomState.spots);
}

function updateRoomScanFrame() {
  if (!roomState.isScanning || !roomState.analyser) return;
  const frame = computeRoomFrameSummary();
  if (!frame) return;
  roomState.heatmapFrames.push(frame.compactSpectrum);
  roomState.heatmapFrames = roomState.heatmapFrames.slice(-180);
  roomState.rollingFrames.push(frame);
  roomState.rollingFrames = roomState.rollingFrames.slice(-180);
  refreshRoomSummary();

  const now = Date.now();
  if (now - roomState.lastUiRefreshAt > 700) {
    roomState.lastUiRefreshAt = now;
    renderAll();
  }
}

function bindInteractiveCanvas(canvas, viewKey) {
  if (!canvas || canvas.dataset.bound === "true") return;
  canvas.dataset.bound = "true";
  const view = state.visuals[viewKey];
  const beginDrag = (x, y) => {
    view.dragging = true;
    view.lastX = x;
    view.lastY = y;
  };
  const updateDrag = (x, y) => {
    const dx = x - view.lastX;
    const dy = y - view.lastY;
    view.yaw += dx * 0.01;
    view.pitch = clamp(view.pitch + dy * 0.008, -1.15, 1.15);
    view.lastX = x;
    view.lastY = y;
  };
  const stopDrag = () => {
    view.dragging = false;
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    beginDrag(event.clientX, event.clientY);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!view.dragging) return;
    event.preventDefault();
    updateDrag(event.clientX, event.clientY);
  });
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointerleave", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("lostpointercapture", stopDrag);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    view.zoom = clamp(view.zoom - event.deltaY * 0.0012, 0.72, 1.8);
  }, { passive: false });

  // Touch fallback for browsers that still route canvas gestures through
  // touch events instead of stable pointer events.
  canvas.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    beginDrag(touch.clientX, touch.clientY);
  }, { passive: false });
  canvas.addEventListener("touchmove", (event) => {
    if (!view.dragging) return;
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    updateDrag(touch.clientX, touch.clientY);
  }, { passive: false });
  canvas.addEventListener("touchend", stopDrag, { passive: true });
  canvas.addEventListener("touchcancel", stopDrag, { passive: true });
}

function drawIdleOrb(canvas) {
  if (!canvas) return;
  resizeCanvasToDisplay(canvas);
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.width / ratio;
  const h = canvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const time = performance.now() * 0.001;
  const cx = w * 0.5;
  const cy = h * 0.52;
  const baseR = Math.min(w, h) * 0.22;
  const breathe = 1 + Math.sin(time * 0.6) * 0.03;
  const steps = 72;

  ctx.fillStyle = "rgba(5, 8, 22, 0.86)";
  ctx.fillRect(0, 0, w, h);

  const rings = 6;
  for (let ring = 0; ring < rings; ring += 1) {
    const latNorm = ring / (rings - 1);
    const lat = (latNorm - 0.5) * Math.PI * 0.88;
    const rs = Math.cos(lat);
    const vert = Math.sin(lat);
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      const wave = 0.04 * Math.sin(angle * 4 + time * 0.8) + 0.02 * Math.sin(angle * 7 - time * 0.5);
      const r = baseR * breathe * (1 + wave);
      const x = cx + Math.cos(angle) * rs * r;
      const y = cy + vert * r + Math.sin(angle) * rs * r * 0.06;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const alpha = 0.1 + latNorm * 0.14;
    ctx.strokeStyle = `rgba(110,231,255,${alpha.toFixed(2)})`;
    ctx.lineWidth = 1 + latNorm * 0.6;
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(cx, cy, baseR * 0.1, cx, cy, baseR * 1.2);
  glow.addColorStop(0, "rgba(167,139,250,0.18)");
  glow.addColorStop(0.4, "rgba(110,231,255,0.12)");
  glow.addColorStop(1, "rgba(110,231,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 1.18, 0, Math.PI * 2);
  ctx.fill();
}

function renderFeatureVisuals() {
  updateRoomScanFrame();
  const primary = getSelectedTrack();
  const [left, right] = getComparisonPair();
  const building = buildLiveRenderReport();
  const heroOrb = document.querySelector("#hero-orb");
  const artifactCanvas = document.querySelector("#artifact-canvas");
  const collisionCanvas = document.querySelector("#collision-canvas");
  const roomHeatmapCanvas = document.querySelector("#room-heatmap");

  if (heroOrb) {
    bindInteractiveCanvas(heroOrb, "artifact");
    if (building) {
      drawGeometricOrb(heroOrb, building, state.visuals.artifact);
    } else if (primary) {
      drawGeometricOrb(heroOrb, primary, state.visuals.artifact);
    } else {
      drawIdleOrb(heroOrb);
    }
  }
  if (artifactCanvas && primary) {
    bindInteractiveCanvas(artifactCanvas, "artifact");
    drawGeometricOrb(artifactCanvas, primary, state.visuals.artifact);
  }
  if (collisionCanvas) {
    bindInteractiveCanvas(collisionCanvas, "collision");
    drawCollision(collisionCanvas, left, right, buildCollisionRead(left, right));
  }
  if (roomHeatmapCanvas) {
    drawRoomHeatmap(roomHeatmapCanvas);
  }
}

let visualLoopStarted = false;

function startVisualLoop() {
  if (visualLoopStarted) return;
  visualLoopStarted = true;
  const tick = () => {
    renderFeatureVisuals();
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
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
  if (!baseReports.some((report) => report.id === state.comparison.leftId)) state.comparison.leftId = baseReports[0].id;
  if (!baseReports.some((report) => report.id === state.comparison.rightId)) {
    state.comparison.rightId = baseReports[1]?.id || baseReports[0].id;
  }
  if (baseReports.length > 1 && state.comparison.leftId === state.comparison.rightId) {
    state.comparison.rightId = baseReports.find((report) => report.id !== state.comparison.leftId)?.id || baseReports[1].id;
  }
}

function setSelectedTrack(id) {
  if (liveState.isPlaying && liveState.playingReportId !== id) {
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
  try {
    const availability = getRoomScanAvailability();
    if (!availability.supported) {
      roomState.error = availability.reason;
      refreshRoomSummary();
      renderAll();
      setStatus(availability.reason);
      return;
    }
    await audioContext.resume();
    if (roomState.isScanning) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = roomState.fftSize;
    analyser.smoothingTimeConstant = 0.5;
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNode.connect(analyser);

    roomState.stream = stream;
    roomState.sourceNode = sourceNode;
    roomState.analyser = analyser;
    roomState.freqData = new Float32Array(analyser.frequencyBinCount);
    roomState.timeData = new Float32Array(analyser.fftSize);
    roomState.previousSpectrum = null;
    roomState.heatmapFrames = [];
    roomState.rollingFrames = [];
    roomState.error = null;
    roomState.sampleRate = audioContext.sampleRate;
    roomState.isScanning = true;
    roomState.lastUiRefreshAt = 0;
    refreshRoomSummary();
    renderAll();
    setStatus("Room scan live. Walk around and mark spots to compare seats.");
  } catch (error) {
    roomState.error = error.message || "Microphone access was blocked.";
    refreshRoomSummary();
    roomState.isScanning = false;
    renderAll();
    setStatus(`Room scan unavailable: ${roomState.error}`);
  }
}

function stopRoomScan() {
  roomState.sourceNode?.disconnect();
  roomState.analyser?.disconnect();
  roomState.stream?.getTracks().forEach((track) => track.stop());
  roomState.isScanning = false;
  roomState.stream = null;
  roomState.sourceNode = null;
  roomState.analyser = null;
  roomState.freqData = null;
  roomState.timeData = null;
  roomState.previousSpectrum = null;
  roomState.lastUiRefreshAt = 0;
  refreshRoomSummary();
  renderAll();
  setStatus("Room scan stopped.");
}

function markRoomSpot() {
  if (!roomState.summary || !roomState.isScanning) return;
  const label = `Spot ${roomState.spots.length + 1}`;
  roomState.spots.push({
    label,
    focusFit: roomState.summary.focusFit,
    chaosScore: roomState.summary.chaosScore,
    speechScore: roomState.summary.speechScore,
  });
  roomState.spots = roomState.spots.slice(-6);
  refreshRoomSummary();
  renderAll();
  setStatus(`${label} saved for seat comparison.`);
}

// ─── Dashboard rendering ─────────────────────────────────────────────────────

function renderTrackCards(reports) {
  const primary = reports.length ? getSelectedTrack() || reports[0] : null;
  const baseReports = reports.filter((report) => !report.isDerived);
  const coach = primary ? buildStudySoundCoach(primary) : null;
  const cleanser = buildPlaylistCleanser(reports);
  const room = roomState.summary || buildRoomSummary([], roomState.spots);
  const trackSummary = primary ? buildHumanReadout(primary) : null;
  const roomAvailability = getRoomScanAvailability();
  const roomStatus = roomState.error ? `Mic error: ${roomState.error}` : roomState.isScanning ? room.status : "Mic idle";
  const stateScore = primary ? buildStateEngineering(primary) : null;
  const energy = primary ? buildEnergyRead(primary) : null;
  const [left, right] = getComparisonPair();
  const comparison = buildCompareRead(left, right);
  const collision = buildCollisionRead(left, right);

  trackResults.innerHTML = `
    <section class="dashboard-shell">
      <div class="dashboard-toolbar">
        <div class="track-switcher">
          ${
            reports.length
              ? reports
                  .map(
                    (report) => `
                      <button
                        class="track-chip ${report.id === primary.id ? "active" : ""}"
                        type="button"
                        data-action="focus-track"
                        data-track-id="${report.id}"
                      >
                        ${escapeHtml(report.name)}
                      </button>
                    `
                  )
                  .join("")
              : `<button class="track-chip active" type="button" disabled>No tracks loaded</button>`
          }
        </div>
        <div class="app-summary">
          <div class="toolbar-copy">
            <p>${
              primary
                ? `${escapeHtml(primary.name)} is active. It reads ${escapeHtml(trackSummary.vibe.toLowerCase())}, carries ${escapeHtml(withIndefiniteArticle(energy.label.toLowerCase()))} energy profile, is strongest for ${escapeHtml(coach.tasks[0].label.toLowerCase())}, and estimates ${(primary.advanced?.estimated_key || "an ambiguous key field")} ${(primary.advanced?.estimated_scale || "")}`.trim() + `.`
                : "Upload a song or playlist to generate task-specific study guidance. Room Scan works independently if you want to profile a space first."
            }</p>
          </div>
          <div class="micro-stat-row">
            <div class="micro-stat">
              <div class="micro-stat-label">Active Track</div>
              <div class="micro-stat-value">${primary ? escapeHtml(primary.name) : "Waiting"}</div>
            </div>
            <div class="micro-stat">
              <div class="micro-stat-label">Room Scan</div>
              <div class="micro-stat-value">${escapeHtml(roomStatus)}</div>
            </div>
            <div class="micro-stat">
              <div class="micro-stat-label">Playlist</div>
              <div class="micro-stat-value">${reports.length ? `${reports.length} track${reports.length === 1 ? "" : "s"}` : "No tracks"}</div>
            </div>
          </div>
        </div>
        ${
          baseReports.length > 1
            ? `
              <div class="compare-picker-shell">
                <div class="compare-picker">
                  <div class="compare-picker-label">Compare Left</div>
                  <div class="compare-track-row">
                    ${baseReports
                      .map(
                        (report) => `
                          <button
                            class="track-chip ${left?.id === report.id ? "active" : ""}"
                            type="button"
                            data-action="set-compare-left"
                            data-track-id="${report.id}"
                          >
                            ${escapeHtml(report.name)}
                          </button>
                        `
                      )
                      .join("")}
                  </div>
                </div>
                <div class="compare-picker">
                  <div class="compare-picker-label">Compare Right</div>
                  <div class="compare-track-row">
                    ${baseReports
                      .map(
                        (report) => `
                          <button
                            class="track-chip ${right?.id === report.id ? "active" : ""}"
                            type="button"
                            data-action="set-compare-right"
                            data-track-id="${report.id}"
                          >
                            ${escapeHtml(report.name)}
                          </button>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              </div>
            `
            : ""
        }
      </div>

      <section class="dashboard-section">
        <p class="dashboard-kicker dashboard-section-title">Core Features</p>
        <div class="dashboard-grid">
          <article class="feature-card">
            <p class="dashboard-kicker">00 • Orb</p>
            <h3>${primary ? `${escapeHtml(primary.name)} artifact orb` : "Upload a track to activate the orb."}</h3>
            <p class="feature-subtitle">${primary ? `The hero orb is reading the real spectrum, novelty, attack density, modulation, MFCC recurrence, and harmonic key field from ${escapeHtml(primary.name)}.` : "The liquid-glass orb becomes the live visual artifact once a track is analyzed."}</p>
            <p class="artifact-note">${primary ? `Drag to rotate. Scroll to zoom. Breathing speed follows ${primary.modulationBands.dominant_modulation_hz.toFixed(2)} Hz modulation. Recurrence affinity is ${(primary.advanced?.recurrence_mean_affinity || 0).toFixed(3)}, and the harmonic center leans ${(primary.advanced?.estimated_key || "ambiguous")} ${(primary.advanced?.estimated_scale || "")}.` : "The orb remains interactive as the main visual surface above this dashboard."}</p>
          </article>

          <article class="feature-card">
            <p class="dashboard-kicker">01 • State</p>
            <h3>${primary ? escapeHtml(stateScore.verdict) : "Upload a track to score state."}</h3>
            <p class="feature-subtitle">${primary ? escapeHtml(stateScore.guidance) : "Dreamscape maps measured roughness, repetition, phase stability, and energy into focus, hype, and chill scores."}</p>
            ${
              primary
                ? `
                  <div class="score-grid">
                    ${stateScore.entries
                      .map(
                        (entry) => `
                          <div class="score-block">
                            <div class="score-label">${escapeHtml(entry.label)}</div>
                            <div class="score-value">${entry.score}%</div>
                            <div class="score-bar"><div class="score-fill" style="width:${entry.score}%"></div></div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                  <p class="score-note">Derived from RMS energy, attack density, spectral roughness, phase stability, and modulation behavior.</p>
                `
                : ""
            }
          </article>

          <article class="feature-card">
            <p class="dashboard-kicker">02 • Energy</p>
            <h3>${primary ? escapeHtml(energy.label) : "Upload a track to read energy."}</h3>
            <p class="feature-subtitle">${primary ? escapeHtml(energy.copy) : "Pressure, shock, and peak lift are computed from the uploaded waveform, not placeholder labels."}</p>
            ${
              primary
                ? `
                  <div class="energy-stack">
                    <span class="tone-badge">${escapeHtml(energy.label)} profile</span>
                    <div class="energy-grid">
                      <div class="energy-block">
                        <div class="compare-label">Energy</div>
                        <div class="energy-value">${energy.energyScore}%</div>
                        <p class="energy-note">Overall pressure from average loudness, peak lift, and transient density.</p>
                      </div>
                      <div class="energy-block">
                        <div class="compare-label">Shock</div>
                        <div class="energy-value">${energy.shockScore}%</div>
                        <p class="energy-note">How sharply the track jumps when peaks and attacks arrive.</p>
                      </div>
                      <div class="energy-block">
                        <div class="compare-label">Peak</div>
                        <div class="energy-value">${energy.peakEnergy.toFixed(3)}</div>
                        <p class="energy-note">95th percentile RMS window from the analyzed waveform.</p>
                      </div>
                    </div>
                  </div>
                `
                : ""
            }
          </article>

          <article class="feature-card">
            <p class="dashboard-kicker">03 • Compare</p>
            <h3>${escapeHtml(comparison.title)}</h3>
            <p class="feature-subtitle">${escapeHtml(comparison.summary)}</p>
            <div class="compare-grid-simple">
              ${
                comparison.stats.length
                  ? comparison.stats
                      .map(
                        (stat) => `
                          <div class="compare-block">
                            <div class="compare-label">${escapeHtml(stat.label)}</div>
                            <div class="compare-value">${escapeHtml(stat.value)}</div>
                            <p class="compare-note">${escapeHtml(stat.note)}</p>
                          </div>
                        `
                      )
                      .join("")
                  : `
                      <div class="compare-block">
                        <div class="compare-label">Waiting</div>
                        <div class="compare-value">2 tracks</div>
                        <p class="compare-note">Upload a second track to unlock side-by-side comparison.</p>
                      </div>
                    `
              }
            </div>
          </article>

          <article class="feature-card">
            <p class="dashboard-kicker">04 • Collision</p>
            <h3>${escapeHtml(collision.label)}${collision.score !== null ? ` • ${collision.score}%` : ""}</h3>
            <p class="feature-subtitle">${escapeHtml(collision.summary)}</p>
            <canvas id="collision-canvas" class="collision-canvas"></canvas>
            <p class="collision-note">Experimental. Driven by measured differences in centroid, modulation pace, phase stability, repetition lock, and dominant peak placement.</p>
          </article>
        </div>
      </section>

      <section class="dashboard-section">
        <p class="dashboard-kicker dashboard-section-title">Side Features</p>
        <div class="dashboard-grid">
          <article class="feature-card">
            <p class="dashboard-kicker">05 • Study Sound Coach</p>
            <h3>${primary ? escapeHtml(coach.headline) : "Upload a track to score task fit."}</h3>
            <p class="feature-subtitle">${primary ? escapeHtml(coach.summary) : "Dreamscape maps measured loudness, attack pressure, repetition, texture, and modulation into reading, writing, coding, memorization, and recovery guidance."}</p>
            ${
              primary
                ? `
                  <p class="feature-lead">${escapeHtml(primary.name)} is most useful for <strong>${escapeHtml(coach.tasks[0].label.toLowerCase())}</strong> and least useful for <strong>${escapeHtml(coach.tasks[coach.tasks.length - 1].label.toLowerCase())}</strong>.</p>
                  <div class="coach-task-grid">
                    ${coach.tasks
                      .map(
                        (task) => `
                          <div class="coach-task">
                            <div class="coach-task-head">
                              <div class="coach-task-label">${escapeHtml(task.label)}</div>
                              <div class="coach-task-score">${task.score}%</div>
                            </div>
                            <div class="score-bar"><div class="score-fill" style="width:${task.score}%"></div></div>
                            <p class="coach-task-note">${escapeHtml(task.note)}</p>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                  <div class="cleanser-banner">
                    <strong>Why it reads this way</strong>
                    <p>Measured flags: ${coach.cautionFlags.map((flag) => escapeHtml(flag)).join(" · ")}. These come from the uploaded audio, not canned mood labels.</p>
                  </div>
                `
                : ""
            }
          </article>

          <article class="feature-card">
            <p class="dashboard-kicker">06 • Room Scan</p>
            <h3>${escapeHtml(roomState.error ? "Room Scan unavailable here." : room.roomTone)}</h3>
            <p class="feature-subtitle">${escapeHtml(roomState.error || room.interruptions)}</p>
            <div class="room-actions">
              <button class="btn-secondary" type="button" data-action="start-room-scan" ${roomState.isScanning || !roomAvailability.supported ? "disabled" : ""}>Start Room Scan</button>
              <button class="btn-secondary" type="button" data-action="stop-room-scan" ${roomState.isScanning ? "" : "disabled"}>Stop Scan</button>
              <button class="btn-secondary" type="button" data-action="mark-room-spot" ${roomState.isScanning ? "" : "disabled"}>Mark Current Spot</button>
            </div>
            ${
              roomState.error || !roomAvailability.supported
                ? `
                  <div class="cleanser-banner">
                    <strong>Mic Access Required</strong>
                    <p>${escapeHtml(roomState.error || roomAvailability.reason)}</p>
                  </div>
                `
                : ""
            }
            <canvas id="room-heatmap" class="heatmap-canvas"></canvas>
            <div class="room-grid">
              <div class="room-metric">
                <div class="room-metric-label">Focus Fit</div>
                <div class="room-metric-value">${room.focusFit}%</div>
                <div class="room-metric-copy">How usable this room is for sustained study right now.</div>
              </div>
              <div class="room-metric">
                <div class="room-metric-label">Chaos</div>
                <div class="room-metric-value">${room.chaosScore}%</div>
                <div class="room-metric-copy">Irregular spikes, chatter-like motion, and unstable bursts.</div>
              </div>
              <div class="room-metric">
                <div class="room-metric-label">Speech</div>
                <div class="room-metric-value">${room.speechScore}%</div>
                <div class="room-metric-copy">Voice-range activity that can hijack your language system.</div>
              </div>
              <div class="room-metric">
                <div class="room-metric-label">Rumble</div>
                <div class="room-metric-value">${room.rumbleScore}%</div>
                <div class="room-metric-copy">Low-end hum and room vibration that wears on focus over time.</div>
              </div>
            </div>
            <ul class="noise-list">
              ${room.hiddenNoises.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
            <div class="seat-callout">
              <strong>Best Seat Finder</strong>
              <p>${escapeHtml(room.bestSeat)}</p>
            </div>
          </article>

          <article class="feature-card">
            <p class="dashboard-kicker">07 • Playlist Cleanser</p>
            <h3>${escapeHtml(cleanser.headline)}</h3>
            <p class="feature-subtitle">${escapeHtml(cleanser.summary)}</p>
            <div class="cleanser-grid">
              ${
                cleanser.tracks.length
                  ? cleanser.tracks
                      .map(
                        (item) => `
                          <div class="cleanser-item">
                            <div class="cleanser-head">
                              <div class="cleanser-track">${escapeHtml(item.name)}</div>
                              <div class="cleanser-score">${item.support}%</div>
                            </div>
                            <p class="cleanser-note">${escapeHtml(item.note)}</p>
                            <div class="cleanser-tags">
                              ${item.tags.map((tag) => `<span class="cleanser-tag ${escapeHtml(tag.tone)}">${escapeHtml(tag.label)}</span>`).join("")}
                            </div>
                          </div>
                        `
                      )
                      .join("")
                  : `
                      <div class="cleanser-item">
                        <div class="cleanser-head">
                          <div class="cleanser-track">Waiting for playlist</div>
                          <div class="cleanser-score">--</div>
                        </div>
                        <p class="cleanser-note">Load a playlist and Dreamscape will flag the tracks that are too explosive, jagged, or distractingly unstable for study.</p>
                      </div>
                    `
              }
            </div>
            ${
              cleanser.safest && cleanser.riskiest
                ? `
                  <div class="cleanser-banner">
                    <strong>Quick Verdict</strong>
                    <p>Keep <strong>${escapeHtml(cleanser.safest.name)}</strong> in the study loop. Consider cutting or saving <strong>${escapeHtml(cleanser.riskiest.name)}</strong> for workouts, walking, or recovery instead of deep work.</p>
                  </div>
                `
                : ""
            }
          </article>
        </div>
      </section>
    </section>
  `;

  renderFeatureVisuals();
}

function renderAll() {
  syncSelectionDefaults();
  exportButton.disabled = !getAllReports().length;
  renderTrackCards(getAllReports());
  const primary = getSelectedTrack();
  if (orbLabel) {
    orbLabel.textContent = liveState.isBuilding && liveState.buildMeta
      ? `Constructing ${liveState.buildMeta.name} · ${Math.round(liveState.buildProgress * 100)}%`
      : primary
        ? `${primary.name} · ${primary.modulationBands.dominant_modulation_hz.toFixed(2)} Hz modulation`
        : "Upload a track to activate";
  }
  updatePlayBtn();
}

// ─── Live playback ────────────────────────────────────────────────────────────

function updatePlayBtn() {
  if (!orbPlayBtn) return;
  const primary = getSelectedTrack();
  orbPlayBtn.hidden = !primary;
  orbPlayBtn.disabled = !primary || liveState.isBuilding;
  orbPlayBtn.textContent = liveState.isPlaying ? "⏸ Pause" : "▶ Play";
}

function stopPlayback() {
  try { liveState.sourceNode?.stop(); } catch (_) {}
  liveState.sourceNode?.disconnect();
  liveState.analyser?.disconnect();
  liveState.isPlaying = false;
  liveState.playingReportId = null;
  liveState.sourceNode = null;
  liveState.analyser = null;
  liveState.liveFreqData = null;
  updatePlayBtn();
}

async function startPlayback(report) {
  stopPlayback();
  const buffer = liveState.audioBuffers.get(report.id);
  if (!buffer) return;
  await audioContext.resume();

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  source.start(0);

  liveState.analyser = analyser;
  liveState.liveFreqData = new Float32Array(analyser.frequencyBinCount);
  liveState.sourceNode = source;
  liveState.isPlaying = true;
  liveState.playingReportId = report.id;
  source.onended = stopPlayback;
  updatePlayBtn();
}

function togglePlayback() {
  const primary = getSelectedTrack();
  if (!primary) return;
  if (liveState.isPlaying && liveState.playingReportId === primary.id) stopPlayback();
  else startPlayback(primary);
}

// ─── Audio file pipeline ──────────────────────────────────────────────────────

const audioContext = new AudioContext();

function encodeWavBlob(signal, sampleRate) {
  const dataLength = signal.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  let offset = 0;
  const writeString = (value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
    offset += value.length;
  };
  writeString("RIFF");
  view.setUint32(offset, 36 + dataLength, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2, true); offset += 4;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, dataLength, true); offset += 4;
  for (let index = 0; index < signal.length; index += 1) {
    const sample = clamp(signal[index], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function buildReportFromSignal({ name, mono, sampleRate, channels, audioUrl }, onProgress) {
  const frameReport = await analyzeFrames(mono, sampleRate, state.config, onProgress);
  const modulation = modulationAnalysis(mono, sampleRate, state.config);
  const embeddings = computeEmbeddings(frameReport.features);
  const segmentation = detectSegments(embeddings, frameReport.features, state.config);
  const symbolic = buildStructuralCodebook(frameReport.features, embeddings, modulation.bands, state.config);
  const evidence = buildEvidenceModel(frameReport.features, modulation.bands, symbolic, segmentation);
  const advanced = computeAdvancedBrowserAnalysis(mono, sampleRate, state.config);

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
    correlations: [],
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
      { name: file.name, mono, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, audioUrl },
      (partialSpectrum, progress) => {
        liveState.buildSpectrum = partialSpectrum;
        liveState.buildProgress = progress;
        if (orbLabel) {
          orbLabel.textContent = `Constructing ${file.name} · ${Math.round(progress * 100)}%`;
        }
      }
    );
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
    if (report?.audio_url?.startsWith("blob:")) URL.revokeObjectURL(report.audio_url);
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
      `
    )
    .join("");
}

// ─── Export ───────────────────────────────────────────────────────────────────

function serializeReport(report) {
  return {
    id: report.id,
    name: report.name,
    duration_s: report.duration_s,
    sample_rate_hz: report.sample_rate_hz,
    channels: report.channels,
    modulationBands: report.modulationBands,
    topPeaks: report.topPeaks,
    symbolic: report.symbolic,
    evidence: report.evidence,
    advanced: report.advanced,
    segmentation: report.segmentation,
    study_sound_coach: buildStudySoundCoach(report),
  };
}

function exportResults() {
  const payload = {
    created_at: new Date().toISOString(),
    config: state.config,
    reports: getAllReports().map(serializeReport),
    playlist_cleanser: buildPlaylistCleanser(getAllReports()),
    room_scan: {
      summary: roomState.summary,
      spots: roomState.spots,
    },
    guardrails: [
      "This export contains acoustic heuristics and correlations, not proof of hidden language or neural transmission.",
    ],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "quantum-sound-lab-session.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─── Analysis entrypoint ──────────────────────────────────────────────────────

async function runAnalysis() {
  try {
    setStatus("Preparing files...");
    await audioContext.resume();
    stopPlayback();
    liveState.audioBuffers.clear();

    const files = await loadSelectedFiles();
    if (!files.length) {
      setStatus("No uploaded audio detected. Add one or two files to generate the dashboard.");
      return;
    }

    setStatus(`Decoding ${files.length} track(s)...`);
    const reports = [];
    for (const file of files) {
      setStatus(`Analyzing ${file.name}...`);
      reports.push(await analyzeFile(file));
    }

    cleanupReportUrls(state.reports);
    cleanupReportUrls(state.derivedReports);
    state.derivedReports = [];
    state.reports = reports;
    syncSelectionDefaults();
    renderAll();
    setStatus(`Analysis complete for ${reports.length} track(s).`);
  } catch (error) {
    console.error(error);
    setStatus(`Analysis failed: ${error.message}`);
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
  body.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  body.addEventListener("dragleave", (e) => { if (!e.relatedTarget) dropZone.classList.remove("drag-over"); });
  body.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const dt = new DataTransfer();
    [...files].filter((f) => /\.(mp3|wav|m4a|ogg|aac)$/i.test(f.name)).forEach((f) => dt.items.add(f));
    if (dt.files.length) {
      audioInput.files = dt.files;
      renderFileList(dt.files);
    }
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
renderTrackCards([]);
startVisualLoop();
