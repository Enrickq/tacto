/*
 * TACTO missions: short challenges answered by touch, with graded help.
 * Pure logic, without the page, sound or storage, so it runs in Node tests.
 *
 * Help follows the autonomy scale of the pilot: 0 no help, 1 one hint (a
 * guiding sound), 2 step by step (spoken directions). A mission that is
 * skipped counts as not completed. Results stay in the session on this
 * device and hold no names or personal data.
 *
 * Points are normalized (0–1) in the 1000 × 640 space of the scenes, so
 * distances are measured in diagram widths.
 */
const WIDTH = 1000;
const HEIGHT = 640;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const LEVELS = Object.freeze(['none', 'hint', 'steps']);

/** Autonomy level of one result: none, hint, steps, or missed. */
export function levelOf({ correct, help = 0 }) {
  if (!correct) return 'missed';
  return LEVELS[clamp(Math.round(Number(help) || 0), 0, 2)];
}

/** Distance between two normalized points, in diagram widths. */
export function distance(a, b) {
  return Math.hypot((b.x - a.x) * WIDTH, (b.y - a.y) * HEIGHT) / WIDTH;
}

/** The closest of a mission's guide points: a region may have several parts. */
export function nearest(from, points = []) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const d = distance(from, point);
    if (d < bestDistance) { best = point; bestDistance = d; }
  }
  return best;
}

const SECTORS = ['right', 'upRight', 'up', 'upLeft', 'left', 'downLeft', 'down', 'downRight'];

/** Which way to move on the screen, in eight directions, or "close" when almost there. */
export function direction(from, to, closeWithin = 0.05) {
  const dx = (to.x - from.x) * WIDTH;
  const dy = (to.y - from.y) * HEIGHT;
  if (Math.hypot(dx, dy) / WIDTH < closeWithin) return 'close';
  const angle = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
  return SECTORS[Math.round(angle / 45) % 8];
}

/**
 * What the guiding sound and the spoken help need: how far the nearest part of
 * the answer is (in diagram widths), which side it is on (−1 left … 1 right)
 * and how high (−1 below … 1 above), and the direction to say.
 */
export function guidance(from, mission, onTarget = false) {
  const target = nearest(from, mission?.points);
  if (!target) return null;
  return {
    distance: onTarget ? 0 : distance(from, target),
    side: clamp((target.x - from.x) * WIDTH / 250, -1, 1),
    height: clamp(-(target.y - from.y) * HEIGHT / 200, -1, 1),
    onTarget: Boolean(onTarget),
    direction: onTarget ? 'on' : direction(from, target),
  };
}

/** A touch that barely moves and lifts quickly. */
export function isTap(start, end, { duration = 350, within = 0.03 } = {}) {
  return Boolean(start && end) && end.time - start.time <= duration && (start.moved ?? 0) <= within;
}

/** Two taps close together in time and place: the answer gesture. */
export function isDoubleTap(previous, tap, { gap = 450, within = 0.06 } = {}) {
  if (!previous || !tap) return false;
  const elapsed = tap.time - previous.time;
  return elapsed >= 0 && elapsed <= gap && distance(previous, tap) <= within;
}

/** One run through the missions of a scene, in order. Times are in milliseconds. */
export class MissionRun {
  constructor(scene, now = 0) {
    this.scene = scene.id;
    this.missions = [...(scene.missions ?? [])];
    this.index = 0;
    this.results = [];
    this._begin(now);
  }

  get current() { return this.missions[this.index] ?? null; }
  get done() { return this.index >= this.missions.length; }
  get total() { return this.missions.length; }

  _begin(now) {
    this.startedAt = now;
    this.help = 0;
    this.wrong = 0;
    this.visited = new Set();
  }

  /** The finger entered a region during this mission. */
  visit(regionId) {
    if (regionId && !this.done) this.visited.add(regionId);
  }

  /** One more level of help, up to step by step. Returns the new level. */
  hint() {
    if (!this.done) this.help = Math.min(2, this.help + 1);
    return this.help;
  }

  isTarget(regionId) {
    return Boolean(regionId) && Boolean(this.current?.targets.includes(regionId));
  }

  /** Answer with the region under the finger (or null for empty space). */
  answer(regionId, now = 0, input = 'touch') {
    if (this.done) return null;
    if (!this.isTarget(regionId)) {
      this.wrong += 1;
      return { correct: false, done: false };
    }
    const result = this._record(true, regionId, now, input);
    return { correct: true, done: this.done, result };
  }

  skip(now = 0) {
    if (this.done) return null;
    const result = this._record(false, null, now, null);
    return { done: this.done, result };
  }

  _record(correct, answer, now, input) {
    const mission = this.current;
    const result = Object.freeze({
      scene: this.scene,
      mission: mission.id,
      target: mission.targets[0],
      correct,
      skipped: !correct,
      answer,
      input,
      help: this.help,
      level: levelOf({ correct, help: this.help }),
      wrongAnswers: this.wrong,
      regionsVisited: this.visited.size,
      ms: Math.max(0, Math.round(now - this.startedAt)),
    });
    this.results.push(result);
    this.index += 1;
    this._begin(now);
    return result;
  }

  summary() {
    const levels = { none: 0, hint: 0, steps: 0, missed: 0 };
    for (const result of this.results) levels[result.level] += 1;
    return { found: this.results.filter(result => result.correct).length, total: this.total, levels };
  }
}
