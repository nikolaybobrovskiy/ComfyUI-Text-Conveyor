// Real installed frontend export, isolated server + clean profile, no inference.
// Start the disposable server as documented in verification/export-boundary.md.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href : 'playwright');
const url=process.env.TC_TEST_URL??'http://127.0.0.1:8197';
assert.equal(new URL(url).hostname,'127.0.0.1');
assert.equal(new URL(url).port,'8197','Use only the disposable verification server');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
const page=await browser.newPage();
let promptRequests=0;
await page.route('**/prompt',route=>{promptRequests++;return route.abort();});
try {
 await page.goto(url);
 await page.waitForFunction(()=>window.comfyAPI?.app?.app?.canvas?.canvas && window.comfyAPI.app.app.extensions.some(e=>e.name==='Nous.TextConveyor') && window.LiteGraph?.registered_node_types?.TextConveyor);
 const workflow=JSON.parse(await readFile(new URL('../examples/no_models.json',import.meta.url),'utf8'));
 const report=await page.evaluate(async workflow=>{
  const app=window.comfyAPI.app.app;
  await app.loadGraphData(workflow);
  const node=app.graph._nodes.find(n=>n.comfyClass==='TextConveyor');
  const {BatchRunner}=await import('/extensions/ComfyUI-Text-Conveyor/conveyor_core.mjs');
  const {attachUI,TEXT_CONVEYOR_REVISION}=await import('/extensions/ComfyUI-Text-Conveyor/conveyor_ui.mjs');
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  assert((await app.graphToPrompt()).output[node.id],'Baseline actual export');
  const originals=node.properties;
  node.properties.ue_properties=new Proxy({widget_ue_connectable:new Proxy({text:true},{})},{});
  const nested=node.properties.ue_properties;
  const snapshot=await app.graphToPrompt();
  assert(snapshot.workflow.nodes.find(n=>String(n.id)===String(node.id)).properties.ue_properties.widget_ue_connectable.text===true,'Nested Proxy property preserved');
  node.properties=new Proxy(node.properties,{});
  const beforeExport=node.properties.ue_properties;
  const snapshot2=await app.graphToPrompt();
  const jobs=[];
  const entries=Array.from({length:60},(_,i)=>({name:`${i}.txt`,text:`Prompt ${i}`}));
  const indexes=entries.map((_,i)=>i);
  await new BatchRunner().run(entries,indexes,snapshot2,String(node.id),async data=>{jobs.push(data);return {prompt_id:'collector-only'};});
  assert(jobs.length===60&&jobs.every((job,i)=>job.output[node.id].inputs.index===i),'Independent collector payloads');
  assert(new Set(jobs.map(job=>job.workflow)).size===60,'Independent workflow snapshots');
  assert(node.properties.ue_properties===beforeExport,'Export does not replace nested references');
  node.properties=originals;
  // Deliberately failing test-only extension hook. This is NOT evidence that an
  // installed extension does this: it verifies diagnostics at the actual seam.
  const oldSerialize=node.onSerialize;
  const hook=()=>structuredClone(nested);
  node.onSerialize=hook;
  let caught;
  try{await app.graphToPrompt();}catch(e){caught=e;}
  assert(caught?.name==='DataCloneError'&&caught.stack.includes('serialize'),'Native error at real graph.serialize boundary');
  let exports=0,queued=0;const logs=[];const oldError=console.error;
  // Attach a separate harness UI to the real node without adding another widget.
  const oldDOM=node.addDOMWidget;
  node.addDOMWidget=()=>({});
  const ui=attachUI(node,{snapshot:()=>{exports++;return app.graphToPrompt();},queue:()=>{queued++;throw Error('Must not queue');}});
  node.addDOMWidget=oldDOM;
  console.error=(...args)=>logs.push(args);
  try{ui.run.click();await new Promise(resolve=>setTimeout(resolve,100));}finally{console.error=oldError;node.onSerialize=oldSerialize;}
  assert(exports===1&&queued===0,'Failed export never enqueues/retries');
  assert(logs.length===1&&logs[0][1].stage==='graph export'&&logs[0][2].name==='DataCloneError','Original native exception logged');
  assert(logs[0][2].stack.includes('serialize'),'Full export stack preserved');
  assert(ui.status.textContent.includes(TEXT_CONVEYOR_REVISION)&&ui.status.textContent.includes('graph export'),'Visible revision/stage');
  assert(!ui.run.disabled&&ui.stop.disabled,'Controls released');
  return {frontend:snapshot.workflow.extra.frontendVersion,nestedProxyExport:'passed',wholePropertiesProxyExport:'passed',collectorJobs:jobs.length,diagnosticRevision:TEXT_CONVEYOR_REVISION,injectedHookError:{name:caught.name,message:caught.message,stack:caught.stack},diagnostics:'passed',noInference:true};
 },workflow);
 assert.equal(promptRequests,0,'No HTTP prompt submissions');
 console.log(JSON.stringify({...report,promptRequests},null,2));
}finally{await browser.close();}
