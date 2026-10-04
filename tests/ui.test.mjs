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
