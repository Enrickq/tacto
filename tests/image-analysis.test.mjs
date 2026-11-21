import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImageData, sampleImageAnalysis, suggestRegions } from '../dist/image-analysis.js';

function image(width, height, pixel = () => [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

test('flat images have no Sobel edges, and a sharp transition has strong edges', () => {
  const flat = analyzeImageData(image(24, 20, () => [120, 120, 120, 255]));
  assert.ok(flat.edges.every((value) => value === 0));
  assert.ok(flat.contrast.every((value) => value === 0));
  const split = analyzeImageData(image(24, 20, (x) => x < 12 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.ok(split.edges[10 * 24 + 11] > 200);
  assert.equal(split.edges[10 * 24 + 4], 0);
  assert.equal(split.edges[10 * 24 + 18], 0);
  assert.equal(split.contrast[10 * 24 + 11], 255);
  for (let x = 0; x < split.width; x++) {
    assert.equal(split.edges[x], 0);
    assert.equal(split.edges[(split.height - 1) * split.width + x], 0);
  }
  for (let y = 0; y < split.height; y++) {
    assert.equal(split.edges[y * split.width], 0);
    assert.equal(split.edges[y * split.width + split.width - 1], 0);
  }
});

test('transparent pixels are composited onto white and analysis does not retain mutable source data', () => {
  const source = image(3, 3, () => [0, 0, 0, 0]);
  const before = source.data.slice();
  const analysis = analyzeImageData(source);
  assert.deepEqual(source.data, before, 'analysis must not mutate caller pixels');
  assert.ok(analysis.luminance.every((value) => value === 255));
  assert.ok(analysis.rgb.every((value) => value === 255));
  source.data.fill(0);
  assert.equal(sampleImageAnalysis(analysis, 0.5, 0.5).color, 'rgb(255, 255, 255)');
  assert.deepEqual(analyzeImageData(image(3, 3, () => [0, 0, 0, 0])), analysis);
});

test('sampling covers image boundaries and returns only pixel descriptions with finite bounded feedback', () => {
  const analysis = analyzeImageData(image(10, 10, (x) => x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const dark = sampleImageAnalysis(analysis, 0, 0);
  const light = sampleImageAnalysis(analysis, 1, 1);
  const edge = sampleImageAnalysis(analysis, 0.49, 0.5);
  assert.equal(dark.label, 'Zona oscura');
  assert.equal(light.label, 'Zona clara');
  assert.equal(edge.label, 'Borde');
  assert.ok(edge.gain > dark.gain, 'local contrast increases feedback intensity');
  assert.ok(edge.pattern.length > dark.pattern.length, 'edges have a distinct pulse cue');
  assert.ok(light.frequency > dark.frequency, 'brightness maps monotonically to pitch');
  const middle = sampleImageAnalysis(analyzeImageData(image(3, 3, () => [128, 128, 128, 255])), 0.5, 0.5);
  assert.equal(middle.label, 'Zona media');
  for (const sample of [dark, light, edge, middle]) {
    assert.ok(Number.isFinite(sample.frequency) && sample.frequency >= 180 && sample.frequency <= 700);
    assert.ok(Number.isFinite(sample.gain) && sample.gain >= 0 && sample.gain <= 1);
    assert.ok(Number.isFinite(sample.pan) && Math.abs(sample.pan) <= 1);
    assert.match(sample.color, /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
    assert.match(sample.description, /No identifica objetos/);
    assert.ok(['sine', 'triangle'].includes(sample.waveform));
  }
});

test('out-of-image, nonnumeric and malformed samples return null', () => {
  const analysis = analyzeImageData(image(4, 4));
  for (const [x, y] of [[-0.01, 0], [1.01, 0], [0, -1], [0, 2], [NaN, 0], [0, Infinity], ['0.5', 0]]) {
    assert.equal(sampleImageAnalysis(analysis, x, y), null);
  }
  assert.equal(sampleImageAnalysis(null, 0, 0), null);
  assert.equal(sampleImageAnalysis({ width: 4, height: 4 }, 0, 0), null);
  assert.notEqual(sampleImageAnalysis(analyzeImageData(image(1, 1)), 1, 1), null);
});

test('invalid input and images above the explicit processing bound are rejected', () => {
  for (const source of [null, { width: 0, height: 1 }, { width: 3.5, height: 4 }, { width: Infinity, height: 2 }]) {
    assert.throws(() => analyzeImageData(source), RangeError);
  }
  assert.throws(() => analyzeImageData({ width: 1001, height: 1000, data: new Uint8Array(0) }), /1.000.000/);
  assert.throws(() => analyzeImageData({ width: 2, height: 2, data: new Uint8Array(4) }), TypeError);
  assert.throws(() => analyzeImageData({ width: 2, height: 2, data: new Float32Array(16) }), TypeError);
  const maximum = analyzeImageData(image(1000, 1000));
  assert.equal(maximum.luminance.length, 1_000_000);
  assert.deepEqual(suggestRegions(maximum), []);
});

test('clean separated shapes produce bounded editable rectangles without semantic labels', () => {
  const analysis = analyzeImageData(image(160, 120, (x, y) => {
    const first = x >= 15 && x < 45 && y >= 20 && y < 55;
    const second = x >= 100 && x < 140 && y >= 65 && y < 100;
    return first || second ? [0, 0, 0, 255] : [255, 255, 255, 255];
  }));
  const regions = suggestRegions(analysis);
  assert.equal(regions.length, 2);
  const contains = (region, x, y) => x >= region.x && x <= region.x + region.width
    && y >= region.y && y <= region.y + region.height;
  assert.ok(regions.some((region) => contains(region, 30 / 160, 35 / 120)));
  assert.ok(regions.some((region) => contains(region, 120 / 160, 80 / 120)));
  for (const region of regions) {
    assert.ok(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0);
    assert.ok(region.x + region.width <= 1 && region.y + region.height <= 1);
    assert.match(region.label, /^Contorno \d+$/);
    assert.equal(region.source, 'contrast');
  }
  assert.deepEqual(suggestRegions(analysis), regions, 'suggestions are deterministic');
  assert.equal(suggestRegions(analysis, 1).length, 1);
  assert.deepEqual(suggestRegions(analysis, 0), []);
});

test('flat, densely textured and tiny isolated noise do not invent regions', () => {
  assert.deepEqual(suggestRegions(analyzeImageData(image(80, 80))), []);
  const noise = image(80, 80, (x, y) => x === 40 && y === 40 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.deepEqual(suggestRegions(analyzeImageData(noise)), []);
  const texture = image(80, 80, (x, y) => (x + y) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.deepEqual(suggestRegions(analyzeImageData(texture)), []);
  assert.deepEqual(suggestRegions(null), []);
});
