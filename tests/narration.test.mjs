import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createScenes } from '../dist/scenes.js';
import { LANGUAGES, translate } from '../dist/i18n.js';
import { getNarrationUrl, NARRATION_ASSETS } from '../dist/narration.js';

// The recordings are generated on Windows with the system's own voice
// (scripts/prepare-narration.mjs) and are not part of the public repository.
// Without them the lookup is still checked; the app then uses the browser's voices.
const RECORDINGS = await access(new URL('../dist/audio/', import.meta.url)).then(() => true, () => false);
if (!RECORDINGS) console.log('# dist/audio is missing: the recorded narrations are not checked.');

function wavData(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (id === 'fmt ') format = { codec:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),rate:bytes.readUInt32LE(start+4),bits:bytes.readUInt16LE(start+14) };
    if (id === 'data') pcm = bytes.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  assert.deepEqual(format, {codec:1,channels:1,rate:22050,bits:16});
  assert.ok(pcm?.length > 4000, 'Narration must contain a playable speech segment');
  let energy = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) energy += Math.abs(pcm.readInt16LE(offset));
  assert.ok(energy > 100000, 'Narration must not be a silent WAV placeholder');
}

const MISSION_KEYS = ['mission.intro', 'mission.correct', 'mission.wrong', 'mission.hint1', 'mission.hint2', 'mission.onTarget', 'mission.done',
  'mission.dir.close', 'mission.dir.up', 'mission.dir.down', 'mission.dir.left', 'mission.dir.right',
  'mission.dir.upLeft', 'mission.dir.upRight', 'mission.dir.downLeft', 'mission.dir.downRight'];

function bundledTexts(language) {
  const texts = [translate(language, 'voice.test')];
  const scenes = createScenes(language);
  for (const scene of scenes) {
    texts.push(scene.description);
    for (const region of scene.regions) texts.push(region.label, `${region.label}. ${region.description}`);
  }
  // Missions: every question, answer, help phrase and score of three missions is recorded.
  for (const scene of scenes) for (const mission of scene.missions) texts.push(mission.prompt);
  for (const key of MISSION_KEYS) texts.push(translate(language, key));
  for (let count = 0; count <= 3; count += 1) texts.push(translate(language, 'mission.found', { count, total: 3 }));
  return texts;
}

for (const language of LANGUAGES) {
  test(`every ${language} example name, explanation, overview and mission phrase has playable bundled narration`, async () => {
    const texts = bundledTexts(language);
    assert.equal(texts.length, 77);
    for (const text of texts) {
      const url = getNarrationUrl(text, language);
      assert.ok(url, `Missing included narration: ${text}`);
      const file = new URL(url).pathname.split('/').at(-1);
      assert.equal(file.startsWith('en-'), language === 'en', `${text}: recording from the wrong language (${file})`);
      if (RECORDINGS) wavData(await readFile(new URL(url)));
    }
  });
}

test('assets are unique and each language keeps its own recording of shared names', () => {
  assert.equal(new Set(NARRATION_ASSETS).size, NARRATION_ASSETS.length);
  assert.equal(NARRATION_ASSETS.length, 154);
  // Island names are written the same in both languages but spoken by different voices.
  assert.notEqual(getNarrationUrl('Tenerife', 'es'), getNarrationUrl('Tenerife', 'en'));
  assert.match(getNarrationUrl('Tenerife', 'en'), /\/en-islands-tenerife-label\.wav$/);
  assert.equal(getNarrationUrl('Núcleo', 'en'), null);
  assert.equal(getNarrationUrl('Nucleus', 'es'), null);
});

test('the lookup tolerates harmless spacing but never substitutes an unrelated clip for user content', () => {
  assert.equal(getNarrationUrl('  Núcleo. '), getNarrationUrl('Núcleo'), 'outside a page the language is Spanish');
  assert.equal(getNarrationUrl('  Nucleus. ', 'en'), getNarrationUrl('Nucleus', 'en'));
  assert.equal(getNarrationUrl('Mi explicación nueva'), null);
  assert.equal(getNarrationUrl('<script>alert(1)</script>'), null);
  assert.equal(getNarrationUrl(null), null);
  assert.equal(getNarrationUrl('Núcleo', '__proto__'), null);
  assert.equal(getNarrationUrl('Núcleo', 'fr'), null);
});

test('respellings for the English voice change only the spoken text, never the lookup text', async () => {
  const content = JSON.parse(await readFile(new URL('../scripts/narration-content.json', import.meta.url), 'utf8'));
  assert.equal(content.schema, 'tacto.narration.v2');
  for (const asset of content.assets) {
    assert.ok(LANGUAGES.includes(asset.lang));
    assert.ok(asset.spoken, `${asset.file} has spoken text`);
    if (asset.lang === 'es') assert.equal(asset.spoken, asset.text);
  }
  const teide = content.assets.find(asset => asset.file === 'en-islands-teide-label.wav');
  assert.equal(teide.text, 'Mount Teide');
  assert.equal(teide.spoken, 'Mount Tay-day');
});
