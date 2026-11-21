/**
 * Screenshots of the local TACTO demo for the deck, the video or the docs,
 * through the DevTools protocol of Edge or Chrome (no Playwright needed).
 * Start the demo first (node server.mjs), then:
 *   node scripts/capture-screens.mjs [outDir] [en|es]
 * Default outDir: artifacts/screens (ignored by Git). Default language: en.
 * Saves cell, islands, economy, missions, mission-card and studio (desktop, 2x)
 * and phone (390 px, 3x).
 */
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'artifacts/screens');
const language = process.argv[3] === 'es' ? 'es' : 'en';
const base = `http://localhost:4317/?lang=${language}`;
const port = 9333;
const studioRegions = {
  en: [
    ['Circle', 'A green circle on the left, the largest of the three shapes.', 'ellipse', 13, 32, 21, 33],
    ['Square', 'A purple square in the middle, between the circle and the ellipse.', 'rect', 44, 32, 19, 33],
    ['Ellipse', 'A tall orange ellipse on the right.', 'ellipse', 72, 27, 19, 43],
  ],
  es: [
    ['Círculo', 'Un círculo verde a la izquierda, la mayor de las tres figuras.', 'ellipse', 13, 32, 21, 33],
    ['Cuadrado', 'Un cuadrado morado en el centro, entre el círculo y la elipse.', 'rect', 44, 32, 19, 33],
    ['Elipse', 'Una elipse naranja y alta a la derecha.', 'ellipse', 72, 27, 19, 43],
  ],
}[language];

let browserPath = null;
for (const candidate of [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]) {
  try { await access(candidate); browserPath = candidate; break; } catch { /* try the next one */ }
}
if (!browserPath) throw new Error('No se encontró Edge ni Chrome.');
const reply = await fetch(base).catch(() => null);
if (!reply?.ok) throw new Error(`La demo no responde en ${base}. Arranca antes node server.mjs.`);
await mkdir(outDir, { recursive: true });
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'tacto-capture-'));

const browser = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
  '--mute-audio', `--lang=${language === 'es' ? 'es-ES' : 'en-US'}`, 'about:blank',
], { stdio: 'ignore' });

async function devtools(pathname, method = 'GET') {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
      if (response.ok) return response.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('El navegador no abrió su puerto de DevTools.');
}

let ws;
try {
  await devtools('/json/version');
  const target = await devtools('/json/new?about:blank', 'PUT');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const nextEvent = method => new Promise(resolve => {
    const listener = message => { if (message.method === method) { listeners.delete(listener); resolve(message.params); } };
    listeners.add(listener);
  });
  // userGesture lets the page start its audio as if the button had been pressed.
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, userGesture: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const open = async metrics => {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    await send('Emulation.setTouchEmulationEnabled', { enabled: Boolean(metrics.mobile), maxTouchPoints: metrics.mobile ? 5 : 1 });
    const loaded = nextEvent('Page.loadEventFired');
    await send('Page.navigate', { url: base });
    await loaded;
    await evaluate('document.fonts.ready.then(() => true)');
    await sleep(600);
  };
  const rectOf = selector => evaluate(`(() => { window.scrollTo(0, 0); const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const capture = async (name, clip) => {
    const params = { format: 'jpeg', quality: 90 };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await send('Page.captureScreenshot', params);
    await writeFile(path.join(outDir, name), Buffer.from(data, 'base64'));
    console.log(`${name} guardada`);
  };
  const pick = async region => {
    await evaluate(`document.querySelector('.region-chip[data-region="${region}"]').click()`);
    await sleep(700);
    await evaluate(`document.getElementById('toast').hidden = true; window.scrollTo(0, 0); true`);
  };
  const start = async () => { await evaluate(`document.getElementById('start-button').click(); true`); await sleep(800); };

  await send('Page.enable');
  await send('Runtime.enable');

  // The three lessons, each with one region selected.
  await open({ width: 1440, height: 1320, deviceScaleFactor: 2, mobile: false });
  await start();
  await pick('nucleus');
  await capture('cell.jpg', await rectOf('.laboratory'));
  for (const [scene, region] of [['islands', 'teide'], ['economy', 'equilibrium']]) {
    await evaluate(`document.querySelector('[data-scene="${scene}"]').click(); true`);
    await sleep(500);
    await pick(region);
    await capture(`${scene}.jpg`, await rectOf('.laboratory'));
  }

  // Missions, in the Canary Islands lesson: mission 1 answered with a real double
  // click on Tenerife, then mission 2 with the hint on and the finger held inside
  // Tenerife, short of Mount Teide. Saves the lesson and the mission card.
  await open({ width: 1440, height: 1320, deviceScaleFactor: 2, mobile: false });
  await evaluate(`document.querySelector('[data-scene="islands"]').click(); true`);
  await sleep(500);
  await evaluate(`document.getElementById('mission-start').click(); true`);
  await sleep(900);
  const svgPoint = (x, y) => evaluate(`(() => { window.scrollTo(0, 0); const p = new DOMPoint(${x}, ${y}).matrixTransform(document.getElementById('scene-svg').getScreenCTM()); return { x: p.x, y: p.y }; })()`);
  const mouse = (type, { x, y }, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount });
  const tenerife = await svgPoint(378, 320);
  for (const clickCount of [1, 2]) {
    await mouse('mousePressed', tenerife, clickCount);
    await mouse('mouseReleased', tenerife, clickCount);
    await sleep(120);
  }
  await sleep(900);
  const mission = await evaluate(`document.getElementById('mission-step').textContent`);
  if (!/2/.test(mission)) throw new Error(`La primera misión no se respondió: ${mission}`);
  await evaluate(`document.getElementById('mission-hint').click(); true`);
  await sleep(400);
  // Inside Tenerife but outside Mount Teide: the student is still searching.
  const searching = await svgPoint(380, 322);
  await mouse('mousePressed', searching);
  await sleep(600);
  // No focus ring around the diagram, and no toast, in the picture.
  await evaluate(`document.getElementById('toast').hidden = true; document.activeElement?.blur(); true`);
  await capture(`missions${language === 'es' ? '-es' : ''}.jpg`, await rectOf('.laboratory'));
  // The card alone, without the border of the card beside it.
  const card = await evaluate(`(() => { const r = document.getElementById('mission-card').getBoundingClientRect(); return { x: Math.round(r.left - 24), y: Math.round(r.top + scrollY - 24), width: Math.round(r.width + 18), height: Math.round(r.height + 48) }; })()`);
  const { data: cardImage } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, captureBeyondViewport: true, clip: { ...card, scale: 1 } });
  await writeFile(path.join(outDir, `mission-card${language === 'es' ? '-es' : ''}.jpg`), Buffer.from(cardImage, 'base64'));
  console.log('Misiones guardadas');
  await mouse('mouseReleased', searching);

  // Phone, before Studio: Studio saves a draft that would add a fourth lesson.
  await open({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await start();
  await evaluate(`document.querySelector('.region-chip[data-region="nucleus"]').click(); true`);
  await sleep(700);
  await evaluate(`(() => { document.getElementById('toast').hidden = true; window.scrollTo(0, document.querySelector('.experience-heading').getBoundingClientRect().top + window.scrollY - 12); return true; })()`);
  await sleep(400);
  await capture('phone.jpg');
  // The other two lessons and a mission on the phone, for the stage deck's product pictures.
  const frame = `(() => { document.getElementById('toast').hidden = true; document.activeElement?.blur(); window.scrollTo(0, document.querySelector('.experience-heading').getBoundingClientRect().top + window.scrollY - 12); return true; })()`;
  for (const [scene, region] of [['islands', 'teide'], ['economy', 'equilibrium']]) {
    await evaluate(`document.querySelector('[data-scene="${scene}"]').click(); true`);
    await sleep(500);
    await evaluate(`document.querySelector('.region-chip[data-region="${region}"]').click(); true`);
    await sleep(700);
    await evaluate(frame);
    await sleep(400);
    await capture(`phone-${scene}.jpg`);
  }
  await evaluate(`document.querySelector('[data-scene="islands"]').click(); true`);
  await sleep(500);
  await evaluate(`document.getElementById('mission-start').click(); true`);
  await sleep(1200);
  await evaluate(frame);
  await sleep(400);
  await capture('phone-mission.jpg');
  await evaluate(`document.getElementById('mission-stop')?.click(); true`);

  // Studio with the built-in example and three named regions.
  await open({ width: 1440, height: 1320, deviceScaleFactor: 2, mobile: false });
  await evaluate(`document.getElementById('open-studio').click(); true`);
  await sleep(400);
  await evaluate(`document.getElementById('studio-example').click(); true`);
  await sleep(2000);
  await evaluate(`(() => {
    const dialog = document.getElementById('studio-dialog');
    const field = (id, value, type = 'input') => { const element = dialog.querySelector('#' + id); element.value = value; element.dispatchEvent(new Event(type, { bubbles: true })); };
    for (const [name, description, shape, x, y, width, height] of ${JSON.stringify(studioRegions)}) {
      dialog.querySelector('#studio-add').click();
      field('studio-region-label', name);
      field('studio-region-description', description);
      field('studio-shape', shape);
      for (const [key, value] of [['x', x], ['y', y], ['width', width], ['height', height]]) field('studio-' + key, value, 'change');
    }
    return true;
  })()`);
  await sleep(500);
  await capture('studio.jpg', await rectOf('#studio-dialog'));
} finally {
  try { ws?.close(); } catch { /* closing */ }
  browser.kill();
  await sleep(800);
  // The temporary browser profile also holds the Studio draft: remove it.
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
console.log(`Capturas en ${outDir}`);
