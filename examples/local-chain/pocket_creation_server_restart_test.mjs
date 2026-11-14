import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const sourceRun='C:/Users/timot/Desktop/2026/CKB/QuotaCell/local-state/wo18-pudge-acceptance-20261111';
const run=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-server-restart-'));
const txHash='0x'+'f'.repeat(64);
const recovery=JSON.stringify({initial:{marker:'provisional-creation'},actors:{owner:{publicKey:'0x02'+'00'.repeat(32)}}});
const port=await new Promise((resolve,reject)=>{
  const probe=net.createServer();
  probe.once('error',reject);
  probe.listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(error=>error?reject(error):resolve(value));});
});
const origin=`http://127.0.0.1:${port}`;

function startBackend(){
  const env={...process.env,QUOTACELL_NETWORK:'pudge-readonly',QUOTACELL_DEV_SIGNER:'0'};
  delete env.QUOTACELL_PUDGE_BROADCAST;
  const child=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(port)],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
  child.output='';
  child.stdout.on('data',chunk=>child.output+=chunk.toString());
  child.stderr.on('data',chunk=>child.output+=chunk.toString());
  return child;
}

async function readState(child){
  const deadline=Date.now()+90000;
  let lastError;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Backend exited with ${child.exitCode}: ${child.output}`);
    try{
      const response=await fetch(`${origin}/api/state`,{signal:AbortSignal.timeout(5000)});
      if(response.ok)return response.json();
      lastError=new Error(`State returned HTTP ${response.status}`);
    }catch(error){lastError=error;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw lastError||new Error('Backend did not become ready');
}

async function stopBackend(child){
  if(child.exitCode!==null)return;
  child.kill();
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Backend process did not stop')),10000);
    child.once('exit',()=>{clearTimeout(timeout);resolve();});
  });
}

try{
  await fs.mkdir(path.join(run,'evidence'),{recursive:true});
  for(const [source,target] of [
    [path.join(sourceRun,'runtime.json'),path.join(run,'runtime.json')],
    [path.join(sourceRun,'deployment.json'),path.join(run,'deployment.json')],
    [path.join(sourceRun,'evidence','node-profile.json'),path.join(run,'evidence','node-profile.json')],
  ])await fs.copyFile(source,target);

  const db=new DatabaseSync(path.join(run,'working-pocket.sqlite'));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE intents (id TEXT PRIMARY KEY, genesis TEXT NOT NULL, pocket TEXT NOT NULL, actor TEXT NOT NULL, recipient TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT NOT NULL, signed TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, operation TEXT NOT NULL, recovery_json TEXT)");
  db.prepare('INSERT INTO intents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'creation-restart-fixture',
    '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606',
    '0x'+'a'.repeat(64),
    '0x02'+'00'.repeat(32),
    '0x'+'00'.repeat(20),
    '0',
    txHash,
    JSON.stringify({inputs:[]}),
    'uncertain',
    new Date().toISOString(),
    'genesis',
    recovery,
  );
  db.close();

  for(let restart=0;restart<2;restart++){
    const child=startBackend();
    try{
      const state=await readState(child);
      assert.equal(state.empty,false);
      assert.equal(state.recoveryRequired,true);
      assert.equal(state.unresolved,true);
      assert.equal(state.creationRecovery.txHash,txHash);
      assert.equal(state.creationRecovery.state,'uncertain');
      assert.equal(state.creationRecovery.recoveryAvailable,true);

      const blocked=await fetch(`${origin}/api/ckb`,{
        method:'POST',
        headers:{origin,'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'send_transaction',params:[{}]}),
      });
      assert.equal(blocked.status,400);
      assert.match((await blocked.json()).error,/RPC method unavailable/);
      assert.equal(await fs.access(path.join(run,'pocket.json')).then(()=>true,()=>false),false);
    }finally{await stopBackend(child);}

    const check=new DatabaseSync(path.join(run,'working-pocket.sqlite'));
    const item=check.prepare("SELECT tx_hash,state,recovery_json,phase FROM intents WHERE operation='genesis'").get();
    assert.equal(item.tx_hash,txHash);
    assert.equal(item.state,'uncertain');
    assert.equal(item.recovery_json,recovery);
    assert.equal(item.phase,'legacy-unknown');
    check.close();
  }

  console.log('PASS full backend restart: unknown creation remains recovery-required; intent persists; read-only RPC rejects broadcast; no descriptor is created');
}finally{await fs.rm(run,{recursive:true,force:true});}
