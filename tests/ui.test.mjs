import test from 'node:test';
import assert from 'node:assert/strict';

// A minimal DOM harness exercises controls and serialized state without Comfy imports.
class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.listeners={}; this.style={}; this.value=''; this.disabled=false; this.textContent=''; this.checked=false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=[...children]; }
  addEventListener(type, fn) { this.listeners[type]=fn; }
  async fire(type, extra={}) { return this.listeners[type]?.({target:this, preventDefault(){},stopPropagation(){}, ...extra}); }
  setAttribute() {}
  click() { return this.fire('click'); }
}
globalThis.document={createElement:tag=>new Element(tag)};

// Simulate reactive restored state without a Vue dependency in the DOM harness.
function attachWithReactiveEntries(attachUI, node, services, wrap) {
  const parse = JSON.parse;
  JSON.parse = (...args) => wrap(parse(...args));
  try { return attachUI(node, services); }
  finally { JSON.parse = parse; }
}

test('Run All snapshots reactive entries before async export and restores controls', async()=>{
  const {attachUI}=await import('../web/conveyor_ui.mjs');
  const node={id:7,widgets:[{name:'entries_json',value:'[{"name":"a.txt","text":"A"},{"name":"b.txt","text":"B"}]'},{name:'index',value:0}],properties:{},size:[500,650],addDOMWidget(){return {}},setSize(){}};
  let resolveSnapshot, entries, exports=0;
  const jobs=[];
  const reactive=value=>value && typeof value==='object' ? new Proxy(value,{get:(target,key,receiver)=>reactive(Reflect.get(target,key,receiver))}) : value;
  const ui=attachWithReactiveEntries(attachUI,node,{
    snapshot:()=>{exports++;return new Promise(resolve=>resolveSnapshot=resolve);},
    queue:async data=>{jobs.push(data);return {prompt_id:'ok'};},
  },data=>{entries=data;return reactive(data);});
  const running=ui.run.click();
  assert.equal(ui.run.disabled,true);assert.equal(ui.stop.disabled,false);
  await ui.run.click();assert.equal(exports,1);
  entries[1].text='changed during export';
  resolveSnapshot(reactive({output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[],extra:{nested:{keep:true}}}}));
  await running;
  assert.equal(jobs.length,2);
  assert.equal(JSON.parse(jobs[1].output['7'].inputs.entries_json)[1].text,'B');
  assert.equal(ui.run.disabled,false);assert.equal(ui.stop.disabled,true);
  assert.match(ui.status.textContent,/Queued 2\/2/);
});

test('entry snapshot failure is reported before export and releases busy controls', async()=>{
  const {attachUI}=await import('../web/conveyor_ui.mjs');
  const node={id:7,widgets:[{name:'entries_json',value:'[{"name":"a.txt","text":"A"}]'},{name:'index',value:0}],properties:{},size:[500,650],addDOMWidget(){return {}},setSize(){}};
  let broken=false, exports=0, queued=0;
  const ui=attachWithReactiveEntries(attachUI,node,{
    snapshot:async()=>{exports++;return {output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[]}};},
    queue:async()=>{queued++;return {prompt_id:'ok'};},
  },data=>new Proxy(data,{get(target,key,receiver){
    if(broken && key==='toJSON')throw Error('snapshot unavailable');
    return Reflect.get(target,key,receiver);
  }}));
  broken=true;
  await ui.run.click();
  assert.equal(exports,0);assert.equal(queued,0);
  assert.match(ui.status.textContent,/Failed after 0\/1 acknowledged: snapshot unavailable/);
  assert.equal(ui.run.disabled,false);assert.equal(ui.stop.disabled,true);
  broken=false;await ui.run.click();assert.equal(queued,1);
});
test('Stop during asynchronous snapshot cancels before first enqueue',async()=>{
 const {attachUI}=await import('../web/conveyor_ui.mjs');
 const node={id:7,widgets:[{name:'entries_json',value:'[{"name":"a.txt","text":"A"}]'},{name:'index',value:0}],properties:{},size:[500,650],addDOMWidget(){return {}},setSize(){}};
 let resolveSnapshot, queued=0;
 const ui=attachUI(node,{snapshot:()=>new Promise(resolve=>resolveSnapshot=resolve),queue:async()=>{queued++;return {prompt_id:'ok'}}});
 const running=ui.run.click();await ui.stop.click();
 resolveSnapshot({output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[]}});
 await running; assert.equal(queued,0);assert.match(ui.status.textContent,/Stopped/);
});

test('picker/drop, select, preview, remove/clear, persistence and Run All operate through node widgets', async()=>{
  const { attachUI } = await import('../web/conveyor_ui.mjs');
  const node={id:7,widgets:[{name:'entries_json',value:'[]'},{name:'index',value:0}],properties:{},size:[500,650],addDOMWidget(name,type,root,options){this.root=root;return {options};},setSize(){},setDirtyCanvas(){}};
  const calls=[];
  const ui=attachUI(node,{snapshot:async()=>({output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[]}}),queue:async data=>{calls.push(data);return {prompt_id:'ok'};}});
  const files=[new Blob(['first\n猫']),new Blob(['second'])]; files[0].name='same.txt';files[1].name='same.txt';
  ui.picker.files=files;
  await ui.picker.fire('change');
  assert.equal(ui.list.children.length,2);
  assert.equal(JSON.parse(node.widgets[0].value)[0].text,'first\n猫');
  await ui.list.children[1].children[1].click();
  assert.equal(ui.preview.value,'second'); assert.equal(node.widgets[1].value,1);
  await ui.run.click(); assert.equal(calls.length,2);
  assert.match(ui.status.textContent,/Queued 2\/2/);
  await ui.remove.click(); assert.equal(JSON.parse(node.widgets[0].value).length,0);
  await ui.root.fire('drop',{dataTransfer:{files:[files[0]]}}); assert.equal(ui.list.children.length,1);
  await ui.clear.click(); assert.equal(node.widgets[0].value,'[]');
  node.widgets[0].value=JSON.stringify([{name:'restored.txt',text:'saved'}]);
  node.onConfigure?.(); assert.equal(ui.list.children.length,1); assert.equal(ui.preview.value,'saved');
});
