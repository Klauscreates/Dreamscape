import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual DSP functions without browser/audio-device dependencies.
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from "\.\/[^"\n]+";\n/gm, '')
  .split('// ─── Event wiring')[0];
const context = {
  window: {}, document: {querySelector: () => ({})}, AudioContext: class {},
  performance, setTimeout, console, URL, Blob,
};
vm.createContext(context);
vm.runInContext(source + '\nglobalThis.analyze = buildReportFromSignal; globalThis.score = buildStateEngineering;', context);

async function tone(hz) {
  const sampleRate = 44100;
  const mono = Float32Array.from({length: sampleRate}, (_, i) =>
    0.18 * Math.sin(2 * Math.PI * hz * i / sampleRate));
  return context.analyze({name: 'test-tone.wav', mono, sampleRate, channels: 1, audioUrl: ''});
}
function finite(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'Nonfinite analysis value');
  else if (value && typeof value === 'object') Object.values(value).forEach(finite);
}
const low = await tone(220), repeat = await tone(220), high = await tone(4000);
finite(low); finite(high);
assert.equal(JSON.stringify(low.features), JSON.stringify(repeat.features), 'DSP must be deterministic');
assert.equal(JSON.stringify(low.advanced), JSON.stringify(repeat.advanced));
const centroid = r => r.features.reduce((sum, f) => sum + f.spectral_centroid_hz, 0) / r.features.length;
assert.ok(centroid(high) > centroid(low) + 3000, 'Different audio must yield different spectral measurements');
for (const report of [low, high]) {
  for (const entry of context.score(report).entries) {
    assert.ok(entry.score >= 0 && entry.score <= 100, 'Scores must remain bounded');
  }
}
console.log('PASS: real DSP, repeatability, finite outputs, frequency differentiation and bounded scores.');
