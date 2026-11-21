import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import {
  LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, translate, plural, setLanguage, getLanguage,
  messageKeys, normalizeLanguage, speechLocale, chooseLanguage,
} from '../dist/i18n.js';
import { createScenes, scenes } from '../dist/scenes.js';
import { createCustomScene, makeBlankProject, validateProject } from '../dist/custom-scene.js';
import { analyzeImageData, sampleImageAnalysis, suggestRegions } from '../dist/image-analysis.js';

const dist = new URL('../dist/', import.meta.url);
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const tags = text => [...text.matchAll(/<\/?([a-z]+)/g)].map(match => match[0]).sort();

test('outside a page the language is Spanish, and language tags are normalized', () => {
  assert.equal(DEFAULT_LANGUAGE, 'es');
  assert.equal(getLanguage(), 'es');
  assert.equal(normalizeLanguage('en-GB'), 'en');
  assert.equal(normalizeLanguage('ES_es'), 'es');
  assert.equal(normalizeLanguage('fr'), null);
  assert.equal(normalizeLanguage(undefined), null);
  assert.equal(speechLocale('es'), 'es-ES');
  assert.equal(speechLocale('en'), 'en-US');
});

test('both dictionaries define the same keys, placeholders and markup', () => {
  const [es, en] = LANGUAGES.map(language => messageKeys(language).sort());
  assert.deepEqual(en, es);
  for (const key of es) {
    const spanish = translate('es', key);
    const english = translate('en', key);
    assert.ok(spanish.trim() && english.trim(), `${key} is empty`);
    assert.deepEqual(placeholders(english), placeholders(spanish), `${key}: placeholders differ`);
    assert.deepEqual(tags(english), tags(spanish), `${key}: markup differs`);
    for (const text of [spanish, english]) {
      // Plain strings also go into attributes; markup is limited to a few tags.
      if (!text.includes('<')) assert.doesNotMatch(text, /["&>]/, `${key}: unsafe character`);
      else assert.ok(tags(text).every(tag => /^<\/?(br|em|span)$/.test(tag)), `${key}: unexpected tag`);
    }
  }
});

test('every key used by the page and the modules exists, and none is left unused', async () => {
  const known = new Set(messageKeys('es'));
  const used = new Set();
  const sources = (await readdir(dist)).filter(name => name.endsWith('.js'));
  const prefix = /'((?:meta|nav|header|intro|lab|sidebar|progress|view|surface|readout|transport|details|mission|regions|guide|settings|haptics|voice|speech|toast|announce|session|footer|help|studio|custom|scan)\.[A-Za-z0-9.]+)'/g;
  for (const name of sources) {
    const source = await readFile(new URL(name, dist), 'utf8');
    for (const [, key] of source.matchAll(prefix)) used.add(key);
  }
  const html = await readFile(new URL('index.html', dist), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(key);
  for (const [, pairs] of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of pairs.split(';')) used.add(pair.split(':')[1].trim());
  }
  for (const key of used) {
    assert.ok(known.has(key) || (known.has(`${key}.one`) && known.has(`${key}.other`)), `Missing translation: ${key}`);
  }
  const reached = new Set([...used].flatMap(key => known.has(key) ? [key] : [`${key}.one`, `${key}.other`]));
  // Built from a variable: t(`scan.${tone}`).
  for (const tone of ['edge', 'light', 'dark', 'middle']) reached.add(`scan.${tone}`);
  assert.deepEqual([...known].filter(key => !reached.has(key)), [], 'Unused translations');
});

test('placeholders, plurals and missing keys behave predictably', () => {
  assert.equal(translate('en', 'regions.explore', { label: 'Nucleus' }), 'Explore Nucleus');
  assert.equal(translate('es', 'regions.explore', { label: '{label}' }), 'Explorar {label}', 'values are not expanded twice');
  assert.equal(translate('fr', 'regions.explore', { label: 'X' }), 'Explorar X', 'unknown languages fall back to Spanish');
  assert.equal(translate('en', 'no.such.key'), 'no.such.key');
  setLanguage('en');
  try {
    assert.equal(plural('regions.count', 1), '1 REGION');
    assert.equal(plural('regions.count', 8), '8 REGIONS');
  } finally { setLanguage('es'); }
  assert.equal(plural('regions.count', 1), '1 ZONA');
  assert.equal(plural('studio.ready', 3), '3 zonas con significado. Tu imagen, lista para explorar.');
});

test('choosing a language stores it and reloads, or carries it in the address', () => {
  const page = href => {
    const calls = [];
    const location = { calls, href, reload: () => calls.push('reload'), replace: url => calls.push(url) };
    Object.defineProperty(location, 'hash', { get: () => new URL(href).hash, set: value => calls.push(`#${value}`) });
    return location;
  };
  const memory = () => {
    const values = new Map();
    return { values, setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) ?? null };
  };

  const plain = page('https://example.test/tacto/'), stored = memory();
  assert.equal(chooseLanguage('en', { location: plain, storage: stored }), true);
  assert.deepEqual(plain.calls, ['reload']);
  assert.equal(stored.values.get(LANGUAGE_STORAGE_KEY), 'en');

  const shared = page('https://example.test/tacto/?lang=es#surface');
  chooseLanguage('en', { location: shared, storage: memory() });
  assert.deepEqual(shared.calls, ['https://example.test/tacto/?lang=en#surface']);

  // Without storage the hash carries the choice: some hosts keep only the hash.
  const blocked = page('https://example.test/tacto/');
  chooseLanguage('en', { location: blocked, storage: { setItem() { throw new Error('blocked'); }, getItem: () => null } });
  assert.deepEqual(blocked.calls, ['#en', 'reload']);

  // A link that names a language in its hash is updated, or the hash would win after the reload.
  const hashed = page('https://example.test/artifact#es');
  chooseLanguage('en', { location: hashed, storage: memory() });
  assert.deepEqual(hashed.calls, ['#en', 'reload']);
  const skipLink = page('https://example.test/tacto/#surface');
  chooseLanguage('en', { location: skipLink, storage: memory() });
  assert.deepEqual(skipLink.calls, ['reload'], 'an unrelated hash is left alone');

  const same = page('https://example.test/tacto/');
  assert.equal(chooseLanguage('es', { location: same, storage: memory() }), false, 'the current language does nothing');
  assert.equal(chooseLanguage('fr', { location: same, storage: memory() }), false);
  assert.deepEqual(same.calls, []);
});

const bootSource = await readFile(new URL('lang-boot.js', dist), 'utf8');
function boot({ search = '', hash = '', stored = null, languages = [], language = '', storageThrows = false, pageDefault = null } = {}) {
  const classes = new Set();
  const timers = [];
  const root = { lang: 'es', classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const currentScript = { getAttribute: name => (name === 'data-default-lang' ? pageDefault : null) };
  vm.runInNewContext(bootSource, {
    location: { search, hash },
    localStorage: { getItem: key => { if (storageThrows) throw new Error('blocked'); return key === LANGUAGE_STORAGE_KEY ? stored : null; } },
    navigator: { languages, language },
    document: { documentElement: root, currentScript },
    URLSearchParams,
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  return { language: root.lang, pending: classes.has('i18n-pending'), timers, classes };
}

test('the boot script picks the address, then the saved choice, then the browser languages', () => {
  assert.equal(boot({ search: '?lang=en', stored: 'es', languages: ['es-ES'] }).language, 'en');
  assert.equal(boot({ search: '?lang=EN-gb' }).language, 'en');
  assert.equal(boot({ search: '?lang=fr', stored: 'es', languages: ['en-US'] }).language, 'es', 'unknown values are ignored');
  assert.equal(boot({ stored: 'en', languages: ['es-ES'] }).language, 'en');
  assert.equal(boot({ storageThrows: true, languages: ['es-ES'] }).language, 'es');
  for (const tag of ['es-ES', 'es', 'es-419', 'ca-ES', 'gl', 'eu-ES']) assert.equal(boot({ languages: [tag] }).language, 'es', tag);
  for (const tags of [['el-GR'], ['pl-PL', 'en-GB'], ['de-DE'], ['it-IT'], ['lt'], ['bg-BG'], ['fr-FR'], ['en-US', 'es-ES'], []]) {
    assert.equal(boot({ languages: tags }).language, 'en', tags.join(','));
  }
  assert.equal(boot({ languages: ['el-GR', 'es-ES'] }).language, 'es', 'the first supported preference wins');
  assert.equal(boot({ language: 'es-ES' }).language, 'es', 'navigator.language when languages is empty');
});

test('a hash names the language where the host drops the query, and a page may set its own default', () => {
  assert.equal(boot({ hash: '#en', stored: 'es', languages: ['es-ES'] }).language, 'en');
  assert.equal(boot({ hash: '#ES', languages: ['en-US'] }).language, 'es');
  assert.equal(boot({ search: '?lang=es', hash: '#en' }).language, 'es', 'the query string still comes first');
  assert.equal(boot({ hash: '#surface', languages: ['es-ES'] }).language, 'es', 'other anchors are ignored');
  // The published demo opens in English for the jury, even in a Spanish browser.
  assert.equal(boot({ pageDefault: 'en', languages: ['es-ES'] }).language, 'en');
  assert.equal(boot({ pageDefault: 'en', stored: 'es', languages: ['es-ES'] }).language, 'es', 'a saved choice beats the page default');
  assert.equal(boot({ pageDefault: 'fr', languages: ['es-ES'] }).language, 'es', 'an unknown default is ignored');
});

test('only an English page is hidden while it is translated, and never for long', () => {
  const english = boot({ search: '?lang=en' });
  assert.equal(english.pending, true);
  assert.equal(english.timers.length, 1);
  assert.ok(english.timers[0].delay <= 3000);
  english.timers[0].callback();
  assert.equal(english.classes.has('i18n-pending'), false);
  const spanish = boot({ search: '?lang=es' });
  assert.equal(spanish.pending, false);
  assert.equal(spanish.timers.length, 0);
});

test('English scenes keep the same drawing, regions and signals, with English text', () => {
  const es = createScenes('es');
  const en = createScenes('en');
  const stripText = svg => svg.replace(/>[^<]*</g, '><');
  const spanishWords = /MEMBRANA|MITOCONDRIAS|RETÍCULO|NÚCLEO|NUCLÉOLO|RIBOSOMAS|CITOPLASMA|BIOLOGÍA|ESCALA|Occidente|Oriente|archipiélago|É A N O|ISLAS|TAMAÑOS|DEMANDA|OFERTA|EQUILIBRIO|Precio|Cantidad|MODELO|UNIDADES/;
  assert.deepEqual(scenes.map(scene => scene.title), es.map(scene => scene.title), 'the default export is Spanish outside a page');
  assert.deepEqual(en.map(scene => scene.id), es.map(scene => scene.id));
  for (const [index, english] of en.entries()) {
    const spanish = es[index];
    assert.equal(stripText(english.svg), stripText(spanish.svg), `${english.id}: only the text of the drawing may differ`);
    assert.doesNotMatch(english.svg, spanishWords, `${english.id}: Spanish left in the drawing`);
    assert.deepEqual(english.tour, spanish.tour);
    for (const field of ['category', 'shortTitle', 'title', 'subtitle', 'description', 'task', 'guide']) {
      assert.ok(english[field]?.trim(), `${english.id}.${field} is empty`);
      assert.notEqual(english[field], spanish[field], `${english.id}.${field} is not translated`);
    }
    assert.deepEqual(english.regions.map(region => region.id), spanish.regions.map(region => region.id));
    for (const [r, region] of english.regions.entries()) {
      const original = spanish.regions[r];
      for (const field of ['color', 'frequency', 'waveform']) assert.equal(region[field], original[field]);
      assert.deepEqual(region.pattern, original.pattern);
      assert.deepEqual(region.point, original.point);
      assert.notEqual(region.description, original.description, `${region.id} description is not translated`);
      const hit = english.sample(region.point.x, region.point.y);
      assert.equal(hit.id, region.id);
      assert.equal(hit.label, region.label);
      assert.equal(hit.description, region.description);
    }
  }
  const at = (scene, x, y) => scene.sample(x / 1000, y / 640);
  assert.equal(at(en[0], 445, 300).label, 'Nucleus');
  assert.equal(at(en[1], 410, 306).label, 'Mount Teide');
  assert.equal(at(en[2], 500, 310).label, 'Equilibrium point');
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
const pixels = (width, height, pixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
};

test('Studio defaults, validation messages and the pixel scanner follow the page language', (t) => {
  setLanguage('en');
  t.after(() => setLanguage('es'));
  const blank = makeBlankProject({ dataUrl: PNG, width: 1, height: 1 });
  assert.equal(blank.title, 'My image');
  const scene = createCustomScene({ ...blank, regions: [{ shape: 'rect', x: .1, y: .1, width: .3, height: .3 }] });
  assert.equal(scene.category, 'Your content');
  assert.equal(scene.shortTitle, 'My image');
  assert.equal(scene.regions[0].label, 'Region 1');
  assert.match(scene.guide, /scanner/);
  assert.throws(() => validateProject(null), /must be an object/);
  assert.throws(() => validateProject({ ...blank, schema: 'tacto.lesson.v2' }), /not supported/);
  assert.throws(() => validateProject({ ...blank, regions: [{ label: 'Core', shape: 'rect', x: NaN, y: 0, width: .1, height: .1 }] }), /The horizontal position of “Core” must be a finite number/);

  const analysis = analyzeImageData(pixels(10, 10, x => x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.equal(sampleImageAnalysis(analysis, 0.05, 0.5).label, 'Dark area');
  assert.equal(sampleImageAnalysis(analysis, 0.95, 0.5).label, 'Light area');
  assert.match(sampleImageAnalysis(analysis, 0.05, 0.5).description, /It does not identify objects/);
  const shapes = analyzeImageData(pixels(160, 120, (x, y) => (x >= 15 && x < 45 && y >= 20 && y < 55) || (x >= 100 && x < 140 && y >= 65 && y < 100) ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.deepEqual(suggestRegions(shapes).map(region => region.label), ['Outline 1', 'Outline 2']);
});
