import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomScene, makeBlankProject, validateProject } from '../dist/custom-scene.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
const image = () => ({ dataUrl: PNG, width: 1, height: 1 });
const region = (changes = {}) => ({
  id: 'primera', label: 'Primera zona', description: 'Una estructura de prueba.',
  shape: 'rect', x: 0.1, y: 0.2, width: 0.2, height: 0.3,
  color: '#8AE4B5', frequency: 440, waveform: 'triangle', pattern: [40, 60, 80],
  ...changes,
});
const project = (changes = {}) => ({
  schema: 'tacto.lesson.v1', title: 'Mi lección', description: 'Explora una imagen propia.',
  image: image(), regions: [region()], ...changes,
});

test('a blank lesson is an independent editor draft with a stable schema and scanner enabled', () => {
  const originalImage = image();
  const blank = makeBlankProject(originalImage);
  assert.equal(blank.schema, 'tacto.lesson.v1');
  assert.equal(blank.title, 'Mi imagen');
  assert.equal(blank.description, '');
  assert.equal(blank.scanEnabled, true);
  assert.deepEqual(blank.regions, []);
  assert.notEqual(blank.image, originalImage);
  originalImage.width = 300;
  assert.equal(blank.image.width, 1);

  const scene = createCustomScene(blank);
  assert.equal(scene.id, 'custom');
  assert.deepEqual(scene.regions, []);
  assert.deepEqual(scene.tour, []);
  assert.equal(scene.sample(0.5, 0.5), null);
});

test('validation keeps the scanner choice and upgrades projects without a schema', () => {
  const legacy = project({ scanEnabled: false });
  delete legacy.schema;
  const clean = validateProject(legacy);
  assert.equal(clean.schema, 'tacto.lesson.v1');
  assert.equal(clean.scanEnabled, false);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(clean))), clean);
  assert.throws(() => validateProject(project({ schema: 'tacto.lesson.v2' })), /versión.*no es compatible/i);
  assert.throws(() => validateProject(project({ scanEnabled: 'false' })), /escáner.*verdadera o falsa/i);
});

test('validation returns a safe clone, bounds text, and ignores unrelated fields', () => {
  const raw = project({ title: 'A'.repeat(150), description: 'D'.repeat(900), untrusted: { event: 'onload' } });
  raw.regions[0].label = 'L'.repeat(120);
  raw.regions[0].description = 'E'.repeat(900);
  const clean = validateProject(raw);
  assert.equal(clean.title.length, 100);
  assert.equal(clean.description.length, 600);
  assert.equal(clean.regions[0].label.length, 80);
  assert.equal(clean.regions[0].description.length, 600);
  assert.equal(clean.untrusted, undefined);
  assert.notEqual(clean, raw);
  assert.notEqual(clean.image, raw.image);
  assert.notEqual(clean.regions, raw.regions);
  assert.notEqual(clean.regions[0], raw.regions[0]);
  assert.notEqual(clean.regions[0].pattern, raw.regions[0].pattern);
  raw.regions[0].pattern[0] = 999;
  raw.regions[0].x = 0.9;
  assert.deepEqual(clean.regions[0].pattern, [40, 60, 80]);
  assert.equal(clean.regions[0].x, 0.1);
  assert.equal(validateProject(project({ title: '\u0000   ' })).title, 'Mi imagen');
});

test('identifiers are safe, unique, bounded, and generated for unnamed regions', () => {
  const raw = project({ regions: [
    region({ id: 'Una región " <script>' }),
    region({ id: 'Una región " <script>' }),
    region({ id: undefined }),
    region({ id: '__proto__' }),
    region({ id: 'constructor' }),
    region({ id: '9'.repeat(100) }),
  ] });
  const ids = validateProject(raw).regions.map(zone => zone.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z][a-z0-9_-]*$/);
    assert.ok(id.length <= 48);
    assert.ok(!['__proto__', 'constructor', 'prototype'].includes(id));
  }
  assert.equal(ids[2], 'region-3');
});

test('text and attribute payloads cannot create markup, scripts, events, or remote images', () => {
  const attack = `"><script>alert('x')</script><text onload="alert(1)">&`;
  const scene = createCustomScene(project({
    title: attack, description: attack,
    regions: [region({ id: attack, label: attack, description: attack, color: 'url(https://example.invalid/paint)', waveform: 'sine" onload="alert(1)' })],
  }));
  assert.equal((scene.svg.match(/<image\b/g) || []).length, 1);
  assert.doesNotMatch(scene.svg, /<script\b|<text\s+onload/i);
  for (const tag of scene.svg.match(/<[^>]+>/g) || []) {
    // An escaped attribute value may legitimately contain the word "onload".
    // Examine attribute names after discarding their safely quoted values.
    const namesOnly = tag.replace(/"[^"]*"|'[^']*'/g, '""');
    assert.doesNotMatch(namesOnly, /\son(?:load|error)\s*=/i);
  }
  assert.match(scene.svg, /&lt;script&gt;/);
  assert.match(scene.svg, /&quot;/);
  assert.match(scene.svg, /&#39;/);
  assert.match(scene.svg, /&amp;/);
  assert.doesNotMatch(scene.svg, /url\(/);
  assert.equal(scene.regions[0].color, '#74e8bd');
  assert.equal(scene.regions[0].waveform, 'sine');
});

test('remote, SVG, malformed, and mislabeled image payloads are rejected', () => {
  const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  const badSources = [
    'https://example.invalid/photo.png',
    'javascript:alert(1)',
    `data:image/svg+xml;base64,${svgBase64}`,
    `data:image/png;base64,${svgBase64}`,
    `data:text/html;base64,${svgBase64}`,
    PNG.replace('image/png', 'image/jpeg'),
    PNG.replace(';base64,', ','),
    `${PNG}" onload="alert(1)`,
    'data:image/png;base64,%%%%',
    'data:image/png;base64,aA=',
  ];
  for (const dataUrl of badSources) {
    assert.throws(() => validateProject(project({ image: { dataUrl, width: 1, height: 1 } })), /imagen|PNG|JPEG|WebP|base64|SVG/i);
  }
});

test('all accepted raster MIME types must match their own binary signature', () => {
  // Signature fixtures are sufficient here: complete decoding belongs to the
  // browser's image importer before it creates a project.
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');
  const webp = 'data:image/webp;base64,' + Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBP', 'binary').toString('base64');
  for (const dataUrl of [PNG, jpeg, webp]) {
    assert.equal(validateProject(project({ image: { dataUrl, width: 1, height: 1 } })).image.dataUrl, dataUrl);
  }
});

test('images larger than eight MiB and unreasonable dimensions are rejected', () => {
  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversized);
  assert.throws(() => validateProject(project({ image: { dataUrl: 'data:image/png;base64,' + oversized.toString('base64'), width: 1, height: 1 } })), /8 MiB/);
  for (const dimensions of [{ width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 20000, height: 1 }, { width: 16000, height: 16000 }, { width: NaN, height: 1 }]) {
    assert.throws(() => validateProject(project({ image: { ...image(), ...dimensions } })), /dimensiones|anchura|altura/i);
  }
});

test('projects require supported shapes and at most sixteen properly contained regions', () => {
  assert.throws(() => validateProject(null), /proyecto.*objeto/i);
  assert.throws(() => validateProject(project({ regions: {} })), /zonas.*lista/i);
  assert.throws(() => validateProject(project({ regions: Array.from({ length: 17 }, () => region()) })), /máximo de 16/);
  assert.equal(validateProject(project({ regions: Array.from({ length: 16 }, () => region()) })).regions.length, 16);
  assert.throws(() => validateProject(project({ regions: [region({ shape: 'polygon' })] })), /forma.*rect o ellipse/);
  const invalidGeometry = [
    { x: -0.01 }, { y: 1.01 }, { width: 0 }, { height: -0.1 },
    { x: 0.9, width: 0.2 }, { y: 0.9, height: 0.2 },
    { x: NaN }, { y: Infinity }, { width: '0.2' },
  ];
  for (const geometry of invalidGeometry) {
    assert.throws(() => validateProject(project({ regions: [region(geometry)] })), /lienzo|número finito|tamaños positivos/i);
  }
});

test('optional controls get safe defaults, bounded frequencies, and bounded vibration patterns', () => {
  const withoutControls = region();
  for (const key of ['color', 'frequency', 'waveform', 'pattern']) delete withoutControls[key];
  const defaults = validateProject(project({ regions: [withoutControls] })).regions[0];
  assert.equal(defaults.color, '#74e8bd');
  assert.equal(defaults.waveform, 'sine');
  assert.ok(defaults.frequency >= 70 && defaults.frequency <= 1100);
  assert.deepEqual(defaults.pattern, [45, 65, 85]);
  const bounded = validateProject(project({ regions: [region({ frequency: 999999, color: '#AbC', pattern: Array(30).fill(99999) }), region({ frequency: -10 })] })).regions;
  assert.equal(bounded[0].frequency, 1100);
  assert.equal(bounded[1].frequency, 70);
  assert.equal(bounded[0].color, '#aabbcc');
  assert.ok(bounded[0].pattern.length <= 9);
  assert.ok(bounded[0].pattern.every(duration => duration >= 0 && duration <= 750));
  assert.ok(bounded[0].pattern.reduce((sum, duration) => sum + duration, 0) <= 3000);
  assert.throws(() => validateProject(project({ regions: [region({ frequency: NaN })] })), /frecuencia.*número finito/);
  assert.throws(() => validateProject(project({ regions: [region({ pattern: [10, Infinity] })] })), /duración.*número finito/);
});

test('rectangle hit testing uses canvas coordinates that agree with the SVG, independent of image aspect ratio', () => {
  const scene = createCustomScene(project({ image: { ...image(), width: 800, height: 1200 } }));
  assert.match(scene.svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(scene.svg, /<rect x="100" y="128" width="200" height="192"/);
  assert.equal(scene.sample(0.2, 0.35).id, 'primera');
  assert.equal(scene.sample(0.1, 0.2).id, 'primera');
  assert.equal(scene.sample(0.099, 0.35), null);
  assert.equal(scene.sample(0.2, 0.501), null);
  const hit = scene.sample(0.2, 0.35);
  assert.equal(hit.pan, -0.6);
  assert.equal(hit.gain, 0.5);
  assert.equal(hit.frequency, 440);
  assert.equal(hit.waveform, 'triangle');
  assert.deepEqual(hit.pattern, [40, 60, 80]);
});

test('ellipse hit testing follows its curve rather than accepting its rectangular corners', () => {
  const scene = createCustomScene(project({ regions: [region({ shape: 'ellipse', x: 0.4, y: 0.3, width: 0.2, height: 0.4 })] }));
  assert.match(scene.svg, /<ellipse cx="500" cy="320" rx="100" ry="128"/);
  assert.equal(scene.sample(0.5, 0.5).id, 'primera');
  assert.equal(scene.sample(0.4, 0.5).id, 'primera');
  assert.equal(scene.sample(0.5, 0.3).id, 'primera');
  assert.equal(scene.sample(0.4, 0.3), null);
  assert.equal(scene.sample(0.399, 0.5), null);
});

test('the last region wins overlaps and the underlying region remains available outside the overlap', () => {
  const scene = createCustomScene(project({ regions: [
    region({ id: 'base', x: 0.1, y: 0.1, width: 0.5, height: 0.5, frequency: 220 }),
    region({ id: 'superior', x: 0.3, y: 0.3, width: 0.2, height: 0.2, frequency: 880 }),
  ] }));
  assert.equal(scene.sample(0.4, 0.4).id, 'superior');
  assert.equal(scene.sample(0.4, 0.4).frequency, 880);
  assert.equal(scene.sample(0.2, 0.2).id, 'base');
  assert.equal(scene.sample(0.2, 0.2).frequency, 220);
  assert.ok(scene.svg.indexOf('data-region="base"') < scene.svg.indexOf('data-region="superior"'));
  for (const zone of scene.regions) assert.equal(scene.sample(zone.point.x, zone.point.y).id, zone.id);
});

test('viewer controls and progress count only reachable regions while the editor keeps covered regions', () => {
  const source = project({ regions: [region({ id: 'oculta' }), region({ id: 'visible' })] });
  const cleanProject = validateProject(source);
  const scene = createCustomScene(cleanProject);
  assert.equal(cleanProject.regions.length, 2, 'The editor project must retain covered regions');
  assert.equal(source.regions.length, 2, 'The factory must not mutate the source project');
  assert.equal(scene.regions.length, 1, 'Viewer progress must not require an unreachable region');
  assert.equal(scene.regions[0].id, 'visible');
  assert.equal(scene.tour.length, 1);
  assert.doesNotMatch(scene.svg, /data-region="oculta"/);
  assert.match(scene.svg, /data-region="visible"/);
  assert.equal(scene.sample(0.2, 0.35).id, 'visible', 'Sampling must keep the original top-layer index');
  for (const zone of scene.regions) assert.equal(scene.sample(zone.point.x, zone.point.y).id, zone.id);
  assert.equal(scene.sample(scene.tour[0].x, scene.tour[0].y).id, 'visible');
});

test('a narrow exposed strip remains a reachable region with its own valid shortcut', () => {
  const scene = createCustomScene(project({ regions: [
    region({ id: 'franja', x: 0.1, y: 0.2, width: 0.2, height: 0.3 }),
    region({ id: 'capa', x: 0.1001, y: 0.2, width: 0.1999, height: 0.3 }),
  ] }));
  assert.equal(scene.regions.length, 2);
  assert.equal(scene.tour.length, 2);
  assert.equal(scene.sample(0.10005, 0.35).id, 'franja');
  for (const zone of scene.regions) assert.equal(scene.sample(zone.point.x, zone.point.y).id, zone.id);
});

test('filtering an intermediate hidden layer does not shift any remaining sample metadata', () => {
  const scene = createCustomScene(project({ regions: [
    region({ id: 'izquierda', x: 0.05, y: 0.1, width: 0.2, height: 0.2, frequency: 220 }),
    region({ id: 'oculta', x: 0.6, y: 0.2, width: 0.2, height: 0.3, frequency: 440 }),
    region({ id: 'derecha', x: 0.6, y: 0.2, width: 0.2, height: 0.3, frequency: 880 }),
  ] }));
  assert.deepEqual(scene.regions.map(zone => zone.id), ['izquierda', 'derecha']);
  assert.equal(scene.sample(0.15, 0.2).frequency, 220);
  assert.equal(scene.sample(0.7, 0.35).frequency, 880);
  for (const zone of scene.regions) assert.equal(scene.sample(zone.point.x, zone.point.y).id, zone.id);
});

test('sample returns null for unmarked content, out-of-bounds input, and non-finite input', () => {
  const scene = createCustomScene(project());
  for (const [x, y] of [[0.9, 0.9], [-0.01, 0.3], [1.01, 0.3], [0.2, -0.01], [0.2, 1.01], [NaN, 0.3], [0.2, NaN], [Infinity, 0.3], [0.2, undefined], ['0.2', 0.3]]) {
    assert.equal(scene.sample(x, y), null);
  }
});

test('a built scene is unaffected by later edits to the source project or returned sample pattern', () => {
  const source = project();
  const scene = createCustomScene(source);
  source.regions[0].x = 0.8;
  source.regions[0].frequency = 1000;
  source.regions[0].pattern[0] = 700;
  const first = scene.sample(0.2, 0.35);
  assert.equal(first.id, 'primera');
  assert.equal(first.frequency, 440);
  assert.deepEqual(first.pattern, [40, 60, 80]);
  first.pattern[0] = 999;
  assert.deepEqual(scene.sample(0.2, 0.35).pattern, [40, 60, 80]);
});
