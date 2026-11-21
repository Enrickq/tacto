import test from 'node:test';
import assert from 'node:assert/strict';
import { scenes } from '../dist/scenes.js';

const byId = Object.fromEntries(scenes.map(scene => [scene.id, scene]));
const at = (scene, x, y) => scene.sample(x / 1000, y / 640);

// These are independent landmarks in SVG space, rather than region.point.
// They protect the meaning of the drawing when shapes or labels are edited.
const landmarks = {
  cell: [
    ['membrane', 125, 320],
    ['cytoplasm', 205, 310],
    ['nucleus', 445, 300],
    ['nucleolus', 515, 285],
    ['mitochondria', 250, 234],
    ['reticulum', 315, 320],
    ['golgi', 655, 333],
    ['ribosomes', 486, 453],
  ],
  islands: [
    ['palma', 150, 200],
    ['hierro', 153, 450],
    ['gomera', 310, 365],
    ['tenerife', 387, 313],
    ['grancanaria', 592, 420],
    ['fuerteventura', 785, 300],
    ['lanzarote', 845, 171],
    ['graciosa', 826, 105],
    ['teide', 410, 306],
  ],
  economy: [
    ['supply', 748, 174],
    ['demand', 252, 174],
    ['equilibrium', 500, 310],
    ['price', 140, 240],
    ['quantity', 750, 520],
  ],
};

for (const [sceneId, examples] of Object.entries(landmarks)) {
  test(`${sceneId}: every named structure has a matching visual landmark`, async t => {
    const scene = byId[sceneId];
    assert.ok(scene, `Missing scene ${sceneId}`);
    assert.equal(new Set(examples.map(([id]) => id)).size, scene.regions.length);

    for (const [expectedId, x, y] of examples) {
      await t.test(expectedId, () => {
        const hit = at(scene, x, y);
        const definition = scene.regions.find(region => region.id === expectedId);
        assert.ok(hit, `Expected a structure at (${x}, ${y})`);
        assert.ok(definition, `Missing definition ${expectedId}`);
        assert.equal(hit.id, expectedId);
        assert.equal(hit.label, definition.label);
        assert.equal(hit.description, definition.description);
        assert.equal(hit.color, definition.color);
        assert.deepEqual(hit.pattern, definition.pattern);
        assert.equal(hit.waveform, definition.waveform);
        assert.ok(hit.frequency > 0 && Number.isFinite(hit.frequency));
        assert.ok(hit.gain > 0 && hit.gain <= 1);
        assert.ok(hit.pan >= -1 && hit.pan <= 1);
        assert.equal(hit.pan, 2 * x / 1000 - 1);
      });
    }
  });
}

test('unmarked backgrounds and decorative chart guides remain silent', () => {
  const silentPositions = {
    cell: [[50, 50], [480, 75], [900, 320], [480, 560]],
    islands: [[500, 150], [500, 550], [730, 400], [800, 150]],
    economy: [[50, 50], [650, 170], [350, 310], [500, 450]],
  };
  for (const [sceneId, positions] of Object.entries(silentPositions)) {
    for (const [x, y] of positions) {
      assert.equal(at(byId[sceneId], x, y), null, `${sceneId}: unexpected sound at (${x}, ${y})`);
    }
  }
});

test('all scenes reject out-of-bounds and non-finite normalized input', () => {
  const invalidPositions = [
    [-0.001, 0.5], [1.001, 0.5], [0.5, -0.001], [0.5, 1.001],
    [NaN, 0.5], [0.5, NaN], [Infinity, 0.5], [0.5, -Infinity],
    [undefined, 0.5], [0.5, null], ['0.5', 0.5],
  ];
  for (const scene of scenes) {
    for (const [x, y] of invalidPositions) {
      assert.equal(scene.sample(x, y), null, `${scene.id}: accepted invalid input (${x}, ${y})`);
    }
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      assert.equal(scene.sample(x, y), null, `${scene.id}: corner should be outside the diagram`);
    }
  }
});

test('nested cell structures take precedence over their surrounding medium', () => {
  const cell = byId.cell;
  assert.equal(at(cell, 515, 285).id, 'nucleolus');
  assert.equal(at(cell, 465, 285).id, 'nucleus');
  assert.equal(at(cell, 570, 425).id, 'cytoplasm');
  assert.equal(at(cell, 125, 320).id, 'membrane');
  assert.equal(at(cell, 115, 320), null);
  assert.ok(at(cell, 570, 425).gain < at(cell, 465, 285).gain, 'The background medium should sound softer than a landmark');
});

test('all three rotated mitochondria are recognized as the same organelle type', () => {
  const cell = byId.cell;
  for (const [x, y] of [[250, 234], [684, 205], [348, 461]]) {
    assert.equal(at(cell, x, y).id, 'mitochondria');
  }
});

test('Canarias contains eight distinct islands, including La Graciosa', () => {
  const islandIds = byId.islands.regions.filter(region => region.id !== 'teide').map(region => region.id).sort();
  assert.deepEqual(islandIds, ['palma', 'hierro', 'gomera', 'tenerife', 'grancanaria', 'fuerteventura', 'lanzarote', 'graciosa'].sort());
  assert.equal(at(byId.islands, 826, 105).label, 'La Graciosa');
  assert.equal(at(byId.islands, 845, 171).label, 'Lanzarote');
});

test('Teide is a higher-pitched landmark inside Tenerife, not the whole island or its decorative halo', () => {
  const islands = byId.islands;
  const teide = at(islands, 410, 306);
  const tenerife = at(islands, 387, 313);
  assert.equal(teide.id, 'teide');
  assert.equal(tenerife.id, 'tenerife');
  assert.equal(at(islands, 410, 282).id, 'tenerife');
  assert.equal(at(islands, 400, 319).id, 'tenerife');
  assert.ok(teide.frequency > tenerife.frequency);
  assert.notDeepEqual(teide.pattern, tenerife.pattern);
});

test('supply rises in price as quantity increases, with a rising pitch', () => {
  const lowLeft = at(byId.economy, 252, 446);
  const highRight = at(byId.economy, 748, 174);
  assert.equal(lowLeft.id, 'supply');
  assert.equal(highRight.id, 'supply');
  assert.equal(lowLeft.waveform, 'triangle');
  assert.equal(highRight.waveform, 'triangle');
  assert.ok(highRight.frequency > lowLeft.frequency);
  assert.ok(lowLeft.pan < 0 && highRight.pan > 0);
});

test('demand falls in price as quantity increases, with a falling pitch and its own timbre', () => {
  const highLeft = at(byId.economy, 252, 174);
  const lowRight = at(byId.economy, 748, 446);
  assert.equal(highLeft.id, 'demand');
  assert.equal(lowRight.id, 'demand');
  assert.equal(highLeft.waveform, 'sine');
  assert.equal(lowRight.waveform, 'sine');
  assert.ok(highLeft.frequency > lowRight.frequency);
  assert.notEqual(highLeft.waveform, at(byId.economy, 748, 174).waveform);
});

test('the exact crossing has a distinct signal and nearby curve branches remain distinguishable', () => {
  const economy = byId.economy;
  const cross = at(economy, 500, 310);
  assert.equal(cross.id, 'equilibrium');
  assert.equal(at(economy, 500, 333).id, 'equilibrium');
  assert.equal(at(economy, 530, 294).id, 'supply');
  assert.equal(at(economy, 530, 326).id, 'demand');
  assert.notDeepEqual(cross.pattern, at(economy, 530, 294).pattern);
  assert.notDeepEqual(cross.pattern, at(economy, 530, 326).pattern);
});

test('region shortcuts and guided tours land on actual content', () => {
  for (const scene of scenes) {
    for (const region of scene.regions) {
      assert.equal(scene.sample(region.point.x, region.point.y)?.id, region.id, `${scene.id}/${region.id}: invalid shortcut`);
    }
    for (const point of scene.tour) {
      assert.ok(point.duration > 0 && Number.isFinite(point.duration));
      assert.ok(scene.sample(point.x, point.y), `${scene.id}: tour enters silence`);
    }
  }
});
