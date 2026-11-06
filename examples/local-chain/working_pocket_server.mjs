// Disposable local development only. Never use with real keys or funds.
import * as c from '@ckb-ccc/core';
import {DatabaseSync} from 'node:sqlite';
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
assert(Boolean(initial)===Boolean(actors),'Development context and actors must be supplied together');
const environment=deployment||initial;
assert(environment,'A public deployment.json is required when no development Pocket exists');
assert.match(runtime.url,/^http:\/\/127\.0\.0\.1:\d+$/);
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
 const res=await fetch(runtime.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rid,method,params}),signal:AbortSignal.timeout(15000)});
 const x=await res.json();if(x.error)throw Object.assign(new Error(JSON.stringify(x.error)),{rpc:x.error});return x.result;
}
async function live(p){const x=await rpc('get_live_cell',[point(p),true]);assert.equal(x.status,'live','Input is stale');return {...x,outPoint:p};}
async function verifyEnvironment(){
 assert.equal((await rpc('get_consensus')).id,'ckb_dev','Only isolated CKB dev chains are allowed');
 assert.equal(await rpc('get_block_hash',['0x0']),profile.genesisHeader.hash,'Unexpected genesis');
 await rpc('set_network_active',[false]);
 assert.equal((await rpc('get_peers')).length,0,'Node must have no peers');
 for(const n of ['A','F','Q']){const x=await live(environment.deployed[n]);assert.equal(c.hashCkb(buf(x.cell.data.content)),hashes[n],`Wrong ${n} dependency`);}
 const group=await live(environment.kdep.outPoint),data=buf(group.cell.data.content);assert.equal(data.length,76);
 const members=[0,1].map(j=>({txHash:hex(data.subarray(4+j*36,36+j*36)),index:data.readUInt32LE(36+j*36)}));
 for(const [i,n] of ['Kdata','Kcode'].entries()){const x=await live(members[i]);assert.equal(c.hashCkb(buf(x.cell.data.content)),hashes[n]);if(n==='Kcode'){const t=x.cell.output.type;assert(t);assert.equal(c.Script.from({codeHash:t.code_hash,hashType:t.hash_type,args:t.args}).hash(),K);}}
 assert.deepEqual(environment.allDeps,[environment.kdep,...['A','F','Q'].map(n=>({outPoint:environment.deployed[n],depType:'code'}))]);
}
await verifyEnvironment();
const db=new DatabaseSync(path.join(run,'working-pocket.sqlite'));
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, genesis TEXT NOT NULL, pocket TEXT NOT NULL, actor TEXT NOT NULL, recipient TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT NOT NULL, signed TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL)");
if(!db.prepare('PRAGMA table_info(intents)').all().some(x=>x.name==='operation'))db.exec("ALTER TABLE intents ADD COLUMN operation TEXT NOT NULL DEFAULT 'pay'");
const insert=db.prepare('INSERT INTO intents (id,genesis,pocket,actor,recipient,amount,tx_hash,signed,state,created,operation) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const rows=()=>db.prepare('SELECT * FROM intents ORDER BY rowid').all();
const update=db.prepare('UPDATE intents SET state=? WHERE id=?');
let busy=false;
const requests=new Map();
const walletBundle=(await build({entryPoints:[path.join(here,'working_pocket_wallet.mjs')],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome110'})).outputFiles[0].contents;
async function canonicalCommit(tx){if(tx?.tx_status?.status!=='committed')return false;const header=await rpc('get_header',[tx.tx_status.block_hash]);return !!header && await rpc('get_block_hash',[header.number])===header.hash;}
async function snapshot(){
 assert(initial&&actors,'No Pocket is open');
 const state=structuredClone(initial);let unresolved=false;
 for(const item of rows()){
  assert.equal(item.genesis,profile.genesisHeader.hash);assert.equal(item.pocket,c.Script.from(initial.Q).hash());
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
 const p=await live(state.policy),f=state.fund?await live(state.fund):null,s=buf(p.cell.data.content),closed=s.length===28;
 const ps=p.cell.output.type;assert(ps,'Missing policy type');const actualPolicy=c.Script.from({codeHash:ps.code_hash,hashType:ps.hash_type,args:ps.args});assert(actualPolicy.eq(c.Script.from(initial.Q)),'Policy identity mismatch');
 const pl=p.cell.output.lock;assert(c.Script.from({codeHash:pl.code_hash,hashType:pl.hash_type,args:pl.args}).eq(c.Script.from({codeHash:hashes.A,hashType:'data1',args:'0x'})),'Policy lock mismatch');
 if(f){const fl=f.cell.output.lock;const expected=c.Script.from({codeHash:hashes.F,hashType:'data1',args:actualPolicy.hash()});assert(c.Script.from({codeHash:fl.code_hash,hashType:fl.hash_type,args:fl.args}).eq(expected),'Fund policy identity mismatch');assert(!f.cell.output.type&&f.cell.data.content==='0x','Unsupported fund cell');}
 if(closed)assert.equal(s.subarray(0,8).toString('hex'),'5143543404000100');else {assert.equal(s.length,466);assert.equal(s.subarray(0,6).toString('hex'),'51434e340400');}
 const u=o=>s.readBigUInt64LE(o)+(s.readBigUInt64LE(o+8)<<64n);
 const delegates=['alice','ben'].map((role,i)=>{if(closed)return {role,limit:'0',used:'0',perPayment:'0',enabled:false,recipient:'',publicKey:''};const o=158+154*i;return {role,limit:u(o+106).toString(),used:u(o+122).toString(),perPayment:u(o+138).toString(),enabled:Boolean(s[7]&(1<<i)),recipient:c.Script.fromBytes(s.subarray(o+33,o+106)).args,publicKey:hex(s.subarray(o,o+33))};});
 return {state,p,f,unresolved,closed,view:{pocket:c.Script.from(initial.Q).hash(),genesis:profile.genesisHeader.hash,owner:actors.owner.publicKey,policyOutpoint:state.policy,fundShannons:f?BigInt(f.cell.output.capacity).toString():'0',fundOccupiedShannons:f?'7300000000':'0',sharedLimit:closed?'0':u(8).toString(),sharedUsed:closed?'0':u(24).toString(),delegates,closed,hasFund:!!f,policyCapacity:p.cell.output.capacity,history:rows().map(({id,tx_hash,state,amount,recipient,created,actor,operation})=>({id,tx_hash,state,amount,recipient,created,actor,operation})),unresolved}};
}
async function prepareExternal(body){
 assert(!busy,'Another action is in progress');busy=true;
 try{
  for(const [id,request] of requests)if(request.expires<=Date.now())requests.delete(id);
  assert(requests.size<128,'Too many outstanding signing requests');
  assert.match(body.id||'',/^[0-9a-f-]{36}$/);assert.match(body.amount||'',/^[0-9]{1,12}$/);assert.match(body.recipient||'',/^0x[0-9a-f]{40}$/);
  assert(['alice','ben'].includes(body.role),'Unknown delegate');assert(!requests.has(body.id)&&!rows().some(x=>x.id===body.id),'Intent already exists');
  await verifyEnvironment();const snap=await snapshot();assert(!snap.unresolved,'An earlier outcome is uncertain');
  const grant=snap.view.delegates.find(d=>d.role===body.role);assert.equal(body.recipient,grant.recipient,'Recipient changed');
  assert.equal(body.publicKey,grant.publicKey,'Connected account is not the selected delegate');
  const actor=await live(snap.state.seeds[body.role]),amount=BigInt(body.amount)*100000000n;
  const tx=buildPayment({policy:snap.p,actor,funds:[snap.f],deps:environment.allDeps,delegate:body.role==='alice'?0:1,amount,fee:2000n});
  const client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]});const lock=c.Script.from(actors[body.role].lock),info=await tx.getSignHashInfo(lock,client);assert.equal(info.position,1);
  const record={bytes:tx.toHex(),message:info.message,position:info.position,publicKey:grant.publicKey,points:[snap.state.policy,snap.state.seeds[body.role],snap.state.fund],pocket:snap.view.pocket,amount:amount.toString(),recipient:body.recipient,operation:'pay',expires:Date.now()+300000};
  requests.set(body.id,record);return {id:body.id,transaction:record.bytes,publicKey:record.publicKey,genesis:profile.genesisHeader.hash};
 }finally{busy=false;}
}
async function submitExternal(body){
 assert(!busy,'Another action is in progress');busy=true;
 try{
  const request=requests.get(body.id);assert(request,'Unknown or expired signing request');requests.delete(body.id);assert(Date.now()<request.expires,'Signing request expired');
  assert.match(body.transaction||'',/^0x[0-9a-f]+$/i);assert(body.transaction.length<200000,'Signed transaction too large');
  await verifyEnvironment();const snap=await snapshot();assert(!snap.unresolved,'An earlier outcome is uncertain');assert.equal(snap.view.pocket,request.pocket);
  for(const p of request.points)await live(p);
  const prepared=c.Transaction.fromBytes(request.bytes),signed=c.Transaction.fromBytes(body.transaction);
  verifyWalletTransaction({prepared,signed,message:request.message,publicKey:request.publicKey,position:request.position});
  const signedRaw=raw(signed);await rpc('dry_run_transaction',[signedRaw]);
  db.exec('BEGIN IMMEDIATE');try{assert(!rows().some(x=>x.state!=='committed'),'An outcome is uncertain');insert.run(body.id,profile.genesisHeader.hash,request.pocket,request.publicKey,request.recipient,request.amount,signed.hash(),JSON.stringify(signedRaw),'uncertain',new Date().toISOString(),request.operation);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  try{assert.equal(await rpc('send_transaction',[signedRaw,'passthrough']),signed.hash());}catch(e){return {txHash:signed.hash(),state:'uncertain',error:e.message};}
  for(let i=0;i<20;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));if(await canonicalCommit(await rpc('get_transaction',[signed.hash()]))){update.run('committed',body.id);return {txHash:signed.hash(),state:'committed'};}}
  return {txHash:signed.hash(),state:'uncertain'};
 }finally{busy=false;}
}
async function pay(body){
 assert(developmentSigner,'Development signer is disabled');
 if(busy)throw new Error('Another action is in progress');busy=true;
 try{
  assert.match(body.id||'',/^[0-9a-f-]{36}$/);assert.match(body.amount||'',/^[0-9]{1,12}$/);assert.match(body.recipient||'',/^0x[0-9a-f]{40}$/);
  assert(!rows().some(x=>x.id===body.id),'Intent already exists; reconcile the existing transaction');
  await verifyEnvironment();const snap=await snapshot();assert(!snap.unresolved,'An earlier outcome is uncertain; reconcile before another payment');
  assert(['alice','ben'].includes(body.role),'Unknown delegate');const grant=snap.view.delegates.find(d=>d.role===body.role);assert.equal(body.recipient,grant.recipient,'Recipient changed; review the live policy');
  const amount=BigInt(body.amount)*100000000n;
  const actor=await live(snap.state.seeds[body.role]);const tx=buildPayment({policy:snap.p,actor,funds:[snap.f],deps:environment.allDeps,delegate:body.role==='alice'?0:1,amount,fee:2000n});
  assert.equal(tx.outputs[2].capacity,amount);assert.equal(tx.outputs[2].lock.args,body.recipient);
  const acp=await new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}).getKnownScript(c.KnownScript.AnyoneCanPay);
  const client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[],scripts:{[c.KnownScript.Secp256k1Blake160]:{codeHash:K,hashType:'type',cellDeps:[{cellDep:environment.kdep}]},[c.KnownScript.AnyoneCanPay]:acp}});
  const secret=await load('keys/'+body.role);const signer=new c.SignerCkbPrivateKey(client,secret.privateKey);assert.equal(signer.publicKey,actors[body.role].publicKey);
  const lock=c.Script.from(actors[body.role].lock),info=await tx.getSignHashInfo(lock,client);assert.equal(info.position,1);
  const signed=await signWithCkbWallet({signer,prepared:tx,actorLock:lock,publicKey:signer.publicKey,message:info.message,position:1});
  for(const p of [snap.state.policy,snap.state.seeds[body.role],snap.state.fund])await live(p);
  const signedRaw=raw(signed);await rpc('dry_run_transaction',[signedRaw]);
  db.exec('BEGIN IMMEDIATE');try{assert(!rows().some(x=>x.state!=='committed'),'An outcome is uncertain');insert.run(body.id,profile.genesisHeader.hash,snap.view.pocket,signer.publicKey,body.recipient,amount.toString(),signed.hash(),JSON.stringify(signedRaw),'uncertain',new Date().toISOString(),'pay');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
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
  const op=body.operation,owner=await live(snap.state.ownerFee),ownerCap=BigInt(owner.cell.output.capacity),fee=2000n;
  const old=buf(snap.p.cell.data.content),ownerLock=c.Script.from(actors.owner.lock),policyOut={capacity:BigInt(snap.p.cell.output.capacity),lock:c.Script.from({codeHash:snap.p.cell.output.lock.code_hash,hashType:snap.p.cell.output.lock.hash_type,args:snap.p.cell.output.lock.args}),type:c.Script.from(initial.Q)};
  const ownerInput=owner.cell.output.lock;assert(c.Script.from({codeHash:ownerInput.code_hash,hashType:ownerInput.hash_type,args:ownerInput.args}).eq(ownerLock)&&!owner.cell.output.type&&owner.cell.data.content==='0x','Owner fee cell mismatch');
  if(snap.closed)assert.equal(hex(old.subarray(8,28)),ownerLock.args,'Terminal owner mismatch');else assert.equal(hex(old.subarray(125,158)),actors.owner.publicKey,'Policy owner mismatch');
  let inputs,outputs,data,action,position,amount=0n;
  if(op==='revoke'){
   assert(!snap.closed && (old[7]&1),'Alice is already revoked or pocket is closed');const next=Buffer.from(old);next[7]&=~1;
   inputs=[snap.state.policy,snap.state.ownerFee];outputs=[policyOut,{capacity:ownerCap-fee,lock:ownerLock}];data=[hex(next),'0x'];action='0x5143413103ff000001';position=1;
  }else if(op==='close'){
   assert(!snap.closed&&snap.f,'An active funded pocket is required');const terminal=Buffer.concat([Buffer.from('5143543404000100','hex'),buf(actors.owner.lock.args)]);const released=policyOut.capacity-13400000000n;
   inputs=[snap.state.policy,snap.state.ownerFee,snap.state.fund];amount=BigInt(snap.f.cell.output.capacity);outputs=[{...policyOut,capacity:13400000000n},{capacity:amount,lock:ownerLock},{capacity:ownerCap+released-fee,lock:ownerLock}];data=[hex(terminal),'0x','0x'];action='0x5143413104ff0000';position=1;
  }else if(op==='deposit'){
   assert(snap.closed&&!snap.f,'A closed pocket with no tracked fund is required');assert.match(body.amount||'',/^[0-9]{1,12}$/);amount=BigInt(body.amount)*100000000n;assert(amount>=7300000000n,'Deposit below occupied capacity');
   inputs=[snap.state.ownerFee];outputs=[{capacity:amount,lock:c.Script.from(initial.F)},{capacity:ownerCap-amount-fee,lock:ownerLock}];data=['0x','0x'];position=0;
  }else{
   assert(snap.closed&&snap.f,'No tracked late deposit');amount=BigInt(snap.f.cell.output.capacity);inputs=[snap.state.policy,snap.state.ownerFee,snap.state.fund];outputs=[policyOut,{capacity:amount,lock:ownerLock},{capacity:ownerCap-fee,lock:ownerLock}];data=[hex(old),'0x','0x'];action='0x5143413105ff0000';position=1;
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
   requests.set(body.id,record);return {id:body.id,transaction:record.bytes,publicKey:record.publicKey,genesis:profile.genesisHeader.hash};
  }
  const secret=await load('keys/owner'),signer=new c.SignerCkbPrivateKey(client,secret.privateKey);assert.equal(signer.publicKey,actors.owner.publicKey);
  const signed=await signWithCkbWallet({signer,prepared:tx,actorLock:ownerLock,publicKey:signer.publicKey,message:info.message,position});for(const p of inputs)await live(p);
  const signedRaw=raw(signed);await rpc('dry_run_transaction',[signedRaw]);
  db.exec('BEGIN IMMEDIATE');try{assert(!rows().some(x=>x.state!=='committed'),'An outcome is uncertain');insert.run(body.id,profile.genesisHeader.hash,snap.view.pocket,signer.publicKey,actors.owner.lock.args,amount.toString(),signed.hash(),JSON.stringify(signedRaw),'uncertain',new Date().toISOString(),op);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  try{assert.equal(await rpc('send_transaction',[signedRaw,'passthrough']),signed.hash());}catch(e){return {txHash:signed.hash(),state:'uncertain',error:e.message};}
  for(let i=0;i<20;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));const result=await rpc('get_transaction',[signed.hash()]);if(await canonicalCommit(result)){update.run('committed',body.id);return {txHash:signed.hash(),state:'committed'};}}
  return {txHash:signed.hash(),state:'uncertain'};
 }finally{busy=false;}
}
const html=await fs.readFile(path.join(here,'working_pocket.html'));
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`)throw new Error('Invalid host');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;}
  if(req.method==='GET'&&req.url==='/wallet.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(walletBundle);return;}
  if(req.method==='POST'&&req.url==='/api/ckb'){
   assert.equal(req.headers.origin,origin,'Invalid origin');let body='';for await(const chunk of req){body+=chunk;assert(body.length<65536);}
   const call=JSON.parse(body);assert(['get_fee_rate_statistics','get_tip_header','get_live_cell','get_transaction','get_header','get_block_hash','get_consensus'].includes(call.method),'RPC method unavailable');
   const result=await rpc(call.method,call.params||[]);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));return;
  }
  if(req.method==='GET'&&req.url==='/api/state'){const s=initial?await snapshot():{view:{empty:true,genesis:profile.genesisHeader.hash,developmentSigner}};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(s.view));return;}
  if(req.method==='POST'&&['/api/external/prepare','/api/external/owner','/api/external/submit'].includes(req.url)){
   assert.equal(req.headers.origin,origin,'Invalid origin');assert.equal(req.headers['content-type'],'application/json');let body='';for await(const chunk of req){body+=chunk;assert(body.length<210000);}
   const input=JSON.parse(body);const result=await (req.url.endsWith('/owner')?ownerAction(input,true):req.url.endsWith('/prepare')?prepareExternal(input):submitExternal(input));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
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
   try{await verifyEnvironment();const outcomes=[];for(const item of rows().filter(x=>x.state!=='committed')){let tx=await rpc('get_transaction',[item.tx_hash]);if(['pending','proposed'].includes(tx?.tx_status?.status)){for(let i=0;i<8;i++){await rpc('generate_block');await new Promise(r=>setTimeout(r,200));tx=await rpc('get_transaction',[item.tx_hash]);if(await canonicalCommit(tx))break;}}if(await canonicalCommit(tx))update.run('committed',item.id);outcomes.push({txHash:item.tx_hash,status:tx?.tx_status?.status||'unknown'});}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({outcomes}));}finally{busy=false;}return;
  }
  res.writeHead(404);res.end('Not found');
 }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Working Pocket development app: ${origin}`));
