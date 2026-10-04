import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('extension registers only Text Conveyor and attaches once',async()=>{
 const source=await readFile(new URL('../web/text_conveyor.js',import.meta.url),'utf8');
 globalThis.__tcTest={app:{registerExtension(e){this.extension=e}},api:{},attachUI(n){n.attached=(n.attached||0)+1}};
 const transformed=source.replace(/^import .*;$/gm,'')+'\n';
 await import('data:text/javascript,'+encodeURIComponent('const {app,api,attachUI}=globalThis.__tcTest;\n'+transformed));
 const e=globalThis.__tcTest.app.extension;assert.ok(e);
 const other={comfyClass:'Other'},node={comfyClass:'TextConveyor',widgets:[]};
 e.nodeCreated(other);e.nodeCreated(node);e.nodeCreated(node);
 assert.equal(other.attached,undefined);assert.equal(node.attached,1);
});
