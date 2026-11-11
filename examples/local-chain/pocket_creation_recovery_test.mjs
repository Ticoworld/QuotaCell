import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {submitDurableCreation,recoverCreation} from './pocket_creation_recovery.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const testFile=fileURLToPath(import.meta.url);
const childDb=process.argv[2]==='--crash-after-intent'?process.argv[3]:null;
const schema="CREATE TABLE intents (id TEXT PRIMARY KEY, operation TEXT NOT NULL, tx_hash TEXT NOT NULL, signed TEXT NOT NULL, state TEXT NOT NULL, recovery_json TEXT NOT NULL)";
const recovery=JSON.stringify({initial:{pocket:'p'},actors:{owner:'o'}});
function dbAt(file){const db=new DatabaseSync(file);db.exec(schema);return db;}
function durableRow(db,state='uncertain'){
 db.prepare('INSERT INTO intents (id,operation,tx_hash,signed,state,recovery_json) VALUES (?,?,?,?,?,?)').run('creation-1','genesis','0xabc','{"inputs":[]}',state,recovery);
}
function reopen(file){const db=new DatabaseSync(file);return {db,item:db.prepare('SELECT * FROM intents WHERE operation=\'genesis\'').get()};}

if(childDb){
 const db=dbAt(childDb);db.exec('BEGIN IMMEDIATE');durableRow(db);db.exec('COMMIT');db.close();process.exit(77);
}

const root=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-creation-recovery-'));
const events=[];
try{
 // A terminated writer leaves an intent that a new process can recover from SQLite.
 const crashFile=path.join(root,'crash.sqlite');
 const child=spawnSync(process.execPath,['--experimental-strip-types',testFile,'--crash-after-intent',crashFile],{encoding:'utf8'});
 assert.equal(child.status,77,child.stderr||child.stdout);
 let {db,item}=reopen(crashFile);
 assert.equal(item.state,'uncertain');assert.equal(item.recovery_json,recovery);
 let observed=0,writes=0;
 let result=await recoverCreation({item,observe:async row=>{observed++;assert.equal(row.tx_hash,'0xabc');return {state:'unknown',reason:'No canonical result'};},writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,false);assert.equal(result.outcome.state,'unknown');assert.equal(observed,1);assert.equal(writes,0);
 assert.equal(db.prepare("SELECT count(*) AS n FROM intents WHERE operation='genesis'").get().n,1);
 db.close();

 // An intent-write failure never calls a public RPC and leaves no row.
 const preFile=path.join(root,'before-intent.sqlite');db=dbAt(preFile);
 await assert.rejects(submitDurableCreation({persistIntent:async()=>{events.push('persist-failed');throw Error('disk failure');},dryRun:async()=>events.push('dry-run'),submit:async()=>events.push('submit')}),/disk failure/);
 assert.deepEqual(events,['persist-failed']);assert.equal(db.prepare('SELECT count(*) AS n FROM intents').get().n,0);db.close();

 // Faults after durable persistence survive close/reopen and never trigger a replacement send.
 for(const stopAt of ['after-intent','before-dry-run','dry-run','after-dry-run','before-submit','submit','after-submit']){
  const file=path.join(root,`${stopAt}.sqlite`);db=dbAt(file);events.length=0;let sends=0,networkAccepted=false;
  const run=()=>submitDurableCreation({
   persistIntent:async()=>{db.exec('BEGIN IMMEDIATE');try{durableRow(db);db.exec('COMMIT');events.push('persist');}catch(e){db.exec('ROLLBACK');throw e;}},
   dryRun:async()=>{events.push('dry-run');if(stopAt==='dry-run')throw Error('dry-run response lost');},
   submit:async()=>{events.push('submit');sends++;if(stopAt==='submit'){networkAccepted=true;throw Error('submit response lost');}return {state:'submitted'};},
   checkpoint:async stage=>{events.push(stage);if(stage===stopAt)throw Error('injected process boundary');}
  });
  let result;
  if(stopAt==='after-intent')await assert.rejects(run(),/injected process boundary/);
  else result=await run();
  if(stopAt!=='after-intent')assert.equal(result.state,'uncertain');
  assert(sends<=1);assert(!events.includes('submit')||events.indexOf('persist')<events.indexOf('submit'));
  db.close();({db,item}=reopen(file));assert.equal(item.recovery_json,recovery);
  let outcome=stopAt==='submit'||stopAt==='after-submit'?{state:'committed',blockHash:'0xblock'}:{state:'unknown',reason:'No canonical result'};
  if(stopAt==='submit')assert.equal(networkAccepted,true);
  observed=0;writes=0;
  result=await recoverCreation({item,observe:async row=>{observed++;assert.equal(row.tx_hash,'0xabc');return outcome;},writeDescriptor:async()=>{writes++;}});
  if(outcome.state==='committed'){assert.equal(result.ready,true);assert.equal(writes,1);}else{assert.equal(result.ready,false);assert.equal(writes,0);}
  assert.equal(observed,1);
  assert.equal(sends,stopAt==='after-submit'||stopAt==='submit'?1:0,'recovery must observe, never rebroadcast');
  db.close();
 }

 // Pending, rejected, conflicting, and unknown outcomes remain blocked.
 for(const state of ['pending','rejected','conflicting','unknown','uncertain']){
  const file=path.join(root,`state-${state}.sqlite`);db=dbAt(file);durableRow(db);({item}=reopen(file));
  let writes=0;result=await recoverCreation({item,observe:async()=>({state}),writeDescriptor:async()=>{writes++;}});
  assert.equal(result.ready,false);assert.equal(result.outcome.state,state);assert.equal(writes,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM intents WHERE operation='genesis'").get().n,1);db.close();
 }

 // A known committed row is revalidated; descriptor failure is retryable after reopening.
 const committedFile=path.join(root,'committed.sqlite');db=dbAt(committedFile);durableRow(db,'committed');db.close();
 ({db,item}=reopen(committedFile));observed=0;
 result=await recoverCreation({item,operationInProgress:true,observe:async()=>{observed++;return {state:'committed'};},writeDescriptor:async()=>{throw Error('must not write during another operation');}});
 assert.equal(result.ready,false);assert.equal(observed,0);assert.match(result.outcome.reason,/in progress/);
 db.close();({db,item}=reopen(committedFile));observed=0;
 await assert.rejects(recoverCreation({item,observe:async()=>{observed++;return {state:'committed'};},writeDescriptor:async()=>{throw Error('descriptor rename failed');}}),/descriptor rename failed/);
 assert.equal(observed,1);db.close();
 ({db,item}=reopen(committedFile));observed=0;writes=0;
 result=await recoverCreation({item,observe:async()=>{observed++;return {state:'committed'};},writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,true);assert.equal(observed,1);assert.equal(writes,1);db.close();
 ({db,item}=reopen(committedFile));observed=0;
 result=await recoverCreation({item,observe:async()=>{observed++;return {state:'uncertain',reason:'Previously committed transaction is no longer canonical'};},writeDescriptor:async()=>{throw Error('must not materialize');}});
 assert.equal(result.ready,false);assert.equal(result.outcome.state,'uncertain');assert.equal(observed,1);db.close();

 console.log('PASS SQLite-backed creation recovery: process exit after intent, close/reopen fault stages, no rebroadcast, canonical revalidation and descriptor retry');
}finally{await fs.rm(root,{recursive:true,force:true});}
