import { getNarrationUrl } from './narration.js';
import { t, getLanguage, speechLocale } from './i18n.js';

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const now = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * Optional audio, vibration and speech for TACTO's exploration surface.
 * Constructing this class is silent. Call enable() from a real user gesture.
 * Browser vibration support cannot establish that a physical motor responded.
 */
export class FeedbackEngine {
  constructor() {
    this.options = { sound: true, haptics: false, voice: false, volume: 0.25 };
    this._context = null;
    this._nodes = null;
    this._enablePromise = null;
    this._unlocked = false;
    this._gestureSeen = false;
    this._destroyed = false;
    this._active = false;
    this._sample = null;
    this._regionId = null;
    this._lastHapticAt = -Infinity;
    this._lastHapticId = null;
    this._hapticStatus = 'idle';
    this._vibrationRequested = false;
    this._vibrationRoute = null;
    this._voiceTimer = null;
    this._utterance = null;
    this._speechSequence = 0;
    this._lastSpeechAt = -Infinity;
    this._lastSpokenId = null;
    this._speaking = false;
    this._speechStatus = 'idle';
    this._speechMessage = t('speech.idle');
    this._speechWatchdog = null;
    this._clipSource = null;
    this._clipGain = null;
    this._clipCache = new Map();
    // Set when the site answers 404 for a recording (a copy published without
    // them): later phrases go straight to the device voice instead of asking again.
    this._recordingsMissing = false;
    // Mission speech (questions, answers, directions) is not cut by moving the finger.
    this._priority = false;
    this._beacon = null;
    this._beaconTimer = null;
    this._listeners = [];

    this._onGesture = (event) => {
      if (event.isTrusted) this._gestureSeen = true;
    };
    this._onRelease = () => this.stop({ speech: false });
    this._onInterrupt = () => this.stop();
    this._onVisibility = () => {
      if (globalThis.document?.hidden) this.stop();
    };

    const document = globalThis.document;
    if (document?.addEventListener) {
      for (const type of ['pointerdown', 'keydown', 'touchstart', 'click']) {
        this._listen(document, type, this._onGesture, true);
      }
      for (const type of ['pointerup', 'touchend']) {
        this._listen(document, type, this._onRelease, true);
      }
      for (const type of ['pointercancel', 'touchcancel']) this._listen(document, type, this._onInterrupt, true);
      this._listen(document, 'visibilitychange', this._onVisibility);
    }
    if (globalThis.addEventListener) {
      this._listen(globalThis, 'blur', this._onInterrupt);
      this._listen(globalThis, 'pagehide', this._onInterrupt);
    }
    if (typeof globalThis.speechSynthesis?.addEventListener === 'function') this._listen(globalThis.speechSynthesis, 'voiceschanged', () => {
      if (this._speechStatus === 'unavailable' && globalThis.speechSynthesis.getVoices().length) this._setSpeechStatus('idle', t('speech.voicesReady'));
    });
  }

  _listen(target, type, listener, options = false) {
    target.addEventListener(type, listener, options);
    this._listeners.push([target, type, listener, options]);
  }

  _canUnlock() {
    const activation = globalThis.navigator?.userActivation;
    return this._gestureSeen || Boolean(activation?.isActive || activation?.hasBeenActive);
  }

  _hapticRoute() {
    const native = globalThis.window?.TactoNative ?? globalThis.TactoNative;
    if (typeof native?.vibrate === 'function') {
      return { kind: 'native', call: (pattern) => native.vibrate(JSON.stringify(pattern)) };
    }
    const navigator = globalThis.navigator;
    if (typeof navigator?.vibrate === 'function') {
      return { kind: 'web', call: (pattern) => navigator.vibrate(pattern) };
    }
    return null;
  }

  get capabilities() {
    const route = this._destroyed ? null : this._hapticRoute();
    let hapticsMode = t('haptics.unavailable');
    if (route) {
      hapticsMode = t(route.kind === 'native' ? 'haptics.native' : 'haptics.api');
      if (this._hapticStatus === 'requested') {
        hapticsMode = t('haptics.requested');
      } else if (this._hapticStatus === 'failed') {
        hapticsMode = t('haptics.failed');
      }
    }
    return {
      audio: !this._destroyed && this._context?.state === 'running',
      // A successful API call still does not verify physical vibration.
      haptics: false,
      hapticsAvailable: Boolean(route),
      hapticsVerified: false,
      // 'idle' | 'requested' | 'failed': for logic; hapticsMode is the message.
      hapticsState: route ? this._hapticStatus : 'unavailable',
      hapticsMode,
      speechState: this._speechStatus,
      speechMessage: this._speechMessage,
      browserVoices: globalThis.speechSynthesis?.getVoices?.().length ?? 0,
    };
  }

  _setSpeechStatus(state, message) {
    this._speechStatus = state;
    this._speechMessage = message;
    try { this.onStatusChange?.(this.capabilities); } catch { /* Status rendering is optional. */ }
  }

  async enable() {
    if (this._destroyed || globalThis.document?.hidden || !this._canUnlock()) {
      return this.capabilities;
    }
    this._unlocked = true;
    if (this._enablePromise) return this._enablePromise;
    this._enablePromise = this._enableAudio();
    try {
      return await this._enablePromise;
    } finally {
      this._enablePromise = null;
    }
  }

  async _enableAudio() {
    try {
      const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (typeof AudioContext !== 'function') return this.capabilities;
      if (!this._context || this._context.state === 'closed') {
        this._context = new AudioContext({ latencyHint: 'interactive' });
        this._createAudioGraph(this._context);
      }
      const context = this._context;
      if (context.state !== 'running') {
        let timeout;
        try {
          await Promise.race([
            context.resume(),
            new Promise((resolve) => { timeout = setTimeout(resolve, 1500); }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (!this._destroyed && context.state === 'running' && this._active) {
        this._applyAudio(this._sample);
      }
    } catch {
      // A rejected resume or unavailable output must not break exploration.
      this._silenceAudio();
    }
    return this.capabilities;
  }

  _createAudioGraph(context) {
    const sine = context.createOscillator();
    const triangle = context.createOscillator();
    const sineGain = context.createGain();
    const triangleGain = context.createGain();
    const mix = context.createGain();
    const master = context.createGain();
    const panner = typeof context.createStereoPanner === 'function'
      ? context.createStereoPanner() : null;
    const limiter = typeof context.createDynamicsCompressor === 'function'
      ? context.createDynamicsCompressor() : null;

    sine.type = 'sine';
    triangle.type = 'triangle';
    sine.frequency.value = 220;
    triangle.frequency.value = 220;
    triangle.detune.value = -2;
    sineGain.gain.value = 0;
    triangleGain.gain.value = 0;
    master.gain.value = 0;
    mix.gain.value = 1;

    sine.connect(sineGain);
    triangle.connect(triangleGain);
    sineGain.connect(mix);
    triangleGain.connect(mix);
    let output = mix;
    if (panner) {
      output.connect(panner);
      output = panner;
    }
    if (limiter) {
      limiter.threshold.value = -18;
      limiter.knee.value = 20;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.006;
      limiter.release.value = 0.15;
      output.connect(limiter);
      output = limiter;
    }
    output.connect(master);
    master.connect(context.destination);
    sine.start();
    triangle.start();
    this._nodes = { sine, triangle, sineGain, triangleGain, mix, panner, limiter, master };
  }

  _ramp(parameter, value, timeConstant = 0.025) {
    if (!parameter || !this._context || this._context.state === 'closed') return;
    const time = this._context.currentTime;
    try {
      if (typeof parameter.cancelAndHoldAtTime === 'function') {
        parameter.cancelAndHoldAtTime(time);
      } else {
        const current = parameter.value;
        parameter.cancelScheduledValues(time);
        parameter.setValueAtTime(current, time);
      }
      parameter.setTargetAtTime(value, time, timeConstant);
    } catch {
      // Audio may have been interrupted by the operating system.
    }
  }

  _silenceAudio() {
    if (!this._nodes) return;
    this._ramp(this._nodes.sineGain.gain, 0, 0.018);
    this._ramp(this._nodes.triangleGain.gain, 0, 0.018);
    this._ramp(this._nodes.master.gain, 0, 0.018);
  }

  _applyAudio(sample) {
    if (!sample || !this._active || !this.options.sound || !this._unlocked
      || this._context?.state !== 'running' || globalThis.document?.hidden) {
      this._silenceAudio();
      return;
    }
    const nodes = this._nodes;
    if (!nodes) return;
    const frequency = clamp(sample.frequency, 70, 1100, 220);
    // The region tone steps back while a voice speaks or the guiding sound plays.
    const level = clamp(sample.gain, 0, 1, 0.6) * 0.7 * (this._speaking ? 0.22 : 1) * (this._beacon ? 0.4 : 1);
    const triangleMix = sample.waveform === 'triangle' ? 0.6 : 0.2;
    this._ramp(nodes.sine.frequency, frequency, 0.035);
    this._ramp(nodes.triangle.frequency, frequency, 0.035);
    this._ramp(nodes.sineGain.gain, level * (1 - triangleMix));
    this._ramp(nodes.triangleGain.gain, level * triangleMix);
    if (nodes.panner) this._ramp(nodes.panner.pan, clamp(sample.pan, -1, 1, 0), 0.04);
    // Bounded digital level and a compressor; headphone/system volume is separate.
    this._ramp(nodes.master.gain, this.options.volume * 0.2, 0.035);
  }

  setOptions(options = {}) {
    if (this._destroyed) return;
    const wasVoice = this.options.voice;
    for (const key of ['sound', 'haptics', 'voice']) {
      if (typeof options[key] === 'boolean') this.options[key] = options[key];
    }
    if (options.volume !== undefined) {
      this.options.volume = clamp(options.volume, 0, 1, this.options.volume);
    }
    if (!this.options.haptics) this._cancelVibration();
    if ((wasVoice && !this.options.voice) || this.options.volume === 0) this._cancelSpeech();
    if (!wasVoice && this.options.voice) this._regionId = null;
    if (this._clipGain && this.options.volume > 0) this._ramp(this._clipGain.gain, Math.min(.9, this.options.volume * 2.6));
    this._applyAudio(this._sample);
  }

  update(sample, { announce } = {}) {
    if (this._destroyed || !sample || globalThis.document?.hidden) {
      this.stop();
      return;
    }
    const id = String(sample.id ?? sample.label ?? 'region');
    const changed = id !== this._regionId;
    if (changed && !this._priority) this._cancelSpeech();
    this._regionId = id;
    this._sample = sample;
    this._active = true;
    this._applyAudio(sample);
    if (!this._unlocked) return;
    this._applyVibration(sample, id);
    if (this.options.voice && announce !== false && (changed || announce === true)) {
      // Short names remain intelligible while moving; explanations are on demand.
      const text = sample.label;
      this._scheduleSpeech(text, id);
    }
  }

  _microPattern(pattern) {
    const values = Array.isArray(pattern) ? pattern.slice(0, 7)
      : [typeof pattern === 'number' ? pattern : 14];
    let budget = 180;
    return values.map((value) => {
      const duration = Math.round(clamp(value, 0, Math.min(60, budget), 0));
      budget -= duration;
      return duration;
    });
  }

  _applyVibration(sample, id) {
    if (!this.options.haptics || !this._active || !this._unlocked) return;
    const route = this._hapticRoute();
    if (!route) return;
    const time = now();
    const minimumGap = id === this._lastHapticId ? 650 : 160;
    if (time - this._lastHapticAt < minimumGap) return;
    const pattern = this._microPattern(sample.pattern);
    if (!pattern.some((duration, index) => index % 2 === 0 && duration > 0)) return;
    this._lastHapticAt = time;
    this._lastHapticId = id;
    this._vibrationRoute = route;
    this._vibrationRequested = true;
    try {
      const result = route.call(pattern);
      this._hapticStatus = result === false ? 'failed' : 'requested';
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then((accepted) => {
          if (!this._destroyed && accepted === false) this._hapticStatus = 'failed';
        }, () => {
          if (!this._destroyed) this._hapticStatus = 'failed';
        });
      }
    } catch {
      this._hapticStatus = 'failed';
    }
  }

  _cancelVibration() {
    if (!this._vibrationRequested) return;
    this._vibrationRequested = false;
    try {
      const route = this._vibrationRoute;
      const result = route?.call(route.kind === 'native' ? [0] : 0);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Stopping exploration must remain safe even when vibration is unavailable.
    }
    this._vibrationRoute = null;
  }

  _speechAvailable() {
    return typeof globalThis.SpeechSynthesisUtterance === 'function'
      && typeof globalThis.speechSynthesis?.speak === 'function';
  }

  _scheduleSpeech(text, id) {
    if (!text || this.options.volume === 0) return;
    if (!this._speechAvailable() && (this._recordingsMissing || !getNarrationUrl(text, getLanguage()))) { this._setSpeechStatus('unavailable', t('speech.noVoiceForText')); return; }
    if (id === this._lastSpokenId && now() - this._lastSpeechAt < 1800) return;
    clearTimeout(this._voiceTimer);
    const delay = Math.max(240, 950 - (now() - this._lastSpeechAt));
    this._voiceTimer = setTimeout(() => {
      this._voiceTimer = null;
      // A mission phrase in progress wins; the name is said on the next change.
      if (!this._destroyed && this._regionId === id && this.options.voice && !this._priority) {
        this._speak(String(text).slice(0, 320), id);
      }
    }, delay);
  }

  /**
   * Explicit reading button: the gesture itself opts into this speech. Several
   * phrases are spoken one after another. With priority, moving the finger to
   * another region or off the image does not cut them (missions use this).
   */
  announce(text, { priority = false } = {}) {
    if (this._destroyed || !text || globalThis.document?.hidden || !this._canUnlock()) {
      return false;
    }
    const parts = (Array.isArray(text) ? text : [text])
      .map(part => String(part ?? '').trim().slice(0, 600)).filter(Boolean);
    if (!parts.length) return false;
    this._unlocked = true;
    this._cancelSpeech();
    return this._speakParts(parts, priority);
  }

  _speakParts(parts, priority) {
    const [first, ...rest] = parts;
    const then = rest.length ? () => this._speakParts(rest, priority) : null;
    const started = this._speak(first, null, { priority, then });
    // A phrase that cannot be spoken must not silence the ones after it.
    return started || (rest.length ? this._speakParts(rest, priority) : false);
  }

  _speak(text, id, { skipRecording = false, priority = false, then = null } = {}) {
    if (!this._unlocked || this.options.volume === 0) return false;
    this._cancelSpeech();
    this._priority = Boolean(priority);
    const sequence = this._speechSequence;
    const language = getLanguage();
    const clipUrl = !skipRecording && !this._recordingsMissing && getNarrationUrl(text, language);
    if (clipUrl && this._context?.state === 'running' && typeof this._context.decodeAudioData === 'function' && typeof this._context.createBufferSource === 'function') {
      this._setSpeechStatus('loading', t('speech.loadingClip'));
      this._playRecorded(clipUrl, text, id, sequence, { priority, then });
      return true;
    }
    if (!this._speechAvailable()) { this._setSpeechStatus('unavailable', t('speech.unavailable')); return false; }
    try {
      const utterance = new globalThis.SpeechSynthesisUtterance(text);
      const locale = speechLocale(language);
      utterance.lang = locale;
      utterance.rate = 0.94;
      utterance.pitch = 1;
      utterance.volume = Math.min(0.9, this.options.volume * 2.6);
      // Some Android browsers report voice languages as "en_US".
      const voiceLanguage = (candidate) => String(candidate?.lang ?? '').toLowerCase().replace('_', '-');
      const voices = globalThis.speechSynthesis.getVoices?.() ?? [];
      const voice = voices.find((candidate) => voiceLanguage(candidate) === locale.toLowerCase())
        ?? voices.find((candidate) => voiceLanguage(candidate).split('-')[0] === language);
      if (voice) utterance.voice = voice;
      const finish = () => {
        if (sequence !== this._speechSequence) return;
        this._utterance = null;
        this._speaking = false;
        this._priority = false;
        clearTimeout(this._speechWatchdog);
        this._setSpeechStatus('idle', t('speech.finished'));
        this._applyAudio(this._sample);
        then?.();
      };
      utterance.onstart = () => {
        if (sequence !== this._speechSequence) return;
        clearTimeout(this._speechWatchdog);
        this._speaking = true;
        this._lastSpeechAt = now();
        this._lastSpokenId = id;
        this._setSpeechStatus('speaking', t('speech.speaking'));
        this._applyAudio(this._sample);
      };
      utterance.onend = finish;
      utterance.onerror = event => {
        if (sequence !== this._speechSequence) return;
        finish();
        if (!['canceled', 'interrupted'].includes(event?.error)) this._setSpeechStatus('error', t('speech.error'));
      };
      this._utterance = utterance;
      this._setSpeechStatus('loading', t('speech.requesting'));
      this._speechWatchdog = setTimeout(() => {
        if (sequence !== this._speechSequence || this._speaking) return;
        this._cancelSpeech();
        this._setSpeechStatus('unavailable', t('speech.noStart'));
      }, 2000);
      globalThis.speechSynthesis.resume?.();
      globalThis.speechSynthesis.speak(utterance);
      return true;
    } catch {
      this._utterance = null;
      this._speaking = false;
      clearTimeout(this._speechWatchdog);
      this._setSpeechStatus('error', t('speech.browserUnavailable'));
      return false;
    }
  }

  async _playRecorded(url, text, id, sequence, { priority = false, then = null } = {}) {
    try {
      if (!this._clipCache.has(url)) {
        let timeout;
        const abort = typeof AbortController === 'function' ? new AbortController() : null;
        const request = fetch(url, abort ? { signal: abort.signal } : undefined);
        const promise = Promise.race([request, new Promise((_, reject) => {
          timeout = setTimeout(() => { abort?.abort(); reject(new Error('Narration timed out')); }, 8000);
        })]).then(response => {
          if (response.status === 404) this._recordingsMissing = true;
          if (!response.ok) throw new Error('Narration unavailable');
          return response.arrayBuffer();
        }).then(bytes => this._context.decodeAudioData(bytes)).finally(() => clearTimeout(timeout));
        this._clipCache.set(url, promise);
        promise.catch(() => this._clipCache.delete(url));
      }
      const buffer = await this._clipCache.get(url);
      if (sequence !== this._speechSequence || this._destroyed || globalThis.document?.hidden) return;
      const source = this._context.createBufferSource();
      const gain = this._context.createGain();
      source.buffer = buffer;
      gain.gain.value = Math.min(.9, this.options.volume * 2.6);
      source.connect(gain); gain.connect(this._context.destination);
      this._clipSource = source; this._clipGain = gain; this._speaking = true;
      this._lastSpeechAt = now(); this._lastSpokenId = id;
      this._setSpeechStatus('speaking', t('speech.playingClip'));
      this._applyAudio(this._sample);
      source.onended = () => {
        if (sequence !== this._speechSequence) return;
        this._clipSource = null; this._clipGain = null; this._speaking = false; this._priority = false;
        this._setSpeechStatus('idle', t('speech.finished'));
        this._applyAudio(this._sample);
        try { source.disconnect(); gain.disconnect(); } catch {}
        then?.();
      };
      source.start();
    } catch {
      if (sequence !== this._speechSequence || this._destroyed) return;
      this._speak(text, id, { skipRecording: true, priority, then });
    }
  }

  _cancelSpeech() {
    clearTimeout(this._voiceTimer);
    clearTimeout(this._speechWatchdog);
    this._voiceTimer = null;
    this._speechSequence += 1;
    if (this._clipSource) {
      const source = this._clipSource;
      try { source.stop(); source.disconnect(); this._clipGain?.disconnect(); } catch {}
      this._clipSource = null; this._clipGain = null;
    }
    if (this._utterance) {
      try { globalThis.speechSynthesis?.cancel(); } catch { /* Optional API. */ }
    }
    this._utterance = null;
    this._speaking = false;
    this._priority = false;
    this._setSpeechStatus('idle', t('speech.idle'));
  }

  /**
   * The guiding sound of a mission hint: short blips that come faster as the
   * finger nears the answer, panned to its side and higher when it lies above.
   * guide = { distance, side, height, onTarget } (see missions.js); null stops it.
   * Updating the guide keeps the rhythm; it does not restart it.
   */
  setBeacon(guide) {
    if (this._destroyed) return;
    if (!guide) { this._stopBeacon(); return; }
    const starting = !this._beacon;
    this._beacon = { ...guide };
    if (!this._beaconTimer) this._beaconTick();
    if (starting) this._applyAudio(this._sample);
  }

  get beaconActive() { return Boolean(this._beacon); }

  _stopBeacon() {
    const wasOn = Boolean(this._beacon);
    clearTimeout(this._beaconTimer);
    this._beaconTimer = null;
    this._beacon = null;
    if (wasOn) this._applyAudio(this._sample);
  }

  _beaconTick() {
    this._beaconTimer = null;
    const guide = this._beacon;
    if (!guide || this._destroyed) return;
    if (guide.onTarget) this._tone(1175, { type: 'triangle', length: 0.07, pan: guide.side });
    else this._tone(620 * 2 ** (clamp(guide.height, -1, 1, 0) * 7 / 12), { length: 0.09, pan: guide.side });
    const interval = guide.onTarget ? 110 : 120 + 780 * clamp(guide.distance / 0.6, 0, 1, 1);
    this._beaconTimer = setTimeout(() => this._beaconTick(), interval);
  }

  /** A short earcon for an answer: 'success' (two rising notes) or 'wrong' (one low note). */
  cue(kind) {
    if (kind === 'success') {
      this._tone(784, { length: 0.12 });
      this._tone(1175, { at: 0.11, length: 0.18 });
    } else {
      this._tone(196, { type: 'triangle', length: 0.2 });
    }
  }

  _tone(frequency, { at = 0, type = 'sine', length = 0.1, pan = 0 } = {}) {
    const context = this._context;
    if (this._destroyed || !this.options.sound || !this._unlocked || this.options.volume === 0
      || context?.state !== 'running' || globalThis.document?.hidden) return false;
    try {
      const start = context.currentTime + at;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const panner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
      oscillator.type = type;
      oscillator.frequency.value = clamp(frequency, 70, 2000, 620);
      envelope.gain.value = 0;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.setTargetAtTime(Math.min(0.45, this.options.volume * 1.2), start, 0.004);
      envelope.gain.setTargetAtTime(0, start + length * 0.35, length * 0.3);
      oscillator.connect(envelope);
      if (panner) {
        panner.pan.value = clamp(pan, -1, 1, 0);
        envelope.connect(panner);
        panner.connect(context.destination);
      } else envelope.connect(context.destination);
      oscillator.start(start);
      oscillator.stop?.(start + length + 0.12);
      oscillator.onended = () => {
        try { oscillator.disconnect(); envelope.disconnect(); panner?.disconnect(); } catch { /* Already gone. */ }
      };
      return true;
    } catch {
      // Earcons and guidance are optional; exploration continues without them.
      return false;
    }
  }

  /** A one-off vibration, such as the confirmation of an answer. Needs haptics on. */
  pulse(pattern) {
    if (this._destroyed || !this.options.haptics || !this._unlocked) return false;
    const route = this._hapticRoute();
    if (!route) return false;
    try {
      const result = route.call(this._microPattern(pattern));
      this._hapticStatus = result === false ? 'failed' : 'requested';
      this._vibrationRoute = route;
      this._vibrationRequested = true;
      return result !== false;
    } catch {
      this._hapticStatus = 'failed';
      return false;
    }
  }

  /**
   * keepPriority leaves a mission phrase speaking (the finger left the image);
   * keepBeacon leaves the guiding sound on (the finger is still down).
   */
  stop({ speech = true, keepPriority = false, keepBeacon = false } = {}) {
    this._active = false;
    this._sample = null;
    if (speech) this._regionId = null;
    this._silenceAudio();
    this._cancelVibration();
    if (!keepBeacon) this._stopBeacon();
    if (speech && !(keepPriority && this._priority)) this._cancelSpeech();
  }

  destroy() {
    if (this._destroyed) return;
    this.stop();
    this._destroyed = true;
    for (const [target, type, listener, options] of this._listeners) {
      target.removeEventListener(type, listener, options);
    }
    this._listeners.length = 0;
    const context = this._context;
    this._context = null;
    this._nodes = null;
    if (context && context.state !== 'closed') {
      // Let the short release ramp settle before removing the output graph.
      setTimeout(() => {
        try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already closed. */ }
      }, 110);
    }
  }
}
