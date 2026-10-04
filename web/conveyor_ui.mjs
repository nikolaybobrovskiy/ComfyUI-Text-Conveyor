import { readTextFiles, BatchRunner, MAX_FILES, MAX_TOTAL_BYTES } from './conveyor_core.mjs';

export function attachUI(node, services) {
  const entriesWidget = node.widgets.find(w => w.name === 'entries_json');
  const indexWidget = node.widgets.find(w => w.name === 'index');
  const runner = new BatchRunner();
  let entries = [], selected = new Set(), busy = false, loading = false, stopRequested = false;
  const el = (tag, text) => { const e=document.createElement(tag); if(text) e.textContent=text; return e; };
  const root=el('div'); root.className='text-conveyor';
  Object.assign(root.style,{display:'flex',flexDirection:'column',gap:'6px',padding:'10px',background:'#20242b',color:'#eee',borderRadius:'8px',height:'100%',boxSizing:'border-box',font:'13px sans-serif'});
  const toolbar=el('div'), actions=el('div');
  const pick=el('button','Add text files'), all=el('button','Select all'), none=el('button','Select none');
  const remove=el('button','Remove selected'), clear=el('button','Clear');
  const run=el('button','Run All'), stop=el('button','Stop enqueueing');
  const picker=el('input'); picker.type='file';picker.multiple=true;picker.accept='.txt,.md,.text,.prompt';picker.style.display='none';
  const info=el('div','Drop UTF-8 text files here. Whole file = one prompt.');
  const list=el('div'); Object.assign(list.style,{overflow:'auto',height:'180px',flexShrink:'0'});
  const preview=el('textarea'); preview.readOnly=true;preview.setAttribute('aria-label','Prompt preview'); Object.assign(preview.style,{width:'100%',minHeight:'110px',flex:'1',boxSizing:'border-box',whiteSpace:'pre',font:'12px monospace'});
  const status=el('div','No files loaded'); status.setAttribute('role','status');
  toolbar.append(pick,all,none,remove,clear);actions.append(run,stop); root.append(toolbar,picker,info,list,preview,actions,status);
  for(const button of [pick,all,none,remove,clear,run,stop]) Object.assign(button.style,{padding:'5px 8px',margin:'2px',cursor:'pointer'});
  const persist=()=>{entriesWidget.value=JSON.stringify(entries);node.properties.text_conveyor_selected=[...selected];node.setDirtyCanvas?.(true,true);};
  const render=()=>{
    list.replaceChildren();
    entries.forEach((entry,i)=>{
      const row=el('div');Object.assign(row.style,{display:'flex',alignItems:'center',gap:'6px'});
      const check=el('input');check.type='checkbox';check.checked=selected.has(i);check.disabled=busy||loading;check.setAttribute('aria-label',`Queue file ${i+1}: ${entry.name}`);
      check.addEventListener('change',()=>{check.checked?selected.add(i):selected.delete(i);persist();render();});
      const title=el('button',`${i+1}. ${entry.name}`); title.style.textAlign='left';title.style.flex='1';title.addEventListener('click',()=>{indexWidget.value=i;preview.value=entry.text;node.setDirtyCanvas?.(true);});
      row.append(check,title);list.append(row);
    });
    const index=Math.min(Math.max(0,Number(indexWidget.value)||0),Math.max(0,entries.length-1));indexWidget.value=index;preview.value=entries[index]?.text??'';
    info.textContent=`${entries.length} files / ${selected.size} selected. Drop UTF-8 files here (500 files, 1 MiB each, 20 MiB total).`;
    for(const b of [pick,all,none,remove,clear]) b.disabled=busy||loading;
    run.disabled=busy||loading||!selected.size;stop.disabled=!busy;
  };
  const restore=()=>{
    try {const data=JSON.parse(entriesWidget.value);if(!Array.isArray(data)||data.some(e=>typeof e.name!=='string'||typeof e.text!=='string'))throw Error('invalid saved list');entries=data;
      selected=new Set((node.properties.text_conveyor_selected??entries.map((_,i)=>i)).filter(i=>Number.isInteger(i)&&i>=0&&i<entries.length));render();
    } catch(error){entries=[];selected.clear();render();status.textContent=`Cannot restore: ${error.message}`;}
  };
  const add=async(files)=>{
    if(busy||loading)return;
    loading=true;render();
    try {
      if(entries.length+files.length>MAX_FILES)throw Error('Maximum 500 files');
      const added=await readTextFiles(files);
      const combined=[...entries,...added];
      if(combined.reduce((sum,e)=>sum+new TextEncoder().encode(e.text).length,0)>MAX_TOTAL_BYTES)throw Error('Maximum 20 MiB total');
      const start=entries.length;entries=combined;added.forEach((_,i)=>selected.add(start+i));persist();status.textContent=`Loaded ${entries.length} files`;
    }catch(error){status.textContent=`Load failed; list unchanged: ${error.message}`;}
    finally{loading=false;picker.value='';render();}
  };
  pick.addEventListener('click',()=>picker.click());picker.addEventListener('change',()=>add(Array.from(picker.files??[])));
  root.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});
  root.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();return add(Array.from(e.dataTransfer?.files??[]));});
  all.addEventListener('click',()=>{selected=new Set(entries.map((_,i)=>i));persist();render();});
  none.addEventListener('click',()=>{selected.clear();persist();render();});
  remove.addEventListener('click',()=>{entries=entries.filter((_,i)=>!selected.has(i));selected=new Set(entries.map((_,i)=>i));indexWidget.value=0;persist();render();});
  clear.addEventListener('click',()=>{entries=[];selected.clear();indexWidget.value=0;persist();render();status.textContent='No files loaded';});
  run.addEventListener('click',async()=>{
    if(busy||loading)return;
    busy=true;render();status.textContent='Preparing workflow snapshot…';
    const files=structuredClone(entries), indexes=entries.map((_,i)=>i).filter(i=>selected.has(i));
    stopRequested=false;
    try{
      const snapshot=await services.snapshot();
      if(stopRequested){status.textContent=`Stopped. Queued 0/${indexes.length}`;return;}
      const result=await runner.run(files,indexes,snapshot,String(node.id),services.queue,p=>{status.textContent=`Queued ${p.queued}/${p.total} (not execution completion)`;});
      status.textContent=`${result.stopped?'Stopped. ':''}Queued ${result.queued}/${result.total} (not execution completion)`;
    }catch(error){status.textContent=`Failed after ${error.queued??0}/${error.total??indexes.length} acknowledged: ${error.message}. No automatic retry; check Comfy queue before retrying.`;}
    finally{busy=false;render();}
  });
  const stopBatch=()=>{stopRequested=true;runner.stop();};
  stop.addEventListener('click',stopBatch);
  const oldConfigure=node.onConfigure;node.onConfigure=function(...args){oldConfigure?.apply(this,args);restore();};
  const oldRemoved=node.onRemoved;node.onRemoved=function(...args){stopBatch();oldRemoved?.apply(this,args);};
  const widget=node.addDOMWidget('text_conveyor_ui','TEXT_CONVEYOR_UI',root,{serialize:false,hideOnZoom:false,getMinHeight:()=>450,getMaxHeight:()=>600});
  widget.computeSize=width=>[width,450];node.setSize?.([Math.max(node.size[0],500),Math.max(node.size[1],610)]);
  restore();
  return {root,picker,list,preview,run,stop,remove,clear,status};
}
