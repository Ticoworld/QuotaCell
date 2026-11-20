import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const sourceRun=path.resolve(process.argv[2]||'');
assert(process.argv[2],'Pass the existing persistent runtime directory');
const run=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-wo18-empty-journal-'));
const port=await new Promise((resolve,reject)=>{
  const probe=net.createServer();
  probe.once('error',reject);
  probe.listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(error=>error?reject(error):resolve(value));});
});
const origin=`http://127.0.0.1:${port}`;
let child;
let output='';
try{
  await fs.mkdir(path.join(run,'evidence'),{recursive:true});
  for(const [source,target] of [
    [path.join(sourceRun,'runtime.json'),path.join(run,'runtime.json')],
    [path.join(sourceRun,'deployment.json'),path.join(run,'deployment.json')],
    [path.join(sourceRun,'pocket.json'),path.join(run,'pocket.json')],
    [path.join(sourceRun,'evidence','node-profile.json'),path.join(run,'evidence','node-profile.json')],
  ])await fs.copyFile(source,target);
  const database=path.join(run,'working-pocket.sqlite');
  await assert.rejects(fs.access(database),{code:'ENOENT'});
  child=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(port)],{
    cwd:repo,
    env:{...process.env,QUOTACELL_NETWORK:'pudge-readonly',QUOTACELL_DEV_SIGNER:'0'},
    stdio:['ignore','pipe','pipe'],
    windowsHide:true,
  });
  child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.on('data',chunk=>output+=chunk);

  const startupDeadline=Date.now()+90000;
  while(!output.includes('Working Pocket')){
    if(child.exitCode!==null)throw new Error(`Read-only backend exited with ${child.exitCode}:\n${output}`);
    assert(Date.now()<startupDeadline,`Read-only backend did not listen:\n${output}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const response=await fetch(`${origin}/api/state`,{signal:AbortSignal.timeout(120000)});
  const body=await response.text();
  assert.equal(response.status,200,`Read-only state returned HTTP ${response.status}: ${body.slice(0,2000)}\n${output}`);
  const state=JSON.parse(body);
  assert.equal(state.networkMode,'pudge-readonly');
  assert.equal(state.closed,true);
  assert.equal(state.hasFund,false);
  assert.equal(state.fundShannons,'0');
  assert.equal(state.fundOccupiedShannons,'0');
  assert.equal(BigInt(state.policyCapacity),134n*100000000n);
  assert.deepEqual(state.history,[],'Transaction history comes from the local journal');
  assert.equal(state.unresolved,false);
  console.log('PASS closed terminal Cell rediscovered from Pudge with an empty journal; history remains local; no broadcast enabled');
}finally{
  if(child?.exitCode===null){
    child.kill();
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Read-only backend process did not stop')),10000);
      child.once('exit',()=>{clearTimeout(timeout);resolve();});
    });
  }
  await fs.rm(run,{recursive:true,force:true});
}
