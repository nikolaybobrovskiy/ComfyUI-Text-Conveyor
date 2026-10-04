// Run only against an isolated no-model ComfyUI instance, never a user's canvas.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href : 'playwright');
const url=process.env.TC_TEST_URL ?? 'http://127.0.0.1:8197';
assert.notEqual(new URL(url).port,'8188','Do not run browser verification on the live instance');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
const page=await browser.newPage({viewport:{width:1500,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);await page.waitForFunction(()=>window.comfyAPI?.app?.app?.canvas?.canvas && window.comfyAPI.app.app.graph?._nodes?.length);
 await page.waitForFunction(()=>!!window.LiteGraph?.registered_node_types?.TextConveyor || window.comfyAPI?.app?.app?.extensions?.some?.(e=>e.name==='Nous.TextConveyor')).catch(()=>{});
 const workflow=JSON.parse(await readFile(new URL('../examples/no_models.json',import.meta.url),'utf8'));
 await page.evaluate(async workflow=>{await window.comfyAPI.app.app.loadGraphData(workflow);},workflow);
 const root=page.locator('.text-conveyor');await root.waitFor({state:'visible'});
 await root.locator('input[type=file]').setInputFiles([
  {name:'same.txt',mimeType:'text/plain',buffer:Buffer.from('\ufeffFirst\r\n猫')},
  {name:'same.txt',mimeType:'text/plain',buffer:Buffer.from('Second 🌍')},
  {name:'empty.txt',mimeType:'text/plain',buffer:Buffer.from('')},
 ]);
 await page.waitForFunction(()=>document.querySelector('.text-conveyor [role=status]')?.textContent==='Loaded 5 files');
 // Example provides two initial files; remove those only through checkboxes.
 const boxes=root.locator('input[type=checkbox]');
 await root.getByRole('button',{name:'Select none',exact:true}).click();
 await boxes.nth(0).check();await boxes.nth(1).check();
 await root.getByRole('button',{name:'Remove selected',exact:true}).click();
 assert.equal(await boxes.count(),3);
 await root.getByRole('button',{name:'2. same.txt',exact:true}).click();
 assert.equal(await root.locator('textarea').inputValue(),'Second 🌍');
 const before=await (await fetch(url+'/history')).json();
 await root.getByRole('button',{name:'Run All',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.text-conveyor [role=status]')?.textContent.startsWith('Queued 3/3'));
 let newHistory;
 for(let i=0;i<100;i++){
   const history=await (await fetch(url+'/history')).json();
   newHistory=Object.entries(history).filter(([id])=>!before[id]);
   if(newHistory.length===3 && newHistory.every(([,job])=>job.status?.completed))break;
   await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(newHistory.length,3);
 const actual=[];
 for(const [id,job] of newHistory){
   assert.equal(job.status.status_str,'success');
   const inputs=job.prompt[2]['1'].inputs;
   const saved=job.outputs['2'].text[0];actual.push({id,index:inputs.index,saved,text:await readFile(saved,'utf8')});
   assert.equal(job.prompt[3].extra_pnginfo.workflow.nodes.find(n=>n.id===1).widgets_values[1],inputs.index);
 }
 actual.sort((a,b)=>a.index-b.index);
 assert.deepEqual(actual.map(x=>x.text),['First\r\n猫','Second 🌍','']);
 const serialized=await page.evaluate(()=>window.comfyAPI.app.app.graph.serialize());
 await page.evaluate(async data=>window.comfyAPI.app.app.loadGraphData(data),serialized);
 assert.equal(await root.locator('input[type=checkbox]').count(),3);
 assert.equal(await root.locator('textarea').inputValue(),'Second 🌍');
 await root.getByRole('button',{name:'Clear',exact:true}).click();assert.equal(await root.locator('input[type=checkbox]').count(),0);
 await root.evaluate(el=>{const transfer=new DataTransfer();transfer.items.add(new File(['Drop\n猫'],'drop.txt',{type:'text/plain'}));el.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));});
 await page.waitForFunction(()=>document.querySelector('.text-conveyor [role=status]')?.textContent==='Loaded 1 files');
 assert.equal(await root.locator('textarea').inputValue(),'Drop\n猫');
 const screenshot=process.env.TC_SCREENSHOT;
 if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
 assert.deepEqual(errors,[]);
 const report={passed:true,frontend:true,queued:actual.length,actual,checks:['picker','BOM','unicode','multiline','duplicate filenames','empty file','selection','preview','remove','clear','drag/drop','workflow persistence','real queue/history/files','per-job workflow metadata'],pageErrors:errors};
 if(process.env.TC_REPORT)await writeFile(process.env.TC_REPORT,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}catch(error){
 console.error('BROWSER DIAGNOSTICS',JSON.stringify({errors,state:await page.evaluate(()=>({title:document.title,dom:document.querySelectorAll('.text-conveyor').length,nodes:window.comfyAPI?.app?.app?.graph?._nodes?.map(n=>({id:n.id,type:n.type,comfyClass:n.comfyClass,widgets:n.widgets?.map(w=>({name:w.name,type:w.type})),attached:n.__textConveyorAttached})),body:document.body.innerText.slice(-2500)}))},null,2));
 if(process.env.TC_SCREENSHOT)await page.screenshot({path:process.env.TC_SCREENSHOT,fullPage:true});
 throw error;
}finally{await browser.close();}
