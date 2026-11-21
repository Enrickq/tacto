import { scenes } from './scenes.js';
import { FeedbackEngine } from './feedback.js';
import { initStudio } from './studio.js';
import { t, plural, getLanguage, chooseLanguage, applyTranslations } from './i18n.js';
import { MissionRun, guidance, isTap, isDoubleTap, distance as diagramDistance } from './missions.js';

const $ = id => document.getElementById(id);
// The markup is written in Spanish; translate it before anything is drawn.
applyTranslations(document);
document.title = t('meta.title');
document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
document.querySelectorAll('[data-language]').forEach(button => {
  const active = button.dataset.language === getLanguage();
  button.setAttribute('aria-pressed', String(active));
  button.addEventListener('click', () => { if (!active) chooseLanguage(button.dataset.language); });
});
// A shared link such as ?lang=en keeps its language when the logo is pressed.
if (new URLSearchParams(location.search).has('lang')) document.querySelector('.brand')?.setAttribute('href', `./?lang=${getLanguage()}`);
const icons = {
  play: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.1.6-1.7 1-1.7 2.7M12 16.5h.01"/>',
  headphones: '<path d="M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v7h4v-7ZM20 12h1v7h-4v-7Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18M10 5.2A13 13 0 0 1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3.5 4.4M6.5 6.5A20 20 0 0 0 2 12s3.5 7 10 7a13 13 0 0 0 5.5-1.3M10 10a3 3 0 0 0 4 4"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6M22 9l-6 6"/>',
  speaker: '<path d="m10 5-5 4H2v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  route: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h3"/>',
  ear: '<path d="M7 9a5 5 0 1 1 10 0c0 4-4 4-4 7a3 3 0 0 1-6 0M10 9a2 2 0 1 1 4 0c0 2-3 2-3 4"/>',
  fingerprint: '<path d="M5 10a7 7 0 0 1 14 0v3M2 10a10 10 0 0 1 20 0M8 17v-7a4 4 0 0 1 8 0v6M12 9v7a8 8 0 0 1-2 5M4 14v3M20 17l-1 3M15 20l1-1"/>',
  spark: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z"/>',
  sliders: '<path d="M4 4v6M4 15v5M12 4v2M12 11v9M20 4v10M20 19v1M1 10h6M9 6h6M17 14h6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  cell: '<path d="M12 3c6 0 9 3 9 8s-4 10-10 10-8-6-8-11 3-7 9-7Z"/><circle cx="12" cy="11" r="3"/><path d="m6 14 2 1M15 17l2-1M7 7h1"/>',
  islands: '<path d="m3 15 3-5 3 3 2 5-5 2ZM13 8l2-5 3 3-1 5ZM17 17l4-3 1 5-3 2Z"/>',
  economy: '<path d="M4 3v17h17M7 6l12 11M7 17 19 6"/><circle cx="13" cy="11.5" r="2"/>',
  custom: '<path d="M4 16V5h16v14H8M8 20v-7M4.5 16.5l7 0M7 9h.01M10 14l4-5 6 7"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.spark}</svg>`; }
function decorate(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
decorate();

const engine = new FeedbackEngine();
let prefs = { sound: true, haptics: false, voice: false, volume: .25 };
try { const stored = JSON.parse(localStorage.getItem('tacto-preferences') || '{}'); for (const k of ['sound', 'haptics', 'voice']) if (typeof stored[k] === 'boolean') prefs[k] = stored[k]; if (typeof stored.volume === 'number' && Number.isFinite(stored.volume)) prefs.volume = Math.max(0, Math.min(.6, stored.volume)); } catch {}
let scene = scenes[0], enabled = false, enabling = null, pressed = false, pointerId = null, touring = false;
let point = { x: .5, y: .5 }, lastSample = null, activeRegion = null, tourFrame = null;
let keyboardTimer = null, announcementTimer = null, previewTimer = null, toastTimer = null;
let generation = 0, previousPaintedRegion = null;
let hapticReport = null;
const discovered = new Map(scenes.map(s => [s.id, new Set()]));
const newSession = () => ({ schema: 'tacto.exploration.v2', startedAt: new Date().toISOString(), events: [], missions: [] });
let session = newSession();
// Missions: the run in progress, the last finished one, taps for the answer gesture, spoken directions.
let run = null, lastRun = null, tapStart = null, lastTap = null, lastMode = 'pointer';
let spokenDirection = null, directionAt = -Infinity, missionSpeechTimer = null;
// Literal keys, so the translation test can see that every one is used.
const DIRECTION_KEYS = {
  up: 'mission.dir.up', down: 'mission.dir.down', left: 'mission.dir.left', right: 'mission.dir.right',
  upLeft: 'mission.dir.upLeft', upRight: 'mission.dir.upRight', downLeft: 'mission.dir.downLeft', downRight: 'mission.dir.downRight',
  close: 'mission.dir.close', on: 'mission.onTarget',
};
const LEVEL_KEYS = { none: 'mission.level.none', hint: 'mission.level.hint', steps: 'mission.level.steps', missed: 'mission.level.missed' };

function applyPrefs() {
  engine.setOptions(prefs);
  $('voice-toggle').checked = prefs.voice;
  $('haptics-toggle').checked = prefs.haptics;
  $('volume').value = Math.round(prefs.volume * 100);
  $('sound-button').setAttribute('aria-pressed', String(prefs.sound));
  $('sound-button').setAttribute('aria-label', t(prefs.sound ? 'transport.mute' : 'transport.unmute'));
  $('sound-button').innerHTML = icon(prefs.sound ? 'volume' : 'mute');
  try { localStorage.setItem('tacto-preferences', JSON.stringify(prefs)); } catch {}
}
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
function announce(text) { clearTimeout(announcementTimer); announcementTimer = setTimeout(() => { $('announcements').textContent = text; }, 250); }
function updateCapabilities() {
  const caps = engine.capabilities;
  const available = Boolean(caps.hapticsAvailable ?? caps.haptics);
  $('haptics-toggle').disabled = !available;
  $('test-haptics').disabled = !available;
  $('haptics-status').textContent = t(!available ? 'haptics.unavailable'
    : hapticReport === 'felt' ? 'haptics.felt'
    : hapticReport === 'not-felt' ? 'haptics.notFelt'
    : caps.hapticsState === 'failed' ? 'haptics.rejected'
    : 'haptics.unconfirmed');
  if ($('voice-status')) {
    $('voice-status').textContent = caps.speechMessage;
    $('voice-status').dataset.state = caps.speechState;
  }
  if (!available && prefs.haptics) { prefs.haptics = false; applyPrefs(); }
}
async function ensureEnabled() {
  // A brief haptics-only test must never leave subsequent exploration muted.
  applyPrefs();
  if (enabling) return enabling;
  if (enabled && engine.capabilities.audio) return true;
  const activationGeneration = generation;
  enabling = (async () => {
    try {
      applyPrefs();
      const caps = await engine.enable();
      if (activationGeneration !== generation) { engine.stop(); return false; }
      enabled = true;
      $('start-label').textContent = t('transport.pause');
      $('start-button').firstElementChild.innerHTML = icon('pause');
      $('start-button').setAttribute('aria-pressed', 'true');
      $('surface-state').textContent = t('surface.active');
      updateCapabilities();
      if (!caps.audio) toast(t('toast.noAudio'));
      return true;
    } catch {
      toast(t('toast.audioFailed'));
      return false;
    } finally { enabling = null; }
  })();
  return enabling;
}
function stopFeedback({ speech = false, keepPriority = false, keepBeacon = false } = {}) {
  engine.stop({ speech, keepPriority, keepBeacon });
  document.body.classList.remove('is-sounding');
  $('surface').classList.remove('is-touching');
}
function stopTour() {
  if (tourFrame !== null) cancelAnimationFrame(tourFrame);
  tourFrame = null; touring = false;
  $('tour-button').setAttribute('aria-pressed', 'false');
  $('tour-button').innerHTML = `<span>${icon('route')}</span><span>${t('transport.tour')}</span>`;
  stopFeedback();
}
function pauseExperience() {
  generation++; pressed = false;
  clearTimeout(keyboardTimer); clearTimeout(previewTimer); clearTimeout(missionSpeechTimer);
  stopTour(); enabled = false;
  engine.stop();
  $('start-label').textContent = t('transport.start');
  $('start-button').firstElementChild.innerHTML = icon('play');
  $('start-button').setAttribute('aria-pressed', 'false');
  $('surface-state').textContent = t('surface.paused');
}
function updateProgress() {
  const count = discovered.get(scene.id).size;
  $('discovery-count').textContent = scene.regions.length ? `${count} / ${scene.regions.length}` : t('progress.free');
  const progress = scene.regions.length ? Math.round(count / scene.regions.length * 100) : 0;
  $('progress-fill').style.width = `${progress}%`;
  $('progress').setAttribute('aria-valuenow', String(progress));
  $('progress-caption').textContent = t(!scene.regions.length ? 'progress.scanner' : count === scene.regions.length ? 'progress.done' : 'progress.start');
  $('region-list').querySelectorAll('button').forEach(button => button.classList.toggle('discovered', discovered.get(scene.id).has(button.dataset.region)));
}
function paintCursor() {
  const matrix = $('scene-svg').getScreenCTM();
  if (!matrix) return;
  const coord = new DOMPoint(point.x * 1000, point.y * 640).matrixTransform(matrix);
  const rect = $('surface').getBoundingClientRect();
  $('cursor').style.left = `${coord.x - rect.left}px`;
  $('cursor').style.top = `${coord.y - rect.top}px`;
  $('coordinates').textContent = `X ${Math.round(point.x * 100).toString().padStart(2, '0')} · Y ${Math.round(point.y * 100).toString().padStart(2, '0')}`;
}
function paintRegion(sample) {
  const id = sample?.id ?? null;
  if (id === previousPaintedRegion) return;
  previousPaintedRegion = id;
  $('scene-svg').querySelectorAll('[data-region]').forEach(el => el.classList.toggle('region-active', el.dataset.region === id));
  $('region-list').querySelectorAll('button').forEach(el => { el.classList.toggle('active', el.dataset.region === id); el.setAttribute('aria-pressed', String(el.dataset.region === id)); });
  $('region-name').textContent = sample?.label || t('readout.betweenTitle');
  $('region-description').textContent = sample?.description || t('readout.betweenText');
  $('readout-mark').style.color = sample?.color || 'var(--mint)';
  if (sample) announce(sample.label);
}
function explore(x, y, mode = 'pointer') {
  point = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  const sample = scene.sample(point.x, point.y);
  lastSample = sample; lastMode = mode;
  $('cursor').hidden = false;
  $('surface').classList.add('has-explored');
  paintCursor(); paintRegion(sample);
  if (sample && enabled) {
    engine.update(sample);
    document.body.classList.toggle('is-sounding', prefs.sound);
    $('surface').classList.add('is-touching');
    if (!discovered.get(scene.id).has(sample.id) && scene.regions.some(r => r.id === sample.id)) { discovered.get(scene.id).add(sample.id); updateProgress(); }
  } else stopFeedback({ speech: true, keepPriority: true, keepBeacon: true });
  if (sample && activeRegion !== `${scene.id}:${sample.id}`) {
    activeRegion = `${scene.id}:${sample.id}`;
    if (session.events.length < 2500) session.events.push({ elapsedMs: Date.now() - Date.parse(session.startedAt), scene: scene.id, region: sample.id, mode });
  } else if (!sample) activeRegion = null;
  if (run && !run.done && mode !== 'guided-tour') {
    run.visit(sample?.id);
    if (run.help > 0 && enabled) guideFinger(sample);
  }
}

// ———————————————————————————— MISSIONS ————————————————————————————
// Short challenges answered by touch (missions.js). The answer gesture is a
// double tap, Enter, or the "Answer here" button. Help comes in two levels: a
// guiding sound, then spoken directions. Results stay in this session only.
function speakMission(parts, delay = 0) {
  clearTimeout(missionSpeechTimer);
  const say = () => engine.announce(parts, { priority: true });
  if (delay) missionSpeechTimer = setTimeout(say, delay); else say();
}
function guideFinger(sample) {
  const onTarget = run.isTarget(sample?.id);
  const guide = guidance(point, run.current, onTarget);
  if (!guide) return;
  engine.setBeacon(guide);
  if (run.help < 2) return;
  const now = performance.now();
  if (now - directionAt < (guide.direction === spokenDirection ? 2600 : 1300)) return;
  spokenDirection = guide.direction; directionAt = now;
  speakMission([t(DIRECTION_KEYS[guide.direction])]);
}
function missionLabel(result) { return scene.regions.find(region => region.id === result.target)?.label ?? result.target; }
function renderMissionCard() {
  const available = Boolean(scene.missions?.length);
  const live = Boolean(run && !run.done);
  const finished = !live && lastRun?.scene === scene.id ? lastRun : null;
  $('mission-card').classList.toggle('is-live', live);
  $('mission-label').textContent = t(live || finished ? 'mission.label' : 'mission.title');
  $('mission-step').textContent = live ? t('mission.step', { index: run.index + 1, total: run.total })
    : finished ? `${finished.summary.found} / ${finished.summary.total}` : '';
  $('scene-task').textContent = live ? run.current.prompt
    : finished ? `${t('mission.done')} ${t('mission.found', { count: finished.summary.found, total: finished.summary.total })}` : scene.task;
  $('mission-help').hidden = !(live && run.help > 0);
  if (live && run.help > 0) $('mission-help').textContent = t(run.help === 1 ? 'mission.hintOn' : 'mission.stepsOn');
  $('mission-live').hidden = !live;
  $('mission-idle').hidden = live;
  $('mission-start').hidden = !available;
  $('mission-start-label').textContent = t(finished ? 'mission.again' : 'mission.start');
  if (live) {
    $('mission-hint-label').textContent = t(run.help === 0 ? 'mission.hint' : 'mission.moreHelp');
    $('mission-hint').disabled = run.help >= 2;
  }
  // The guided tour would visit every region and give the answers away.
  $('tour-button').disabled = live;
  $('mission-privacy').hidden = !(live || finished);
  const list = $('mission-results');
  list.replaceChildren();
  list.hidden = !finished;
  for (const result of finished?.results ?? []) {
    const item = document.createElement('li'); item.className = result.correct ? 'found' : 'missed';
    const mark = document.createElement('span'); mark.className = 'mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = result.correct ? '✓' : '–';
    const name = document.createElement('span'); name.textContent = `${missionLabel(result)}: ${t(LEVEL_KEYS[result.level])}`;
    const time = document.createElement('small'); time.textContent = result.correct ? t('mission.seconds', { seconds: Math.max(1, Math.round(result.ms / 1000)) }) : '';
    item.append(mark, name, time); list.append(item);
  }
}
async function startMissions() {
  if (!scene.missions?.length) return;
  stopTour(); clearTimeout(previewTimer); clearTimeout(keyboardTimer);
  const token = generation;
  if (!await ensureEnabled() || token !== generation) return;
  run = new MissionRun(scene, performance.now());
  lastRun = null; lastTap = null; spokenDirection = null; directionAt = -Infinity;
  renderMissionCard();
  speakMission([t('mission.intro'), run.current.prompt]);
  announce(`${t('mission.intro')} ${t('mission.keys')} ${run.current.prompt}`);
  $('surface').focus({ preventScroll: true });
}
function finishMissions(lead = []) {
  const summary = run.summary();
  lastRun = { scene: scene.id, summary, results: [...run.results] };
  run = null; lastTap = null;
  engine.setBeacon(null);
  const found = t('mission.found', { count: summary.found, total: summary.total });
  speakMission([...lead, t('mission.done'), found], lead.length ? 350 : 0);
  announce([...lead, t('mission.done'), found].join(' '));
  renderMissionCard();
}
function answerMission(at, input) {
  if (!run || run.done) return;
  const sample = at ? scene.sample(at.x, at.y) : null;
  const outcome = run.answer(sample?.id ?? null, performance.now(), input);
  if (!outcome.correct) {
    engine.cue('wrong'); engine.pulse([60]);
    speakMission([t('mission.wrong')], 260);
    announce(t('mission.wrong'));
    return;
  }
  session.missions.push(outcome.result);
  engine.setBeacon(null); spokenDirection = null;
  engine.cue('success'); engine.pulse([40, 60, 40]);
  const praise = [t('mission.correct'), sample.label];
  if (outcome.done) { finishMissions(praise); return; }
  speakMission([...praise, run.current.prompt], 350);
  announce(`${praise.join(' ')}. ${run.current.prompt}`);
  renderMissionCard();
}
function hintMission() {
  if (!run || run.done) return;
  const level = run.hint();
  speakMission([t(level === 1 ? 'mission.hint1' : 'mission.hint2')]);
  announce(t(level === 1 ? 'mission.hintOn' : 'mission.stepsOn'));
  // Let the hint be heard before the first direction.
  spokenDirection = null; directionAt = performance.now() + 1500;
  renderMissionCard();
}
function repeatMission() {
  if (!run || run.done) return;
  speakMission([run.current.prompt]);
  announce(run.current.prompt);
}
function skipMission() {
  if (!run || run.done) return;
  const outcome = run.skip(performance.now());
  session.missions.push(outcome.result);
  engine.setBeacon(null); spokenDirection = null;
  if (outcome.done) { finishMissions(); return; }
  speakMission([run.current.prompt]);
  announce(run.current.prompt);
  renderMissionCard();
}
function stopMissions() {
  clearTimeout(missionSpeechTimer);
  if (run) engine.stop();
  run = null; lastRun = null; lastTap = null;
  renderMissionCard();
}
/** A double tap on the surface answers the current mission. */
function checkDoubleTap(event) {
  const start = tapStart; tapStart = null;
  if (!run || run.done || !start || start.pointerId !== event.pointerId) return;
  const end = { time: performance.now() };
  if (!isTap(start, end)) { lastTap = null; return; }
  const tap = { time: end.time, x: start.x, y: start.y };
  if (isDoubleTap(lastTap, tap)) { lastTap = null; answerMission(tap, 'touch'); }
  else lastTap = tap;
}
function eventPoint(event) {
  const matrix = $('scene-svg').getScreenCTM();
  if (!matrix) return null;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: p.x / 1000, y: p.y / 640 };
}
function renderScene(id, focus = false) {
  const next = scenes.find(s => s.id === id);
  if (!next) return;
  generation++; pressed = false; stopTour(); engine.stop();
  clearTimeout(keyboardTimer); clearTimeout(previewTimer); clearTimeout(announcementTimer); clearTimeout(missionSpeechTimer);
  scene = next; point = { x: .5, y: .5 }; lastSample = null; previousPaintedRegion = null; activeRegion = null;
  run = null; lastTap = null; tapStart = null;
  const index = scenes.indexOf(scene);
  $('scene-category').textContent = scene.category;
  $('scene-title').textContent = scene.title;
  $('signal-guide').textContent = scene.guide || t('guide.default');
  $('scene-svg').innerHTML = scene.svg;
  $('scene-counter').textContent = `${String(index + 1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}`;
  $('scene-total')?.replaceChildren();
  $('surface-caption').textContent = scene.subtitle || t('surface.caption');
  $('surface').setAttribute('aria-label', `${scene.title}. ${scene.description}`);
  $('surface').classList.remove('has-explored');
  $('surface-state').textContent = t(enabled ? 'surface.active' : 'surface.ready');
  $('cursor').hidden = true; $('coordinates').textContent = 'X — · Y —';
  $('region-name').textContent = t('readout.startTitle');
  $('region-description').textContent = t(enabled ? 'readout.readyText' : 'readout.startText');
  $('region-total').textContent = scene.regions.length ? plural('regions.count', scene.regions.length) : t('regions.scanner');
  $('region-list').replaceChildren();
  if (!scene.regions.length) { const hint = document.createElement('p'); hint.className = 'scanner-region-hint'; hint.textContent = t('regions.scannerHint'); $('region-list').append(hint); }
  for (const region of scene.regions) {
    const button = document.createElement('button'); button.className = 'region-chip'; button.dataset.region = region.id;
    button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', t('regions.explore', { label: region.label }));
    const dot = document.createElement('span'); dot.className = 'region-dot'; dot.style.setProperty('--region-color', region.color); dot.setAttribute('aria-hidden', 'true');
    button.append(dot, document.createTextNode(region.label));
    button.addEventListener('click', async () => {
      stopTour(); clearTimeout(previewTimer);
      const token = generation;
      if (!await ensureEnabled() || token !== generation) return;
      explore(region.point.x, region.point.y, 'region-button');
      previewTimer = setTimeout(stopFeedback, 1400);
    });
    $('region-list').append(button);
  }
  $('scene-nav').querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button.dataset.scene === id)));
  updateProgress(); renderMissionCard();
  if (focus) announce(t('announce.scene', { title: scene.title, task: scene.task }));
}
function addSceneButton(s, i) {
  const button = document.createElement('button'); button.className = 'scene-card'; button.dataset.scene = s.id;
  const name = document.createElement('strong'); name.textContent = s.shortTitle || s.title;
  const area = document.createElement('small'); area.textContent = s.category;
  button.innerHTML = `<span class="scene-icon">${icon(s.id)}</span><span class="scene-text"></span><span class="scene-number">0${i + 1}</span>`;
  button.querySelector('.scene-text').append(name, area);
  button.addEventListener('click', () => renderScene(s.id, true)); $('scene-nav').append(button);
}
for (const [i, s] of scenes.entries()) addSceneButton(s, i);

$('start-button').addEventListener('click', async () => {
  if (enabled) { pauseExperience(); announce(t('announce.paused')); }
  else if (await ensureEnabled()) { toast(t('toast.howTo')); $('surface').focus({ preventScroll: true }); }
});
$('surface').addEventListener('pointerdown', async event => {
  if (event.button !== 0) return;
  stopTour(); clearTimeout(keyboardTimer); clearTimeout(previewTimer);
  event.preventDefault(); pointerId = event.pointerId; pressed = true;
  $('surface').setPointerCapture(event.pointerId);
  const p = eventPoint(event); const token = generation;
  tapStart = p ? { time: performance.now(), x: p.x, y: p.y, moved: 0, pointerId: event.pointerId } : null;
  if (p) { point = p; paintCursor(); }
  if (await ensureEnabled() && pressed && pointerId === event.pointerId && token === generation && p) explore(p.x, p.y);
});
$('surface').addEventListener('pointermove', event => {
  if (!pressed || event.pointerId !== pointerId) return;
  const p = eventPoint(event);
  if (p && tapStart?.pointerId === event.pointerId) tapStart.moved = Math.max(tapStart.moved, diagramDistance(tapStart, p));
  if (p) explore(p.x, p.y);
});
function releasePointer(event) {
  if (event.pointerId !== pointerId) return;
  pressed = false; pointerId = null; stopFeedback();
  if (event.type === 'pointerup') checkDoubleTap(event);
}
$('surface').addEventListener('pointerup', releasePointer);
$('surface').addEventListener('pointercancel', releasePointer);
$('surface').addEventListener('lostpointercapture', () => { pressed = false; pointerId = null; stopFeedback(); });
$('surface').addEventListener('keydown', async event => {
  if (event.key === 'Escape') { pauseExperience(); return; }
  // In a mission, Enter answers with the region under the cursor; H asks for a hint; R repeats.
  if (run && !run.done && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'enter') { event.preventDefault(); if (await ensureEnabled()) answerMission(point, 'keyboard'); return; }
    if (key === 'h') { event.preventDefault(); hintMission(); return; }
    if (key === 'r') { event.preventDefault(); repeatMission(); return; }
  }
  if (event.key === 'Enter') { if (await ensureEnabled()) { if (lastSample) engine.announce(`${lastSample.label}. ${lastSample.description}`); else engine.announce(scene.description); } return; }
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!dirs[event.key]) return;
  event.preventDefault(); stopTour(); clearTimeout(keyboardTimer); clearTimeout(previewTimer);
  const token = generation;
  if (!await ensureEnabled() || token !== generation) return;
  const d = dirs[event.key], step = event.shiftKey ? .06 : .018;
  explore(point.x + d[0] * step, point.y + d[1] * step, 'keyboard');
  keyboardTimer = setTimeout(stopFeedback, 650);
});
$('surface').addEventListener('blur', () => { if (!pressed && !touring) stopFeedback(); });

$('tour-button').addEventListener('click', async () => {
  if (touring) { stopTour(); return; }
  const token = generation;
  clearTimeout(keyboardTimer); clearTimeout(previewTimer);
  if (!await ensureEnabled() || token !== generation) return;
  const route = scene.tour?.length ? scene.tour : scene.regions.map(r => ({ ...r.point, duration: 1900 }));
  if (!route.length) return;
  touring = true;
  $('tour-button').setAttribute('aria-pressed', 'true');
  $('tour-button').innerHTML = `<span>${icon('pause')}</span><span>${t('transport.stopTour')}</span>`;
  announce(t('announce.tourStarted'));
  let index = 0, from = { x: route[0].x, y: route[0].y }, segmentStart = performance.now();
  function frame(now) {
    if (!touring || token !== generation) return;
    const target = route[index], duration = target.duration || 1800;
    const elapsed = now - segmentStart, t = Math.min(1, elapsed / Math.max(200, duration * .55));
    const eased = t * t * (3 - 2 * t);
    explore(from.x + (target.x - from.x) * eased, from.y + (target.y - from.y) * eased, 'guided-tour');
    if (elapsed >= duration) {
      from = { x: target.x, y: target.y }; index++; segmentStart = now;
      if (index >= route.length) { stopTour(); announce(t('announce.tourDone')); return; }
    }
    tourFrame = requestAnimationFrame(frame);
  }
  tourFrame = requestAnimationFrame(frame);
});
$('sound-button').addEventListener('click', () => { prefs.sound = !prefs.sound; applyPrefs(); if (!prefs.sound) document.body.classList.remove('is-sounding'); });
$('volume').addEventListener('input', event => { prefs.volume = Number(event.target.value) / 100; applyPrefs(); $('volume-value').textContent = `${event.target.value}%`; });
$('haptics-toggle').addEventListener('change', event => { prefs.haptics = event.target.checked; applyPrefs(); if (prefs.haptics) toast(t('toast.hapticsOn')); });
$('voice-toggle').addEventListener('change', async event => {
  prefs.voice = event.target.checked; applyPrefs();
  if (prefs.voice) { stopTour(); clearTimeout(previewTimer); clearTimeout(keyboardTimer); if (await ensureEnabled()) engine.announce(t('voice.test')); }
});
$('test-voice').addEventListener('click', async () => {
  stopTour(); clearTimeout(previewTimer); clearTimeout(keyboardTimer); engine.stop();
  if (prefs.volume === 0) { prefs.volume = .25; applyPrefs(); }
  if (await ensureEnabled()) engine.announce(t('voice.test'));
});
$('test-haptics').addEventListener('click', async () => {
  stopTour(); clearTimeout(previewTimer);
  if (!await ensureEnabled()) return;
  prefs.haptics = true; applyPrefs();
  const sample = scene.regions[0];
  engine.setOptions({ ...prefs, sound: false, voice: false });
  engine.update({ ...sample, id: `test-${Date.now()}`, gain: 0, pan: 0, pattern: [60, 60, 60] });
  $('haptics-confirm').hidden = false;
  updateCapabilities();
  previewTimer = setTimeout(() => { engine.stop(); applyPrefs(); updateCapabilities(); }, 300);
  toast(t('toast.hapticsTest'));
});
$('haptics-yes').addEventListener('click', () => { hapticReport = 'felt'; $('haptics-confirm').hidden = true; updateCapabilities(); });
$('haptics-no').addEventListener('click', () => { hapticReport = 'not-felt'; prefs.haptics = false; applyPrefs(); $('haptics-confirm').hidden = true; updateCapabilities(); toast(t('toast.hapticsOff')); });
$('read-region').addEventListener('click', async () => {
  stopTour(); clearTimeout(previewTimer); clearTimeout(keyboardTimer); applyPrefs();
  if (await ensureEnabled()) engine.announce(lastSample ? `${lastSample.label}. ${lastSample.description}` : scene.description);
});
$('hide-image').addEventListener('click', () => {
  const hidden = $('surface').classList.toggle('image-hidden');
  $('hide-image').setAttribute('aria-pressed', String(hidden));
  $('hide-image').setAttribute('aria-label', t(hidden ? 'view.show' : 'view.hide'));
  $('hide-image').innerHTML = icon(hidden ? 'eyeOff' : 'eye');
  announce(t(hidden ? 'announce.imageHidden' : 'announce.imageShown'));
});
$('fullscreen').addEventListener('click', async () => {
  const lab = document.querySelector('.laboratory');
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (lab.requestFullscreen) await lab.requestFullscreen();
    else lab.classList.toggle('expanded');
  } catch { lab.classList.toggle('expanded'); }
  requestAnimationFrame(paintCursor);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { pauseExperience(); document.querySelector('.laboratory').classList.remove('expanded'); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseExperience(); });
// Keep the engine reusable when the browser restores this document from bfcache.
window.addEventListener('pagehide', pauseExperience);
window.addEventListener('resize', () => { if (!$('cursor').hidden) paintCursor(); });

$('help-button').addEventListener('click', () => { pauseExperience(); $('help-dialog').showModal(); });
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('begin-help').addEventListener('click', async () => { $('help-dialog').close(); if (await ensureEnabled()) $('surface').focus({ preventScroll: true }); });
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const rect = $('help-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('help-dialog').close(); } });
$('reset-session').addEventListener('click', () => { discovered.get(scene.id).clear(); session = newSession(); lastRun = null; renderScene(scene.id); announce(t('announce.reset')); });
$('mission-start').addEventListener('click', startMissions);
$('mission-answer').addEventListener('click', async () => {
  if (!await ensureEnabled()) return;
  const input = { keyboard: 'keyboard', 'region-button': 'button' }[lastMode] ?? 'touch';
  answerMission($('cursor').hidden ? null : point, input);
});
$('mission-hint').addEventListener('click', hintMission);
$('mission-repeat').addEventListener('click', repeatMission);
$('mission-skip').addEventListener('click', skipMission);
$('mission-stop').addEventListener('click', stopMissions);
$('export-session').addEventListener('click', () => {
  const data = { ...session, exportedAt: new Date().toISOString(), language: getLanguage(), note: t('session.logNote'), discovered: Object.fromEntries([...discovered].map(([id, regions]) => [id, [...regions]])), options: prefs };
  const name = `${t('session.fileName')}-${new Date().toISOString().slice(0, 10)}.json`;
  const contents = JSON.stringify(data, null, 2);
  const native = globalThis.window?.TactoNative ?? globalThis.TactoNative;
  const nativeSave = typeof native?.saveFile === 'function' && native.saveFile(name, 'application/json', contents) === true;
  if (!nativeSave) {
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  toast(t(nativeSave ? 'session.saveNative' : 'session.saved'));
});

engine.onStatusChange = updateCapabilities;
applyPrefs(); renderScene(scene.id); updateCapabilities();
const studio = initStudio({ onOpen: pauseExperience, notify: toast, onPublish(next, { activate = true } = {}) {
  const index = scenes.findIndex(s => s.id === next.id);
  if (index >= 0) scenes[index] = next;
  else { scenes.push(next); addSceneButton(next, scenes.length - 1); }
  discovered.set(next.id, new Set());
  $('nav-total').textContent = `01—${String(scenes.length).padStart(2,'0')}`;
  $('scene-nav').classList.toggle('has-custom', scenes.some(s => s.id === 'custom'));
  if (activate || scene.id === next.id) { renderScene(next.id, true); requestAnimationFrame(() => $('surface').focus({ preventScroll: false })); }
  else $('scene-counter').textContent = `${String(scenes.findIndex(s => s.id === scene.id)+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}`;
} });
$('open-studio').addEventListener('click', () => studio.open());
$('sidebar-studio').addEventListener('click', () => studio.open());
// lang-boot.js hides an English page until this point, so Spanish never flashes.
document.documentElement.classList.remove('i18n-pending');
// The offline worker belongs to the installable site, the page that declares the web manifest;
// the Android app and the single-page copy have neither.
if (document.querySelector('link[rel="manifest"]') && !window.TactoNative && 'serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) navigator.serviceWorker.register('./sw.js').catch(() => {});
