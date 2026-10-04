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

const file = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
test('UTF8 BOM and Unicode are decoded whole; duplicates retained in order', async () => {
  const bytes = new TextEncoder().encode('\ufeffone\r\n猫');
  const entries = await readTextFiles([file('same.txt', bytes), file('same.txt', new Uint8Array())]);
  assert.deepEqual(entries, [{ name: 'same.txt', text: 'one\r\n猫' }, { name: 'same.txt', text: '' }]);
});
