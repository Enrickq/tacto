import { createCustomScene, validateProject, makeBlankProject } from './custom-scene.js';
import { analyzeImageData, sampleImageAnalysis, suggestRegions } from './image-analysis.js';
import { t, plural } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const STORE = 'tacto-studio-draft-v1';
const colors = ['#8de4bd', '#c4a5f5', '#f5b67c', '#8fd9e5', '#f1a5cd', '#dfdf9e'];
const patterns = { pulse: [30, 55, 30], border: [12], slow: [55, 100, 15] };
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const fit = image => { const scale = Math.min(1000 / image.width, 640 / image.height); const w = image.width * scale, h = image.height * scale; return { x: (1000 - w) / 2, y: (640 - h) / 2, w, h }; };

function download(data, filename) {
  const contents = JSON.stringify(data, null, 2);
  const native = globalThis.window?.TactoNative ?? globalThis.TactoNative;
  if (typeof native?.saveFile === 'function') return native.saveFile(filename, 'application/json', contents) === true;
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return false;
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(t('studio.imageUnreadable'))); image.src = src; });
}
async function prepareImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('studio.imageType'));
  if (file.size > 8 * 1024 * 1024) throw new Error(t('studio.imageTooHeavy'));
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error(t('studio.imageTooBig'));
    const scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', .9), width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
async function analyze(image) {
  const bitmap = await loadImage(image.dataUrl);
  if (bitmap.naturalWidth !== image.width || bitmap.naturalHeight !== image.height) throw new Error(t('studio.imageMismatch'));
  const scale = Math.min(1, 640 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(2, Math.round(image.width * scale)); canvas.height = Math.max(2, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return analyzeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

export async function buildStudioScene(raw) {
  const project = validateProject(raw);
  const scene = createCustomScene(project);
  if (!project.scanEnabled) return scene;
  const analysis = await analyze(project.image), frame = fit(project.image), regionSample = scene.sample;
  scene.sample = (x, y) => {
    const region = regionSample(x, y);
    if (region) return region;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    const ix = (x * 1000 - frame.x) / frame.w, iy = (y * 640 - frame.y) / frame.h;
    const sample = sampleImageAnalysis(analysis, ix, iy);
    return sample ? { ...sample, id: `scan-${sample.id}`, pan: 2 * x - 1 } : null;
  };
  scene.subtitle = t(project.regions.length ? 'studio.subtitleRegions' : 'studio.subtitleScanner');
  scene.description += ` ${t('studio.scannerNote')}`;
  if (!scene.tour.length) scene.tour = [[.15,.3],[.5,.3],[.85,.3],[.85,.65],[.5,.65],[.15,.65]].map(([x,y]) => ({ x: (frame.x + frame.w * x) / 1000, y: (frame.y + frame.h * y) / 640, duration: 1700 }));
  return scene;
}

export function initStudio({ onPublish, onOpen = () => {}, notify = () => {} }) {
  const dialog = document.createElement('dialog'); dialog.id = 'studio-dialog'; dialog.setAttribute('aria-labelledby', 'studio-title');
  // Every string below comes from i18n.js; none of it is user content.
  dialog.innerHTML = `
    <div class="studio-heading"><div><p class="eyebrow">${t('studio.eyebrow')}</p><h2 id="studio-title">${t('studio.title')}</h2><p>${t('studio.intro')}</p></div><button type="button" class="icon-button" id="studio-close" aria-label="${t('studio.close')}">✕</button></div>
    <div class="studio-toolbar"><label class="studio-upload"><span aria-hidden="true">＋</span> ${t('studio.upload')}<input id="studio-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="secondary-button" id="studio-example">${t('studio.useExample')}</button><button type="button" class="text-button" id="studio-import-button">${t('studio.openFile')}</button><input id="studio-import" type="file" accept=".json,application/json" hidden><span id="studio-save-status" role="status">${t('studio.statusStart')}</span></div>
    <div class="studio-grid">
      <div class="studio-workspace"><div class="studio-canvas-top"><span>${t('studio.canvasTitle')}</span><span id="studio-canvas-hint">${t('studio.canvasHint')}</span></div>
        <div class="studio-canvas-wrap"><svg id="studio-canvas" viewBox="0 0 1000 640" role="img" aria-label="${t('studio.canvasAria')}"></svg><div class="studio-empty" id="studio-empty"><span aria-hidden="true">⌁</span><h3>${t('studio.emptyTitle')}</h3><p>${t('studio.emptyText')}</p><button type="button" class="text-button" id="studio-empty-example">${t('studio.emptyExample')}</button></div></div>
        <div class="studio-tools"><button type="button" class="secondary-button" id="studio-add">${t('studio.addRegion')}</button><button type="button" class="secondary-button" id="studio-suggest">${t('studio.suggest')}</button><button type="button" class="text-button" id="studio-undo">${t('studio.undo')}</button></div>
        <p class="studio-method" id="studio-method">${t('studio.method')}</p>
        <div class="studio-region-list" id="studio-regions" aria-label="${t('studio.regionsAria')}"></div>
      </div>
      <aside class="studio-inspector" aria-label="${t('studio.inspectorAria')}">
        <label class="studio-field">${t('studio.projectTitle')}<input id="studio-project-title" maxlength="100" placeholder="${t('studio.projectTitlePlaceholder')}"></label>
        <label class="studio-field">${t('studio.projectDescription')}<textarea id="studio-project-description" maxlength="600" rows="2" placeholder="${t('studio.projectDescriptionPlaceholder')}"></textarea></label>
        <label class="studio-scan"><input type="checkbox" id="studio-scan" checked><span><strong>${t('studio.scanTitle')}</strong><small>${t('studio.scanHint')}</small></span></label>
        <div class="studio-divider"></div><div class="section-label"><span>${t('studio.regionSection')}</span><span id="studio-region-count">0 / 16</span></div>
        <p class="studio-select-hint" id="studio-select-hint">${t('studio.selectHint')}</p>
        <fieldset id="studio-region-fields" disabled><legend class="sr-only">${t('studio.regionLegend')}</legend>
          <label class="studio-field">${t('studio.regionName')}<input id="studio-region-label" maxlength="100" placeholder="${t('studio.regionNamePlaceholder')}"></label>
          <label class="studio-field">${t('studio.regionDescription')}<textarea id="studio-region-description" rows="2" maxlength="600" placeholder="${t('studio.regionDescriptionPlaceholder')}"></textarea></label>
          <div class="studio-field-pair"><label class="studio-field">${t('studio.shape')}<select id="studio-shape"><option value="rect">${t('studio.shapeRect')}</option><option value="ellipse">${t('studio.shapeEllipse')}</option></select></label><label class="studio-field">${t('studio.timbre')}<select id="studio-waveform"><option value="sine">${t('studio.timbreSoft')}</option><option value="triangle">${t('studio.timbreBright')}</option></select></label></div>
          <label class="studio-field">${t('studio.pattern')}<select id="studio-pattern"><option value="pulse">${t('studio.patternPulse')}</option><option value="border">${t('studio.patternBorder')}</option><option value="slow">${t('studio.patternSlow')}</option></select></label>
          <label class="studio-field studio-frequency">${t('studio.frequency')} <output id="studio-frequency-value">320 Hz</output><input id="studio-frequency" type="range" min="70" max="1100" value="320"></label>
          <details class="studio-position"><summary>${t('studio.position')}</summary><div class="studio-geometry"><label>X %<input id="studio-x" type="number" min="0" max="99" step="1"></label><label>Y %<input id="studio-y" type="number" min="0" max="99" step="1"></label><label>${t('studio.width')}<input id="studio-width" type="number" min="1" max="100" step="1"></label><label>${t('studio.height')}<input id="studio-height" type="number" min="1" max="100" step="1"></label></div></details>
          <button type="button" class="text-button studio-delete" id="studio-delete">${t('studio.delete')}</button>
        </fieldset>
      </aside>
    </div>
    <div class="studio-footer"><div><strong id="studio-ready">${t('studio.readyInitial')}</strong><p>${t('studio.footerNote')}</p></div><button type="button" class="secondary-button" id="studio-export">${t('studio.save')}</button><button type="button" class="primary-button" id="studio-publish">${t('studio.publish')}</button></div>
    <p class="studio-error" id="studio-error" role="alert" hidden></p>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  let project = null, selected = null, history = [], analysis = null, pendingDraw = null, saveTimer = null, revision = 0, busy = false;
  const canvas = el('studio-canvas');
  const selectedRegion = () => project?.regions.find(r => r.id === selected);
  const showError = message => { el('studio-error').textContent = message; el('studio-error').hidden = !message; };
  function checkpoint() { if (project) { history.push({ ...project, regions: project.regions.map(r => ({ ...r, pattern: [...r.pattern] })) }); if (history.length > 16) history.shift(); } }
  function flushDraft() {
    clearTimeout(saveTimer);
    if (!project) return;
    try { localStorage.setItem(STORE, JSON.stringify(project)); el('studio-save-status').textContent = t('studio.draftSaved'); }
    catch { el('studio-save-status').textContent = t('studio.draftNotSaved'); }
  }
  function persist() {
    if (!project) return;
    clearTimeout(saveTimer); el('studio-save-status').textContent = t('studio.draftSaving');
    saveTimer = setTimeout(flushDraft, 300);
  }
  function setBusy(value) { busy = value; for (const id of ['studio-publish','studio-suggest','studio-file','studio-import','studio-example','studio-add','studio-export']) el(id).disabled = value || (!project && ['studio-publish','studio-suggest','studio-add','studio-export'].includes(id)); el('studio-publish').textContent = t(value ? 'studio.publishing' : 'studio.publish'); }
  function draw() {
    if (!project) { canvas.replaceChildren(); el('studio-empty').hidden = false; return; }
    el('studio-empty').hidden = true;
    canvas.innerHTML = createCustomScene(project).svg;
    canvas.querySelectorAll('[data-region]').forEach(shape => {
      if (shape.dataset.region === selected) shape.classList.add('studio-selected');
    });
    const list = el('studio-regions'); list.replaceChildren();
    project.regions.forEach((region, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-region-button'; button.setAttribute('aria-pressed', String(region.id === selected));
      const dot = document.createElement('i'); dot.style.background = region.color; dot.setAttribute('aria-hidden', 'true');
      button.append(dot, document.createTextNode(`${i + 1}. ${region.label}`)); button.addEventListener('click', () => { selected = region.id; draw(); fillRegion(); }); list.append(button);
    });
    el('studio-region-count').textContent = `${project.regions.length} / 16`;
    el('studio-ready').textContent = project.regions.length ? plural('studio.ready', project.regions.length) : t('studio.readyScanner');
    el('studio-undo').disabled = !history.length;
    setBusy(busy);
  }
  function fillRegion() {
    const region = selectedRegion(); el('studio-region-fields').disabled = !region;
    el('studio-select-hint').hidden = Boolean(region);
    if (!region) return;
    el('studio-region-label').value = region.label; el('studio-region-description').value = region.description;
    el('studio-shape').value = region.shape; el('studio-waveform').value = region.waveform;
    el('studio-pattern').value = Object.entries(patterns).find(([,p]) => JSON.stringify(p) === JSON.stringify(region.pattern))?.[0] || 'pulse';
    el('studio-frequency').value = region.frequency; el('studio-frequency-value').textContent = `${Math.round(region.frequency)} Hz`;
    for (const key of ['x','y','width','height']) el(`studio-${key}`).value = Math.round(region[key] * 1000) / 10;
  }
  function fillProject() {
    el('studio-project-title').value = project?.title || ''; el('studio-project-description').value = project?.description || '';
    el('studio-scan').checked = project?.scanEnabled ?? true; fillRegion(); draw();
  }
  async function useProject(raw) {
    const next = validateProject(raw), token = ++revision;
    const nextAnalysis = await analyze(next.image);
    if (token !== revision) return;
    project = next; analysis = nextAnalysis; history = []; selected = project.regions[0]?.id || null;
    el('studio-method').textContent = t('studio.method');
    showError(''); fillProject(); persist();
  }
  function addRegion(box) {
    if (!project || project.regions.length >= 16) { showError(t('studio.maxRegions')); return; }
    checkpoint();
    const index = project.regions.length;
    const region = { id: `region-${Date.now().toString(36)}-${index}`, label: t('custom.regionDefault', { n: index + 1 }), description: t('studio.newRegionDescription'), shape: 'rect', ...box, color: colors[index % colors.length], frequency: 220 + index * 45, waveform: index % 2 ? 'triangle' : 'sine', pattern: [...patterns.pulse] };
    project.regions.push(region); selected = region.id; showError(''); draw(); fillRegion(); persist();
  }
  el('studio-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', flushDraft);
  window.addEventListener('pagehide', flushDraft);
  el('studio-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    setBusy(true);
    try { const image = await prepareImage(file); const next = makeBlankProject(image); next.title = file.name.replace(/\.[^.]+$/, '').slice(0,100) || t('custom.defaultTitle'); await useProject(next); }
    catch (error) { showError(error.message); } finally { setBusy(false); }
  });
  async function example() {
    if (busy) return;
    const c = document.createElement('canvas'); c.width = 1000; c.height = 640; const ctx = c.getContext('2d');
    ctx.fillStyle = '#f3f1e8'; ctx.fillRect(0,0,1000,640);
    ctx.fillStyle = '#526969'; ctx.font = '500 16px sans-serif'; ctx.fillText(t('studio.exampleHeading'), 65, 70);
    ctx.strokeStyle = '#1e654f'; ctx.lineWidth = 5; ctx.fillStyle = '#9bdbc2'; ctx.beginPath(); ctx.arc(235,310,105,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#795191'; ctx.fillStyle = '#cab2dd'; ctx.fillRect(445,205,190,210); ctx.strokeRect(445,205,190,210);
    ctx.strokeStyle = '#ab6e3c'; ctx.fillStyle = '#ebc395'; ctx.beginPath(); ctx.ellipse(815,310,90,135,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#526969'; ctx.font = '15px sans-serif'; ctx.fillText(t('studio.exampleCaption'),65,555);
    const next = makeBlankProject({ dataUrl:c.toDataURL('image/png'),width:1000,height:640 }); next.title = t('studio.exampleTitle'); next.description = t('studio.exampleDescription');
    setBusy(true); try { await useProject(next); } catch(error) { showError(error.message); } finally { setBusy(false); }
  }
  el('studio-example').addEventListener('click', example); el('studio-empty-example').addEventListener('click', example);
  el('studio-add').addEventListener('click', () => addRegion({ x:.35,y:.3,width:.25,height:.3 }));
  el('studio-suggest').addEventListener('click', () => {
    if (!project || !analysis || busy) return;
    const f = fit(project.image), available = 16 - project.regions.length;
    const suggestions = suggestRegions(analysis, Math.min(6, available));
    if (!suggestions.length) { showError(t('studio.suggestNone')); return; }
    checkpoint();
    for (const [i,s] of suggestions.entries()) project.regions.push({ id:`suggest-${Date.now().toString(36)}-${i}`, label:s.label, description:t('studio.suggestDescription'), shape:'rect', x:(f.x+s.x*f.w)/1000,y:(f.y+s.y*f.h)/640,width:s.width*f.w/1000,height:s.height*f.h/640,color:colors[(project.regions.length)%colors.length],frequency:240+i*65,waveform:i%2?'triangle':'sine',pattern:[...patterns.border] });
    selected = project.regions.at(-1).id; showError(''); draw(); fillRegion(); persist();
    el('studio-method').textContent = plural('studio.suggested', suggestions.length);
  });
  const pointerPoint = event => { const m = canvas.getScreenCTM(); if (!m) return null; const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(m.inverse()); return { x:clamp(p.x/1000), y:clamp(p.y/640) }; };
  canvas.addEventListener('pointerdown', event => {
    if (!project || busy || event.button !== 0) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); const start = pointerPoint(event); if (!start) return;
    const rect = document.createElementNS(NS,'rect'); rect.setAttribute('fill','#c0f5ce22');rect.setAttribute('stroke','#c0f5ce');rect.setAttribute('stroke-dasharray','7 5');rect.setAttribute('stroke-width','3'); canvas.append(rect);
    pendingDraw = { start, end:start, rect, pointerId:event.pointerId };
  });
  canvas.addEventListener('pointermove', event => {
    if (!pendingDraw || event.pointerId !== pendingDraw.pointerId) return;
    const p=pointerPoint(event); if(!p)return; pendingDraw.end=p; const a=pendingDraw.start;
    for(const [key,v]of Object.entries({x:Math.min(a.x,p.x)*1000,y:Math.min(a.y,p.y)*640,width:Math.abs(a.x-p.x)*1000,height:Math.abs(a.y-p.y)*640})) pendingDraw.rect.setAttribute(key,v);
  });
  canvas.addEventListener('pointerup', event => {
    if (!pendingDraw || event.pointerId !== pendingDraw.pointerId) return;
    const {start,end,rect}=pendingDraw;pendingDraw=null;rect.remove();
    if (Math.abs(end.x-start.x)<.015 || Math.abs(end.y-start.y)<.015) { showError(t('studio.drawTooSmall')); return; }
    addRegion({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)});
  });
  canvas.addEventListener('pointercancel', () => { pendingDraw?.rect.remove();pendingDraw=null; });
  el('studio-undo').addEventListener('click',()=>{if(!history.length)return;project=history.pop();selected=project.regions.at(-1)?.id||null;fillProject();persist();});
  el('studio-delete').addEventListener('click',()=>{if(!selectedRegion())return;checkpoint();project.regions=project.regions.filter(r=>r.id!==selected);selected=project.regions.at(-1)?.id||null;draw();fillRegion();persist();});
  for(const [id,key]of [['studio-project-title','title'],['studio-project-description','description']])el(id).addEventListener('input',event=>{if(!project)return;project[key]=event.target.value;persist();});
  el('studio-scan').addEventListener('change',event=>{if(project){project.scanEnabled=event.target.checked;persist();}});
  for(const [id,key]of [['studio-region-label','label'],['studio-region-description','description'],['studio-shape','shape'],['studio-waveform','waveform'],['studio-frequency','frequency'],['studio-pattern','pattern']])el(id).addEventListener('input',event=>{
    const r=selectedRegion();if(!r)return;r[key]=key==='frequency'?Number(event.target.value):key==='pattern'?[...patterns[event.target.value]]:event.target.value;
    el('studio-frequency-value').textContent=`${Math.round(r.frequency)} Hz`;draw();persist();
  });
  for(const key of ['x','y','width','height'])el(`studio-${key}`).addEventListener('change',event=>{
    const r=selectedRegion();if(!r)return;const value=Number(event.target.value)/100;if(!Number.isFinite(value))return;
    checkpoint();r[key]=clamp(value, (key==='width'||key==='height') ? .01 : 0, 1);
    r.x=clamp(r.x,0,.99);r.y=clamp(r.y,0,.99);r.width=clamp(r.width,.01,1-r.x);r.height=clamp(r.height,.01,1-r.y);draw();fillRegion();persist();
  });
  el('studio-import-button').addEventListener('click',()=>el('studio-import').click());
  el('studio-import').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>12*1024*1024){showError(t('studio.fileTooLarge'));return;}
    setBusy(true);try{await useProject(JSON.parse(await file.text()));}catch(error){showError(error instanceof SyntaxError?t('studio.fileInvalid'):error.message);}finally{setBusy(false);}
  });
  el('studio-export').addEventListener('click',()=>{try{const valid=validateProject(project);const nativeSave=download(valid,`${valid.title.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi,'-').slice(0,60)||t('studio.defaultFileName')}.tacto.json`);notify(t(nativeSave?'studio.savedNative':'studio.savedDownload'));}catch(error){showError(error.message);}});
  el('studio-publish').addEventListener('click',async()=>{
    if(!project||busy)return;
    if(!project.scanEnabled&&!project.regions.length){showError(t('studio.publishEmpty'));return;}
    setBusy(true);const token=revision;
    try{const next=await buildStudioScene(project);if(token!==revision)return;flushDraft();onPublish(next,{activate:true});dialog.close();notify(t('studio.published'));}
    catch(error){showError(error.message);}finally{setBusy(false);}
  });
  setBusy(false);
  try{const stored=localStorage.getItem(STORE);if(stored){const restoreRevision=revision+1;useProject(JSON.parse(stored)).then(async()=>{if(project&&revision===restoreRevision){const saved=await buildStudioScene(project);if(revision===restoreRevision)onPublish(saved,{activate:false});}}).catch(()=>{el('studio-save-status').textContent=t('studio.restoreFailed');});}}catch{}
  return { open(){onOpen();showError('');dialog.showModal();fillProject();}, close(){dialog.close();} };
}
