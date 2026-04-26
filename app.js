const DEFAULT_TRACKS = [
  "analog_mannequin - and all its contents.mp3",
  "øneheart - watching the stars (sped up).mp3",
];

const DEFAULT_CONFIG = {
  frameSize: 2048,
  hopSize: 512,
  modulationResampleHz: 200,
  segmentationQuantile: 0.9,
  motifSpan: 4,
  biosignalLagCenterS: 0,
  biosignalLagWindowS: 2,
};

const STORAGE_KEY = "quantum-sound-lab-annotations-v2";
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

const MODE_DEFINITIONS = {
  structure: {
    description: "Structure mode emphasizes segmentation, recurrence, and motif density.",
    charts: [
      {
        title: "Energy Timeline",
        copy: "Frame-level RMS with section boundaries and the active playback cursor.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "RMS",
                color: "#6ee7ff",
                points: report.features.map((item) => ({ x: item.time_s, y: item.rms })),
              },
            ],
            markers: report.segmentation.boundaries.map((item) => ({
              x: item.time_s,
              color: "rgba(255, 211, 111, 0.55)",
            })),
            readoutLabel: "RMS",
          };
        },
      },
      {
        title: "Novelty Map",
        copy: "Embedding-space novelty used to cut the track into structural sections.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Novelty",
                color: "#ffd36f",
                points: report.segmentation.novelty.map((value, index) => ({
                  x: report.features[index]?.time_s || 0,
                  y: value,
                })),
              },
            ],
            markers: report.segmentation.boundaries.map((item) => ({
              x: item.time_s,
              color: "rgba(255, 123, 156, 0.55)",
            })),
            readoutLabel: "Novelty",
          };
        },
      },
    ],
  },
  rhythm: {
    description: "Rhythm mode pushes onset strength, attack bursts, and slow envelope modulation to the foreground.",
    charts: [
      {
        title: "Attack Strength",
        copy: "Attack intensity across time. Useful for transient-rich regions and beat-like surges.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Attack",
                color: "#ff7b9c",
                points: report.features.map((item) => ({ x: item.time_s, y: item.attack_strength })),
              },
            ],
            markers: report.segmentation.boundaries.map((item) => ({
              x: item.time_s,
              color: "rgba(110, 231, 255, 0.42)",
            })),
            readoutLabel: "Attack",
          };
        },
      },
      {
        title: "Modulation Spectrum",
        copy: "Low-frequency envelope motion where the EEG-style band labels live.",
        build(report) {
          return {
            type: "value",
            series: [
              {
                name: "Modulation",
                color: "#ffd36f",
                points: report.modulationSpectrum
                  .map((value, index) => ({
                    x: report.modulationFreqs[index],
                    y: value,
                  }))
                  .filter((item) => item.x <= 45),
              },
            ],
            xDomain: [0, 45],
            readoutLabel: "Magnitude",
          };
        },
      },
    ],
  },
  texture: {
    description: "Texture mode focuses on timbral brightness, spread, and how spectral mass drifts through the track.",
    charts: [
      {
        title: "Spectral Centroid",
        copy: "Brightness trace across the active track.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Centroid",
                color: "#90f0b6",
                points: report.features.map((item) => ({ x: item.time_s, y: item.spectral_centroid_hz })),
              },
            ],
            readoutLabel: "Hz",
          };
        },
      },
      {
        title: "Spectral Rolloff",
        copy: "Upper-energy boundary as the texture opens or collapses.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Rolloff",
                color: "#6ee7ff",
                points: report.features.map((item) => ({ x: item.time_s, y: item.spectral_rolloff_hz })),
              },
            ],
            readoutLabel: "Hz",
          };
        },
      },
    ],
  },
  biosignal: {
    description: "Biosignal mode keeps audio metrics live while the lag window and signal pairings are adjusted.",
    charts: [
      {
        title: "Energy Trace",
        copy: "Audio energy remains the base layer for biosignal alignment work.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "RMS",
                color: "#6ee7ff",
                points: report.features.map((item) => ({ x: item.time_s, y: item.rms })),
              },
            ],
            readoutLabel: "RMS",
          };
        },
      },
      {
        title: "Phase Lock",
        copy: "Phase stability often exposes coherent zones worth checking against biosignals.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Phase lock",
                color: "#ff7b9c",
                points: report.features.map((item) => ({ x: item.time_s, y: item.phase_lock })),
              },
            ],
            readoutLabel: "Phase",
          };
        },
      },
    ],
  },
  similarity: {
    description: "Similarity mode frames the active report as one member of a pair rather than an isolated specimen.",
    charts: [
      {
        title: "Spectral Flux",
        copy: "Flux is a useful divergence indicator when comparing related tracks.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Flux",
                color: "#ffd36f",
                points: report.features.map((item) => ({ x: item.time_s, y: item.spectral_flux })),
              },
            ],
            readoutLabel: "Flux",
          };
        },
      },
      {
        title: "Dominant Frequency",
        copy: "Where the strongest frequency bin sits over time.",
        build(report) {
          return {
            type: "time",
            series: [
              {
                name: "Dominant frequency",
                color: "#90f0b6",
                points: report.features.map((item) => ({ x: item.time_s, y: item.dominant_freq_hz })),
              },
            ],
            readoutLabel: "Hz",
          };
        },
      },
    ],
  },
};

const state = {
  reports: [],
  derivedReports: [],
  eegRows: null,
  emfRows: null,
  biosignalValidation: {},
  config: { ...DEFAULT_CONFIG },
  mode: "structure",
  selectedTrackId: null,
  comparison: {
    leftId: null,
    rightId: null,
  },
  annotations: loadAnnotations(),
  reelClips: [],
  qrngSample: null,
  qrngCursor: 0,
  focusWindowS: 2.5,
  selectedBiosignalSource: "EEG",
  selectedCorrelationKeys: {
    EEG: null,
    EMF: null,
  },
  pendingSeek: null,
  spotifyContext: "",
  visuals: {
    artifact: { yaw: 0.32, pitch: 0.18, zoom: 1, dragging: false, lastX: 0, lastY: 0 },
    collision: { yaw: 0.18, pitch: -0.12, zoom: 1, dragging: false, lastX: 0, lastY: 0 },
  },
};

window.__quantumSoundLab = { state };

const audioInput = document.querySelector("#audio-files");
const spotifyUrlInput = document.querySelector("#spotify-url");
const eegInput = document.querySelector("#eeg-file");
const emfInput = document.querySelector("#emf-file");
const frameSizeInput = document.querySelector("#frame-size");
const hopSizeInput = document.querySelector("#hop-size");
const modulationResampleInput = document.querySelector("#modulation-resample");
const segmentationSensitivityInput = document.querySelector("#segmentation-sensitivity");
const motifSpanInput = document.querySelector("#motif-span");
const focusWindowInput = document.querySelector("#focus-window");
const biosignalLagInput = document.querySelector("#biosignal-lag");
const analyzeButton = document.querySelector("#analyze-button");
const exportButton = document.querySelector("#export-button");
const statusLine = document.querySelector("#status-line");
const modeDescription = document.querySelector("#mode-description");
const summaryGrid = document.querySelector("#summary-grid");
const selectedTrackSelect = document.querySelector("#selected-track");
const compareLeftSelect = document.querySelector("#compare-left");
const compareRightSelect = document.querySelector("#compare-right");
const audioPlayer = document.querySelector("#audio-player");
const playbackTime = document.querySelector("#playback-time");
const focusReadout = document.querySelector("#focus-readout");
const missionOutput = document.querySelector("#mission-output");
const chartATitle = document.querySelector("#chart-a-title");
const chartACopy = document.querySelector("#chart-a-copy");
const chartAReadout = document.querySelector("#chart-a-readout");
const chartACanvas = document.querySelector("#chart-a-canvas");
const chartBTitle = document.querySelector("#chart-b-title");
const chartBCopy = document.querySelector("#chart-b-copy");
const chartBReadout = document.querySelector("#chart-b-readout");
const chartBCanvas = document.querySelector("#chart-b-canvas");
const comparisonMetrics = document.querySelector("#comparison-metrics");
const comparisonCanvas = document.querySelector("#comparison-canvas");
const motifWorkbench = document.querySelector("#motif-workbench");
const annotationCategory = document.querySelector("#annotation-category");
const annotationNote = document.querySelector("#annotation-note");
const annotationList = document.querySelector("#annotation-list");
const biosignalSourceSelect = document.querySelector("#biosignal-source");
const biosignalLagValue = document.querySelector("#biosignal-lag-value");
const biosignalSummary = document.querySelector("#biosignal-summary");
const biosignalCanvas = document.querySelector("#biosignal-canvas");
const biosignalResults = document.querySelector("#biosignal-results");
const skepticOutput = document.querySelector("#skeptic-output");
const cosmicOutput = document.querySelector("#cosmic-output");
const humanReadout = document.querySelector("#human-readout");
const profileOutput = document.querySelector("#profile-output");
const qrngProvider = document.querySelector("#qrng-provider");
const qrngFallback = document.querySelector("#qrng-fallback");
const qrngCount = document.querySelector("#qrng-count");
const qrngBits = document.querySelector("#qrng-bits");
const qrngButton = document.querySelector("#qrng-button");
const qrngStatusLine = document.querySelector("#qrng-status-line");
const qrngOutput = document.querySelector("#qrng-output");
const reelList = document.querySelector("#reel-list");
const analyzeReelButton = document.querySelector("#analyze-reel");
const clearReelButton = document.querySelector("#clear-reel");
const reelOutput = document.querySelector("#reel-output");
const trackResults = document.querySelector("#track-results");
const chartTooltip = document.querySelector("#chart-tooltip");
const segmentationValue = document.querySelector("#segmentation-sensitivity-value");
const motifSpanValue = document.querySelector("#motif-span-value");
const focusWindowValue = document.querySelector("#focus-window-value");
const timelineCanvas = document.querySelector("#timeline-canvas");

const modeButtons = [...document.querySelectorAll(".mode-button")];
const missionButtons = [...document.querySelectorAll(".mission-button")];
const skepticButtons = [...document.querySelectorAll(".skeptic-button")];
const cosmicButtons = [...document.querySelectorAll(".cosmic-button")];
const profileButtons = [...document.querySelectorAll(".profile-button")];
const qrngActionButtons = [...document.querySelectorAll(".qrng-action")];

const chartRegistry = new Map();
const audioContext = new AudioContext();

function setStatus(message) {
  statusLine.textContent = message;
}

function setQrngStatus(message) {
  qrngStatusLine.textContent = message;
}

function setMissionOutput(message) {
  missionOutput.textContent = message;
}

function setSkepticOutput(text) {
  skepticOutput.textContent = text;
}

function setCosmicOutput(text) {
  cosmicOutput.textContent = text;
}

function setProfileOutput(text) {
  profileOutput.textContent = text;
}

function revealPanel(element) {
  if (!element?.scrollIntoView) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}

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

function formatSeconds(value) {
  const seconds = clamp(Number(value) || 0, 0, Number.POSITIVE_INFINITY);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function formatCompactSeconds(value) {
  return `${(Number(value) || 0).toFixed(2)} s`;
}

function normalizeScore(value, minimum, maximum) {
  if (maximum === minimum) return 0;
  return clamp((value - minimum) / (maximum - minimum), 0, 1);
}

function parseSpotifyContext(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/i);
  if (!match) {
    return {
      raw,
      type: "external-link",
      id: null,
      label: raw,
      note: "Saved as external context only. Direct waveform analysis still requires uploaded audio.",
    };
  }
  return {
    raw,
    type: match[1].toLowerCase(),
    id: match[2],
    label: `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}`,
    note: "Spotify link captured for context. Browser-side waveform analysis still requires a real audio file upload.",
  };
}

function loadAnnotations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Could not load annotations", error);
    return [];
  }
}

function persistAnnotations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.annotations));
  } catch (error) {
    console.warn("Could not persist annotations", error);
  }
}

function csvToRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index] === undefined ? "" : cells[index].trim()])
    );
  });
}

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

function analyzeFrames(signal, sampleRate, config) {
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
    envelope: centered.map((value, index) => ({ time_s: index / actualRate, envelope: value })),
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

function normalizeTimeColumn(rows) {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  const timeKey =
    keys.find((key) => ["time_s", "time", "timestamp", "seconds"].includes(key)) || keys.find((key) => key === "time_ms");
  if (!timeKey) return [];
  const normalized = rows
    .map((row) => {
      const timeValue = Number.parseFloat(row[timeKey]);
      return {
        ...row,
        time_s: timeKey === "time_ms" ? timeValue / 1000 : timeValue,
      };
    })
    .filter((row) => Number.isFinite(row.time_s))
    .sort((left, right) => left.time_s - right.time_s);
  const deduped = [];
  for (const row of normalized) {
    if (deduped.length && deduped[deduped.length - 1].time_s === row.time_s) {
      deduped[deduped.length - 1] = row;
    } else {
      deduped.push(row);
    }
  }
  return deduped;
}

function interpolate(sourceRows, key, timeS) {
  if (sourceRows.length < 2) return Number.NaN;
  if (timeS < sourceRows[0].time_s || timeS > sourceRows[sourceRows.length - 1].time_s) {
    return Number.NaN;
  }
  let index = 0;
  while (index < sourceRows.length - 1 && sourceRows[index + 1].time_s < timeS) {
    index += 1;
  }
  const left = sourceRows[index];
  const right = sourceRows[Math.min(index + 1, sourceRows.length - 1)];
  const leftValue = Number.parseFloat(left[key]);
  const rightValue = Number.parseFloat(right[key]);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return Number.NaN;
  if (left.time_s === right.time_s) return leftValue;
  const ratio = (timeS - left.time_s) / (right.time_s - left.time_s);
  return leftValue * (1 - ratio) + rightValue * ratio;
}

function pearson(left, right) {
  const paired = left
    .map((value, index) => [value, right[index]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (paired.length < 8) return Number.NaN;
  const leftMean = mean(paired.map((item) => item[0]));
  const rightMean = mean(paired.map((item) => item[1]));
  let numerator = 0;
  let leftDen = 0;
  let rightDen = 0;
  for (const [a, b] of paired) {
    numerator += (a - leftMean) * (b - rightMean);
    leftDen += (a - leftMean) ** 2;
    rightDen += (b - rightMean) ** 2;
  }
  return numerator / Math.sqrt(Math.max(leftDen * rightDen, 1e-12));
}

function correlateBiosignal(features, rows, label, options = {}) {
  const normalized = normalizeTimeColumn(rows);
  if (!normalized.length) {
    return { label, note: "No usable time column detected.", top_correlations: [] };
  }

  const numericKeys = Object.keys(normalized[0]).filter(
    (key) => key !== "time_s" && normalized.some((row) => Number.isFinite(Number.parseFloat(row[key])))
  );
  const audioKeys = Object.keys(features[0] || {}).filter((key) => key !== "time_s");
  const lags = [];
  const center = options.centerLagS ?? 0;
  const window = options.lagWindowS ?? 2;
  const step = options.lagStepS ?? 0.25;
  for (let lag = center - window; lag <= center + window + 1e-6; lag += step) {
    lags.push(Number.parseFloat(lag.toFixed(2)));
  }

  const results = [];
  for (const signalKey of numericKeys) {
    for (const audioKey of audioKeys) {
      let best = null;
      for (const lag of lags) {
        const audioSeries = [];
        const bioSeries = [];
        for (const feature of features) {
          audioSeries.push(feature[audioKey]);
          bioSeries.push(interpolate(normalized, signalKey, feature.time_s + lag));
        }
        const r = pearson(audioSeries, bioSeries);
        if (!Number.isFinite(r)) continue;
        if (!best || Math.abs(r) > Math.abs(best.pearson_r)) {
          best = { biosignal_feature: signalKey, audio_feature: audioKey, pearson_r: r, lag_s: lag };
        }
      }
      if (best) results.push(best);
    }
  }

  return {
    label,
    note: "Exploratory only. These are correlation peaks, not proof of entrainment or information transfer.",
    top_correlations: results.sort((left, right) => Math.abs(right.pearson_r) - Math.abs(left.pearson_r)).slice(0, 14),
  };
}

function validateBiosignalRows(rows, label) {
  const normalized = normalizeTimeColumn(rows);
  if (!normalized.length) return `${label}: no valid time axis found.`;
  const numericKeys = Object.keys(normalized[0]).filter(
    (key) => key !== "time_s" && normalized.some((row) => Number.isFinite(Number.parseFloat(row[key])))
  );
  const duration = normalized[normalized.length - 1].time_s - normalized[0].time_s;
  return `${label}: ${normalized.length} rows across ${duration.toFixed(2)} s with ${numericKeys.length} numeric channels.`;
}

function buildCorrelations(features) {
  const correlations = [];
  if (state.eegRows) {
    correlations.push(
      correlateBiosignal(features, state.eegRows, "EEG", {
        centerLagS: state.config.biosignalLagCenterS,
        lagWindowS: state.config.biosignalLagWindowS,
      })
    );
  }
  if (state.emfRows) {
    correlations.push(
      correlateBiosignal(features, state.emfRows, "EMF", {
        centerLagS: state.config.biosignalLagCenterS,
        lagWindowS: state.config.biosignalLagWindowS,
      })
    );
  }
  return correlations;
}

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
  view.setUint32(offset, 36 + dataLength, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * 2, true);
  offset += 4;
  view.setUint16(offset, 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataLength, true);
  offset += 4;
  for (let index = 0; index < signal.length; index += 1) {
    const sample = clamp(signal[index], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function resampleSignal(signal, fromRate, toRate) {
  if (fromRate === toRate) return signal;
  const length = Math.max(1, Math.round(signal.length * (toRate / fromRate)));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sourcePosition = (index / Math.max(length - 1, 1)) * Math.max(signal.length - 1, 1);
    const left = Math.floor(sourcePosition);
    const right = Math.min(signal.length - 1, Math.ceil(sourcePosition));
    const mix = sourcePosition - left;
    output[index] = signal[left] * (1 - mix) + signal[right] * mix;
  }
  return output;
}

async function decodeFile(file) {
  const arrayBuffer = file.arrayBuffer ? await file.arrayBuffer() : await file;
  return audioContext.decodeAudioData(arrayBuffer.slice(0));
}

async function fetchDefaultFiles() {
  const loaded = [];
  for (const filename of DEFAULT_TRACKS) {
    try {
      const response = await fetch(encodeURI(filename));
      if (!response.ok) continue;
      const blob = await response.blob();
      loaded.push(new File([blob], filename, { type: blob.type || "audio/mpeg" }));
    } catch (error) {
      console.warn("Could not auto-load", filename, error);
    }
  }
  return loaded;
}

function buildReportFromSignal({ name, mono, sampleRate, channels, audioUrl, isDerived = false, sourceRefs = [] }) {
  const frameReport = analyzeFrames(mono, sampleRate, state.config);
  const modulation = modulationAnalysis(mono, sampleRate, state.config);
  const embeddings = computeEmbeddings(frameReport.features);
  const segmentation = detectSegments(embeddings, frameReport.features, state.config);
  const symbolic = buildStructuralCodebook(frameReport.features, embeddings, modulation.bands, state.config);
  const evidence = buildEvidenceModel(frameReport.features, modulation.bands, symbolic, segmentation);

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
    segmentation,
    correlations: buildCorrelations(frameReport.features),
    averageSpectrum: Array.from(frameReport.averageSpectrum),
    spectrumFreqs: frameReport.spectrumFreqs,
    monoSignal: mono,
    audio_url: audioUrl,
    isDerived,
    source_refs: sourceRefs,
  };
}

async function analyzeFile(file) {
  const buffer = await decodeFile(file);
  const mono = downmix(buffer);
  const audioUrl = URL.createObjectURL(file);
  return buildReportFromSignal({
    name: file.name,
    mono,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    audioUrl,
  });
}

async function loadSelectedFiles() {
  if (audioInput.files && audioInput.files.length) return [...audioInput.files];
  return fetchDefaultFiles();
}

async function parseOptionalCsv(input) {
  if (!input.files || !input.files.length) return null;
  return csvToRows(await input.files[0].text());
}

function cleanupReportUrls(reports) {
  for (const report of reports) {
    if (report?.audio_url?.startsWith("blob:")) URL.revokeObjectURL(report.audio_url);
  }
}

function getAllReports() {
  return [...state.reports, ...state.derivedReports];
}

function getReportById(id) {
  return getAllReports().find((report) => report.id === id) || null;
}

function getSelectedTrack() {
  return getReportById(state.selectedTrackId) || getAllReports()[0] || null;
}

function getCurrentTime() {
  if (!audioPlayer.src || audioPlayer.dataset.trackId !== state.selectedTrackId) return 0;
  return audioPlayer.currentTime || 0;
}

function getNearestFeature(report, timeS) {
  if (!report?.features?.length) return null;
  let best = report.features[0];
  let bestDistance = Math.abs(best.time_s - timeS);
  for (const item of report.features) {
    const distance = Math.abs(item.time_s - timeS);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function getFocusRange(report) {
  const timeS = clamp(getCurrentTime(), 0, report?.duration_s || 0);
  const half = state.focusWindowS / 2;
  return {
    start: clamp(timeS - half, 0, report?.duration_s || 0),
    end: clamp(timeS + half, 0, report?.duration_s || 0),
  };
}

function getSegmentWindow(report, timeS) {
  if (!report) return { start: 0, end: 0 };
  const boundaries = report.segmentation.boundaries.map((item) => item.time_s).sort((a, b) => a - b);
  let start = 0;
  let end = report.duration_s;
  for (const boundary of boundaries) {
    if (boundary <= timeS) start = boundary;
    if (boundary > timeS) {
      end = boundary;
      break;
    }
  }
  return { start, end };
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

  return {
    strongest_match: matches[0] || null,
    matches,
    note:
      "This checks whether dominant spectral peaks sit near integer multiples of common reference tunings such as 432 Hz, 440 Hz, and 528 Hz. It is an approximate proximity test, not proof of intentional tuning.",
  };
}

function analyzeHarmonicRatios(report) {
  const targets = [
    { label: "golden_ratio", value: (1 + Math.sqrt(5)) / 2 },
    { label: "fibonacci_5_3", value: 5 / 3 },
    { label: "fibonacci_8_5", value: 8 / 5 },
    { label: "fibonacci_13_8", value: 13 / 8 },
    { label: "perfect_fifth", value: 3 / 2 },
    { label: "octave", value: 2 },
  ];
  const peaks = report.topPeaks
    .map((peak) => peak.freq_hz)
    .filter((value) => value >= 40)
    .slice(0, 8);
  const matches = [];

  for (let index = 0; index < peaks.length; index += 1) {
    for (let compare = index + 1; compare < peaks.length; compare += 1) {
      const ratio = peaks[compare] / peaks[index];
      const best = targets
        .map((target) => ({
          ratio_label: target.label,
          target_ratio: target.value,
          observed_ratio: ratio,
          deviation_percent: Math.abs((ratio - target.value) / target.value) * 100,
          base_hz: peaks[index],
          upper_hz: peaks[compare],
        }))
        .sort((left, right) => left.deviation_percent - right.deviation_percent)[0];
      matches.push(best);
    }
  }

  return {
    matches: matches.sort((left, right) => left.deviation_percent - right.deviation_percent).slice(0, 8),
    note:
      "These are the closest pairwise peak ratios against golden-ratio and Fibonacci-adjacent intervals. Small deviation suggests resemblance, not exact geometric causation.",
  };
}

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
  return { brightness, texture, dissonance: dissonanceHint };
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

function describeBodyResponse(report) {
  const dominantBand = getDominantBand(report);
  const strongestCorrelation = report.correlations
    .flatMap((group) => group.top_correlations || [])
    .sort((left, right) => Math.abs(right.pearson_r) - Math.abs(left.pearson_r))[0];

  let stateLabel = "Open Listening";
  if (dominantBand === "beta" || dominantBand === "gamma") stateLabel = "Focus Mode";
  else if (dominantBand === "alpha" || dominantBand === "theta") stateLabel = "Meditation / Trance";
  else if (dominantBand === "delta") stateLabel = "Grounded / Heavy Drift";

  const syncLabel =
    strongestCorrelation && Math.abs(strongestCorrelation.pearson_r) >= 0.45
      ? `Possible nervous-system sync cue via ${strongestCorrelation.audio_feature} vs ${strongestCorrelation.biosignal_feature}`
      : "No strong biosignal lock detected";

  return { stateLabel, syncLabel, dominantBand };
}

function buildHumanReadout(report) {
  const cosmic = classifyTimbreSignature(report);
  const quality = describeSoundQuality(report);
  const body = describeBodyResponse(report);
  return {
    vibe: describeVibe(report),
    quality: `${quality.brightness} • ${quality.texture}`,
    body: body.stateLabel,
    tuning: describeTuningLabel(report),
    spiritual: cosmic.label,
    details: {
      clarity: quality.brightness === "Bright" ? "Celestial clarity" : quality.brightness === "Dark" ? "Grounding depth" : "Centered clarity",
      vibrational_urgency: report.evidence.scores.attack_density > 0.15 ? "High" : report.evidence.scores.attack_density > 0.08 ? "Moderate" : "Low",
      harmony_alignment: quality.dissonance === "stable harmonic spacing" ? "Aligned" : "Tension present",
      biosignal_note: body.syncLabel,
      dissonance: quality.dissonance,
    },
  };
}

function formatCosmicSignatureText(report) {
  const signature = classifyTimbreSignature(report);
  const quality = describeSoundQuality(report);
  return [
    `Spectral signature for ${report.name}:`,
    `${signature.label}.`,
    ``,
    `In plain English: this sound feels ${describeVibe(report).toLowerCase()}. It leans ${quality.brightness.toLowerCase()} and ${quality.texture.toLowerCase()}, with ${quality.dissonance}.`,
    `The strongest grounding or shimmer anchor sits near ${signature.dominant_peak_hz.toFixed(1)} Hz, and the dominant modulation band is ${String(signature.dominant_band).toUpperCase()}.`,
  ].join("\n");
}

function formatUniversalTuningText(report) {
  const tuning = analyzeUniversalTuning(report);
  const best = tuning.strongest_match;
  if (!best) {
    return `Universal tuning read for ${report.name}:\nNo strong tuning family match was detected in the current peak set.`;
  }
  const closeness =
    best.absolute_cents <= 12 ? "very close" : best.absolute_cents <= 35 ? "fairly close" : "only loosely related";
  return [
    `Universal tuning read for ${report.name}:`,
    `${describeTuningLabel(report)}.`,
    ``,
    `The clearest match is ${best.observed_peak_hz.toFixed(1)} Hz, which sits ${closeness} to the ${best.reference_hz} Hz family at ${best.target_hz.toFixed(1)} Hz.`,
    `Offset: ${best.cents_off > 0 ? "+" : ""}${best.cents_off.toFixed(2)} cents.`,
    `This is a proximity check, not proof that the whole piece was intentionally tuned that way.`,
  ].join("\n");
}

function formatHarmonicRatiosText(report) {
  const ratioReport = analyzeHarmonicRatios(report);
  const top = ratioReport.matches.slice(0, 3);
  if (!top.length) {
    return `Harmonic ratio read for ${report.name}:\nThere were not enough strong peaks to compare intervals.`;
  }
  return [
    `Harmonic ratio read for ${report.name}:`,
    ...top.map(
      (match, index) =>
        `${index + 1}. ${match.base_hz.toFixed(1)} Hz to ${match.upper_hz.toFixed(1)} Hz most closely resembles ${match.ratio_label.replaceAll("_", " ")} with ${match.deviation_percent.toFixed(2)}% deviation.`
    ),
    ``,
    `These are similarity reads, not claims of exact sacred geometry.`,
  ].join("\n");
}

function formatMoodProfileText(report, profile, score) {
  const readout = buildHumanReadout(report);
  let verdict = "weak match";
  if (score >= 80) verdict = "strong match";
  else if (score >= 60) verdict = "moderate match";
  else if (score >= 40) verdict = "partial match";

  return [
    `${profile.label} profile for ${report.name}: ${verdict}.`,
    `Compatibility score: ${score.toFixed(1)} / 100.`,
    ``,
    `${profile.language}`,
    `Right now the track reads as ${readout.vibe.toLowerCase()}, ${readout.quality.toLowerCase()}, and ${readout.tuning.toLowerCase()}.`,
    `Body state read: ${readout.body}.`,
  ].join("\n");
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

function withIndefiniteArticle(label) {
  const value = String(label || "");
  return /^[aeiou]/i.test(value) ? `an ${value}` : `a ${value}`;
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

  const summary = [
    `${brighter.name} comes across brighter and more top-end forward.`,
    `${harder.name} hits harder on transients and structural friction.`,
    `${steadier.name} is the more pattern-locked track, while ${rougher.name} reads rougher at the waveform level.`,
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
    const spectrumIndex = Math.floor((index / steps) * Math.max(spectrum.length - 1, 1));
    const noveltyIndex = Math.floor((index / steps) * Math.max(novelty.length - 1, 1));
    const spectralLift = (spectrum[spectrumIndex] || 0) / spectrumMax;
    const noveltyLift = (novelty[noveltyIndex] || 0) / noveltyMax;
    return spectralLift * 0.72 + noveltyLift * 0.28;
  });
}

function drawOrbMesh(canvas, report, view, accent = "#6ee7ff") {
  if (!canvas || !report) return;
  resizeCanvasToDisplay(canvas);
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const ratio = window.devicePixelRatio || 1;
  const w = width / ratio;
  const h = height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const profile = buildOrbProfile(report);
  const metrics = summarizeReportMetrics(report);
  const baseRadius = Math.min(w, h) * 0.22 * view.zoom;
  const centerX = w * 0.5;
  const centerY = h * 0.52;
  const time = performance.now() * 0.001;
  const breathe = 1 + Math.sin(time * (0.7 + metrics.modulationHz * 0.03)) * 0.035;
  const rings = 7;

  ctx.fillStyle = "rgba(5, 11, 25, 0.86)";
  ctx.fillRect(0, 0, w, h);

  for (let ring = 0; ring < rings; ring += 1) {
    const latNorm = ring / (rings - 1);
    const latitude = (latNorm - 0.5) * Math.PI * 0.9;
    const ringScale = Math.cos(latitude);
    const vertical = Math.sin(latitude);
    const points = [];

    for (let index = 0; index < profile.length; index += 1) {
      const azimuth = (index / profile.length) * Math.PI * 2;
      const jagged = profile[index] * (0.16 + metrics.attackDensity * 0.85);
      const radius = baseRadius * breathe * (1 + jagged);
      const point = {
        x: Math.cos(azimuth) * ringScale * radius,
        y: vertical * radius,
        z: Math.sin(azimuth) * ringScale * radius,
      };
      const rotated = rotatePoint(point, view.yaw, view.pitch);
      const depth = 1.9 / (1.9 + rotated.z / Math.max(baseRadius, 1));
      points.push({
        x: centerX + rotated.x * depth,
        y: centerY + rotated.y * depth,
        depth,
      });
    }

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    const alpha = 0.16 + latNorm * 0.18;
    ctx.strokeStyle = `${accent}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0")}`;
    ctx.lineWidth = 1.1 + latNorm * 0.8;
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.12, centerX, centerY, baseRadius * 1.2);
  glow.addColorStop(0, "rgba(255,255,255,0.22)");
  glow.addColorStop(0.3, "rgba(110,231,255,0.18)");
  glow.addColorStop(1, "rgba(110,231,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius * 1.15, 0, Math.PI * 2);
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

function bindInteractiveCanvas(canvas, viewKey) {
  if (!canvas || canvas.dataset.bound === "true") return;
  canvas.dataset.bound = "true";
  const view = state.visuals[viewKey];

  canvas.addEventListener("pointerdown", (event) => {
    view.dragging = true;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!view.dragging) return;
    const dx = event.clientX - view.lastX;
    const dy = event.clientY - view.lastY;
    view.yaw += dx * 0.01;
    view.pitch = clamp(view.pitch + dy * 0.008, -1.15, 1.15);
    view.lastX = event.clientX;
    view.lastY = event.clientY;
  });
  const stopDrag = () => {
    view.dragging = false;
  };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointerleave", stopDrag);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    view.zoom = clamp(view.zoom - event.deltaY * 0.0012, 0.72, 1.8);
  });
}

function renderFeatureVisuals() {
  const primary = getSelectedTrack();
  const [left, right] = getComparisonPair();
  const artifactCanvas = document.querySelector("#artifact-canvas");
  const collisionCanvas = document.querySelector("#collision-canvas");
  if (artifactCanvas && primary) {
    bindInteractiveCanvas(artifactCanvas, "artifact");
    drawOrbMesh(artifactCanvas, primary, state.visuals.artifact, "#6ee7ff");
  }
  if (collisionCanvas) {
    bindInteractiveCanvas(collisionCanvas, "collision");
    drawCollision(collisionCanvas, left, right, buildCollisionRead(left, right));
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

const MOOD_PROFILES = {
  "astral-projection": {
    label: "Astral Projection",
    ideal: { centroid: 1700, flatness: 0.28, attackDensity: 0.06, modulationHz: 6, band: "theta" },
    language: "Favors airy brightness, low attack urgency, and slow trance-like pulsing.",
  },
  "boss-battle": {
    label: "Boss Battle",
    ideal: { centroid: 3200, flatness: 0.34, attackDensity: 0.22, modulationHz: 10, band: "beta" },
    language: "Favors high urgency, sharp attack bursts, and bright, forceful spectral weight.",
  },
  "meditation-trance": {
    label: "Meditation / Trance",
    ideal: { centroid: 1200, flatness: 0.18, attackDensity: 0.05, modulationHz: 5, band: "alpha" },
    language: "Favors grounded warmth, low transient pressure, and alpha/theta-adjacent pulsing.",
  },
};

function runMoodProfile(profileKey) {
  const report = getSelectedTrack();
  if (!report) {
    setProfileOutput("Load and analyze a track before running a mood profile.");
    return;
  }
  const profile = MOOD_PROFILES[profileKey];
  if (!profile) return;

  const centroid = mean(report.features.map((item) => item.spectral_centroid_hz));
  const flatness = mean(report.features.map((item) => item.spectral_flatness));
  const attackDensity = report.evidence.scores.attack_density || 0;
  const modulationHz = report.modulationBands.dominant_modulation_hz || 0;
  const dominantBand = getDominantBand(report);
  const score =
    100 -
    Math.min(
      100,
      Math.abs((centroid - profile.ideal.centroid) / Math.max(profile.ideal.centroid, 1)) * 30 +
        Math.abs(flatness - profile.ideal.flatness) * 80 +
        Math.abs(attackDensity - profile.ideal.attackDensity) * 220 +
        Math.abs((modulationHz - profile.ideal.modulationHz) / Math.max(profile.ideal.modulationHz, 1)) * 25 +
        (dominantBand === profile.ideal.band ? 0 : 12)
    );

  setProfileOutput(formatMoodProfileText(report, profile, score));
  revealPanel(profileOutput);
}

function runCosmicRead(kind) {
  const report = getSelectedTrack();
  if (!report) {
    setCosmicOutput("Load and analyze a track before running a cosmic read.");
    return;
  }

  if (kind === "signature") {
    setCosmicOutput(formatCosmicSignatureText(report));
    revealPanel(cosmicOutput);
    return;
  }

  if (kind === "tuning") {
    setCosmicOutput(formatUniversalTuningText(report));
    revealPanel(cosmicOutput);
    return;
  }

  if (kind === "ratios") {
    setCosmicOutput(formatHarmonicRatiosText(report));
    revealPanel(cosmicOutput);
  }
}

function getTrackAnnotations(trackId) {
  return state.annotations.filter((item) => item.trackId === trackId).sort((a, b) => a.time_s - b.time_s);
}

function getComparisonReports() {
  const all = getAllReports();
  return {
    left: getReportById(state.comparison.leftId) || all[0] || null,
    right: getReportById(state.comparison.rightId) || all[1] || all[0] || null,
  };
}

function computeFeatureMeans(report) {
  return Object.fromEntries(
    FEATURE_FIELDS.map((field) => [field, mean(report.features.map((item) => item[field]))])
  );
}

function buildComparison(left, right) {
  if (!left || !right) return null;
  const leftMeans = computeFeatureMeans(left);
  const rightMeans = computeFeatureMeans(right);
  const featureDistance = Math.sqrt(
    FEATURE_FIELDS.reduce((sum, field) => sum + (leftMeans[field] - rightMeans[field]) ** 2, 0)
  );
  const sharedMotifs = left.symbolic.top_motifs
    .map((item) => item.sequence.join(" → "))
    .filter((sequence) => right.symbolic.top_motifs.some((candidate) => candidate.sequence.join(" → ") === sequence))
    .slice(0, 4);

  return {
    featureDistance,
    repetitionGap: Math.abs(left.evidence.scores.repetition_index - right.evidence.scores.repetition_index),
    dominantModulationGap: Math.abs(left.modulationBands.dominant_modulation_hz - right.modulationBands.dominant_modulation_hz),
    sharedMotifs,
  };
}

function syncConfigFromControls() {
  state.config.frameSize = Number.parseInt(frameSizeInput.value, 10) || DEFAULT_CONFIG.frameSize;
  state.config.hopSize = Number.parseInt(hopSizeInput.value, 10) || DEFAULT_CONFIG.hopSize;
  state.config.modulationResampleHz = Number.parseInt(modulationResampleInput.value, 10) || DEFAULT_CONFIG.modulationResampleHz;
  state.config.segmentationQuantile = (Number.parseInt(segmentationSensitivityInput.value, 10) || 90) / 100;
  state.config.motifSpan = Number.parseInt(motifSpanInput.value, 10) || DEFAULT_CONFIG.motifSpan;
  state.focusWindowS = Number.parseFloat(focusWindowInput.value) || 2.5;
  state.config.biosignalLagCenterS = Number.parseFloat(biosignalLagInput.value) || 0;
  state.selectedBiosignalSource = biosignalSourceSelect.value;
}

function updateControlReadouts() {
  segmentationValue.textContent = `${segmentationSensitivityInput.value}th percentile`;
  motifSpanValue.textContent = `${motifSpanInput.value} tokens`;
  focusWindowValue.textContent = `${Number.parseFloat(focusWindowInput.value).toFixed(1)} s`;
  biosignalLagValue.textContent = `${Number.parseFloat(biosignalLagInput.value).toFixed(2)} s`;
}

function syncSelectionDefaults() {
  const all = getAllReports();
  if (!all.length) {
    state.selectedTrackId = null;
    state.comparison.leftId = null;
    state.comparison.rightId = null;
    return;
  }
  if (!getReportById(state.selectedTrackId)) state.selectedTrackId = all[0].id;
  if (!getReportById(state.comparison.leftId)) state.comparison.leftId = all[0].id;
  if (!getReportById(state.comparison.rightId)) state.comparison.rightId = all[1]?.id || all[0].id;
}

function renderTrackOptions(select, selectedId) {
  const reports = getAllReports();
  select.innerHTML = reports.length
    ? reports
        .map(
          (report) =>
            `<option value="${escapeHtml(report.id)}">${escapeHtml(report.isDerived ? `${report.name} [derived]` : report.name)}</option>`
        )
        .join("")
    : `<option value="">No tracks loaded</option>`;
  if (reports.length) select.value = selectedId || reports[0].id;
}

function renderModeState() {
  modeDescription.textContent = MODE_DEFINITIONS[state.mode].description;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
}

function renderMetricCards(reports) {
  if (!reports.length) {
    summaryGrid.innerHTML = `<div class="empty">Run the analyzer to populate the live metric deck.</div>`;
    return;
  }
  const allFeatures = reports.flatMap((report) => report.features);
  const annotations = state.annotations.length;
  const reelCount = state.reelClips.length;
  summaryGrid.innerHTML = `
    <article class="metric-card">
      <div class="label">Tracks</div>
      <div class="value">${reports.length}</div>
      <p class="metric-note">Base and derived reports currently active in the workspace.</p>
    </article>
    <article class="metric-card">
      <div class="label">Mean Energy</div>
      <div class="value">${mean(allFeatures.map((item) => item.rms)).toFixed(3)}</div>
      <p class="metric-note">Average RMS across all analyzed frames.</p>
    </article>
    <article class="metric-card">
      <div class="label">Dominant Bias</div>
      <div class="value">${escapeHtml(getDominantBand(reports[0]).toUpperCase())}</div>
      <p class="metric-note">Most energetic modulation band on the active report.</p>
    </article>
    <article class="metric-card">
      <div class="label">Annotations</div>
      <div class="value">${annotations}</div>
      <p class="metric-note">Bookmarks and notes saved in local browser storage.</p>
    </article>
    <article class="metric-card">
      <div class="label">Focus Reel</div>
      <div class="value">${reelCount}</div>
      <p class="metric-note">Queued clips ready to be fused into a derived sequence.</p>
    </article>
  `;
}

function renderHumanReadout() {
  const report = getSelectedTrack();
  if (!report) {
    humanReadout.innerHTML = `<div class="empty">Analyze a track to generate the human-language dashboard.</div>`;
    return;
  }

  const summary = buildHumanReadout(report);
  humanReadout.innerHTML = `
    <article class="human-card">
      <div class="label">Vibe</div>
      <div class="value">${escapeHtml(summary.vibe)}</div>
      <div class="detail">Maps spectral brightness, attack pressure, spread, and pulsing into an immediately felt mood.</div>
    </article>
    <article class="human-card">
      <div class="label">Sound Quality</div>
      <div class="value">${escapeHtml(summary.quality)}</div>
      <div class="detail">${escapeHtml(summary.details.harmony_alignment)} • ${escapeHtml(summary.details.dissonance)}</div>
    </article>
    <article class="human-card">
      <div class="label">Body Response</div>
      <div class="value">${escapeHtml(summary.body)}</div>
      <div class="detail">${escapeHtml(summary.details.biosignal_note)}</div>
    </article>
    <article class="human-card">
      <div class="label">Sacred / Tuning</div>
      <div class="value">${escapeHtml(summary.tuning)}</div>
      <div class="detail">${escapeHtml(summary.spiritual)}</div>
    </article>
  `;
}

function syncCanvasSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(300, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(180, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, dpr, ctx: canvas.getContext("2d") };
}

function drawChartSpec(canvas, spec) {
  const { width, height, dpr, ctx } = syncCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, 0, width, height);

  if (!spec || !spec.series?.length || !spec.series.some((series) => series.points.length)) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `${16 * dpr}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("Run analysis to populate this view.", width / 2, height / 2);
    return;
  }

  const allPoints = spec.series.flatMap((series) => series.points);
  const xMin = spec.xDomain?.[0] ?? Math.min(...allPoints.map((point) => point.x));
  const xMax = spec.xDomain?.[1] ?? Math.max(...allPoints.map((point) => point.x), 1);
  const yMin = spec.yDomain?.[0] ?? Math.min(...allPoints.map((point) => point.y));
  const yMax = spec.yDomain?.[1] ?? Math.max(...allPoints.map((point) => point.y), 1);
  const resolvedYMin = yMin === yMax ? yMin - 1 : yMin;
  const resolvedYMax = yMin === yMax ? yMax + 1 : yMax;

  const plot = {
    left: 16 * dpr,
    right: width - 16 * dpr,
    top: 14 * dpr,
    bottom: height - 16 * dpr,
  };

  const xToPx = (value) => plot.left + ((value - xMin) / Math.max(xMax - xMin, 1e-9)) * (plot.right - plot.left);
  const yToPx = (value) => plot.bottom - ((value - resolvedYMin) / Math.max(resolvedYMax - resolvedYMin, 1e-9)) * (plot.bottom - plot.top);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let step = 1; step < 4; step += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * step) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }

  if (spec.rangeHighlight) {
    const start = xToPx(spec.rangeHighlight.start);
    const end = xToPx(spec.rangeHighlight.end);
    ctx.fillStyle = spec.rangeHighlight.color || "rgba(255, 211, 111, 0.12)";
    ctx.fillRect(start, plot.top, Math.max(end - start, 2), plot.bottom - plot.top);
  }

  for (const marker of spec.markers || []) {
    const x = xToPx(marker.x);
    ctx.strokeStyle = marker.color || "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
  }

  for (const series of spec.series) {
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();
    series.points.forEach((point, index) => {
      const x = xToPx(point.x);
      const y = yToPx(point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (spec.currentX !== undefined && spec.currentX !== null) {
    const x = xToPx(spec.currentX);
    ctx.strokeStyle = "rgba(255, 123, 156, 0.9)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
  }

  if (spec.hoverX !== undefined && spec.hoverX !== null) {
    const x = xToPx(spec.hoverX);
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();

    const nearestPoints = spec.series.map((series) => {
      let nearest = series.points[0];
      let bestDistance = Math.abs(series.points[0].x - spec.hoverX);
      for (const point of series.points) {
        const distance = Math.abs(point.x - spec.hoverX);
        if (distance < bestDistance) {
          nearest = point;
          bestDistance = distance;
        }
      }
      return { series, point: nearest };
    });

    for (const item of nearestPoints) {
      ctx.fillStyle = item.series.color;
      ctx.beginPath();
      ctx.arc(xToPx(item.point.x), yToPx(item.point.y), 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function bindChart(canvas, key, buildSpec, readoutEl) {
  chartRegistry.set(key, { canvas, buildSpec, readoutEl, hoverX: null });
  if (canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";

  canvas.addEventListener("mousemove", (event) => {
    const entry = chartRegistry.get(key);
    const spec = entry.buildSpec();
    if (!spec?.series?.length) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const points = spec.series.flatMap((series) => series.points);
    const xMin = spec.xDomain?.[0] ?? Math.min(...points.map((point) => point.x));
    const xMax = spec.xDomain?.[1] ?? Math.max(...points.map((point) => point.x), 1);
    entry.hoverX = xMin + ratio * (xMax - xMin);
    drawRegisteredChart(key);

    const nearest = spec.series.map((series) => {
      let point = series.points[0];
      let distance = Math.abs(point.x - entry.hoverX);
      for (const candidate of series.points) {
        const nextDistance = Math.abs(candidate.x - entry.hoverX);
        if (nextDistance < distance) {
          point = candidate;
          distance = nextDistance;
        }
      }
      return `${series.name}: ${point.y.toFixed(3)} @ ${point.x.toFixed(2)}`;
    });
    readoutEl.textContent = nearest.join(" • ");
    chartTooltip.textContent = nearest.join("\n");
    chartTooltip.style.left = `${event.clientX + 12}px`;
    chartTooltip.style.top = `${event.clientY + 12}px`;
    chartTooltip.classList.remove("hidden");
  });

  canvas.addEventListener("mouseleave", () => {
    const entry = chartRegistry.get(key);
    entry.hoverX = null;
    readoutEl.textContent = "";
    chartTooltip.classList.add("hidden");
    drawRegisteredChart(key);
  });

  canvas.addEventListener("click", (event) => {
    const entry = chartRegistry.get(key);
    const spec = entry.buildSpec();
    if (!spec?.series?.length || !spec.onClick) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const points = spec.series.flatMap((series) => series.points);
    const xMin = spec.xDomain?.[0] ?? Math.min(...points.map((point) => point.x));
    const xMax = spec.xDomain?.[1] ?? Math.max(...points.map((point) => point.x), 1);
    spec.onClick(xMin + ratio * (xMax - xMin));
  });
}

function drawRegisteredChart(key) {
  const entry = chartRegistry.get(key);
  if (!entry) return;
  const spec = entry.buildSpec();
  if (spec) spec.hoverX = entry.hoverX;
  drawChartSpec(entry.canvas, spec);
}

function redrawAllCharts() {
  for (const key of chartRegistry.keys()) drawRegisteredChart(key);
}

function renderPlaybackState() {
  const report = getSelectedTrack();
  if (!report) {
    playbackTime.textContent = "No track loaded.";
    focusReadout.innerHTML = `<div class="empty">Analyze a track to unlock the focus deck.</div>`;
    redrawAllCharts();
    return;
  }

  playbackTime.textContent = `${escapeHtml(report.name)} • ${formatSeconds(getCurrentTime())} / ${formatSeconds(report.duration_s)}`;
  const feature = getNearestFeature(report, getCurrentTime());
  const segment = getSegmentWindow(report, getCurrentTime());
  const dominantBand = getDominantBand(report);
  focusReadout.innerHTML = `
    <article class="mini-stat">
      <div class="label">Cursor</div>
      <div class="value">${formatCompactSeconds(getCurrentTime())}</div>
    </article>
    <article class="mini-stat">
      <div class="label">Window</div>
      <div class="value">${formatCompactSeconds(segment.start)} → ${formatCompactSeconds(segment.end)}</div>
    </article>
    <article class="mini-stat">
      <div class="label">Energy</div>
      <div class="value">${feature ? feature.rms.toFixed(3) : "n/a"}</div>
    </article>
    <article class="mini-stat">
      <div class="label">Dominant Bias</div>
      <div class="value">${escapeHtml(dominantBand.toUpperCase())}</div>
    </article>
  `;
  redrawAllCharts();
}

function buildTimelineSpec(report) {
  const annotations = getTrackAnnotations(report.id).map((item) => ({
    x: item.time_s,
    color: "rgba(255, 123, 156, 0.45)",
  }));
  return {
    type: "time",
    series: [
      {
        name: "RMS",
        color: "#6ee7ff",
        points: report.features.map((item) => ({ x: item.time_s, y: item.rms })),
      },
    ],
    markers: [
      ...report.segmentation.boundaries.map((item) => ({ x: item.time_s, color: "rgba(255, 211, 111, 0.42)" })),
      ...annotations,
    ],
    currentX: getCurrentTime(),
    rangeHighlight: { ...getFocusRange(report), color: "rgba(255, 211, 111, 0.12)" },
    onClick(timeS) {
      seekToTime(timeS);
    },
  };
}

function renderModeCharts() {
  const report = getSelectedTrack();
  const definition = MODE_DEFINITIONS[state.mode];
  if (!report) {
    chartATitle.textContent = "Awaiting analysis";
    chartACopy.textContent = "Run the analyzer to populate the first interactive view.";
    chartBTitle.textContent = "Awaiting analysis";
    chartBCopy.textContent = "Run the analyzer to populate the second interactive view.";
    chartAReadout.textContent = "";
    chartBReadout.textContent = "";
    drawChartSpec(chartACanvas, null);
    drawChartSpec(chartBCanvas, null);
    return;
  }

  const [chartA, chartB] = definition.charts;
  chartATitle.textContent = chartA.title;
  chartACopy.textContent = chartA.copy;
  chartBTitle.textContent = chartB.title;
  chartBCopy.textContent = chartB.copy;

  bindChart(chartACanvas, "mode-a", () => ({ ...chartA.build(report), currentX: getCurrentTime(), onClick: seekToTime }), chartAReadout);
  bindChart(chartBCanvas, "mode-b", () => ({ ...chartB.build(report), currentX: getCurrentTime(), onClick: chartB.build(report).type === "time" ? seekToTime : null }), chartBReadout);
  drawRegisteredChart("mode-a");
  drawRegisteredChart("mode-b");
}

function renderComparisonPanel() {
  const { left, right } = getComparisonReports();
  if (!left || !right) {
    comparisonMetrics.innerHTML = `<div class="empty">Load at least one report to use the comparison workspace.</div>`;
    drawChartSpec(comparisonCanvas, null);
    return;
  }

  const summary = buildComparison(left, right);
  comparisonMetrics.innerHTML = `
    <article class="mini-stat">
      <div class="label">Feature Distance</div>
      <div class="value">${summary.featureDistance.toFixed(2)}</div>
    </article>
    <article class="mini-stat">
      <div class="label">Repetition Gap</div>
      <div class="value">${summary.repetitionGap.toFixed(3)}</div>
    </article>
    <article class="mini-stat">
      <div class="label">Mod Gap</div>
      <div class="value">${summary.dominantModulationGap.toFixed(2)} Hz</div>
    </article>
    <article class="mini-stat">
      <div class="label">Shared Motifs</div>
      <div class="value">${summary.sharedMotifs.length}</div>
    </article>
  `;

  bindChart(
    comparisonCanvas,
    "comparison",
    () => ({
      type: "time",
      series: [
        {
          name: left.name,
          color: "#6ee7ff",
          points: left.features.map((item) => ({ x: item.time_s, y: item.rms })),
        },
        {
          name: right.name,
          color: "#ffd36f",
          points: right.features.map((item) => ({ x: item.time_s, y: item.rms })),
        },
      ],
      currentX: getCurrentTime(),
      onClick(timeS) {
        seekToTime(timeS);
      },
    }),
    chartBReadout
  );
  drawRegisteredChart("comparison");
}

function renderMotifWorkbench() {
  const report = getSelectedTrack();
  if (!report) {
    motifWorkbench.innerHTML = `<div class="empty">Motifs appear here after analysis.</div>`;
    return;
  }

  motifWorkbench.innerHTML = report.symbolic.top_motifs.length
    ? report.symbolic.top_motifs
        .map(
          (motif, index) => `
            <article class="motif-card">
              <div class="label">Motif ${index + 1}</div>
              <div class="motif-sequence">${escapeHtml(motif.sequence.join(" → "))}</div>
              <div class="pill-row">
                <div class="chip"><strong>Repeats</strong> ${motif.count}</div>
                <div class="chip"><strong>Hits shown</strong> ${motif.occurrences.length}</div>
              </div>
              <div class="occurrence-list">
                ${motif.occurrences
                  .slice(0, 6)
                  .map(
                    (hit) => `
                      <button class="occurrence-button" type="button" data-action="jump-motif" data-time="${hit.time_s}">
                        ${formatCompactSeconds(hit.time_s)}
                      </button>
                    `
                  )
                  .join("")}
                ${
                  motif.occurrences[0]
                    ? `<button class="occurrence-button" type="button" data-action="clip-motif" data-time="${motif.occurrences[0].time_s}">
                        Add First Hit
                      </button>`
                    : ""
                }
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty">No motifs extracted for the active report.</div>`;
}

function renderAnnotations() {
  const report = getSelectedTrack();
  if (!report) {
    annotationList.innerHTML = `<div class="empty">Annotations attach to the active track.</div>`;
    return;
  }
  const annotations = getTrackAnnotations(report.id);
  annotationList.innerHTML = annotations.length
    ? annotations
        .map(
          (item) => `
            <article class="annotation-card">
              <div class="label">${escapeHtml(item.category)}</div>
              <div class="motif-sequence">${escapeHtml(item.note || "No note")}</div>
              <div class="annotation-meta">${formatCompactSeconds(item.time_s)}</div>
              <div class="annotation-actions">
                <button class="text-button" type="button" data-action="jump-annotation" data-time="${item.time_s}">Jump</button>
                <button class="text-button" type="button" data-action="delete-annotation" data-id="${escapeHtml(item.id)}">Delete</button>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty">No annotations on the active track yet.</div>`;
}

function getCorrelationSelection(report, source) {
  const correlationGroup = report?.correlations.find((item) => item.label === source);
  if (!correlationGroup?.top_correlations?.length) return null;
  const key = state.selectedCorrelationKeys[source];
  return (
    correlationGroup.top_correlations.find((item) => `${item.audio_feature}|${item.biosignal_feature}` === key) ||
    correlationGroup.top_correlations[0]
  );
}

function renderBiosignalPanel() {
  const report = getSelectedTrack();
  const source = state.selectedBiosignalSource;
  const validation = state.biosignalValidation[source] || `${source}: no file loaded.`;
  biosignalSummary.textContent = `${validation} Lag center ${state.config.biosignalLagCenterS.toFixed(2)} s.`;

  if (!report) {
    biosignalResults.innerHTML = `<div class="empty">Load audio and optional biosignals to inspect alignment.</div>`;
    drawChartSpec(biosignalCanvas, null);
    return;
  }

  const selected = getCorrelationSelection(report, source);
  const group = report.correlations.find((item) => item.label === source);
  biosignalResults.innerHTML = group?.top_correlations?.length
    ? group.top_correlations
        .slice(0, 8)
        .map((item) => {
          const key = `${item.audio_feature}|${item.biosignal_feature}`;
          const active = selected && key === `${selected.audio_feature}|${selected.biosignal_feature}`;
          return `
            <article class="biosignal-card">
              <div class="label">${escapeHtml(item.audio_feature)} vs ${escapeHtml(item.biosignal_feature)}</div>
              <div class="pill-row">
                <div class="biosignal-pill"><strong>r</strong> ${item.pearson_r.toFixed(3)}</div>
                <div class="biosignal-pill"><strong>lag</strong> ${item.lag_s.toFixed(2)} s</div>
              </div>
              <div class="annotation-actions">
                <button class="text-button" type="button" data-action="select-correlation" data-source="${source}" data-key="${escapeHtml(key)}">
                  ${active ? "Active Pair" : "Focus Pair"}
                </button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty">No ${source} correlations available yet.</div>`;

  bindChart(
    biosignalCanvas,
    "biosignal",
    () => {
      if (!selected) return null;
      const rows = normalizeTimeColumn(source === "EEG" ? state.eegRows : state.emfRows);
      const audioPoints = report.features.map((item) => ({ x: item.time_s, y: item[selected.audio_feature] }));
      const biosignalPoints = report.features.map((item) => ({
        x: item.time_s,
        y: interpolate(rows, selected.biosignal_feature, item.time_s + selected.lag_s),
      }));
      const numeric = biosignalPoints.filter((item) => Number.isFinite(item.y));
      return {
        type: "time",
        series: [
          { name: selected.audio_feature, color: "#6ee7ff", points: audioPoints },
          { name: selected.biosignal_feature, color: "#ff7b9c", points: numeric },
        ],
        currentX: getCurrentTime(),
        onClick(timeS) {
          seekToTime(timeS);
        },
      };
    },
    chartAReadout
  );
  drawRegisteredChart("biosignal");
}

function renderReelPanel() {
  reelList.innerHTML = state.reelClips.length
    ? state.reelClips
        .map((clip) => {
          const report = getReportById(clip.sourceId);
          return `
            <article class="reel-card">
              <div class="label">${escapeHtml(report?.name || "Missing source")}</div>
              <div class="motif-sequence">${formatCompactSeconds(clip.start)} → ${formatCompactSeconds(clip.end)}</div>
              <div class="reel-actions">
                <button class="text-button" type="button" data-action="remove-reel-clip" data-id="${escapeHtml(clip.id)}">Remove</button>
                <button class="text-button" type="button" data-action="jump-reel-clip" data-time="${clip.start}" data-source="${escapeHtml(clip.sourceId)}">Jump</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty">Queue clips from the focus deck, motifs, or missions.</div>`;

  const reelReport = state.derivedReports[0];
  if (!reelReport) {
    reelOutput.textContent = "No derived reel analysis yet.";
    return;
  }

  reelOutput.textContent = JSON.stringify(
    {
      name: reelReport.name,
      duration_s: Number(reelReport.duration_s.toFixed(3)),
      dominant_band: getDominantBand(reelReport),
      repetition_index: Number(reelReport.evidence.scores.repetition_index.toFixed(3)),
      top_motif: reelReport.symbolic.top_motifs[0]?.sequence || [],
    },
    null,
    2
  );
}

function renderTrackCards(reports) {
  if (!reports.length) {
    trackResults.innerHTML = `
      <section class="dashboard-shell">
        <div class="empty-dashboard">
          <article class="empty-card">
            <p class="dashboard-kicker">Solo</p>
            <h3>Upload one track.</h3>
            <p class="feature-subtitle">The app renders the artifact, state score, and energy read right away.</p>
          </article>
          <article class="empty-card">
            <p class="dashboard-kicker">Compare</p>
            <h3>Upload two tracks.</h3>
            <p class="feature-subtitle">Compare and collision unlock only when two real audio files are loaded.</p>
          </article>
        </div>
      </section>
    `;
    return;
  }

  const primary = getSelectedTrack() || reports[0];
  const [left, right] = getComparisonPair();
  const human = buildHumanReadout(primary);
  const stateScore = buildStateEngineering(primary);
  const energy = buildEnergyRead(primary);
  const comparison = buildCompareRead(left, right);
  const collision = buildCollisionRead(left, right);
  const spotifyContext = parseSpotifyContext(state.spotifyContext);

  trackResults.innerHTML = `
    <section class="dashboard-shell">
      <div class="dashboard-toolbar">
        <div class="track-switcher">
          ${reports
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
            .join("")}
        </div>
        <div class="app-summary">
          <div class="toolbar-copy">
            <p>${escapeHtml(primary.name)} is active. It reads ${escapeHtml(human.vibe.toLowerCase())} with ${escapeHtml(withIndefiniteArticle(energy.label.toLowerCase()))} energy profile.</p>
          </div>
          <div class="micro-stat-row">
            <div class="micro-stat">
              <div class="micro-stat-label">Surface</div>
              <div class="micro-stat-value">${escapeHtml(human.quality)}</div>
            </div>
            <div class="micro-stat">
              <div class="micro-stat-label">Tuning</div>
              <div class="micro-stat-value">${escapeHtml(human.tuning)}</div>
            </div>
            <div class="micro-stat">
              <div class="micro-stat-label">Harmony</div>
              <div class="micro-stat-value">${escapeHtml(human.details.harmony_alignment)}</div>
            </div>
          </div>
          ${
            spotifyContext
              ? `<p class="spotify-note">${escapeHtml(spotifyContext.note)}</p>`
              : ""
          }
        </div>
      </div>

      <div class="dashboard-grid">
        <article class="feature-card">
          <p class="dashboard-kicker">01 • Artifact</p>
          <h3>Liquid glass orb</h3>
          <p class="feature-subtitle">Built from the real spectrum, novelty, and transient structure. Drag to rotate. Scroll to zoom.</p>
          <canvas id="artifact-canvas" class="orb-canvas"></canvas>
          <p class="artifact-note">Jaggedness follows structural friction. Breathing speed follows the measured modulation rate at ${primary.modulationBands.dominant_modulation_hz.toFixed(2)} Hz.</p>
        </article>

        <article class="feature-card">
          <p class="dashboard-kicker">02 • State</p>
          <h3>${escapeHtml(stateScore.verdict)}</h3>
          <p class="feature-subtitle">${escapeHtml(stateScore.guidance)}</p>
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
          <p class="score-note">These scores are derived from RMS energy, attack density, spectral roughness, phase stability, and modulation behavior.</p>
        </article>

        <article class="feature-card">
          <p class="dashboard-kicker">03 • Energy</p>
          <h3>${escapeHtml(energy.label)}</h3>
          <div class="energy-stack">
            <span class="tone-badge">${escapeHtml(energy.label)} profile</span>
            <p class="feature-subtitle">${escapeHtml(energy.copy)}</p>
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
        </article>

        <article class="feature-card">
          <p class="dashboard-kicker">04 • Compare</p>
          <h3>${escapeHtml(comparison.title)}</h3>
          <p class="feature-subtitle">${comparison.summary}</p>
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
                      <p class="compare-note">Upload a second song to populate this card.</p>
                    </div>
                  `
            }
          </div>
        </article>

        <article class="feature-card">
          <p class="dashboard-kicker">05 • Collision</p>
          <h3>${escapeHtml(collision.label)}${collision.score !== null ? ` • ${collision.score}% compatibility` : ""}</h3>
          <p class="feature-subtitle">${escapeHtml(collision.summary)}</p>
          <canvas id="collision-canvas" class="collision-canvas"></canvas>
          <p class="collision-note">Experimental. The score is driven by measured differences in centroid, modulation pace, phase stability, repetition lock, and dominant peak placement.</p>
        </article>
      </div>
    </section>
  `;

  renderFeatureVisuals();
}

function syncAudioPlayer({ preserveTime = true } = {}) {
  const report = getSelectedTrack();
  if (!report) {
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    return;
  }
  const shouldPreserve = preserveTime && audioPlayer.dataset.trackId === report.id;
  const current = shouldPreserve ? audioPlayer.currentTime || 0 : 0;
  if (audioPlayer.dataset.trackId !== report.id) {
    audioPlayer.src = report.audio_url;
    audioPlayer.dataset.trackId = report.id;
    audioPlayer.load();
    state.pendingSeek = current;
  } else if (shouldPreserve) {
    audioPlayer.currentTime = clamp(current, 0, report.duration_s);
  }
}

function renderAll() {
  syncSelectionDefaults();
  renderModeState();
  renderTrackOptions(selectedTrackSelect, state.selectedTrackId);
  renderTrackOptions(compareLeftSelect, state.comparison.leftId);
  renderTrackOptions(compareRightSelect, state.comparison.rightId);
  exportButton.disabled = !getAllReports().length;
  renderMetricCards(getAllReports());
  renderHumanReadout();
  renderModeCharts();
  renderComparisonPanel();
  renderMotifWorkbench();
  renderAnnotations();
  renderBiosignalPanel();
  renderReelPanel();
  renderTrackCards(getAllReports());
  bindChart(timelineCanvas, "timeline", () => {
    const report = getSelectedTrack();
    return report ? buildTimelineSpec(report) : null;
  }, chartAReadout);
  syncAudioPlayer();
  renderPlaybackState();
}

function setSelectedTrack(id, options = {}) {
  state.selectedTrackId = id;
  selectedTrackSelect.value = id;
  syncAudioPlayer({ preserveTime: false });
  if (options.timeS !== undefined) {
    state.pendingSeek = options.timeS;
  }
  renderAll();
}

function seekToTime(timeS) {
  const report = getSelectedTrack();
  if (!report) return;
  const next = clamp(timeS, 0, report.duration_s);
  if (audioPlayer.readyState >= 1) {
    audioPlayer.currentTime = next;
  } else {
    state.pendingSeek = next;
  }
  renderPlaybackState();
}

function jumpBoundary(direction) {
  const report = getSelectedTrack();
  if (!report) return;
  const now = getCurrentTime();
  const boundaries = report.segmentation.boundaries.map((item) => item.time_s).sort((a, b) => a - b);
  const target =
    direction === "next"
      ? boundaries.find((timeS) => timeS > now + 0.05)
      : [...boundaries].reverse().find((timeS) => timeS < now - 0.05);
  if (target !== undefined) seekToTime(target);
}

function addAnnotation(category, note, timeS = getCurrentTime()) {
  const report = getSelectedTrack();
  if (!report) return;
  state.annotations.push({
    id: `${report.id}-${Date.now()}`,
    trackId: report.id,
    category,
    note,
    time_s: clamp(timeS, 0, report.duration_s),
  });
  persistAnnotations();
  renderAnnotations();
  renderPlaybackState();
}

function addFocusClip(start, end, sourceId = state.selectedTrackId) {
  state.reelClips.push({
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sourceId,
    start,
    end,
  });
  renderReelPanel();
}

function addCurrentFocusClip() {
  const report = getSelectedTrack();
  if (!report) return;
  const range = getFocusRange(report);
  addFocusClip(range.start, range.end, report.id);
  setMissionOutput(`Queued ${formatCompactSeconds(range.start)} → ${formatCompactSeconds(range.end)} from ${report.name}.`);
}

async function analyzeReel() {
  if (!state.reelClips.length) {
    setMissionOutput("Queue at least one clip before analyzing the reel.");
    return;
  }
  const baseReports = getAllReports().filter((report) => !report.isDerived);
  if (!baseReports.length) return;
  const targetRate = baseReports[0].sample_rate_hz;
  const gap = new Float32Array(Math.round(targetRate * 0.05));
  const chunks = [];

  for (const clip of state.reelClips) {
    const report = getReportById(clip.sourceId);
    if (!report?.monoSignal) continue;
    const source = report.sample_rate_hz === targetRate ? report.monoSignal : resampleSignal(report.monoSignal, report.sample_rate_hz, targetRate);
    const start = clamp(Math.floor(clip.start * targetRate), 0, source.length);
    const end = clamp(Math.ceil(clip.end * targetRate), start + 1, source.length);
    chunks.push(source.subarray(start, end));
    chunks.push(gap);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  cleanupReportUrls(state.derivedReports);
  const audioUrl = URL.createObjectURL(encodeWavBlob(combined, targetRate));
  state.derivedReports = [
    buildReportFromSignal({
      name: `Focus Reel (${state.reelClips.length} clips)`,
      mono: combined,
      sampleRate: targetRate,
      channels: 1,
      audioUrl,
      isDerived: true,
      sourceRefs: state.reelClips,
    }),
  ];
  syncSelectionDefaults();
  renderAll();
  setMissionOutput("Derived reel analyzed and added to the workspace.");
}

function removeReelClip(id) {
  state.reelClips = state.reelClips.filter((item) => item.id !== id);
  renderReelPanel();
}

function clearReel() {
  state.reelClips = [];
  cleanupReportUrls(state.derivedReports);
  state.derivedReports = [];
  renderAll();
}

async function fetchQrngSample() {
  try {
    setQrngStatus("Fetching QRNG sample...");
    const params = new URLSearchParams({
      provider: qrngProvider.value,
      fallback: qrngFallback.value,
      count: String(Math.max(1, Number.parseInt(qrngCount.value || "16", 10))),
      bits: qrngBits.value,
    });
    const response = await fetch(`/api/qrng?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail || "QRNG request failed.");
    state.qrngSample = payload;
    state.qrngCursor = 0;
    qrngOutput.textContent = JSON.stringify(payload, null, 2);
    setQrngStatus(`QRNG ready from ${payload.source.toUpperCase()} (${payload.count} values).`);
    return payload;
  } catch (error) {
    qrngOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
    setQrngStatus(`QRNG failed: ${error.message}`);
    throw error;
  }
}

async function ensureQrngSample() {
  if (state.qrngSample?.data?.length) return state.qrngSample;
  return fetchQrngSample();
}

function consumeQrngValue(modulo) {
  const sample = state.qrngSample;
  if (!sample?.data?.length) return Math.floor(Math.random() * modulo);
  const value = sample.data[state.qrngCursor % sample.data.length];
  state.qrngCursor += 1;
  return Math.abs(value) % modulo;
}

async function runQrngAction(kind) {
  const reports = getAllReports();
  if (!reports.length) return;
  await ensureQrngSample();
  if (kind === "segment") {
    const report = reports[consumeQrngValue(reports.length)];
    setSelectedTrack(report.id);
    const ratio = consumeQrngValue(1000) / 1000;
    seekToTime(ratio * report.duration_s);
    setMissionOutput(`QRNG sampled ${report.name} at ${formatCompactSeconds(getCurrentTime())}.`);
  }
  if (kind === "motif") {
    const report = reports[consumeQrngValue(reports.length)];
    const motifs = report.symbolic.top_motifs.filter((item) => item.occurrences.length);
    if (!motifs.length) return;
    const motif = motifs[consumeQrngValue(motifs.length)];
    const hit = motif.occurrences[consumeQrngValue(motif.occurrences.length)];
    setSelectedTrack(report.id);
    seekToTime(hit.time_s);
    setMissionOutput(`QRNG motif sample: ${motif.sequence.join(" → ")} at ${formatCompactSeconds(hit.time_s)}.`);
  }
}

function shuffleArray(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function runSkepticCheck(kind) {
  const report = getSelectedTrack();
  if (!report) return;
  if (kind === "evidence") {
    setSkepticOutput(
      JSON.stringify(
        {
          descriptors: report.evidence.descriptors,
          scores: report.evidence.scores,
          dominant_band: getDominantBand(report),
          top_peaks: report.topPeaks.slice(0, 5),
        },
        null,
        2
      )
    );
    return;
  }

  if (kind === "noise-floor") {
    const flatness = report.features.map((item) => item.spectral_flatness);
    const rms = report.features.map((item) => item.rms);
    setSkepticOutput(
      JSON.stringify(
        {
          flatness_p10: Number(percentile(flatness, 0.1).toFixed(4)),
          flatness_p50: Number(percentile(flatness, 0.5).toFixed(4)),
          flatness_p90: Number(percentile(flatness, 0.9).toFixed(4)),
          rms_p10: Number(percentile(rms, 0.1).toFixed(4)),
          rms_p50: Number(percentile(rms, 0.5).toFixed(4)),
          rms_p90: Number(percentile(rms, 0.9).toFixed(4)),
        },
        null,
        2
      )
    );
    return;
  }

  if (kind === "shuffle") {
    const source = state.selectedBiosignalSource;
    const rows = normalizeTimeColumn(source === "EEG" ? state.eegRows : state.emfRows);
    const selection = getCorrelationSelection(report, source);
    if (!rows.length || !selection) {
      setSkepticOutput("No biosignal correlation is available for shuffle testing.");
      return;
    }
    const numeric = rows
      .map((row) => Number.parseFloat(row[selection.biosignal_feature]))
      .filter((value) => Number.isFinite(value));
    if (numeric.length < 8) {
      setSkepticOutput("Not enough numeric biosignal data to run a shuffle baseline.");
      return;
    }
    const shuffled = shuffleArray(numeric);
    const sampled = report.features.map((feature, index) => [feature[selection.audio_feature], shuffled[index % shuffled.length]]);
    const actual = selection.pearson_r;
    const shuffledR = pearson(
      sampled.map((item) => item[0]),
      sampled.map((item) => item[1])
    );
    setSkepticOutput(
      JSON.stringify(
        {
          source,
          pair: `${selection.audio_feature} vs ${selection.biosignal_feature}`,
          actual_r: Number(actual.toFixed(4)),
          shuffled_r: Number(shuffledR.toFixed(4)),
          survived_shuffle: Math.abs(actual) > Math.abs(shuffledR),
        },
        null,
        2
      )
    );
  }
}

async function runMission(kind) {
  const reports = getAllReports();
  if (!reports.length) return;

  if (kind === "repetition") {
    const report = reports
      .slice()
      .sort((left, right) => right.evidence.scores.repetition_index - left.evidence.scores.repetition_index)[0];
    const motif = report.symbolic.top_motifs[0];
    setSelectedTrack(report.id);
    if (motif?.occurrences?.[0]) seekToTime(motif.occurrences[0].time_s);
    setMissionOutput(`Most repetitive report: ${report.name}. Focused the top motif.`);
    return;
  }

  if (kind === "modulation") {
    const report = reports
      .slice()
      .sort((left, right) => right.modulationBands.dominant_modulation_hz - left.modulationBands.dominant_modulation_hz)[0];
    setSelectedTrack(report.id);
    setMissionOutput(`Strongest dominant modulation found in ${report.name} at ${report.modulationBands.dominant_modulation_hz.toFixed(2)} Hz.`);
    return;
  }

  if (kind === "skeptic") {
    runSkepticCheck("shuffle");
    setMissionOutput("Ran a shuffled-baseline challenge on the active biosignal pairing.");
    return;
  }

  if (kind === "spectral-signature") {
    runCosmicRead("signature");
    setMissionOutput("Spectral signature generated below in plain English.");
    return;
  }

  if (kind === "universal-tuning") {
    runCosmicRead("tuning");
    setMissionOutput("Universal tuning read generated below in plain English.");
    return;
  }

  if (kind === "astral-projection" || kind === "boss-battle" || kind === "meditation-trance") {
    runMoodProfile(kind);
    setMissionOutput(`${MOOD_PROFILES[kind].label} profile generated below in plain English.`);
    return;
  }

  if (kind === "random-segment") {
    await runQrngAction("segment");
    return;
  }

  if (kind === "build-reel") {
    addCurrentFocusClip();
  }
}

function recomputeCorrelationsOnly() {
  for (const report of getAllReports()) {
    report.correlations = buildCorrelations(report.features);
  }
  renderBiosignalPanel();
  renderTrackCards(getAllReports());
}

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
    segmentation: report.segmentation,
    correlations: report.correlations,
    isDerived: report.isDerived,
    source_refs: report.source_refs,
  };
}

function exportResults() {
  const payload = {
    created_at: new Date().toISOString(),
    mode: state.mode,
    config: state.config,
    focus_window_s: state.focusWindowS,
    reports: getAllReports().map(serializeReport),
    annotations: state.annotations,
    reel_clips: state.reelClips,
    qrng_sample: state.qrngSample,
    guardrails: [
      "This export contains acoustic heuristics and correlations, not proof of hidden language or neural transmission.",
      "Use biosignal matches as leads for controlled testing, not conclusions.",
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

async function runAnalysis() {
  try {
    syncConfigFromControls();
    updateControlReadouts();
    state.spotifyContext = spotifyUrlInput?.value.trim() || "";
    setStatus("Preparing files...");
    await audioContext.resume();
    state.eegRows = await parseOptionalCsv(eegInput);
    state.emfRows = await parseOptionalCsv(emfInput);
    state.biosignalValidation = {
      EEG: validateBiosignalRows(state.eegRows, "EEG"),
      EMF: validateBiosignalRows(state.emfRows, "EMF"),
    };

    if ((!audioInput.files || !audioInput.files.length) && state.spotifyContext) {
      setStatus("Spotify links can be captured for context, but direct analysis still requires an uploaded audio file.");
      return;
    }

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
    state.reelClips = [];
    state.reports = reports;
    syncSelectionDefaults();
    renderAll();
    setStatus(`Analysis complete for ${reports.length} track(s).`);
  } catch (error) {
    console.error(error);
    setStatus(`Analysis failed: ${error.message}`);
  }
}

analyzeButton.addEventListener("click", runAnalysis);
exportButton.addEventListener("click", exportResults);
qrngButton.addEventListener("click", fetchQrngSample);

selectedTrackSelect.addEventListener("change", (event) => {
  setSelectedTrack(event.target.value, { preserveTime: false });
});

compareLeftSelect.addEventListener("change", (event) => {
  state.comparison.leftId = event.target.value;
  renderComparisonPanel();
});

compareRightSelect.addEventListener("change", (event) => {
  state.comparison.rightId = event.target.value;
  renderComparisonPanel();
});

focusWindowInput.addEventListener("input", () => {
  syncConfigFromControls();
  updateControlReadouts();
  renderPlaybackState();
});

segmentationSensitivityInput.addEventListener("input", updateControlReadouts);
motifSpanInput.addEventListener("input", updateControlReadouts);

biosignalLagInput.addEventListener("input", () => {
  syncConfigFromControls();
  updateControlReadouts();
  recomputeCorrelationsOnly();
});

biosignalSourceSelect.addEventListener("change", () => {
  syncConfigFromControls();
  renderBiosignalPanel();
});

audioPlayer.addEventListener("timeupdate", renderPlaybackState);
audioPlayer.addEventListener("play", renderPlaybackState);
audioPlayer.addEventListener("pause", renderPlaybackState);
audioPlayer.addEventListener("loadedmetadata", () => {
  const report = getSelectedTrack();
  if (!report) return;
  if (state.pendingSeek !== null) {
    audioPlayer.currentTime = clamp(state.pendingSeek, 0, report.duration_s);
    state.pendingSeek = null;
  }
  renderPlaybackState();
});

document.querySelector("#prev-segment").addEventListener("click", () => jumpBoundary("prev"));
document.querySelector("#next-segment").addEventListener("click", () => jumpBoundary("next"));
document.querySelector("#bookmark-focus").addEventListener("click", () => {
  addAnnotation(annotationCategory.value, annotationNote.value.trim() || "Quick bookmark");
  annotationNote.value = "";
});
document.querySelector("#add-focus-clip").addEventListener("click", addCurrentFocusClip);
document.querySelector("#save-annotation").addEventListener("click", () => {
  addAnnotation(annotationCategory.value, annotationNote.value.trim() || "Annotation");
  annotationNote.value = "";
});

analyzeReelButton.addEventListener("click", analyzeReel);
clearReelButton.addEventListener("click", clearReel);

modeButtons.forEach((button) =>
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    renderAll();
  })
);

missionButtons.forEach((button) =>
  button.addEventListener("click", () => {
    runMission(button.dataset.mission).catch((error) => setMissionOutput(error.message));
  })
);

skepticButtons.forEach((button) =>
  button.addEventListener("click", () => {
    runSkepticCheck(button.dataset.skeptic);
  })
);

cosmicButtons.forEach((button) =>
  button.addEventListener("click", () => {
    runCosmicRead(button.dataset.cosmic);
  })
);

profileButtons.forEach((button) =>
  button.addEventListener("click", () => {
    runMoodProfile(button.dataset.profile);
  })
);

qrngActionButtons.forEach((button) =>
  button.addEventListener("click", () => {
    runQrngAction(button.dataset.qrngAction).catch((error) => setMissionOutput(error.message));
  })
);

motifWorkbench.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "jump-motif") {
    seekToTime(Number.parseFloat(button.dataset.time));
  }
  if (button.dataset.action === "clip-motif") {
    const timeS = Number.parseFloat(button.dataset.time);
    addFocusClip(Math.max(0, timeS - state.focusWindowS / 2), timeS + state.focusWindowS / 2);
  }
});

annotationList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "jump-annotation") {
    seekToTime(Number.parseFloat(button.dataset.time));
  }
  if (button.dataset.action === "delete-annotation") {
    state.annotations = state.annotations.filter((item) => item.id !== button.dataset.id);
    persistAnnotations();
    renderAnnotations();
  }
});

biosignalResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='select-correlation']");
  if (!button) return;
  state.selectedCorrelationKeys[button.dataset.source] = button.dataset.key;
  renderBiosignalPanel();
});

reelList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "remove-reel-clip") {
    removeReelClip(button.dataset.id);
  }
  if (button.dataset.action === "jump-reel-clip") {
    setSelectedTrack(button.dataset.source);
    seekToTime(Number.parseFloat(button.dataset.time));
  }
});

trackResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "focus-track") {
    setSelectedTrack(button.dataset.trackId);
  }
  if (button.dataset.action === "jump-track-time") {
    setSelectedTrack(button.dataset.trackId);
    seekToTime(Number.parseFloat(button.dataset.time));
  }
});

window.addEventListener("resize", redrawAllCharts);

updateControlReadouts();
setSkepticOutput("No skeptical check run yet.");
setCosmicOutput("No cosmic read has been generated yet.");
setProfileOutput("No mood profile run yet.");
humanReadout.innerHTML = `<div class="empty">Analyze a track to generate the human-language dashboard.</div>`;
trackResults.innerHTML = `
  <section class="dashboard-shell">
    <div class="empty-dashboard">
      <article class="empty-card">
        <p class="dashboard-kicker">Blank State</p>
        <h3>Upload one track for the solo dashboard.</h3>
        <p class="feature-subtitle">The app will render the artifact orb, state engineering score, and energy read from the analyzed waveform.</p>
      </article>
      <article class="empty-card">
        <p class="dashboard-kicker">Compare Mode</p>
        <h3>Upload two tracks to unlock compare and collision.</h3>
        <p class="feature-subtitle">The fourth and fifth cards activate only when there are two real audio files to compare.</p>
      </article>
    </div>
  </section>
`;
motifWorkbench.innerHTML = `<div class="empty">Motifs appear here after analysis.</div>`;
annotationList.innerHTML = `<div class="empty">Annotations attach to the active track.</div>`;
biosignalResults.innerHTML = `<div class="empty">Load audio and optional biosignals to inspect alignment.</div>`;
reelList.innerHTML = `<div class="empty">Queue clips from the focus deck, motifs, or missions.</div>`;
reelOutput.textContent = "No derived reel analysis yet.";
biosignalSummary.textContent = "EEG: no file loaded. Lag center 0.00 s.";
renderMetricCards([]);
drawChartSpec(chartACanvas, null);
drawChartSpec(chartBCanvas, null);
drawChartSpec(comparisonCanvas, null);
drawChartSpec(biosignalCanvas, null);
drawChartSpec(timelineCanvas, null);
startVisualLoop();
