import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { NARRATION_ASSETS } from '../dist/narration.js';
const modules = ['app', 'i18n', 'lang-boot', 'feedback', 'scenes', 'missions', 'studio', 'custom-scene', 'image-analysis', 'narration', 'sw'];
for (const name of modules) {
  const result = spawnSync(process.execPath, ['--check', `dist/${name}.js`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const asset of ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest']) await access(`dist/${asset}`);
// The recorded narrations are generated on Windows (scripts/prepare-narration.mjs)
// and are not in the public repository; without them the app uses the system's voices.
const recordings = await access('dist/audio').then(() => true, () => false);
if (recordings) for (const asset of NARRATION_ASSETS) {
  const audio = await readFile(`dist/${asset}`);
  if (audio.toString('ascii',0,4) !== 'RIFF' || audio.toString('ascii',8,12) !== 'WAVE' || audio.length <= 44) throw new Error(`Narración no válida: ${asset}`);
}
const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
if (!manifest.name || !manifest.start_url || !manifest.icons?.length) throw new Error('Manifest incompleto');
console.log(recordings ? 'Módulos y recursos del piloto verificados.' : 'Módulos verificados. Sin narraciones grabadas en dist/audio: la app usará las voces del sistema.');
