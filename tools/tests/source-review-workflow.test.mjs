import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {sha256} from '../source-review-receipt.mjs'; import {prepare,accept,apply} from '../source-review-workflow.mjs';

test('accept and apply bind all evidence, reject failures before source writes, and apply both files', t => {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'nodoc-flow-')); t.after(()=>fs.rmSync(base,{recursive:true,force:true})); const root=path.join(base,'root');fs.mkdirSync(root);
 const p=path.join(base,'proposal'); fs.writeFileSync(p,'new'); for(const f of ['one','two'])fs.writeFileSync(path.join(root,f),'old');
 const manifestPath=path.join(base,'manifest'),reviewPath=path.join(base,'review'),solPath=path.join(base,'sol'),bindingPath=path.join(base,'binding'),gatePath=path.join(base,'gate'),resultPath=path.join(base,'result');
 const m={changes:['one','two'].map(destination=>({destination,proposal:p,beforeSha256:sha256('old'),proposalSha256:sha256('new')}))};
 fs.writeFileSync(manifestPath,JSON.stringify(m)); fs.writeFileSync(reviewPath,JSON.stringify({decision:'accepted',model:'gpt-6-luna',reasoning:'xhigh',reviewedManifestSha256:sha256(fs.readFileSync(manifestPath))}));
 const hashes=prepare(manifestPath,reviewPath); const sol={decision:'accept',model:'gpt-6.1-sol',reasoning:'medium',...hashes}; fs.writeFileSync(solPath,JSON.stringify({...sol,manifestSha256:'a'.repeat(63)}));
 const args={root,manifestPath,reviewPath,solPath,bindingPath,gatePath,resultPath};
 assert.throws(()=>accept(args),/Sol/); assert.equal(fs.existsSync(bindingPath),false); fs.writeFileSync(solPath,JSON.stringify(sol));
 fs.writeFileSync(gatePath,'collision'); assert.throws(()=>accept(args),/exists/); assert.equal(fs.existsSync(bindingPath),false); fs.rmSync(gatePath);
 accept(args);
 const originalBinding=fs.readFileSync(bindingPath); const b=JSON.parse(originalBinding); b.changes.pop(); fs.writeFileSync(bindingPath,JSON.stringify(b)); assert.throws(()=>apply(args),/drift/); fs.writeFileSync(bindingPath,originalBinding);
 const gate=JSON.parse(fs.readFileSync(gatePath)); fs.writeFileSync(gatePath,JSON.stringify({...gate,model:'wrong'})); assert.throws(()=>apply(args),/Sol/); fs.writeFileSync(gatePath,JSON.stringify(gate));
 fs.writeFileSync(path.join(root,'two'),'drift'); assert.throws(()=>apply(args),/drift/); assert.equal(fs.readFileSync(path.join(root,'one'),'utf8'),'old'); fs.writeFileSync(path.join(root,'two'),'old');
 fs.writeFileSync(resultPath,'collision'); assert.throws(()=>apply(args),/exists/); assert.equal(fs.readFileSync(path.join(root,'one'),'utf8'),'old'); fs.rmSync(resultPath);
 const result=apply(args); assert.equal(result.status,'applied'); assert.deepEqual(result.completed,['one','two']); assert.equal(fs.readFileSync(path.join(root,'two'),'utf8'),'new'); assert.equal(JSON.parse(fs.readFileSync(resultPath)).status,'applied');
});

test('write failure records completed and uncertain pending destination', t => {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'nodoc-partial-')); t.after(()=>fs.rmSync(base,{recursive:true,force:true})); const root=path.join(base,'root');fs.mkdirSync(root);
 const p=path.join(base,'p'); fs.writeFileSync(p,'new'); for(const n of ['a','b'])fs.writeFileSync(path.join(root,n),'old');
 const manifestPath=path.join(base,'manifest'),reviewPath=path.join(base,'review'),solPath=path.join(base,'sol'),bindingPath=path.join(base,'binding'),gatePath=path.join(base,'gate'),resultPath=path.join(base,'result');
 fs.writeFileSync(manifestPath,JSON.stringify({changes:['a','b'].map(destination=>({destination,proposal:p,beforeSha256:sha256('old'),proposalSha256:sha256('new')}))}));
 fs.writeFileSync(reviewPath,JSON.stringify({decision:'accepted',model:'gpt-6-luna',reasoning:'xhigh',reviewedManifestSha256:sha256(fs.readFileSync(manifestPath))}));
 fs.writeFileSync(solPath,JSON.stringify({decision:'accept',model:'gpt-6.1-sol',reasoning:'medium',...prepare(manifestPath,reviewPath)})); const args={root,manifestPath,reviewPath,solPath,bindingPath,gatePath,resultPath}; accept(args);
 const original=fs.writeFileSync; fs.writeFileSync=function(file,...rest) {if(file===path.join(root,'b'))throw Error('injected write failure');return original.call(this,file,...rest)};
 try { assert.throws(()=>apply(args),/injected/); } finally { fs.writeFileSync=original; }
 const result=JSON.parse(fs.readFileSync(resultPath)); assert.equal(result.status,'failed-or-interrupted'); assert.deepEqual(result.completed,['a']); assert.equal(result.pending,'b'); assert.equal(fs.readFileSync(path.join(root,'a'),'utf8'),'new'); assert.equal(fs.readFileSync(path.join(root,'b'),'utf8'),'old');
});

for (const fault of ['write', 'rename']) test(`persistent checkpoint ${fault} failure preserves last pending JSON`, t => {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'nodoc-checkpoint-')); t.after(()=>fs.rmSync(base,{recursive:true,force:true})); const root=path.join(base,'root'); fs.mkdirSync(root);
 const p=path.join(base,'p'); fs.writeFileSync(p,'new'); fs.writeFileSync(path.join(root,'a'),'old');
 const manifestPath=path.join(base,'manifest'),reviewPath=path.join(base,'review'),solPath=path.join(base,'sol'),bindingPath=path.join(base,'binding'),gatePath=path.join(base,'gate'),resultPath=path.join(base,'result');
 fs.writeFileSync(manifestPath,JSON.stringify({changes:[{destination:'a',proposal:p,beforeSha256:sha256('old'),proposalSha256:sha256('new')}]}));
 fs.writeFileSync(reviewPath,JSON.stringify({decision:'accepted',model:'gpt-6-luna',reasoning:'xhigh',reviewedManifestSha256:sha256(fs.readFileSync(manifestPath))}));
 fs.writeFileSync(solPath,JSON.stringify({decision:'accept',model:'gpt-6.1-sol',reasoning:'medium',...prepare(manifestPath,reviewPath)})); const args={root,manifestPath,reviewPath,solPath,bindingPath,gatePath,resultPath}; accept(args);
 let sourceWritten=false; const write=fs.writeFileSync, rename=fs.renameSync;
 fs.writeFileSync=function(file,...rest) { if(sourceWritten && fault==='write' && typeof file==='number') throw Error('persistent checkpoint write failure'); const value=write.call(this,file,...rest); if(file===path.join(root,'a'))sourceWritten=true; return value; };
 fs.renameSync=function(...args) {if(sourceWritten && fault==='rename')throw Error('persistent checkpoint rename failure'); return rename.apply(this,args);};
 try { assert.throws(()=>apply(args), /persistent checkpoint/); } finally { fs.writeFileSync=write; fs.renameSync=rename; }
 assert.equal(fs.readFileSync(path.join(root,'a'),'utf8'),'new'); const saved=JSON.parse(fs.readFileSync(resultPath)); assert.equal(saved.status,'applying'); assert.deepEqual(saved.completed,[]); assert.equal(saved.pending,'a'); assert.deepEqual(fs.readdirSync(base).filter(n=>n.endsWith('.tmp')),[]);
});
