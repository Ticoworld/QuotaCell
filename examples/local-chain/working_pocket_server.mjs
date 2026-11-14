// Disposable local development only. Never use with real keys or funds.
import * as c from '@ckb-ccc/core';
import {DatabaseSync} from 'node:sqlite';
import {observePublicTransaction,rebroadcastExistingTransaction,submitPublicTransaction} from './pocket_public_tx.mjs';
import {recoverCreation,submitDurableCreation} from './pocket_creation_recovery.mjs';
import {callRpc} from './pocket_rpc_retry.mjs';
import {verifyNetwork} from './pocket_network.mjs';
import {parseCkb,recipientArgs} from './pocket_input.mjs';
import {buildGenesis} from './pocket_genesis.mjs';
import {discoverIndexed,discoverIndexedWithRetry,withIndexedTipRetry} from './pocket_indexed_discovery.mjs';
import {discoverPolicy} from './pocket_discovery.mjs';
import {discoverPlainCells} from './pocket_cell_discovery.mjs';
import {buildPayment} from './pocket_payment.ts';
import {signWithCkbWallet,verifyWalletTransaction} from './pocket_signing.mjs';
import {build} from 'esbuild';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const developmentSigner=process.env.QUOTACELL_DEV_SIGNER==='1';
const run=path.resolve(process.argv[2]||'');
const port=Number(process.argv[3]||4173);
assert(Number.isInteger(port)&&port>1024&&port<65536);
const origin=`http://127.0.0.1:${port}`;
const load=async name=>JSON.parse(await fs.readFile(path.join(run,name+'.json'),'utf8'));
const optional=async name=>{try{return await load(name);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const [runtime,profile,deployment]=await Promise.all([load('runtime'),load('evidence/node-profile'),optional('deployment')]);
let initial=developmentSigner?await optional('context'):null;
let actors=developmentSigner?await optional('actors'):null;
let descriptor=await optional('pocket');
if(!initial&&descriptor){initial=descriptor.initial;actors=descriptor.actors;}
assert(Boolean(initial)===Boolean(actors),'Development context and actors must be supplied together');
const environment=deployment||initial;
assert(environment,'A public deployment.json is required when no development Pocket exists');
const networkMode=process.env.QUOTACELL_NETWORK||'isolated';
const rpcUrl=process.env.QUOTACELL_TEST_RPC_PROXY||runtime.url;
assert(!process.env.QUOTACELL_TEST_RPC_PROXY||networkMode==='isolated','The test RPC proxy is restricted to isolated chains');
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const hashes={A:'0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1',F:'0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a',Q:'0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e',Kcode:'0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649',Kdata:'0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4'};
const buf=h=>Buffer.from(h.slice(2),'hex');
const hex=b=>'0x'+Buffer.from(b).toString('hex');
const num=n=>'0x'+BigInt(n).toString(16);
const point=p=>({tx_hash:p.txHash,index:num(p.index)});
const script=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
const raw=tx=>({version:num(tx.version),cell_deps:tx.cellDeps.map(d=>({out_point:point(d.outPoint),dep_type:d.depType==='depGroup'?'dep_group':d.depType})),header_deps:[],inputs:tx.inputs.map(i=>({since:num(i.since),previous_output:point(i.previousOutput)})),outputs:tx.outputs.map(o=>({capacity:num(o.capacity),lock:script(o.lock),type:o.type?script(o.type):null})),outputs_data:tx.outputsData,witnesses:tx.witnesses});
let rid=0;
async function rpc(method,params=[]){
 return callRpc(method,async()=>{
  const res=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rid,method,params}),signal:AbortSignal.timeout(method==='get_live_cell'?30000:15000)});
  const x=await res.json();if(x.error)throw Object.assign(new Error(JSON.stringify(x.error)),{rpc:x.error,retryable:false});return x.result;
 });
}
async function live(p){const x=await rpc('get_live_cell',[point(p),true]);assert.equal(x.status,'live','Input is stale');return {...x,outPoint:p};}
async function verifyEnvironment(){
 await verifyNetwork({mode:networkMode,url:rpcUrl,rpc,expectedGenesis:profile.genesisHeader.hash,developmentSigner});
 for(const n of ['A','F','Q']){const x=await live(environment.deployed[n]);assert.equal(c.hashCkb(buf(x.cell.data.content)),hashes[n],`Wrong ${n} dependency`);}
 const group=await live(environment.kdep.outPoint),data=buf(group.cell.data.content);assert.equal(data.length,76);assert.equal(data.readUInt32LE(0),2,'Invalid K dependency group');
 const members=[0,1].map(j=>({txHash:hex(data.subarray(4+j*36,36+j*36)),index:data.readUInt32LE(36+j*36)}));
 for(const [i,n] of ['Kdata','Kcode'].entries()){const x=await live(members[i]);assert.equal(c.hashCkb(buf(x.cell.data.content)),hashes[n]);if(n==='Kcode'){const t=x.cell.output.type;assert(t);assert.equal(c.Script.from({codeHash:t.code_hash,hashType:t.hash_type,args:t.args}).hash(),K);}}
 assert.deepEqual(environment.allDeps,[environment.kdep,...['A','F','Q'].map(n=>({outPoint:environment.deployed[n],depType:'code'}))]);
}
const db=new DatabaseSync(path.join(run,'working-pocket.sqlite'));
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, genesis TEXT NOT NULL, pocket TEXT NOT NULL, actor TEXT NOT NULL, recipient TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT NOT NULL, signed TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'intent-persisted')");
if(!db.prepare('PRAGMA table_info(intents)').all().some(x=>x.name==='operation'))db.exec("ALTER TABLE intents ADD COLUMN operation TEXT NOT NULL DEFAULT 'pay'");
if(!db.prepare('PRAGMA table_info(intents)').all().some(x=>x.name==='recovery_json'))db.exec('ALTER TABLE intents ADD COLUMN recovery_json TEXT');
if(!db.prepare('PRAGMA table_info(intents)').all().some(x=>x.name==='phase'))db.exec("ALTER TABLE intents ADD COLUMN phase TEXT NOT NULL DEFAULT 'legacy-unknown'");
const insert=db.prepare('INSERT INTO intents (id,genesis,pocket,actor,recipient,amount,tx_hash,signed,state,created,phase,operation,recovery_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
const rows=()=>db.prepare('SELECT * FROM intents ORDER BY rowid').all();
const update=db.prepare('UPDATE intents SET state=? WHERE id=?');
const updatePhase=db.prepare('UPDATE intents SET phase=? WHERE id=?');
await verifyEnvironment();
let busy=false;
const requests=new Map();
const walletBundle=(await build({entryPoints:[path.join(here,'working_pocket_wallet.mjs')],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome110'})).outputFiles[0].contents;
async function canonicalCommit(tx){if(tx?.tx_status?.status!=='committed')return false;const header=await rpc('get_header',[tx.tx_status.block_hash]);return !!header && await rpc('get_block_hash',[header.number])===header.hash;}
async function snapshot({currentIntent}={}){
 assert(initial&&actors,'No Pocket is open');
 const state=structuredClone(initial);let unresolved=false;
 let indexedTip=null;
 if(initial.expected){
  const expectedKeys=[initial.expected.ownerPublicKey,...initial.expected.delegates.map(d=>d.publicKey)];
  for(const [i,role] of ['owner','alice','ben'].entries()){assert.equal(actors[role].publicKey,expectedKeys[i],'Pocket actor identity mismatch');assert(c.Script.from(actors[role].lock).eq(lockFor(expectedKeys[i])),'Pocket actor lock mismatch');}
  assert(c.Script.from(initial.F).eq(c.Script.from({codeHash:hashes.F,hashType:'data1',args:c.Script.from(initial.Q).hash()})),'Pocket fund identity mismatch');
  let found,fundCells,ownerCells,aliceCells,benCells,unsupportedFunds=[];
  if(networkMode==='isolated'){
   found=await discoverPolicy({rpc,policy:initial.Q,expected:initial.expected});
   const results=await Promise.all([initial.F,actors.owner.lock,actors.alice.lock,actors.ben.lock].map((lock,i)=>discoverPlainCells({rpc,lock,includeUnsupported:i===0})));[fundCells,ownerCells,aliceCells,benCells]=results.map(r=>r.cells);unsupportedFunds=results[0].unsupported;
  }else{
   const results=await withIndexedTipRetry(async()=>{
    const indexedSnapshot=await rpc('get_indexer_tip');
    const scans=[discoverIndexed({rpc,policy:initial.Q,expected:initial.expected,indexedSnapshot}),...[initial.F,actors.owner.lock,actors.alice.lock,actors.ben.lock].map((lock,i)=>discoverIndexed({rpc,lock,includeUnsupported:i===0,indexedSnapshot}))];
    const found=await Promise.all(scans),tip=found[0].indexedTip;for(const result of found)assert.deepEqual(result.indexedTip,tip,'Indexed snapshots differ');return found;
   });
   indexedTip=results[0].indexedTip;
   found=results[0].cells[0];[fundCells,ownerCells,aliceCells,benCells]=results.slice(1).map(r=>r.cells);unsupportedFunds=results[1].unsupported;
  }
  state.policy={txHash:found.outPoint.tx_hash,index:Number(BigInt(found.outPoint.index))};
  const points=cells=>cells.sort((a,b)=>BigInt(a.cell.output.capacity)>BigInt(b.cell.output.capacity)?-1:1).map(x=>({txHash:x.outPoint.tx_hash,index:Number(BigInt(x.outPoint.index))}));
  state.unsupportedFunds=unsupportedFunds.map(x=>({outPoint:x.outPoint,capacity:x.cell.output.capacity,hasType:!!x.cell.output.type,dataBytes:(x.cell.data.content.length-2)/2}));const funds=points(fundCells);state.funds=funds;state.fund=funds[0]||null;
  state.ownerFee=points(ownerCells)[0];state.seeds.alice=points(aliceCells)[0];state.seeds.ben=points(benCells)[0];
 }

 let skippedCurrentIntent=false;
 for(const item of rows()){
  if(currentIntent&&item.id===currentIntent.id){
   assert(!skippedCurrentIntent,'Duplicate current intent id');
   assert.equal(item.tx_hash,currentIntent.txHash,'Persisted transaction hash changed');
   assert.equal(item.signed,currentIntent.signedJson,'Persisted signed transaction changed');
   assert.equal(item.operation,currentIntent.operation,'Persisted operation changed');
   skippedCurrentIntent=true;continue;
  }
  assert.equal(item.genesis,profile.genesisHeader.hash);assert.equal(item.pocket,c.Script.from(initial.Q).hash());
  if(initial.expected){if(networkMode==='pudge'){const result=await observePublicTransaction({rpc,hash:item.tx_hash,signed:JSON.parse(item.signed),priorState:item.state});update.run(result.state,item.id);if(result.state!=='committed')unresolved=true;}else{const tx=await rpc('get_transaction',[item.tx_hash]);if(await canonicalCommit(tx))update.run('committed',item.id);else unresolved=true;}continue;}
  if(item.operation==='genesis')continue;
  const tx=await rpc('get_transaction',[item.tx_hash]);const status=tx?.tx_status?.status||'unknown';
  if(status==='committed' && await canonicalCommit(tx)){
   update.run('committed',item.id);
   if(item.operation==='pay'){state.policy={txHash:item.tx_hash,index:0};state.fund={txHash:item.tx_hash,index:1};const role=item.actor===actors.alice.publicKey?'alice':item.actor===actors.ben.publicKey?'ben':null;assert(role,'Unknown journal actor');state.seeds[role]={txHash:item.tx_hash,index:3};}
   else if(item.operation==='revoke'){state.policy={txHash:item.tx_hash,index:0};state.ownerFee={txHash:item.tx_hash,index:1};}
   else if(item.operation==='close'||item.operation==='sweep'){state.policy={txHash:item.tx_hash,index:0};state.fund=null;state.ownerFee={txHash:item.tx_hash,index:2};}
   else if(item.operation==='deposit'){state.fund={txHash:item.tx_hash,index:0};state.ownerFee={txHash:item.tx_hash,index:1};}
   else throw new Error('Unknown journal operation');
  }else{update.run('uncertain',item.id);unresolved=true;}
 }
 if(currentIntent)assert(skippedCurrentIntent,'Current persisted intent is missing from the journal');
 const p=await live(state.policy),fs=await Promise.all((state.funds||[state.fund].filter(Boolean)).map(live)),f=fs[0]||null,s=buf(p.cell.data.content),closed=s.length===28;
 const ps=p.cell.output.type;assert(ps,'Missing policy type');const actualPolicy=c.Script.from({codeHash:ps.code_hash,hashType:ps.hash_type,args:ps.args});assert(actualPolicy.eq(c.Script.from(initial.Q)),'Policy identity mismatch');
 const pl=p.cell.output.lock;assert(c.Script.from({codeHash:pl.code_hash,hashType:pl.hash_type,args:pl.args}).eq(c.Script.from({codeHash:hashes.A,hashType:'data1',args:'0x'})),'Policy lock mismatch');
 for(const f of fs){const fl=f.cell.output.lock;const expected=c.Script.from({codeHash:hashes.F,hashType:'data1',args:actualPolicy.hash()});assert(c.Script.from({codeHash:fl.code_hash,hashType:fl.hash_type,args:fl.args}).eq(expected),'Fund policy identity mismatch');assert(!f.cell.output.type&&f.cell.data.content==='0x','Unsupported fund cell');}
 if(closed)assert.equal(s.subarray(0,8).toString('hex'),'5143543404000100');else {assert.equal(s.length,466);assert.equal(s.subarray(0,6).toString('hex'),'51434e340400');}
 const u=o=>s.readBigUInt64LE(o)+(s.readBigUInt64LE(o+8)<<64n);
 const delegates=['alice','ben'].map((role,i)=>{if(closed)return {role,limit:'0',used:'0',perPayment:'0',enabled:false,recipient:'',publicKey:''};const o=158+154*i;return {role,limit:u(o+106).toString(),used:u(o+122).toString(),perPayment:u(o+138).toString(),enabled:Boolean(s[7]&(1<<i)),recipient:c.Script.fromBytes(s.subarray(o+33,o+106)).args,publicKey:hex(s.subarray(o,o+33))};});
 return {state,p,f,fs,unresolved,closed,view:{unsupportedFunds:state.unsupportedFunds||[],networkMode,indexedTip,pocket:c.Script.from(initial.Q).hash(),genesis:profile.genesisHeader.hash,owner:actors.owner.publicKey,policyOutpoint:state.policy,fundShannons:fs.reduce((n,x)=>n+BigInt(x.cell.output.capacity),0n).toString(),fundOccupiedShannons:(BigInt(fs.length)*7300000000n).toString(),sharedLimit:closed?'0':u(8).toString(),sharedUsed:closed?'0':u(24).toString(),delegates,closed,hasFund:!!f,policyCapacity:p.cell.output.capacity,history:rows().map(({id,tx_hash,state,amount,recipient,created,actor,operation})=>({id,tx_hash,state,amount,recipient,created,actor,operation})),unresolved}};
}
async function creationRecoveryState(){
 const item=rows().findLast(x=>x.operation==='genesis');if(!item)return null;
 const recovered=await recoverCreation({item,operationInProgress:busy,observe:async row=>{const result=await observePublicTransaction({rpc,hash:row.tx_hash,signed:JSON.parse(row.signed),priorState:row.state});update.run(result.state,row.id);return result;},descriptorMatches:value=>!descriptor||JSON.stringify(descriptor)===JSON.stringify(value),writeDescriptor:async value=>{if(!descriptor){const file=path.join(run,'pocket.json'),temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(value));await fs.rename(temp,file);descriptor=value;}initial=value.initial;actors=value.actors;}});
 if(recovered.ready)return null;
 return {empty:false,recoveryRequired:true,unresolved:true,genesis:profile.genesisHeader.hash,networkMode,creationRecovery:{txHash:item.tx_hash,state:recovered.outcome.state,reason:recovered.outcome.reason||'',recoveryAvailable:!!item.recovery_json}};
}
const lockFor=publicKey=>c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(buf(publicKey)).slice(0,42)});
async function selectedFee(){if(networkMode==='isolated')return 2000n;const f=await rpc('get_fee_rate_statistics',['0x65']);assert(f?.median,'Fee statistics unavailable');const fee=BigInt(f.median)*8n;assert(fee>0n&&fee<=1000000n,'Current fee exceeds policy bound');return fee;}
async function transactionFee(tx){let total=0n;for(const i of tx.inputs){const cell=await live(i.previousOutput);total+=BigInt(cell.cell.output.capacity);}return (total-tx.outputs.reduce((sum,o)=>sum+o.capacity,0n)).toString();}
async function prepareGenesis(body){
 assert(!busy,'Another action is in progress');busy=true;
 try{
  assert(!initial&&!rows().some(x=>x.operation==='genesis'),'A Pocket creation already exists');assert.match(body.id||'',/^[0-9a-f-]{36}$/);
  assert(!requests.has(body.id),'Intent already exists');assert(requests.size<128,'Too many outstanding signing requests');
  await verifyEnvironment();
  const found=networkMode==='isolated'?await discoverPlainCells({rpc,lock:lockFor(body.publicKey)}):await discoverIndexedWithRetry({rpc,lock:lockFor(body.publicKey)});
  const candidate=found.cells.find(x=>BigInt(x.cell.output.capacity)>=66100002000n);assert(candidate,'Owner needs a plain cell covering policy capacity and change');
  const ownerInput=await live({txHash:candidate.outPoint.tx_hash,index:Number(BigInt(candidate.outPoint.index))});
  const built=buildGenesis({ownerPublicKey:body.publicKey,delegates:body.delegates,sharedLimit:body.sharedLimit,ownerInput,deps:environment.allDeps,fee:await selectedFee()});
  const tx=built.transaction,client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}),info=await tx.getSignHashInfo(lockFor(body.publicKey),client);
  const next={...environment,Q:{codeHash:built.policy.codeHash,hashType:built.policy.hashType,args:built.policy.args},F:{codeHash:hashes.F,hashType:'data1',args:built.policy.hash()},policy:{txHash:tx.hash(),index:0},ownerFee:{txHash:tx.hash(),index:1},fund:null,seeds:{},expected:{ownerPublicKey:body.publicKey,delegates:body.delegates,sharedLimit:body.sharedLimit}};
  const identities=Object.fromEntries([['owner',body.publicKey],...body.delegates.map((d,i)=>[i?'ben':'alice',d.publicKey])].map(([role,publicKey])=>[role,{publicKey,lock:JSON.parse(JSON.stringify(lockFor(publicKey)))}]));
  requests.set(body.id,{bytes:tx.toHex(),message:info.message,position:0,publicKey:body.publicKey,points:[ownerInput.outPoint],pocket:built.policy.hash(),amount:'0',recipient:lockFor(body.publicKey).args,operation:'genesis',expires:Date.now()+300000,next,identities});
  return {id:body.id,transaction:tx.toHex(),publicKey:body.publicKey,genesis:profile.genesisHeader.hash,fee:await transactionFee(tx)};
 }finally{busy=false;}
}
async function prepareExternal(body){
 assert(!busy,'Another action is in progress');busy=true;
 try{
  for(const [id,request] of requests)if(request.expires<=Date.now())requests.delete(id);
  assert(requests.size<128,'Too many outstanding signing requests');
  assert.match(body.id||'',/^[0-9a-f-]{36}$/);body.recipient=await recipientArgs(body.recipient,new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}));
  assert(['alice','ben'].includes(body.role),'Unknown delegate');assert(!requests.has(body.id)&&!rows().some(x=>x.id===body.id),'Intent already exists');
  await verifyEnvironment();const snap=await snapshot();assert(!snap.unresolved,'An earlier outcome is uncertain');
  const grant=snap.view.delegates.find(d=>d.role===body.role);assert.equal(body.recipient,grant.recipient,'Recipient changed');
  assert.equal(body.publicKey,grant.publicKey,'Connected account is not the selected delegate');
  const actor=await live(snap.state.seeds[body.role]),amount=parseCkb(body.amount);
  const tx=buildPayment({policy:snap.p,actor,funds:snap.fs,deps:environment.allDeps,delegate:body.role==='alice'?0:1,amount,fee:await selectedFee()});
  const client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]});const lock=c.Script.from(actors[body.role].lock),info=await tx.getSignHashInfo(lock,client);assert.equal(info.position,1);
  const record={bytes:tx.toHex(),message:info.message,position:info.position,publicKey:grant.publicKey,points:[snap.state.policy,snap.state.seeds[body.role],...snap.state.funds||[snap.state.fund]],pocket:snap.view.pocket,amount:amount.toString(),recipient:body.recipient,operation:'pay',expires:Date.now()+300000};
  requests.set(body.id,record);return {id:body.id,transaction:record.bytes,publicKey:record.publicKey,genesis:profile.genesisHeader.hash,fee:await transactionFee(tx)};
 }finally{busy=false;}
}
async function submitExternal(body){
 assert(!busy,'Another action is in progress');busy=true;
 try{
  if(networkMode==='pudge')assert.equal(process.env.QUOTACELL_PUDGE_BROADCAST,'1','Pudge broadcasting is disabled');
  const request=requests.get(body.id);assert(request,'Unknown or expired signing request');requests.delete(body.id);assert(Date.now()<request.expires,'Signing request expired');
  assert.match(body.transaction||'',/^0x[0-9a-f]+$/i);assert(body.transaction.length<200000,'Signed transaction too large');
  const prepared=c.Transaction.fromBytes(request.bytes),signed=c.Transaction.fromBytes(body.transaction);
  verifyWalletTransaction({prepared,signed,message:request.message,publicKey:request.publicKey,position:request.position});
  const signedRaw=raw(signed);
  if(request.operation==='genesis')assert(!initial,'A Pocket is already open');
  if(request.operation!=='genesis'){
   await verifyEnvironment();
   const before=await snapshot();
   assert(!before.unresolved,'An earlier outcome is uncertain');
   assert.equal(before.view.pocket,request.pocket,'Pocket changed after transaction preparation');
   for(const p of request.points)await live(p);
  }
  const recovery=request.operation==='genesis'?JSON.stringify({initial:request.next,actors:request.identities}):null;
  const persistIntent=()=>{db.exec('BEGIN IMMEDIATE');try{assert(!rows().some(x=>x.state!=='committed'),'An outcome is uncertain');if(request.operation==='genesis')assert(!rows().some(x=>x.operation==='genesis'),'A Pocket creation already exists');insert.run(body.id,profile.genesisHeader.hash,request.pocket,request.publicKey,request.recipient,request.amount,signed.hash(),JSON.stringify(signedRaw),'uncertain',new Date().toISOString(),'intent-persisted',request.operation,recovery);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};
  const dryRun=async()=>{
   await verifyEnvironment();
   if(request.operation!=='genesis'){const snap=await snapshot({currentIntent:{id:body.id,txHash:signed.hash(),signedJson:JSON.stringify(signedRaw),operation:request.operation}});assert(!snap.unresolved,'An earlier outcome is uncertain');assert.equal(snap.view.pocket,request.pocket);}
   for(const p of request.points)await live(p);
   if(networkMode==='pudge'){const f=await rpc('get_fee_rate_statistics',['0x65']);const minimum=(BigInt(signed.toBytes().length)*BigInt(f.median)+999n)/1000n;assert(BigInt(await transactionFee(signed))>=minimum,'Fee below current median');}
   await rpc('dry_run_transaction',[signedRaw]);
  };
  const submitted=await submitDurableCreation({persistIntent,dryRun,checkpoint:async phase=>updatePhase.run(phase,body.id),submit:async()=>networkMode==='pudge'?submitPublicTransaction({rpc,hash:signed.hash(),signed:signedRaw,enabled:process.env.QUOTACELL_PUDGE_BROADCAST==='1'}):(assert.equal(await rpc('send_transaction',[signedRaw,'passthrough']),signed.hash()),{state:'submitted'})});
  if(submitted.state==='uncertain'){update.run('uncertain',body.id);return {txHash:signed.hash(),...submitted};}
  if(networkMode==='pudge'){update.run(submitted.state,body.id);return {txHash:signed.hash(),...submitted};}
  for(let i=0;i<20;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));if(await canonicalCommit(await rpc('get_transaction',[signed.hash()]))){update.run('committed',body.id);if(request.operation==='genesis'){const d={initial:request.next,actors:request.identities};await fs.writeFile(path.join(run,'pocket.json.tmp'),JSON.stringify(d));await fs.rename(path.join(run,'pocket.json.tmp'),path.join(run,'pocket.json'));initial=d.initial;actors=d.actors;}return {txHash:signed.hash(),state:'committed'};}}
  return {txHash:signed.hash(),state:'uncertain'};
 }finally{busy=false;}
}
async function retryExternal(body){
 assert(!busy,'Another action is in progress');busy=true;
 try{
  assert.equal(networkMode,'pudge','Same-transaction retry is only available on Pudge');
  assert.equal(process.env.QUOTACELL_PUDGE_BROADCAST,'1','Pudge broadcasting is disabled');
  assert.match(body.approvedHash||'',/^0x[0-9a-f]{64}$/i,'Invalid approved transaction hash');
  const item=rows().find(row=>row.tx_hash.toLowerCase()===body.approvedHash.toLowerCase());
  assert(item&&item.operation==='deposit','No journaled deposit matches this transaction');
  assert(['uncertain','submitted'].includes(item.state),'Transaction is not retryable');
  await verifyEnvironment();
  const signed=JSON.parse(item.signed);
  const result=await rebroadcastExistingTransaction({rpc,hash:item.tx_hash,signed,priorState:item.state,enabled:true,dryRun:()=>rpc('dry_run_transaction',[signed]),checkpoint:phase=>updatePhase.run(phase,item.id)});
  update.run(result.state,item.id);
  return {txHash:item.tx_hash,...result};
 }finally{busy=false;}
}
async function pay(body){
 assert(developmentSigner,'Development signer is disabled');
 if(busy)throw new Error('Another action is in progress');busy=true;
 try{
  assert.match(body.id||'',/^[0-9a-f-]{36}$/);body.recipient=await recipientArgs(body.recipient,new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}));
  assert(!rows().some(x=>x.id===body.id),'Intent already exists; reconcile the existing transaction');
  await verifyEnvironment();const snap=await snapshot();assert(!snap.unresolved,'An earlier outcome is uncertain; reconcile before another payment');
  assert(['alice','ben'].includes(body.role),'Unknown delegate');const grant=snap.view.delegates.find(d=>d.role===body.role);assert.equal(body.recipient,grant.recipient,'Recipient changed; review the live policy');
  const amount=parseCkb(body.amount);
  const actor=await live(snap.state.seeds[body.role]);const tx=buildPayment({policy:snap.p,actor,funds:snap.fs,deps:environment.allDeps,delegate:body.role==='alice'?0:1,amount,fee:await selectedFee()});
  assert.equal(tx.outputs[2].capacity,amount);assert.equal(tx.outputs[2].lock.args,body.recipient);
  const acp=await new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}).getKnownScript(c.KnownScript.AnyoneCanPay);
  const client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[],scripts:{[c.KnownScript.Secp256k1Blake160]:{codeHash:K,hashType:'type',cellDeps:[{cellDep:environment.kdep}]},[c.KnownScript.AnyoneCanPay]:acp}});
  const secret=await load('keys/'+body.role);const signer=new c.SignerCkbPrivateKey(client,secret.privateKey);assert.equal(signer.publicKey,actors[body.role].publicKey);
  const lock=c.Script.from(actors[body.role].lock),info=await tx.getSignHashInfo(lock,client);assert.equal(info.position,1);
  const signed=await signWithCkbWallet({signer,prepared:tx,actorLock:lock,publicKey:signer.publicKey,message:info.message,position:1});
  for(const p of [snap.state.policy,snap.state.seeds[body.role],...snap.state.funds||[snap.state.fund]])await live(p);
  const signedRaw=raw(signed);await rpc('dry_run_transaction',[signedRaw]);
  db.exec('BEGIN IMMEDIATE');try{assert(!rows().some(x=>x.state!=='committed'),'An outcome is uncertain');insert.run(body.id,profile.genesisHeader.hash,snap.view.pocket,signer.publicKey,body.recipient,amount.toString(),signed.hash(),JSON.stringify(signedRaw),'uncertain',new Date().toISOString(),'pay',null);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  try{assert.equal(await rpc('send_transaction',[signedRaw,'passthrough']),signed.hash());}catch(e){return {txHash:signed.hash(),state:'uncertain',error:e.message};}
  for(let i=0;i<20;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));const result=await rpc('get_transaction',[signed.hash()]);if(await canonicalCommit(result)){update.run('committed',body.id);return {txHash:signed.hash(),state:'committed'};}}
  return {txHash:signed.hash(),state:'uncertain'};
 }finally{busy=false;}
}
async function ownerAction(body,external=false){
 assert(external||developmentSigner,'Development signer is disabled');
 if(busy)throw new Error('Another action is in progress');busy=true;
 try{
  assert.match(body.id||'',/^[0-9a-f-]{36}$/);assert(['revoke','close','deposit','sweep'].includes(body.operation));assert(!requests.has(body.id)&&!rows().some(x=>x.id===body.id),'Intent already exists');if(external)assert.equal(body.publicKey,actors.owner.publicKey,'Connected account is not the owner');
  await verifyEnvironment();const snap=await snapshot();assert(!snap.unresolved,'An earlier outcome is uncertain');
  const op=body.operation,owner=await live(snap.state.ownerFee),ownerCap=BigInt(owner.cell.output.capacity),fee=await selectedFee();
  const old=buf(snap.p.cell.data.content),ownerLock=c.Script.from(actors.owner.lock),policyOut={capacity:BigInt(snap.p.cell.output.capacity),lock:c.Script.from({codeHash:snap.p.cell.output.lock.code_hash,hashType:snap.p.cell.output.lock.hash_type,args:snap.p.cell.output.lock.args}),type:c.Script.from(initial.Q)};
  const ownerInput=owner.cell.output.lock;assert(c.Script.from({codeHash:ownerInput.code_hash,hashType:ownerInput.hash_type,args:ownerInput.args}).eq(ownerLock)&&!owner.cell.output.type&&owner.cell.data.content==='0x','Owner fee cell mismatch');
  if(snap.closed)assert.equal(hex(old.subarray(8,28)),ownerLock.args,'Terminal owner mismatch');else assert.equal(hex(old.subarray(125,158)),actors.owner.publicKey,'Policy owner mismatch');
  let inputs,outputs,data,action,position,amount=0n;
  if(op==='revoke'){
   const role=body.role??'alice';assert(['alice','ben'].includes(role),'Invalid delegate');const mask=role==='alice'?1:2;assert(!snap.closed && (old[7]&mask),'Delegate is already revoked or pocket is closed');const next=Buffer.from(old);next[7]&=~mask;
   inputs=[snap.state.policy,snap.state.ownerFee];outputs=[policyOut,{capacity:ownerCap-fee,lock:ownerLock}];data=[hex(next),'0x'];action='0x5143413103ff0000'+mask.toString(16).padStart(2,'0');position=1;
  }else if(op==='close'){
   assert(!snap.closed&&snap.f,'An active funded pocket is required');const terminal=Buffer.concat([Buffer.from('5143543404000100','hex'),buf(actors.owner.lock.args)]);const released=policyOut.capacity-13400000000n;
   inputs=[snap.state.policy,snap.state.ownerFee,...(snap.state.funds||[snap.state.fund])];amount=snap.fs.reduce((n,x)=>n+BigInt(x.cell.output.capacity),0n);outputs=[{...policyOut,capacity:13400000000n},{capacity:amount,lock:ownerLock},{capacity:ownerCap+released-fee,lock:ownerLock}];data=[hex(terminal),'0x','0x'];action='0x5143413104ff0000';position=1;
  }else if(op==='deposit'){
   amount=parseCkb(body.amount);assert(amount>=7300000000n,'Deposit below occupied capacity');
   inputs=[snap.state.ownerFee];outputs=[{capacity:amount,lock:c.Script.from(initial.F)},{capacity:ownerCap-amount-fee,lock:ownerLock}];data=['0x','0x'];position=0;
  }else{
   assert(snap.closed&&snap.f,'No tracked late deposit');amount=snap.fs.reduce((n,x)=>n+BigInt(x.cell.output.capacity),0n);inputs=[snap.state.policy,snap.state.ownerFee,...(snap.state.funds||[snap.state.fund])];outputs=[policyOut,{capacity:amount,lock:ownerLock},{capacity:ownerCap-fee,lock:ownerLock}];data=[hex(old),'0x','0x'];action='0x5143413105ff0000';position=1;
  }
  assert(outputs.every(o=>o.capacity>=6100000000n),'Owner fee cell would be below occupied capacity');
  const deps=op==='deposit'?[environment.kdep]:environment.allDeps,tx=c.Transaction.from({inputs:inputs.map(previousOutput=>({previousOutput,since:0})),outputs,outputsData:data,cellDeps:deps,headerDeps:[],witnesses:inputs.map(()=> '0x')});
  tx.setWitnessArgs(position,{lock:'0x'+'00'.repeat(65),...(action?{inputType:action}:{})});
  const acp=await new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}).getKnownScript(c.KnownScript.AnyoneCanPay);
  const client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[],scripts:{[c.KnownScript.Secp256k1Blake160]:{codeHash:K,hashType:'type',cellDeps:[{cellDep:environment.kdep}]},[c.KnownScript.AnyoneCanPay]:acp}});
  const info=await tx.getSignHashInfo(ownerLock,client);assert.equal(info.position,position);
  if(external){
   for(const [id,request] of requests)if(request.expires<=Date.now())requests.delete(id);
   assert(requests.size<128,'Too many outstanding signing requests');
   const record={bytes:tx.toHex(),message:info.message,position,publicKey:actors.owner.publicKey,points:inputs,pocket:snap.view.pocket,amount:amount.toString(),recipient:actors.owner.lock.args,operation:op,expires:Date.now()+300000};
   requests.set(body.id,record);return {id:body.id,transaction:record.bytes,publicKey:record.publicKey,genesis:profile.genesisHeader.hash,fee:await transactionFee(tx)};
  }
  const secret=await load('keys/owner'),signer=new c.SignerCkbPrivateKey(client,secret.privateKey);assert.equal(signer.publicKey,actors.owner.publicKey);
  const signed=await signWithCkbWallet({signer,prepared:tx,actorLock:ownerLock,publicKey:signer.publicKey,message:info.message,position});for(const p of inputs)await live(p);
  const signedRaw=raw(signed);await rpc('dry_run_transaction',[signedRaw]);
  db.exec('BEGIN IMMEDIATE');try{assert(!rows().some(x=>x.state!=='committed'),'An outcome is uncertain');insert.run(body.id,profile.genesisHeader.hash,snap.view.pocket,signer.publicKey,actors.owner.lock.args,amount.toString(),signed.hash(),JSON.stringify(signedRaw),'uncertain',new Date().toISOString(),op,null);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  try{assert.equal(await rpc('send_transaction',[signedRaw,'passthrough']),signed.hash());}catch(e){return {txHash:signed.hash(),state:'uncertain',error:e.message};}
  for(let i=0;i<20;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));const result=await rpc('get_transaction',[signed.hash()]);if(await canonicalCommit(result)){update.run('committed',body.id);return {txHash:signed.hash(),state:'committed'};}}
  return {txHash:signed.hash(),state:'uncertain'};
 }finally{busy=false;}
}
const html=await fs.readFile(path.join(here,'working_pocket.html'));
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`)throw new Error('Invalid host');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'");
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;}
  if(req.method==='GET'&&req.url==='/wallet.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(walletBundle);return;}
  if(req.method==='POST'&&req.url==='/api/ckb'){
   assert.equal(req.headers.origin,origin,'Invalid origin');let body='';for await(const chunk of req){body+=chunk;assert(body.length<65536);}
   const call=JSON.parse(body);assert(['get_fee_rate_statistics','get_tip_header','get_live_cell','get_transaction','get_header','get_block_hash','get_consensus'].includes(call.method),'RPC method unavailable');
   const result=await rpc(call.method,call.params||[]);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));return;
  }
  if(req.method==='GET'&&req.url==='/api/state'){const recovery=await creationRecoveryState();const s=recovery?{view:recovery}:initial?await snapshot():{view:{empty:true,genesis:profile.genesisHeader.hash,developmentSigner,networkMode}};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(s.view));return;}
  if(req.method==='POST'&&networkMode==='pudge-readonly'&&!['/api/ckb','/api/reconcile'].includes(req.url))throw new Error('Pudge transactions are disabled pending dependency and wallet qualification');
  if(req.method==='POST'&&['/api/external/genesis','/api/external/prepare','/api/external/owner','/api/external/submit','/api/external/retry'].includes(req.url)){
   assert.equal(req.headers.origin,origin,'Invalid origin');assert.equal(req.headers['content-type'],'application/json');let body='';for await(const chunk of req){body+=chunk;assert(body.length<210000);}
   const input=JSON.parse(body);const result=await (req.url.endsWith('/genesis')?prepareGenesis(input):req.url.endsWith('/owner')?ownerAction(input,true):req.url.endsWith('/prepare')?prepareExternal(input):req.url.endsWith('/retry')?retryExternal(input):submitExternal(input));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
  }
  if(req.method==='POST'&&req.url==='/api/pay'){
   assert.equal(req.headers.origin,origin,'Invalid origin');assert.equal(req.headers['content-type'],'application/json');let body='';for await(const chunk of req){body+=chunk;assert(body.length<4096);}
   const result=await pay(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
  }
  if(req.method==='POST'&&req.url==='/api/owner'){
   assert.equal(req.headers.origin,origin,'Invalid origin');assert.equal(req.headers['content-type'],'application/json');let body='';for await(const chunk of req){body+=chunk;assert(body.length<4096);}
   const result=await ownerAction(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
  }
  if(req.method==='POST'&&req.url==='/api/reconcile'){
   assert.equal(req.headers.origin,origin,'Invalid origin');assert.equal(req.headers['content-type'],'application/json');assert(!busy,'Another action is in progress');busy=true;
   try{await verifyEnvironment();const outcomes=[];if(networkMode.startsWith('pudge')){for(const item of rows()){const result=await observePublicTransaction({rpc,hash:item.tx_hash,signed:JSON.parse(item.signed),priorState:item.state});update.run(result.state,item.id);outcomes.push({txHash:item.tx_hash,...result});}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({outcomes}));return;}for(const item of rows().filter(x=>x.state!=='committed')){let tx=await rpc('get_transaction',[item.tx_hash]);if(['pending','proposed'].includes(tx?.tx_status?.status)){for(let i=0;i<8;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));tx=await rpc('get_transaction',[item.tx_hash]);if(await canonicalCommit(tx))break;}}if(await canonicalCommit(tx))update.run('committed',item.id);outcomes.push({txHash:item.tx_hash,status:tx?.tx_status?.status||'unknown'});}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({outcomes}));}finally{busy=false;}return;
  }
  res.writeHead(404);res.end('Not found');
 }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Working Pocket ${networkMode}: ${origin}`));
