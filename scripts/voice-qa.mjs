import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright');
const browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'es-ES'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:undefined});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>false});
  window.__clips=[];window.__ctx=null;
  const Original=window.AudioContext;
  window.AudioContext=class extends Original{
    constructor(options){super(options);window.__ctx=this;}
    createBufferSource(){
      const source=super.createBufferSource();
      const start=source.start.bind(source),stop=source.stop.bind(source);
      source.start=(...args)=>{window.__clips.push({node:source,duration:source.buffer.duration,stopped:false});return start(...args);};
      source.stop=(...args)=>{const entry=window.__clips.find(c=>c.node===source);if(entry)entry.stopped=true;return stop(...args);};
      return source;
    }
  };
  const originalConnect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){const analyser=this.context.createAnalyser();analyser.fftSize=2048;this.context.__probe=analyser;originalConnect.call(this,analyser);return originalConnect.call(analyser,destination,...args);}
    return originalConnect.call(this,destination,...args);
  };
});
const signal=()=>page.evaluate(()=>{const a=window.__ctx.__probe;const samples=new Float32Array(a.fftSize);a.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length);});
try{
  await page.goto(process.env.TACTO_URL||'http://localhost:4317',{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>typeof speechSynthesis),'undefined');
  await page.getByRole('button',{name:'Probar voz',exact:true}).tap();
  await page.waitForFunction(()=>window.__clips.length===1);
  await page.waitForTimeout(500);
  assert.match(await page.locator('#voice-status').innerText(),/incluida/);
  const rms=await signal();assert.ok(rms>.0001,'Bundled narration must generate a real signal without browser TTS');
  await page.getByRole('button',{name:'Pausar experiencia',exact:true}).tap();
  assert.equal(await page.evaluate(()=>window.__clips[0].stopped),true,'Pause must stop narration');
  await page.locator('#voice-toggle').check();
  await page.waitForFunction(()=>window.__clips.length>=2);
  await page.getByRole('button',{name:'Explorar Núcleo',exact:true}).tap();
  await page.waitForFunction(()=>window.__clips.length>=3);
  assert.ok(await page.evaluate(()=>window.__clips.at(-1).duration>0));
  await page.getByRole('button',{name:'Escuchar descripción de la región',exact:true}).tap();
  await page.waitForFunction(()=>window.__clips.at(-1).duration>3);
  await page.waitForTimeout(1600);
  assert.equal(await page.evaluate(()=>window.__clips.at(-1).stopped),false,'Lifting the finger and the region preview timeout must let the explanation continue');
  await page.getByRole('button',{name:'Pausar experiencia',exact:true}).tap();
  assert.equal(await page.evaluate(()=>window.__clips.at(-1).stopped),true);
  await page.getByRole('button',{name:'Probar vibración',exact:true}).tap();
  await page.waitForTimeout(350);
  assert.match(await page.locator('#haptics-status').innerText(),/rechazó/);
  assert.equal(await page.locator('#haptics-confirm').isVisible(),true);
  await page.getByRole('button',{name:'No',exact:true}).tap();
  assert.equal(await page.locator('#haptics-toggle').isChecked(),false);
  assert.match(await page.locator('#haptics-status').innerText(),/No la has percibido/);
  await page.route('**/audio/cell-mitochondria-label.wav',route=>route.abort());
  await page.getByRole('button',{name:'Explorar Mitocondrias',exact:true}).tap();
  await page.waitForFunction(()=>document.querySelector('#voice-status').dataset.state==='unavailable');
  assert.match(await page.locator('#voice-status').innerText(),/No hay voz/);
  await page.unroute('**/audio/cell-mitochondria-label.wav');
  await page.getByRole('button',{name:'Pausar experiencia',exact:true}).tap();
  const clipsBeforeRetry=await page.evaluate(()=>window.__clips.length);
  await page.getByRole('button',{name:'Explorar Mitocondrias',exact:true}).tap();
  await page.waitForFunction(count=>window.__clips.length>count,clipsBeforeRetry);
  assert.deepEqual(errors,[]);
  await mkdir('artifacts',{recursive:true});
  const report={status:'passed',simulated:'Mobile browser without SpeechSynthesis and refusing Vibration API calls',voiceRms:rms,checks:['Bundled Spanish narration produces audio','Voice test and automatic names','Explanation survives release and preview timeout','Pause cancels narration','Vibration rejection is visible','User can report no physical vibration','Failed narration load is visible and can be retried'],limits:['Exact Mi Browser device not tested','Physical haptic motor not verified']};
  await writeFile('artifacts/voice-qa-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
