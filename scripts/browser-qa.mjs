import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Set PLAYWRIGHT_MODULE to an installed Playwright entrypoint if not installed locally.
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : await import('playwright');
const base = process.env.TACTO_URL || 'http://localhost:4317';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'es-ES' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const OriginalContext = window.AudioContext;
  window.__audioContexts = [];
  window.AudioContext = class extends OriginalContext {
    constructor(options) {
      super(options);
      window.__audioContexts.push(this);
      const originalConnect = AudioNode.prototype.connect;
      if (!window.__tactoAudioProbe) {
        window.__tactoAudioProbe = true;
        AudioNode.prototype.connect = function(destination, ...args) {
          if (destination === this.context.destination) {
            const probe = this.context.createAnalyser();
            probe.fftSize = 2048;
            this.context.__probe = probe;
            originalConnect.call(this, probe);
            return originalConnect.call(probe, destination, ...args);
          }
          return originalConnect.call(this, destination, ...args);
        };
      }
    }
  };
});
const rms = () => page.evaluate(() => {
  const context = window.__audioContexts[0];
  const probe = context?.__probe;
  if (!probe) return 0;
  const data = new Float32Array(probe.fftSize);
  probe.getFloatTimeDomainData(data);
  return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.scene-card').count(), 3);
  assert.equal(await page.locator('.region-chip').count(), 8);
  assert.equal(await page.evaluate(() => window.__audioContexts.length), 0, 'No audio context before a gesture');
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'Activar experiencia', exact: true }).click();
  assert.equal(await page.locator('#start-label').innerText(), 'Pausar experiencia');
  assert.equal(await page.evaluate(() => window.__audioContexts[0]?.state), 'running');
  const rect = await page.locator('#scene-svg').boundingBox();
  await page.mouse.move(rect.x + rect.width * .445, rect.y + rect.height * .452);
  await page.mouse.down();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#region-name').innerText(), 'Núcleo');
  const activeRms = await rms();
  assert.ok(activeRms > .00001, `Audio should contain a synthesized signal (${activeRms})`);
  await page.mouse.up();
  await page.waitForTimeout(350);
  const releaseRms = await rms();
  assert.ok(releaseRms < activeRms * .03, 'Releasing the pointer must fade to silence');

  await page.getByRole('button', { name: 'Explorar Mitocondrias', exact: true }).click();
  assert.equal(await page.locator('#region-name').innerText(), 'Mitocondrias');
  assert.equal(await page.locator('#discovery-count').innerText(), '2 / 8');
  await page.getByRole('button', { name: 'Probar vibración', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar Núcleo', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(await rms() > .00001, 'A quick region selection after a haptics test must restore audio');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.getByRole('button', { name: 'Explorar Núcleo', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(await rms() > .00001, 'Exploration must work after a bfcache pagehide');
  await page.locator('#surface').focus();
  await page.keyboard.press('ArrowLeft');
  assert.match(await page.locator('#coordinates').innerText(), /X \d+/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#start-label').innerText(), 'Activar experiencia');

  await page.locator('[data-scene="islands"]').click();
  assert.equal(await page.locator('.region-chip').count(), 9);
  await page.getByRole('button', { name: 'Explorar Teide', exact: true }).click();
  assert.equal(await page.locator('#region-name').innerText(), 'Teide');
  await page.screenshot({ path: 'artifacts/islands.png', fullPage: true });

  await page.locator('[data-scene="economy"]').click();
  assert.equal(await page.locator('.region-chip').count(), 5);
  await page.getByRole('button', { name: /Explorar .*equilibrio/i }).click();
  assert.match(await page.locator('#region-name').innerText(), /equilibrio/i);
  await page.getByRole('button', { name: 'Ocultar imagen', exact: true }).click();
  assert.equal(await page.locator('#surface').evaluate(el => el.classList.contains('image-hidden')), true);
  await page.getByRole('button', { name: 'Mostrar imagen', exact: true }).click();
  await page.getByRole('button', { name: 'Recorrido guiado', exact: true }).click();
  assert.equal(await page.locator('#tour-button').getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Detener recorrido', exact: true }).click();
  assert.equal(await page.locator('#tour-button').getAttribute('aria-pressed'), 'false');
  await page.screenshot({ path: 'artifacts/economy.png', fullPage: true });

  await page.getByRole('button', { name: 'Cómo explorar', exact: true }).click();
  assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), false);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar recorrido', exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^tacto-recorrido-/);
  await download.saveAs('artifacts/recorrido.json');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'es-ES' });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile must not overflow horizontally');
  await mobile.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
  await mobile.getByRole('button', { name: 'Explorar Núcleo', exact: true }).tap();
  assert.equal(await mobile.locator('#region-name').innerText(), 'Núcleo');
  assert.equal(await mobile.locator('#discovery-count').innerText(), '1 / 8');
  await mobile.getByRole('button', { name: 'Pausar experiencia', exact: true }).tap();
  await mobile.close();
  assert.deepEqual(errors, [], 'No uncaught errors');
  const report = { status: 'passed', browser: 'Chromium / Edge headless', activeRms, releaseRms, checks: ['No audio before gesture', 'Real audio signal', 'Silence on release', 'Semantic hit testing', 'Audio restored after haptics test', 'Reusable after bfcache pagehide', 'Keyboard exploration', 'Scene switching', 'Hide image', 'Guided tour start/stop', 'Dialog', 'Local JSON export', 'Mobile layout and touch buttons'], limits: ['No physical haptic motor tested', 'No TalkBack or VoiceOver user test', 'No user comprehension study'] };
  await writeFile('artifacts/qa-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
