import test from 'node:test';
import assert from 'node:assert/strict';
import { readTextFiles, BatchRunner } from '../web/conveyor_core.mjs';

test('rejects invalid UTF8, excessive count, single and total sizes before reading', async () => {
  await assert.rejects(readTextFiles([file('a.txt', [255])]), /encoded|encoding/i);
  await assert.rejects(readTextFiles(Array(501).fill(file('a.txt', []))), /500/);
  await assert.rejects(readTextFiles([{name:'a.txt',size:1048577,arrayBuffer(){throw Error('should not read')}}]), /1 MiB/);
  await assert.rejects(readTextFiles(Array(21).fill({name:'a.txt',size:1048576})), /20 MiB/);
});

test('batch snapshots files and graph, sequentially queues one workflow per selected index', async () => {
  const entries = [{ name:'a.txt',text:'A' }, {name:'a.txt',text:'B'}];
  const snapshot = {output:{'7':{class_type:'TextConveyor',inputs:{entries_json:'[]',index:0}},'9':{inputs:{seed:42}}},workflow:{nodes:[{id:7,type:'TextConveyor',widgets_values:['[]',0]}],extra:{keep:true}}};
  const original = structuredClone(snapshot), jobs=[];
  const runner = new BatchRunner();
  const result = await runner.run(entries, [0,1], snapshot, '7', async data => {
    jobs.push(structuredClone(data));
    entries[1].text='MUTATED'; snapshot.output['9'].inputs.seed=99;
    await Promise.resolve();
    return {prompt_id:`id${jobs.length}`,node_errors:{}};
  });
  assert.equal(result.queued,2);
  assert.equal(JSON.parse(jobs[1].output['7'].inputs.entries_json)[1].text,'B');
  assert.equal(jobs[1].output['7'].inputs.index,1);
  assert.equal(jobs[1].output['9'].inputs.seed,42);
  assert.deepEqual(jobs[1].workflow.extra,original.workflow.extra);
  assert.equal(jobs[1].workflow.nodes[0].widgets_values[1],1);
});

test('stop only prevents further enqueue, busy run rejected, errors fail fast with honest count', async () => {
  const entries=[{name:'a.txt',text:'A'},{name:'b.txt',text:'B'},{name:'c.txt',text:'C'}];
  const graph={output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[]}};
  const runner=new BatchRunner(); let calls=0;
  const stopped=await runner.run(entries,[0,1,2],graph,'7',async()=>{
    calls++;
    await assert.rejects(runner.run(entries,[0],graph,'7',async()=>{}), /already running/);
    runner.stop(); return {prompt_id:'ok',node_errors:{}};
  });
  assert.equal(calls,1); assert.deepEqual(stopped,{queued:1,total:3,stopped:true});
  calls=0;
  await assert.rejects(runner.run(entries,[0,1,2],graph,'7',async()=>{
    if (++calls===2) throw Error('offline'); return {prompt_id:'ok'};
  }), error => error.queued===1 && error.total===3 && /offline/.test(error.message));
  assert.equal(calls,2); assert.equal(runner.running,false);
  await assert.rejects(runner.run(entries,[0],graph,'7',async()=>({prompt_id:'partial',node_errors:{'9':{errors:['bad']}}})), /validation/);
  await assert.rejects(runner.run(entries,[0],graph,'7',async()=>({})), /acknowledgement/);
  await assert.rejects(runner.run(entries,[],graph,'7',async()=>{}), /select/);
  await assert.rejects(runner.run(entries,[3],graph,'7',async()=>{}), /index/);
});

// Vue-style reactive values can occur anywhere in the exported graph/list.
const reactive = value => value && typeof value === 'object' ? new Proxy(value, {
  get(target, key, receiver) { return reactive(Reflect.get(target, key, receiver)); },
}) : value;

test('Proxy graph and entries queue 60 isolated JSON wire payloads without live mutation', async () => {
  const entries = Array.from({length:60}, (_, i) => ({name:`${i}.txt`,text:`Prompt ${i}\n猫`}));
  const snapshot = {
    output: {
      '7': {class_type:'TextConveyor',inputs:{entries_json:'[]',index:0}},
      '9': {class_type:'Other',inputs:{seed:42, link:['7',0], enabled:true, optional:null}},
    },
    workflow: {nodes:[{id:7,widgets_values:['[]',0],properties:{nested:{labels:['猫',null,false,0]}}}],extra:{nested:{keep:true}}},
  };
  const before = JSON.stringify({entries,snapshot});
  const graph = reactive(snapshot), files = reactive(entries), jobs = [];
  assert.throws(() => structuredClone(graph), {name:'DataCloneError'});
  assert.throws(() => structuredClone(files), {name:'DataCloneError'});
  const runner = new BatchRunner();
  const result = await runner.run(files, entries.map((_,i)=>i), graph, '7', async data => {
    if (jobs.length) {
      // A queue consumer must not be able to mutate the next job's snapshot.
      jobs.at(-1).output['9'].inputs.seed = -1;
      jobs.at(-1).workflow.extra.nested.keep = false;
      jobs.at(-1).workflow.nodes[0].properties.nested.labels.push('changed');
    }
    const index = jobs.length;
    assert.deepEqual(data.output['9'], snapshot.output['9']);
    assert.deepEqual(data.workflow.extra, snapshot.workflow.extra);
    assert.deepEqual(data.workflow.nodes[0].properties, snapshot.workflow.nodes[0].properties);
    assert.equal(data.output['7'].inputs.index, index);
    assert.equal(data.output['7'].inputs.entries_json, JSON.stringify(entries));
    assert.deepEqual(data.workflow.nodes[0].widgets_values, [JSON.stringify(entries),index]);
    assert.deepEqual(data, JSON.parse(JSON.stringify(data)));
    jobs.push(data);
    await Promise.resolve();
    return {prompt_id:`id${index}`,node_errors:{}};
  });
  assert.deepEqual(result, {queued:60,total:60,stopped:false});
  assert.equal(new Set(jobs).size,60);
  assert.equal(new Set(jobs.map(job=>job.output['7'].inputs)).size,60);
  assert.equal(new Set(jobs.map(job=>job.workflow)).size,60);
  assert.equal(JSON.stringify({entries,snapshot}), before);
  assert.equal(runner.running,false);
});

test('nested reactive metadata follows JSON wire semantics', async () => {
  const metadata = {nested:reactive({values:['猫',null,true,1.25],omitted:undefined}),date:new Date('2026-01-01T00:00:00Z')};
  const graph = {output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[],extra:metadata}};
  const expected = JSON.parse(JSON.stringify(metadata));
  const runner = new BatchRunner();
  await runner.run([{name:'a.txt',text:'A'}],[0],graph,'7',async data=>{
    assert.deepEqual(data.workflow.extra,expected);
    assert.equal(data.workflow.extra.date,'2026-01-01T00:00:00.000Z');
    assert.equal('omitted' in data.workflow.extra.nested,false);
    return {prompt_id:'ok'};
  });
  assert.equal(graph.workflow.extra,metadata);
  assert.equal(metadata.date instanceof Date,true);
});

test('cycles and BigInt in graph or entries fail before queue and release runner', async () => {
  const runner = new BatchRunner();
  for (const location of ['graph','entries']) {
    for (const kind of ['cycle','bigint']) {
      const entries=[{name:'a.txt',text:'A'}];
      const graph={output:{'7':{class_type:'TextConveyor',inputs:{}}},workflow:{nodes:[]}};
      const target=location==='graph' ? graph.workflow : entries[0];
      target.invalid=kind==='cycle' ? target : 1n;
      let calls=0;
      await assert.rejects(runner.run(entries,[0],graph,'7',async()=>{calls++;return {prompt_id:'unexpected'};}),
        error=>error.queued===0 && error.total===1 && /circular|BigInt/i.test(error.message));
      assert.equal(calls,0);
      assert.equal(runner.running,false);
      delete target.invalid;
      assert.equal((await runner.run(entries,[0],graph,'7',async()=>({prompt_id:'recovered'}))).queued,1);
    }
  }
});

const file = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
test('UTF8 BOM and Unicode are decoded whole; duplicates retained in order', async () => {
  const bytes = new TextEncoder().encode('\ufeffone\r\n猫');
  const entries = await readTextFiles([file('same.txt', bytes), file('same.txt', new Uint8Array())]);
  assert.deepEqual(entries, [{ name: 'same.txt', text: 'one\r\n猫' }, { name: 'same.txt', text: '' }]);
});
