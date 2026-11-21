import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenes } from '../dist/scenes.js';
import { LANGUAGES } from '../dist/i18n.js';
import { MissionRun, levelOf, direction, guidance, nearest, isTap, isDoubleTap } from '../dist/missions.js';

test('every lesson has three missions in both languages, with the same answers and help points', () => {
  const [es, en] = LANGUAGES.map(language => createScenes(language));
  for (const [i, scene] of es.entries()) {
    assert.equal(scene.missions.length, 3, scene.id);
    assert.deepEqual(
      en[i].missions.map(({ id, targets, points }) => ({ id, targets, points })),
      scene.missions.map(({ id, targets, points }) => ({ id, targets, points })),
    );
    for (const [j, mission] of scene.missions.entries()) {
      const english = en[i].missions[j].prompt;
      assert.ok(mission.prompt && english && mission.prompt !== english, `${scene.id}/${mission.id} has a question in each language`);
      for (const target of mission.targets) assert.ok(scene.regions.some(region => region.id === target), `${target} is a region of ${scene.id}`);
    }
  }
});

test('the help steers the finger to points that really answer the mission', () => {
  for (const language of LANGUAGES) {
    for (const scene of createScenes(language)) {
      for (const mission of scene.missions) {
        assert.ok(mission.points.length >= 1, `${scene.id}/${mission.id} has a help point`);
        for (const point of mission.points) {
          assert.ok(mission.targets.includes(scene.sample(point.x, point.y)?.id), `${scene.id}/${mission.id} at ${JSON.stringify(point)}`);
        }
      }
    }
  }
});

test('a part inside a region also answers for it, but not the other way round', () => {
  const [cell, islands] = createScenes('en');
  const find = (scene, id) => scene.missions.find(mission => mission.id === id);
  assert.ok(find(cell, 'nucleus').targets.includes('nucleolus'));
  assert.ok(!find(cell, 'nucleolus').targets.includes('nucleus'));
  assert.ok(find(islands, 'tenerife').targets.includes('teide'));
  assert.ok(!find(islands, 'teide').targets.includes('tenerife'));
});

test('directions follow the screen in eight sectors and say "close" when almost there', () => {
  const from = { x: 0.5, y: 0.5 };
  assert.equal(direction(from, { x: 0.8, y: 0.5 }), 'right');
  assert.equal(direction(from, { x: 0.2, y: 0.5 }), 'left');
  assert.equal(direction(from, { x: 0.5, y: 0.1 }), 'up');
  assert.equal(direction(from, { x: 0.5, y: 0.9 }), 'down');
  assert.equal(direction(from, { x: 0.8, y: 0.1 }), 'upRight');
  assert.equal(direction(from, { x: 0.2, y: 0.1 }), 'upLeft');
  assert.equal(direction(from, { x: 0.8, y: 0.9 }), 'downRight');
  assert.equal(direction(from, { x: 0.2, y: 0.9 }), 'downLeft');
  assert.equal(direction(from, { x: 0.52, y: 0.51 }), 'close');
});

test('the guiding sound knows the side, the height and the nearest part of the answer', () => {
  const [cell] = createScenes('en');
  const mitochondria = cell.missions.find(mission => mission.id === 'mitochondria');
  const from = { x: 0.2, y: 0.4 };
  assert.deepEqual(nearest(from, mitochondria.points), mitochondria.points[0], 'the left mitochondrion is the closest');
  assert.ok(guidance(from, mitochondria).distance < 0.1);
  const upRight = guidance({ x: 0.1, y: 0.9 }, { points: [{ x: 0.9, y: 0.1 }] });
  assert.equal(upRight.side, 1);
  assert.equal(upRight.height, 1);
  assert.equal(upRight.direction, 'upRight');
  const below = guidance({ x: 0.5, y: 0.2 }, { points: [{ x: 0.5, y: 0.8 }] });
  assert.ok(below.height < 0);
  assert.equal(below.side, 0);
  const on = guidance({ x: 0.5, y: 0.5 }, { points: [{ x: 0.6, y: 0.5 }] }, true);
  assert.equal(on.distance, 0);
  assert.equal(on.direction, 'on');
  assert.equal(on.onTarget, true);
  assert.equal(guidance(from, { points: [] }), null);
});

test('the answer gesture is two quick, still taps in the same place', () => {
  assert.ok(isTap({ time: 0, moved: 0.01 }, { time: 200 }));
  assert.ok(!isTap({ time: 0, moved: 0.08 }, { time: 200 }), 'a slide is not a tap');
  assert.ok(!isTap({ time: 0, moved: 0 }, { time: 900 }), 'a long press is not a tap');
  const first = { time: 1000, x: 0.5, y: 0.5 };
  assert.ok(isDoubleTap(first, { time: 1300, x: 0.51, y: 0.5 }));
  assert.ok(!isDoubleTap(first, { time: 1600, x: 0.5, y: 0.5 }), 'too slow');
  assert.ok(!isDoubleTap(first, { time: 1200, x: 0.7, y: 0.5 }), 'too far apart');
  assert.ok(!isDoubleTap(null, first));
});

test('a run records answer, time, wrong tries and help, on the autonomy scale of the pilot', () => {
  const [cell] = createScenes('en');
  const run = new MissionRun(cell, 1000);
  assert.equal(run.total, 3);
  assert.equal(run.current.id, 'nucleus');
  run.visit('membrane'); run.visit('cytoplasm'); run.visit('cytoplasm');
  assert.deepEqual(run.answer('cytoplasm', 3000), { correct: false, done: false });
  const first = run.answer('nucleolus', 5000, 'touch');
  assert.equal(first.correct, true);
  assert.equal(first.done, false);
  assert.deepEqual({ ...first.result }, {
    scene: 'cell', mission: 'nucleus', target: 'nucleus', correct: true, skipped: false, answer: 'nucleolus',
    input: 'touch', help: 0, level: 'none', wrongAnswers: 1, regionsVisited: 2, ms: 4000,
  });
  assert.equal(run.current.id, 'mitochondria');
  assert.equal(run.hint(), 1);
  const second = run.answer('mitochondria', 9000, 'keyboard');
  assert.equal(second.result.level, 'hint');
  assert.equal(second.result.ms, 4000);
  assert.equal(second.result.wrongAnswers, 0);
  run.hint(); run.hint();
  assert.equal(run.hint(), 2, 'help stops at step by step');
  const third = run.skip(15000);
  assert.equal(third.done, true);
  assert.equal(third.result.level, 'missed');
  assert.equal(third.result.help, 2);
  assert.equal(run.done, true);
  assert.equal(run.current, null);
  assert.equal(run.answer('nucleus', 16000), null, 'no answers after the end');
  assert.deepEqual(run.summary(), { found: 2, total: 3, levels: { none: 1, hint: 1, steps: 0, missed: 1 } });
  assert.throws(() => { run.results[0].correct = false; }, TypeError, 'results cannot be changed afterwards');
});

test('levels are no help, one hint, step by step and not completed', () => {
  assert.equal(levelOf({ correct: true, help: 0 }), 'none');
  assert.equal(levelOf({ correct: true, help: 1 }), 'hint');
  assert.equal(levelOf({ correct: true, help: 2 }), 'steps');
  assert.equal(levelOf({ correct: true, help: 7 }), 'steps');
  assert.equal(levelOf({ correct: false, help: 0 }), 'missed');
});

test('a lesson without missions, such as an image from Studio, gives an empty run', () => {
  const run = new MissionRun({ id: 'custom', regions: [] });
  assert.equal(run.done, true);
  assert.equal(run.current, null);
  assert.equal(run.answer('anything'), null);
  assert.equal(run.skip(), null);
  assert.deepEqual(run.summary(), { found: 0, total: 0, levels: { none: 0, hint: 0, steps: 0, missed: 0 } });
});
