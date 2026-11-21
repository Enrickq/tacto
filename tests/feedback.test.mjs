import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackEngine } from '../dist/feedback.js';
import { setLanguage } from '../dist/i18n.js';

class Clock {
  time = 0;
  nextId = 0;
  timers = new Map();

  setTimeout = (callback, delay = 0) => {
    const id = ++this.nextId;
    this.timers.set(id, { callback, at: this.time + Math.max(0, Number(delay) || 0) });
    return id;
  };

  clearTimeout = (id) => this.timers.delete(id);

  advance(milliseconds) {
    const end = this.time + milliseconds;
    let turns = 0;
    while (true) {
      const next = [...this.timers].filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++turns < 1000, 'timer callbacks must not form an infinite queue');
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
}

class Surface {
  hidden = false;
  listeners = new Map();

  addEventListener(type, callback, capture = false) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture: capture === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) ?? [])
      .filter((listener) => listener.callback !== callback));
  }

  fire(type, properties = {}) {
    const event = { type, isTrusted: false, ...properties };
    const listeners = [...(this.listeners.get(type) ?? [])]
      .sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const { callback } of listeners) callback(event);
  }
}

class AudioParameter {
  _value = 0;
  events = [];

  get value() { return this._value; }
  set value(value) { this._value = value; this.events.push({ type: 'direct', value }); }
  cancelAndHoldAtTime(time) { this.events.push({ type: 'hold', time }); }
  cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); }
  setValueAtTime(value, time) { this._value = value; this.events.push({ type: 'value', value, time }); }
  setTargetAtTime(value, time, constant) {
    this._value = value;
    this.events.push({ type: 'target', value, time, constant });
  }
}

class AudioNode {
  connections = [];
  started = false;

  constructor(kind) {
    this.kind = kind;
    for (const name of ['gain', 'pan', 'frequency', 'detune', 'threshold', 'knee', 'ratio', 'attack', 'release']) {
      this[name] = new AudioParameter();
    }
  }

  connect(node) { this.connections.push(node); }
  start() { this.started = true; }
}

function harness(t, configuration = {}) {
  const state = { ...configuration };
  const clock = new Clock();
  const document = new Surface();
  const window = new Surface();
  const activation = { isActive: false, hasBeenActive: false };
  const contexts = [];
  const vibrations = [];
  const engines = [];
  const descriptors = new Map();
  const speech = {
    calls: [], queue: [], active: null, cancellations: 0,
    getVoices: () => [{ lang: 'en-US' }, { lang: 'es-ES' }],
    speak(utterance) {
      if (state.speechThrows) throw new Error('speech unavailable');
      this.calls.push(utterance);
      if (this.active) this.queue.push(utterance);
      else { this.active = utterance; if (!state.noSpeechStart) utterance.onstart?.(); }
    },
    cancel() {
      this.cancellations++;
      const active = this.active;
      this.active = null;
      this.queue.length = 0;
      active?.onerror?.({ error: 'canceled' });
    },
    finish() {
      const active = this.active;
      this.active = null;
      active?.onend?.();
      const next = this.queue.shift();
      if (next) { this.active = next; next.onstart?.(); }
    },
  };

  class Context {
    state = 'suspended';
    currentTime = 0;
    destination = { kind: 'destination' };
    nodes = [];
    closeCalls = 0;
    resumeCalls = 0;

    constructor() {
      if (state.contextThrows) throw new Error('no output device');
      contexts.push(this);
      if (state.noPanner) this.createStereoPanner = undefined;
      if (state.noCompressor) this.createDynamicsCompressor = undefined;
    }

    node(kind) {
      const node = new AudioNode(kind);
      if (state.legacyParameters) {
        for (const parameter of Object.values(node)) {
          if (parameter instanceof AudioParameter) parameter.cancelAndHoldAtTime = undefined;
        }
      }
      this.nodes.push(node);
      return node;
    }

    createOscillator() { return this.node('oscillator'); }
    createGain() { return this.node('gain'); }
    createStereoPanner() { return this.node('panner'); }
    createDynamicsCompressor() { return this.node('compressor'); }
    async resume() {
      this.resumeCalls++;
      if (state.resumeRejects) throw new Error('activation blocked');
      this.state = 'running';
    }
    async close() { this.closeCalls++; this.state = 'closed'; }
  }

  const navigator = { userActivation: activation };
  if (!state.noVibration) {
    navigator.vibrate = (pattern) => {
      vibrations.push(Array.isArray(pattern) ? [...pattern] : pattern);
      if (state.vibrationThrows) throw new Error('vibration unavailable');
      return state.vibrationRejects ? false : true;
    };
  }
  if (state.nativeBridge) {
    window.TactoNative = { vibrate(pattern) {
      vibrations.push(JSON.parse(pattern));
      return state.nativeRejects ? Promise.reject(new Error('native unavailable')) : Promise.resolve();
    } };
  }

  const replace = (name, value) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  replace('document', document);
  replace('window', window);
  replace('navigator', navigator);
  replace('performance', { now: () => clock.time });
  replace('setTimeout', clock.setTimeout);
  replace('clearTimeout', clock.clearTimeout);
  replace('addEventListener', window.addEventListener.bind(window));
  replace('removeEventListener', window.removeEventListener.bind(window));
  replace('AudioContext', state.noAudio ? undefined : Context);
  replace('webkitAudioContext', undefined);
  replace('speechSynthesis', state.noSpeech ? undefined : speech);
  replace('SpeechSynthesisUtterance', state.noSpeech ? undefined : class {
    constructor(text) { this.text = text; }
  });

  t.after(() => {
    for (const engine of engines) engine.destroy();
    clock.advance(2000);
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  return {
    state, clock, document, window, activation, contexts, vibrations, speech,
    create() { const engine = new FeedbackEngine(); engines.push(engine); return engine; },
    gesture() { activation.isActive = true; activation.hasBeenActive = true; },
  };
}

const region = (id = 'pico', overrides = {}) => ({
  id, label: `Región ${id}`, description: 'Un punto de la gráfica.',
  frequency: 440, waveform: 'triangle', pan: 0, gain: 0.6, pattern: [15, 25, 15],
  ...overrides,
});

const lastTarget = (parameter) => parameter.events.filter((event) => event.type === 'target').at(-1);
const master = (context) => context.nodes.find((node) => node.connections.includes(context.destination));

test('stays silent before a genuine gesture, including explicit reading and opted-in outputs', async (t) => {
  const h = harness(t);
  const engine = h.create();
  engine.setOptions({ voice: true, haptics: true });
  engine.update(region());
  h.document.fire('pointerdown');
  const capabilities = await engine.enable();
  assert.equal(capabilities.audio, false);
  assert.equal(engine.announce('No debe sonar'), false);
  h.clock.advance(3000);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.vibrations.length, 0);
  assert.equal(h.speech.calls.length, 0);
});

test('a trusted gesture unlocks one silent context, and repeated enable reuses it', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.document.fire('pointerdown', { isTrusted: true });
  assert.equal((await engine.enable()).audio, true);
  await engine.enable();
  assert.equal(h.contexts.length, 1);
  const context = h.contexts[0];
  const oscillators = context.nodes.filter((node) => node.kind === 'oscillator');
  assert.ok(oscillators.length > 0 && oscillators.every((node) => node.started));
  assert.equal(master(context).gain.value, 0, 'enabling output must not play a tone');
  assert.equal(h.vibrations.length, 0, 'enabling must not run a haptic test');
  assert.equal(h.speech.calls.length, 0);
});

test('ramps bounded audio parameters and stop mutes without closing the reusable context', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  const context = h.contexts[0];
  const output = master(context);
  const initialDirectWrites = context.nodes.flatMap((node) =>
    Object.values(node).filter((value) => value instanceof AudioParameter)
      .flatMap((parameter) => parameter.events.filter((event) => event.type === 'direct'))).length;
  engine.setOptions({ volume: 99 });
  engine.update(region('extreme', { frequency: Number.MAX_VALUE, pan: 99, gain: 99 }));
  assert.ok(lastTarget(output.gain).value > 0 && lastTarget(output.gain).value < 1);
  for (const oscillator of context.nodes.filter((node) => node.kind === 'oscillator')) {
    const target = lastTarget(oscillator.frequency);
    assert.ok(Number.isFinite(target.value) && target.value > 0 && target.value < 20000);
    assert.ok(target.constant > 0, 'pitch changes must use smooth automation');
    assert.ok(lastTarget(oscillator.connections[0].gain).value <= 1);
  }
  const panner = context.nodes.find((node) => node.kind === 'panner');
  assert.ok(Math.abs(lastTarget(panner.pan).value) <= 1);
  const laterDirectWrites = context.nodes.flatMap((node) =>
    Object.values(node).filter((value) => value instanceof AudioParameter)
      .flatMap((parameter) => parameter.events.filter((event) => event.type === 'direct'))).length;
  assert.equal(laterDirectWrites, initialDirectWrites, 'interaction must not jump AudioParam.value');
  engine.stop();
  assert.equal(lastTarget(output.gain).value, 0);
  assert.equal(context.closeCalls, 0);
  assert.equal(context.state, 'running');
  engine.update(region('again'));
  assert.ok(lastTarget(output.gain).value > 0, 'guided playback can resume without another pointer gesture');
  engine.setOptions({ sound: false });
  assert.equal(lastTarget(output.gain).value, 0);
  engine.setOptions({ sound: true, volume: -10 });
  assert.equal(lastTarget(output.gain).value, 0);
});

test('release, cancellation, blur and hidden documents stop output; a later click can explore again', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  const output = master(h.contexts[0]);
  for (const event of ['pointerup', 'pointercancel', 'touchcancel']) {
    engine.update(region(event));
    h.document.fire(event);
    assert.equal(lastTarget(output.gain).value, 0, `${event} must mute`);
  }
  h.document.addEventListener('click', () => engine.update(region('click')));
  h.document.fire('pointerup');
  h.document.fire('click');
  assert.ok(lastTarget(output.gain).value > 0, 'click exploration follows release capture');
  h.window.fire('blur');
  assert.equal(lastTarget(output.gain).value, 0);
  engine.update(region('visibility'));
  h.document.hidden = true;
  h.document.fire('visibilitychange');
  assert.equal(lastTarget(output.gain).value, 0);
  engine.update(region('hidden'));
  assert.equal(lastTarget(output.gain).value, 0);
});

test('haptics require opt-in, throttle dense updates and cancel; API acceptance is never physical verification', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  engine.update(region());
  assert.equal(h.vibrations.length, 0);
  engine.setOptions({ haptics: true });
  engine.update(region('a', { pattern: [99999, 99999, 99999] }));
  assert.equal(h.vibrations.length, 1);
  const pattern = h.vibrations[0];
  assert.ok(pattern.every((value) => Number.isFinite(value) && value >= 0));
  assert.ok(pattern.reduce((sum, value) => sum + value, 0) < 1000, 'untrusted patterns remain brief');
  for (let i = 0; i < 100; i++) engine.update(region('a'));
  assert.equal(h.vibrations.length, 1, 'pointermove must not flood the motor');
  h.clock.advance(2000);
  engine.update(region('a'));
  assert.equal(h.vibrations.length, 2, 'continued exploration can provide another cue');
  assert.equal(engine.capabilities.hapticsAvailable, true);
  assert.equal(engine.capabilities.hapticsVerified, false);
  assert.equal(engine.capabilities.haptics, false);
  assert.match(engine.capabilities.hapticsMode, /confirma|prueba/);
  engine.stop();
  assert.equal(h.vibrations.at(-1), 0);
  engine.setOptions({ haptics: false });
  h.clock.advance(2000);
  const count = h.vibrations.length;
  engine.update(region('off'));
  assert.equal(h.vibrations.length, count);
});

test('optional APIs may be absent and rejected audio activation can recover without rebuilding output', async (t) => {
  const h = harness(t, { resumeRejects: true, noPanner: true, noCompressor: true, legacyParameters: true });
  const engine = h.create();
  h.gesture();
  assert.equal((await engine.enable()).audio, false);
  assert.doesNotThrow(() => engine.update(region()));
  assert.equal(master(h.contexts[0]).gain.value, 0);
  h.state.resumeRejects = false;
  assert.equal((await engine.enable()).audio, true);
  assert.equal(h.contexts.length, 1);
  engine.update(region('recovered'));
  assert.ok(lastTarget(master(h.contexts[0]).gain).value > 0);
});

test('unavailable audio, vibration and speech do not prevent exploration', async (t) => {
  const h = harness(t, { noAudio: true, noVibration: true, noSpeech: true });
  const engine = h.create();
  h.gesture();
  const capabilities = await engine.enable();
  assert.equal(capabilities.audio, false);
  assert.equal(capabilities.hapticsAvailable, false);
  engine.setOptions({ haptics: true, voice: true });
  assert.doesNotThrow(() => engine.update(region()));
  assert.equal(engine.announce('Sin voz disponible'), false);
  assert.doesNotThrow(() => engine.stop());
  assert.doesNotThrow(() => engine.destroy());
});

test('vibration exceptions, a rejected native bridge and speech failures remain contained', async (t) => {
  const h = harness(t, { vibrationThrows: true, speechThrows: true });
  const engine = h.create();
  h.gesture();
  await engine.enable();
  engine.setOptions({ haptics: true });
  assert.doesNotThrow(() => engine.update(region()));
  assert.match(engine.capabilities.hapticsMode, /no se aceptó/);
  assert.doesNotThrow(() => engine.stop());
  assert.equal(engine.announce('Intento de lectura'), false);
  h.window.TactoNative = { vibrate: () => Promise.reject(new Error('bridge disconnected')) };
  h.clock.advance(2000);
  assert.doesNotThrow(() => engine.update(region('native')));
  await Promise.resolve();
  await Promise.resolve();
  assert.match(engine.capabilities.hapticsMode, /no se aceptó/);
  assert.doesNotThrow(() => engine.stop());
  await Promise.resolve();
});

test('voice is opt-in, debounces rapid regions, cancels obsolete speech and never builds a speech queue', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  engine.update(region('silent'));
  h.clock.advance(3000);
  assert.equal(h.speech.calls.length, 0);
  engine.setOptions({ voice: true });
  for (const id of ['one', 'two', 'latest']) {
    engine.update(region(id));
    h.clock.advance(80);
  }
  assert.equal(h.speech.calls.length, 0, 'crossing a region briefly should not start narration');
  h.clock.advance(1500);
  assert.equal(h.speech.calls.length, 1);
  assert.match(h.speech.active.text, /latest/);
  assert.equal(h.speech.active.lang, 'es-ES');
  engine.update(region('replacement'));
  assert.equal(h.speech.active, null, 'a new region cancels the old utterance immediately');
  h.clock.advance(1500);
  assert.equal(h.speech.calls.length, 2);
  assert.match(h.speech.active.text, /replacement/);
  assert.equal(h.speech.queue.length, 0);
  engine.update(region('canceled-before-reading'));
  engine.stop();
  h.clock.advance(3000);
  assert.equal(h.speech.calls.length, 2, 'stop cancels pending debounced narration');
  assert.equal(h.speech.active, null);
  engine.setOptions({ voice: false });
  assert.equal(engine.announce('Lectura pedida con el botón'), true, 'explicit reading is a separate opt-in');
  assert.match(h.speech.active.text, /Lectura pedida/);
  engine.stop();
  assert.equal(h.speech.active, null);
  assert.equal(h.speech.queue.length, 0);
});

test('a short touch releases tones and vibration while allowing the region name to start and finish', async (t) => {
  const h = harness(t);
  const engine = h.create(); h.gesture(); await engine.enable();
  engine.setOptions({ voice: true, haptics: true });
  engine.update(region('short-touch'));
  h.clock.advance(60); h.document.fire('pointerup');
  assert.equal(lastTarget(master(h.contexts[0]).gain).value, 0);
  assert.equal(h.vibrations.at(-1), 0);
  h.clock.advance(400);
  assert.equal(h.speech.active.text, 'Región short-touch', 'auto voice speaks the short name after release');
  engine.stop({ speech: false });
  assert.notEqual(h.speech.active, null, 'preview timeout must preserve narration');
  h.speech.finish(); assert.match(engine.capabilities.speechMessage, /terminada/);
  engine.update(region('pending')); engine.stop(); h.clock.advance(2500);
  assert.equal(h.speech.active, null, 'explicit pause cancels pending and active speech');
});

test('unchanged voice preferences do not cancel explicit reading, and a failed start is visible and retryable', async (t) => {
  const h = harness(t, { noSpeechStart: true });
  const engine = h.create(); h.gesture(); await engine.enable();
  assert.equal(engine.announce('Una descripción propia'), true);
  engine.setOptions({ voice: false, volume: .25 });
  assert.notEqual(h.speech.active, null, 'applying unchanged opt-in preferences must not cancel an explicit reading');
  h.clock.advance(2100);
  assert.equal(engine.capabilities.speechState, 'unavailable');
  assert.match(engine.capabilities.speechMessage, /no inició/);
  h.state.noSpeechStart = false;
  assert.equal(engine.announce('Una descripción propia'), true);
  assert.equal(engine.capabilities.speechState, 'speaking');
  assert.ok(h.speech.active.volume > .25, 'narration needs a clearer level than the exploratory tone');
  engine.stop();
  assert.equal(h.speech.active, null);
});

test('an English page speaks with an English browser voice and reports status in English', async (t) => {
  setLanguage('en');
  t.after(() => setLanguage('es'));
  const h = harness(t);
  const engine = h.create(); h.gesture(); await engine.enable();
  assert.equal(engine.announce('A description of my own'), true);
  assert.equal(h.speech.active.lang, 'en-US');
  assert.equal(h.speech.active.voice?.lang, 'en-US');
  assert.match(engine.capabilities.speechMessage, /browser voice/);
  h.speech.finish();
  assert.match(engine.capabilities.speechMessage, /finished/);
  engine.setOptions({ haptics: true });
  engine.update(region('english'));
  assert.equal(engine.capabilities.hapticsState, 'requested');
  assert.match(engine.capabilities.hapticsMode, /confirm whether your device vibrated/);
  engine.stop();
});

test('a voice reported as en_US by an Android browser still matches', async (t) => {
  setLanguage('en');
  t.after(() => setLanguage('es'));
  const h = harness(t);
  h.speech.getVoices = () => [{ lang: 'es_ES' }, { lang: 'en_US' }];
  const engine = h.create(); h.gesture(); await engine.enable();
  engine.announce('Another description');
  assert.equal(h.speech.active.voice?.lang, 'en_US');
  engine.stop();
});

test('mission speech plays its phrases in order and is not cut by moving across regions or off the image', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  engine.setOptions({ voice: true });
  assert.equal(engine.announce(['Primera frase', 'Segunda frase'], { priority: true }), true);
  assert.deepEqual(h.speech.calls.map((utterance) => utterance.text), ['Primera frase']);
  engine.update(region('a'));
  engine.update(region('b'));
  engine.stop({ speech: true, keepPriority: true, keepBeacon: true });
  h.clock.advance(3000);
  assert.equal(h.speech.cancellations, 0, 'moving the finger must not cut a mission phrase');
  assert.deepEqual(h.speech.calls.map((utterance) => utterance.text), ['Primera frase'], 'region names wait for it');
  h.speech.finish();
  assert.deepEqual(h.speech.calls.map((utterance) => utterance.text), ['Primera frase', 'Segunda frase']);
  h.speech.finish();
  engine.update(region('c'));
  h.clock.advance(1500);
  assert.equal(h.speech.calls.at(-1).text, 'Región c', 'after the mission phrase, names are spoken again');
  engine.announce('Otra', { priority: true });
  const before = h.speech.cancellations;
  engine.stop();
  assert.equal(h.speech.cancellations, before + 1, 'pausing still silences mission speech');
});

test('the guiding sound blips faster near the answer, pans to its side and ends with the finger', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  const context = h.contexts[0];
  const oscillators = () => context.nodes.filter((node) => node.kind === 'oscillator');
  const sineGain = context.nodes.filter((node) => node.kind === 'gain')[0];
  engine.update(region('tono', { waveform: 'sine' }));
  const loud = lastTarget(sineGain.gain).value;
  engine.setBeacon({ distance: 0.6, side: -1, height: -1, onTarget: false });
  assert.ok(Math.abs(lastTarget(sineGain.gain).value - loud * 0.4) < 1e-9, 'the region tone steps back');
  const blip = oscillators().at(-1);
  assert.ok(blip.started);
  assert.ok(blip.frequency.value < 620, 'an answer below sounds lower');
  assert.equal(blip.connections[0].connections[0].pan.value, -1, 'an answer on the left sounds on the left');
  let before = oscillators().length;
  h.clock.advance(2000);
  const far = oscillators().length - before;
  engine.setBeacon({ distance: 0, side: 0, height: 0, onTarget: true });
  h.clock.advance(1000);
  before = oscillators().length;
  h.clock.advance(2000);
  const onTarget = oscillators().length - before;
  assert.ok(far >= 2 && far <= 3, `far away, about one blip a second (${far})`);
  assert.ok(onTarget >= 15, `on the answer, a quick trill (${onTarget})`);
  engine.stop({ speech: false, keepBeacon: true });
  before = oscillators().length;
  h.clock.advance(500);
  assert.ok(oscillators().length > before, 'leaving a region keeps the guide while the finger is down');
  engine.stop({ speech: false });
  before = oscillators().length;
  h.clock.advance(2000);
  assert.equal(oscillators().length, before, 'lifting the finger stops it');
  assert.equal(engine.beaconActive, false);
});

test('answer earcons and the confirming vibration follow the sound and haptics settings', async (t) => {
  const h = harness(t);
  const engine = h.create();
  h.gesture();
  await engine.enable();
  const context = h.contexts[0];
  const oscillators = () => context.nodes.filter((node) => node.kind === 'oscillator').length;
  const base = oscillators();
  engine.cue('success');
  assert.equal(oscillators(), base + 2, 'two rising notes');
  engine.cue('wrong');
  assert.equal(oscillators(), base + 3, 'one low note');
  engine.setOptions({ sound: false });
  engine.cue('success');
  assert.equal(oscillators(), base + 3, 'no earcons with the sound off');
  assert.equal(engine.pulse([40, 60, 40]), false, 'no vibration unless haptics are on');
  assert.equal(h.vibrations.length, 0);
  engine.setOptions({ haptics: true });
  assert.equal(engine.pulse([40, 60, 40]), true);
  assert.deepEqual(h.vibrations.at(-1), [40, 60, 40]);
});
