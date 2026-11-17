// Loopback supervisor: every Pocket keeps an independent instance of the verified engine.
import * as c from '@ckb-ccc/core';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {acquireRuntimeLock} from './runtime_lock.mjs';
import {assertGenesisAcceptanceOperation,assertGenesisAcceptanceRoute} from './pudge_acceptance_gate.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const workerScript=path.join(here,'working_pocket_server.mjs');
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const networkMode=process.env.QUOTACELL_NETWORK||'isolated';
const genesisAcceptanceOnly=process.env.QUOTACELL_PUDGE_GENESIS_ONLY==='1';
if(genesisAcceptanceOnly){assert.equal(networkMode,'pudge','Genesis-only acceptance requires Pudge mode');assert.equal(process.env.QUOTACELL_PUDGE_BROADCAST,'1','Genesis-only acceptance requires explicit Pudge broadcast enablement');}
const pocketPattern=/^0x[0-9a-f]{64}$/i;
const actorPattern=/^0x0[23][0-9a-f]{64}$/i;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scriptHash(value){return c.Script.from(value).hash().toLowerCase();}
function inputKey(value){return `${value.txHash.toLowerCase()}:${BigInt(value.index).toString(16)}`;}
function sendJson(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
async function readJson(req,limit=210000){let body='';for await(const chunk of req){body+=chunk;assert(body.length<limit,'Request body is too large');}return body?JSON.parse(body):{};}

export async function startPocketSupervisor({run,port=4173,worker=workerScript,spawnWorker=spawn,fetcher=fetch}={}){
 assert(run,'A Pocket runtime directory is required');
 if(networkMode==='pudge-prepare-only')assert.notEqual(process.env.QUOTACELL_PUDGE_BROADCAST,'1','Pudge broadcast must stay disabled in preparation-only mode');
 const root=path.resolve(run),origin=`http://127.0.0.1:${port}`;
 JSON.parse(await fs.readFile(path.join(root,'runtime.json'),'utf8'));
 const profile=JSON.parse(await fs.readFile(path.join(root,'evidence','node-profile.json'),'utf8'));
 const deployment=JSON.parse(await fs.readFile(path.join(root,'deployment.json'),'utf8'));
 const genesis=profile.genesisHeader.hash.toLowerCase();
 assert.equal(deployment.genesis.toLowerCase(),genesis,'Runtime and deployment chain identities differ');
 const runtimeLock=await acquireRuntimeLock(root);
 await fs.mkdir(path.join(root,'contexts'),{recursive:true});
 const db=new DatabaseSync(path.join(root,'pocket-supervisor.sqlite'));
 db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS contexts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, directory TEXT NOT NULL, owner TEXT, draft_id TEXT, pocket TEXT, created TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS contexts_pocket_unique ON contexts(pocket) WHERE pocket IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS contexts_draft_owner_unique ON contexts(draft_id,owner) WHERE draft_id IS NOT NULL; CREATE TABLE IF NOT EXISTS reservations (request_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, genesis TEXT NOT NULL, pocket TEXT NOT NULL, inputs_json TEXT NOT NULL, phase TEXT NOT NULL, expires INTEGER, tx_hash TEXT, operation TEXT NOT NULL, created TEXT NOT NULL)");
 const insertContext=db.prepare('INSERT INTO contexts (id,kind,directory,owner,draft_id,pocket,created) VALUES (?,?,?,?,?,?,?)');
 const contexts=()=>db.prepare('SELECT * FROM contexts ORDER BY created').all();
 const getContext=id=>db.prepare('SELECT * FROM contexts WHERE id=?').get(id)||null;
 const getPocket=pocket=>db.prepare('SELECT * FROM contexts WHERE pocket=?').get(pocket.toLowerCase())||null;
 const getDraft=(draftId,owner)=>db.prepare('SELECT * FROM contexts WHERE draft_id=? AND owner=?').get(draftId,owner.toLowerCase())||null;
 const reservations=()=>db.prepare('SELECT * FROM reservations ORDER BY created').all();
 const getReservation=id=>db.prepare('SELECT * FROM reservations WHERE request_id=?').get(id)||null;
 const workers=new Map(),pendingRequests=new Map();
 let stopping=false;

 function absoluteDirectory(context){
  const directory=path.resolve(root,context.directory);
  assert(directory===root||directory.startsWith(root+path.sep),'Pocket context escaped its runtime');
  return directory;
 }
 async function descriptorPocket(directory){
  try{const descriptor=JSON.parse(await fs.readFile(path.join(directory,'pocket.json'),'utf8'));return scriptHash(descriptor.initial.Q);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 const rootRow=getContext('root');
 if(!rootRow)insertContext.run('root','root','.',null,null,null,new Date().toISOString());
 const rootPocket=await descriptorPocket(root);
 if(rootPocket)db.prepare('UPDATE contexts SET pocket=? WHERE id=?').run(rootPocket,'root');
 const rootContext=getContext('root');
 const portProbe=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(error=>error?reject(error):resolve(address.port));});});

 async function startWorker(context){
  if(workers.has(context.id))return workers.get(context.id);
  const directory=absoluteDirectory(context),childPort=await portProbe(),token=randomBytes(32).toString('hex'),childOrigin=`http://127.0.0.1:${childPort}`;
  const env={...process.env,QUOTACELL_SUPERVISOR_TOKEN:token};
  const child=spawnWorker(process.execPath,['--experimental-strip-types',worker,directory,String(childPort)],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout?.on('data',chunk=>{output+=chunk.toString();});child.stderr?.on('data',chunk=>{output+=chunk.toString();});
  const value={child,port:childPort,origin:childOrigin,token,output};workers.set(context.id,value);
  const deadline=Date.now()+90000;let lastError;
  while(Date.now()<deadline){
   if(child.exitCode!==null){workers.delete(context.id);throw new Error(`Pocket engine ${context.id} exited (${child.exitCode}): ${output}`);}
   try{const result=await workerRequest(value,'GET','/api/internal/health');assert.equal(result.status,200);const health=JSON.parse(result.text);assert.equal(health.genesis.toLowerCase(),genesis,'Pocket engine started on another network');return value;}
   catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,200));}
  }
  child.kill();workers.delete(context.id);throw new Error(`Pocket engine ${context.id} did not become ready: ${lastError?.message||''}\n${output}`);
 }
 async function stopWorker(value){if(!value||value.child.exitCode!==null)return;value.child.kill();await new Promise(resolve=>{const timer=setTimeout(resolve,5000);value.child.once('exit',()=>{clearTimeout(timer);resolve();});});}
 async function workerRequest(value,method,pathname,body){
  const response=await fetcher(`${value.origin}${pathname}`,{method,headers:{'x-quotacell-supervisor-token':value.token,'origin':value.origin,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'});
  return {status:response.status,text:await response.text(),contentType:response.headers.get('content-type')||'application/json'};
 }
 async function workerJson(context,method,pathname,body){
  const value=await startWorker(context),response=await workerRequest(value,method,pathname,body);
  let data;try{data=JSON.parse(response.text);}catch{throw new Error(`Pocket engine returned invalid JSON (${response.status})`);}
  return {...response,data};
 }
 async function copyManifest(directory){
  await fs.mkdir(directory,{recursive:false});
  await fs.mkdir(path.join(directory,'evidence'));
  await Promise.all([
   fs.copyFile(path.join(root,'runtime.json'),path.join(directory,'runtime.json')),
   fs.copyFile(path.join(root,'deployment.json'),path.join(directory,'deployment.json')),
   fs.copyFile(path.join(root,'evidence','node-profile.json'),path.join(directory,'evidence','node-profile.json')),
  ]);
 }
 async function createContext(kind,{owner=null,draftId=null,descriptor=null}={}){
  const id=randomUUID(),relative=path.join('contexts',id),directory=path.join(root,relative);
  await copyManifest(directory);
  try{
   let pocket=null;
   if(descriptor){assert.equal(descriptor.initial?.expected?.ownerPublicKey?.toLowerCase(),owner?.toLowerCase(),'Linked Pocket owner mismatch');pocket=scriptHash(descriptor.initial.Q);assert(pocketPattern.test(pocket),'Invalid linked Pocket identity');await fs.writeFile(path.join(directory,'pocket.json.tmp'),JSON.stringify(descriptor));await fs.rename(path.join(directory,'pocket.json.tmp'),path.join(directory,'pocket.json'));}
   insertContext.run(id,kind,relative,owner?.toLowerCase()||null,draftId,pocket,new Date().toISOString());
   return getContext(id);
  }catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
 }
 async function contextForDraft(draftId,owner){
  assert(uuidPattern.test(draftId||''),'Invalid Pocket draft identity');assert(actorPattern.test(owner||''),'Invalid owner identity');
  draftId=draftId.toLowerCase();
  const found=getDraft(draftId,owner);if(found)return found;
  assert(!db.prepare('SELECT 1 FROM contexts WHERE draft_id=?').get(draftId),'Draft identity is already bound to another owner');
  return createContext('draft',{owner,draftId});
 }
 async function contextForPocket(pocket,actor){
  assert(pocketPattern.test(pocket||''),'Pocket link must contain an exact policy identity');assert(actorPattern.test(actor||''),'Connect the authorized CKB wallet to open this Pocket');
  const known=getPocket(pocket);
  if(known){
   if(known.kind==='draft'){
    let actual=await descriptorPocket(absoluteDirectory(known));
    if(!actual){await workerJson(known,'GET',`/api/state?actor=${encodeURIComponent(actor)}&selected=1`);actual=await descriptorPocket(absoluteDirectory(known));}
    assert.equal(actual,pocket.toLowerCase(),'This Pocket draft has not been confirmed on chain.');
    db.prepare('UPDATE contexts SET pocket=? WHERE id=?').run(actual,known.id);
    const pending=reservations().find(item=>item.context_id===known.id&&item.pocket===actual&&['journaled','submitting'].includes(item.phase));
    if(pending&&(await inspectIntent(known,pending.request_id))?.state==='committed')releaseReservation(pending.request_id);
   }
   return known;
  }
  const rootWorker=await startWorker(rootContext),resolution=await workerJson(rootContext,'GET',`/api/internal/resolve?pocket=${encodeURIComponent(pocket)}&actor=${encodeURIComponent(actor)}`);
  assert.equal(resolution.status,200,resolution.data?.error||'Pocket could not be resolved from public chain state');
  const descriptor=resolution.data.context;assert(descriptor?.initial?.Q&&descriptor?.actors?.owner?.publicKey,'Public Pocket identity is incomplete');
  assert.equal(scriptHash(descriptor.initial.Q),pocket.toLowerCase(),'Resolved Pocket identity mismatch');
  assert.equal(descriptor.initial.expected.ownerPublicKey.toLowerCase(),descriptor.actors.owner.publicKey.toLowerCase(),'Pocket owner identity mismatch');
  assert.equal(rootWorker.origin.startsWith('http://127.0.0.1:'),true);
  return createContext('linked',{owner:descriptor.initial.expected.ownerPublicKey,descriptor});
 }
 function parseInputs(transactionHex){
  const transaction=c.Transaction.fromBytes(transactionHex);
  const inputs=transaction.inputs.map(item=>({txHash:item.previousOutput.txHash.toLowerCase(),index:BigInt(item.previousOutput.index).toString()}));
  const keys=inputs.map(inputKey);assert(inputs.length>0&&new Set(keys).size===keys.length,'Prepared transaction has missing or duplicate inputs');
  return {transaction,inputs,keys};
 }
 function acquireReservation({id,context,pocket,inputs,operation}){
  const expires=Date.now()+31*60_000,keys=inputs.map(inputKey);
  db.exec('BEGIN IMMEDIATE');
  try{
   assert(!getReservation(id),'Signing request ID is already reserved');
   const active=reservations().filter(item=>item.phase!=='committed');
   const held=new Set(active.flatMap(item=>JSON.parse(item.inputs_json).map(inputKey)));
   assert(!keys.some(key=>held.has(key)),'A transaction in another Pocket context already reserves one of these owner-controlled inputs. Reconcile or let the earlier signing request expire.');
   db.prepare('INSERT INTO reservations (request_id,context_id,genesis,pocket,inputs_json,phase,expires,tx_hash,operation,created) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,context.id,genesis,pocket,JSON.stringify(inputs),'prepared',expires,null,operation,new Date().toISOString());
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  pendingRequests.set(id,context.id);
 }
 function releaseReservation(id){db.prepare('DELETE FROM reservations WHERE request_id=?').run(id);pendingRequests.delete(id);}
 async function inspectIntent(context,id){const result=await workerJson(context,'GET',`/api/internal/intent?id=${encodeURIComponent(id)}`);assert.equal(result.status,200);return result.data.intent;}
 async function findIntent(id){const found=await Promise.all(contexts().map(async context=>{const intent=await inspectIntent(context,id);return intent?{context,intent}:null;}));return found.find(Boolean)||null;}
 function intentOutcome(intent){return {txHash:intent.txHash,state:['committed','pending','proposed','submitted','rejected'].includes(intent.state)?intent.state:'uncertain',phase:intent.phase,operation:intent.operation,pocket:intent.operation==='genesis'?intent.pocket:undefined};}
 function signedHash(transaction){try{return /^0x[0-9a-f]+$/i.test(transaction||'')?c.Transaction.fromBytes(transaction).hash():undefined;}catch{return undefined;}}
 function sendNotSubmitted(res,error,txHash){sendJson(res,200,{state:'not-sent',notSent:true,phase:'signing-request',error,txHash});}
 async function seedUnresolved(context){
  const result=await workerJson(context,'GET','/api/internal/intents');assert.equal(result.status,200);
  for(const intent of result.data.intents||[]){
   assert.equal(intent.genesis.toLowerCase(),genesis,'Journal contains an intent from another network');
   const existing=getReservation(intent.id);
   const inputs=intent.inputs.map(item=>({txHash:item.txHash.toLowerCase(),index:BigInt(item.index).toString()}));
   if(existing){assert.equal(existing.context_id,context.id,'Journal intent is bound to another Pocket context');assert.equal(existing.pocket,intent.pocket.toLowerCase(),'Journal intent Pocket identity changed');assert.deepEqual(JSON.parse(existing.inputs_json).map(inputKey).sort(),inputs.map(inputKey).sort(),'Journal input claim changed');continue;}
   const held=new Set(reservations().flatMap(item=>JSON.parse(item.inputs_json).map(inputKey)));
   if(inputs.some(input=>held.has(inputKey(input))))throw new Error(`Journaled transaction ${intent.id} conflicts with another Pocket context input claim`);
   db.prepare('INSERT INTO reservations (request_id,context_id,genesis,pocket,inputs_json,phase,expires,tx_hash,operation,created) VALUES (?,?,?,?,?,?,?,?,?,?)').run(intent.id,context.id,genesis,intent.pocket.toLowerCase(),JSON.stringify(inputs),'journaled',null,intent.txHash,intent.operation,new Date().toISOString());
  }
 }
 async function recoverReservations(){
  for(const item of reservations().filter(row=>row.phase==='prepared')){
   if(item.operation==='genesis')db.prepare('UPDATE contexts SET pocket=NULL WHERE id=? AND kind=\'draft\'').run(item.context_id);
   db.prepare('DELETE FROM reservations WHERE request_id=?').run(item.request_id);
  }
  for(const context of contexts()){
   const value=await startWorker(context);
   const pending=reservations().filter(item=>item.context_id===context.id&&item.phase==='submitting');
   for(const item of pending){
    const intent=await inspectIntent(context,item.request_id);
    if(!intent){db.prepare('DELETE FROM reservations WHERE request_id=?').run(item.request_id);continue;}
    assert.equal(intent.genesis.toLowerCase(),genesis,'Recovered intent belongs to another network');
    if(intent.state==='committed')releaseReservation(item.request_id);
    else db.prepare("UPDATE reservations SET phase='journaled',tx_hash=? WHERE request_id=?").run(intent.txHash,item.request_id);
   }
   await seedUnresolved(context);
   for(const item of reservations().filter(row=>row.context_id===context.id&&row.phase==='journaled')){
    const intent=await inspectIntent(context,item.request_id);
    assert(intent,'A reserved journal entry is missing from its Pocket journal; cross-Pocket work is locked for safety');
    if(intent.state==='committed')releaseReservation(item.request_id);
    else {assert.equal(intent.genesis.toLowerCase(),genesis);assert.equal(intent.pocket.toLowerCase(),item.pocket);}
   }
   void value;
  }
 }
 async function expirePrepared(){
  const cutoff=Date.now()-30000;
  for(const item of reservations().filter(row=>row.phase==='prepared'&&row.expires<cutoff)){
   const context=getContext(item.context_id),value=context?workers.get(context.id):null;
   if(value)try{await workerRequest(value,'POST','/api/internal/cancel',{id:item.request_id});}catch{}
   if(item.operation==='genesis')db.prepare('UPDATE contexts SET pocket=NULL WHERE id=? AND kind=\'draft\' AND NOT EXISTS (SELECT 1 FROM reservations WHERE context_id=? AND phase IN (\'submitting\',\'journaled\'))').run(item.context_id,item.context_id);
   db.prepare('DELETE FROM reservations WHERE request_id=? AND phase=\'prepared\'').run(item.request_id);pendingRequests.delete(item.request_id);
  }
 }
 async function reservePrepared(context,body,result,isGenesis){
  const parsed=parseInputs(result.transaction),id=body.id;
  assert(uuidPattern.test(id||''),'Invalid signing request identity');
  let pocket;
  if(isGenesis){
   const output=parsed.transaction.outputs.find(item=>item.type&&item.type.codeHash.toLowerCase()===Q&&item.type.hashType==='data2');
   assert(output?.type&&/^0x[0-9a-f]{64}$/i.test(output.type.args),'Prepared genesis has no QCN4 policy identity');
   pocket=scriptHash(output.type);
   const existing=getPocket(pocket);assert(!existing||existing.id===context.id,'Pocket identity is already assigned to another runtime context');
  }else{
   assert(pocketPattern.test(body.pocket||''),'Pocket identity is required for this transaction');
   pocket=body.pocket.toLowerCase();assert.equal(context.pocket,pocket,'Prepared transaction is bound to another Pocket context');
  }
  acquireReservation({id,context,pocket,inputs:parsed.inputs,operation:isGenesis?'genesis':body.operation||'pay'});
  if(isGenesis){try{db.prepare('UPDATE contexts SET pocket=? WHERE id=?').run(pocket,context.id);}catch(error){releaseReservation(id);throw error;}}
 }
 async function prepare(context,pathname,body,isGenesis){
  const result=await workerJson(context,'POST',pathname,body);
  if(result.status!==200)return result;
  try{await reservePrepared(context,body,result.data,isGenesis);}
  catch(error){try{await workerJson(context,'POST','/api/internal/cancel',{id:body.id});}catch{}throw error;}
  return result;
 }
 function validOuterOrigin(value){if(!value)return true;try{const parsed=new URL(value);return parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1';}catch{return false;}}
 async function proxyResult(res,result){res.writeHead(result.status,{'content-type':result.contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(result.text);}
 async function proxyState(res,result){
  if(result.status===200&&result.contentType.includes('json'))result.text=JSON.stringify({...JSON.parse(result.text),multiPocket:true});
  await proxyResult(res,result);
 }

 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!==`127.0.0.1:${port}`)throw new Error('Invalid host');
   if(!validOuterOrigin(req.headers.origin))throw new Error('Invalid browser origin');
   const url=new URL(req.url,origin);
   if(!url.pathname.startsWith('/api/')){res.writeHead(404);res.end('Not found');return;}
   if(req.method==='POST'&&genesisAcceptanceOnly)assertGenesisAcceptanceRoute(url.pathname);
   if(req.method==='POST'&&networkMode==='pudge-prepare-only'&&!['/api/ckb','/api/reconcile','/api/external/genesis'].includes(url.pathname))throw new Error('Pudge preparation-only mode permits genesis review, not wallet signing or transaction submission');
   if(req.method==='GET'&&url.pathname==='/api/state'){
    const pocket=url.searchParams.get('pocket'),actor=url.searchParams.get('actor');
    if(pocket&&!actor){sendJson(res,200,{connectRequired:true,pocket,genesis,networkMode,multiPocket:true});return;}
    if(pocket&&actor){const context=await contextForPocket(pocket,actor);const result=await workerJson(context,'GET',`/api/state?actor=${encodeURIComponent(actor)}&selected=1`);await proxyState(res,result);return;}
    const result=await workerJson(rootContext,'GET',req.url);await proxyState(res,result);return;
   }
   if(req.method==='POST'&&url.pathname==='/api/ckb'){const body=await readJson(req,65536);const result=await workerJson(rootContext,'POST','/api/ckb',body);await proxyResult(res,result);return;}
   if(req.method==='POST'&&url.pathname.startsWith('/api/internal/')){sendJson(res,404,{error:'Not found'});return;}
   if(req.method==='POST'&&url.pathname==='/api/external/genesis'){
    const body=await readJson(req);const context=await contextForDraft(body.draftId,body.publicKey);const result=await prepare(context,'/api/external/genesis',body,true);await proxyResult(res,result);return;
   }
   if(req.method==='POST'&&url.pathname==='/api/external/submit'){
    const body=await readJson(req);const reservation=getReservation(body.id),reserved={...reservation},contextId=pendingRequests.get(body.id);
    if(!reservation||!contextId||reservation.context_id!==contextId||reservation.phase!=='prepared'){
     const existing=await findIntent(body.id);
     if(existing){sendJson(res,200,intentOutcome(existing.intent));return;}
     if(reservation?.phase==='submitting'){
      sendJson(res,200,{txHash:signedHash(body.transaction)||reservation.tx_hash||undefined,state:'uncertain',phase:'submit',error:'This transaction submission is still being processed.'});return;
     }
     if(reservation?.phase==='journaled')throw new Error('A saved transaction intent needs reconciliation before another submission.');
     if(contextId){const staleContext=getContext(contextId);if(staleContext)try{await workerJson(staleContext,'POST','/api/internal/cancel',{id:body.id});}catch{}pendingRequests.delete(body.id);}
     sendNotSubmitted(res,'This wallet request expired or was already used before submission. No transaction was sent.',signedHash(body.transaction));return;
    }
    if(genesisAcceptanceOnly)assertGenesisAcceptanceOperation(reserved.operation);
    db.prepare("UPDATE reservations SET phase='submitting' WHERE request_id=? AND phase='prepared'").run(body.id);
    const context=getContext(contextId);let result;
    try{result=await workerJson(context,'POST','/api/external/submit',body);}
    catch(error){
     let intent;try{intent=await inspectIntent(context,body.id);}catch{}
     if(intent){db.prepare("UPDATE reservations SET phase='journaled',tx_hash=? WHERE request_id=?").run(intent.txHash,body.id);pendingRequests.delete(body.id);sendJson(res,200,intentOutcome(intent));return;}
     sendJson(res,200,{txHash:signedHash(body.transaction),state:'uncertain',phase:'submit',error:error?.message||String(error)});return;
    }
    if(result.status!==200){
     const intent=await inspectIntent(context,body.id);
     if(intent)db.prepare("UPDATE reservations SET phase='journaled',tx_hash=? WHERE request_id=?").run(intent.txHash,body.id);
     else {releaseReservation(body.id);sendNotSubmitted(res,result.data?.error||'The transaction was rejected before submission. No transaction was sent.',signedHash(body.transaction));return;}
     pendingRequests.delete(body.id);sendJson(res,200,intentOutcome(intent));return;
    }
    pendingRequests.delete(body.id);
    if(result.data.state==='committed')releaseReservation(body.id);
    else {
     const intent=await inspectIntent(context,body.id);
     if(intent)db.prepare("UPDATE reservations SET phase='journaled',tx_hash=? WHERE request_id=?").run(intent.txHash,body.id);
     else db.prepare("UPDATE reservations SET phase='submitting',tx_hash=? WHERE request_id=?").run(result.data.txHash||null,body.id);
    }
    if(reserved.operation==='genesis'&&result.data.state==='committed'){
     const health=await workerJson(context,'GET','/api/internal/health');
     assert.equal(health.data.pocket?.toLowerCase(),reserved.pocket,'Committed Pocket descriptor does not match the prepared identity');
     result.data={...result.data,pocket:reserved.pocket};
    }
    result.text=JSON.stringify(result.data);await proxyResult(res,result);return;
   }
   if(req.method==='POST'&&url.pathname==='/api/external/retry'){
    const body=await readJson(req),context=await contextForPocket(body.pocket,body.publicKey);const result=await workerJson(context,'POST','/api/external/retry',body);await proxyResult(res,result);return;
   }
   if(req.method==='POST'&&url.pathname==='/api/reconcile'){
    const body=await readJson(req);
    const selected=body.pocket?getPocket(body.pocket):null;
    if(body.pocket)assert(selected,'Pocket journal is not installed in this runtime');
    const targets=selected?[selected]:contexts(),outcomes=[];
    for(const context of targets){const result=await workerJson(context,'POST','/api/reconcile',{});assert.equal(result.status,200,result.data?.error||'Pocket reconciliation failed');outcomes.push(...(result.data.outcomes||[]).map(item=>({...item,pocket:context.pocket})));}
    for(const item of reservations().filter(row=>['journaled','submitting'].includes(row.phase))){
     const context=getContext(item.context_id);if(!context||selected&&context.id!==selected.id)continue;
     const intent=await inspectIntent(context,item.request_id);if(intent?.state==='committed')releaseReservation(item.request_id);
    }
    sendJson(res,200,{outcomes});return;
   }
   if(req.method==='POST'&&['/api/external/prepare','/api/external/owner'].includes(url.pathname)){
    const body=await readJson(req);assert(pocketPattern.test(body.pocket||''),'Pocket identity is required for this transaction');
    const context=getPocket(body.pocket);assert(context,'Pocket context is not installed; reopen the Pocket from verified discovery');
    const result=await prepare(context,url.pathname,body,false);await proxyResult(res,result);return;
   }
   if(req.method==='POST'&&['/api/pay','/api/owner'].includes(url.pathname))throw new Error('Development signing routes are unavailable through the multi-Pocket supervisor');
   sendJson(res,404,{error:'Not found'});
  }catch(error){sendJson(res,400,{error:error?.message||String(error)});}
 });
 try{
  await recoverReservations();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 }catch(error){
  for(const value of workers.values())await stopWorker(value);
  db.close();runtimeLock.release();throw error;
 }
 const timer=setInterval(()=>{void expirePrepared().catch(error=>console.error(`Pocket reservation sweep failed: ${error.message}`));},15000);timer.unref();
 async function close(){if(stopping)return;stopping=true;clearInterval(timer);await new Promise(resolve=>server.close(resolve));for(const value of workers.values())await stopWorker(value);db.close();runtimeLock.release();process.removeListener('SIGINT',onSigint);process.removeListener('SIGTERM',onSigterm);}
 const onSigint=()=>{void close().then(()=>process.exit(0));},onSigterm=()=>{void close().then(()=>process.exit(0));};
 process.once('SIGINT',onSigint);process.once('SIGTERM',onSigterm);
 console.log(`QuotaCell multi-Pocket supervisor: ${origin}`);
 return {server,close,root,port};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [, ,run,portArg]=process.argv;
 startPocketSupervisor({run,port:Number(portArg||4173)}).catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
}
