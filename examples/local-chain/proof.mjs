// WO-07 only: a disposable dev-chain proof, not a wallet or supported SDK.
import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const [mode,runDir,...args]=process.argv.slice(2);
const run=path.resolve(runDir ?? path.join(here,'.local','run'));
const result=path.join(run,'evidence');
const hex=b=>'0x'+Buffer.from(b).toString('hex');
const bytes=x=>Buffer.from(x.slice(2),'hex');
const num=x=>'0x'+BigInt(x).toString(16);
const CKB=100000000n, FEE=2000n;
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const H={A:'0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1',F:'0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a',T:'0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95',Q:'0x4c02a05d3ec9723f742dbc1323efef3e094995f9e5ecb043243239d712a4d876',Kcode:'0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649',Kdata:'0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4'};
const A=c.Script.from({codeHash:H.A,hashType:'data1',args:'0x'});
const T=c.Script.from({codeHash:H.T,hashType:'data1',args:'0x59297894bff4b8f7e1427bf4943b467ba168565d25fe75de207c146debaec14b'});
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const save=async(n,x)=>fs.writeFile(path.join(result,n+'.json'),json(x));
const load=async n=>JSON.parse(await fs.readFile(path.join(run,n+'.json'),'utf8'));
const le128=n=>{const b=Buffer.alloc(16);b.writeBigUInt64LE(BigInt(n)&((1n<<64n)-1n));b.writeBigUInt64LE(BigInt(n)>>64n,8);return b;};
const read128=(b,o)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n);
const decode=data=>{const b=bytes(data);assert.equal(b.length,466);return {phase:b[6],mask:b[7],limit:read128(b,8),used:read128(b,24),aliceLimit:read128(b,264),aliceUsed:read128(b,280),benLimit:read128(b,418),benUsed:read128(b,434)};};
const scriptJSON=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
const outpointJSON=p=>({tx_hash:p.txHash,index:num(p.index)});
const raw=tx=>({version:num(tx.version),cell_deps:tx.cellDeps.map(d=>({out_point:outpointJSON(d.outPoint),dep_type:d.depType==='depGroup'?'dep_group':d.depType})),header_deps:tx.headerDeps,inputs:tx.inputs.map(i=>({since:num(i.since),previous_output:outpointJSON(i.previousOutput)})),outputs:tx.outputs.map(o=>({capacity:num(o.capacity),lock:scriptJSON(o.lock),type:o.type?scriptJSON(o.type):null})),outputs_data:tx.outputsData,witnesses:tx.witnesses});
const fromRawOutput=o=>({capacity:BigInt(o.capacity),lock:{codeHash:o.lock.code_hash,hashType:o.lock.hash_type,args:o.lock.args},type:o.type?{codeHash:o.type.code_hash,hashType:o.type.hash_type,args:o.type.args}:undefined});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let id=0,endpoint;
async function rpc(method,params=[]){
 const url=endpoint ?? (await load('runtime')).url;
 assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:++id,jsonrpc:'2.0',method,params}),signal:AbortSignal.timeout(20000)});
 const body=await response.json();if(body.error){const e=new Error(JSON.stringify(body.error));e.rpc=body.error;throw e;}return body.result;
}
async function live(p){const r=await rpc('get_live_cell',[outpointJSON(p),true]);assert.equal(r.status,'live');return {...r,outPoint:p};}
async function clientFor(dep){
 const url=(await load('runtime')).url;
 // CCC's K signer also loads ACP metadata while classifying related locks.
 // No ACP input/dep is admitted or added; the actual signing path is K only.
 const acp=await new c.ClientPublicTestnet({url,fallbacks:[]}).getKnownScript(c.KnownScript.AnyoneCanPay);
 return new c.ClientPublicTestnet({url,fallbacks:[],scripts:{[c.KnownScript.Secp256k1Blake160]:{codeHash:K,hashType:'type',cellDeps:[{cellDep:dep}]},[c.KnownScript.AnyoneCanPay]:acp}});
}
async function sign(tx,role,position,dep){
 const secret=JSON.parse(await fs.readFile(path.join(run,'keys',role+'.json'),'utf8'));
 const signer=new c.SignerCkbPrivateKey(await clientFor(dep),secret.privateKey);
 const pub=signer.publicKey;
 const actor=c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(bytes(pub)).slice(0,42)});
 const info=await tx.getSignHashInfo(actor,signer.client);assert.equal(info.position,position);
 const before=structuredClone(raw(tx));
 const preimage=[bytes(tx.hash())];const signedWitnessIndexes=[];
 for(let i=0;i<tx.inputs.length;i++){
  const input=await live(tx.inputs[i].previousOutput);
  if(!actor.eq(fromRawOutput(input.cell.output).lock))continue;
  const wb=bytes(tx.witnesses[i]),len=Buffer.alloc(8);len.writeBigUInt64LE(BigInt(wb.length));preimage.push(len,wb);signedWitnessIndexes.push(i);
 }
 assert.equal(c.hashCkb(Buffer.concat(preimage)),info.message);
 const signed=await signer.signOnlyTransaction(tx);
 const witness=signed.getWitnessArgs(position);
 assert.equal(witness.inputType,c.WitnessArgs.fromBytes(before.witnesses[position]).inputType);
 const expectedWitness=c.WitnessArgs.fromBytes(before.witnesses[position]);expectedWitness.lock=witness.lock;
 assert.equal(expectedWitness.toHex(),signed.witnesses[position]);
 for(let i=0;i<before.witnesses.length;i++)if(i!==position)assert.equal(before.witnesses[i],signed.witnesses[i]);
 assert(c.verifyMessageSecp256k1(info.message,witness.lock,pub));
 assert.equal(c.recoverMessageSecp256k1(info.message,witness.lock),pub);
 const after=raw(signed);const originalWitness=before.witnesses;before.witnesses=[];after.witnesses=[];assert.deepEqual(after,before);after.witnesses=signed.witnesses;
 return {tx:signed,signing:{role,position,publicKey:pub,actorLock:scriptJSON(actor),message:info.message,digestPreimage:hex(Buffer.concat(preimage)),signedWitnessIndexes,signature:witness.lock,signatureVerified:true,recoveredPublicKey:pub,action:witness.inputType,actionPreserved:true,onlyLockFieldChanged:true,placeholderWitness:originalWitness[position]}};
}
async function record(name,tx,signing){
 const resolvedInputs=[];for(const i of tx.inputs)resolvedInputs.push(await live(i.previousOutput));
 const inCapacity=resolvedInputs.reduce((s,r)=>s+BigInt(r.cell.output.capacity),0n),outCapacity=tx.outputs.reduce((s,o)=>s+o.capacity,0n);
 const entry={name,txHash:tx.hash(),transaction:raw(tx),serialized:hex(tx.toBytes()),bytes:tx.toBytes().length,feeShannon:inCapacity-outCapacity,outputs:tx.outputs.map((o,i)=>({index:i,capacityShannon:o.capacity,occupiedShannon:BigInt(o.occupiedSize+bytes(tx.outputsData[i]).length)*CKB})),resolvedInputs,signing};
 await save(name,entry);return entry;
}
async function commit(name,tx,signing){
 const e=await record(name,tx,signing);
 e.dryRun=await rpc('dry_run_transaction',[e.transaction]);
 e.submit={method:'send_transaction',outputsValidator:'passthrough',result:await rpc('send_transaction',[e.transaction,'passthrough'])};assert.equal(e.submit.result,e.txHash);
 e.generatedBlocks=[];
 for(let i=0;i<20;i++){
  await sleep(250);e.generatedBlocks.push(await rpc('generate_block'));await sleep(150);
  const t=await rpc('get_transaction',[e.txHash]);
  if(t?.tx_status.status==='committed'){
   const block=await rpc('get_block',[t.tx_status.block_hash]);assert(block.transactions.some(x=>x.hash===e.txHash));
   assert.equal(await rpc('get_block_hash',[block.header.number]),block.header.hash);
   e.inclusion={status:t.tx_status,header:block.header,transactionIndex:block.transactions.findIndex(x=>x.hash===e.txHash)};
   e.nodeTransaction=t;await save(name,e);console.log(name,'committed',e.txHash,'block',BigInt(block.header.number).toString());return e;
  }
 }
 throw new Error('Transaction not committed in bounded block-generation window: '+name);
}
const dep=p=>({outPoint:p,depType:'code'});
const point=(h,i)=>({txHash:h,index:i});
function makeTx(inputs,outputs,data,deps,action,actorPosition){
 const tx=c.Transaction.from({inputs:inputs.map(p=>({previousOutput:p,since:0})),outputs,outputsData:data,cellDeps:deps,headerDeps:[],witnesses:inputs.map(()=> '0x')});
 if(actorPosition!==undefined)tx.setWitnessArgs(actorPosition,{lock:'0x'+'00'.repeat(65),...(action===undefined?{}:{inputType:action})});
 return tx;
}
function state(actors){
 const b=Buffer.alloc(466);b.write('QCP1');b.writeUInt16LE(1,4);b[7]=3;le128(100).copy(b,8);Buffer.from(T.toBytes()).copy(b,40);bytes(actors.owner.publicKey).copy(b,125);
 for(const [i,role]of ['alice','ben'].entries()){
  const o=158+154*i;bytes(actors[role].publicKey).copy(b,o);Buffer.from(c.Script.from(actors[role+'Recipient'].lock).toBytes()).copy(b,o+33);le128(i?50:70).copy(b,o+106);le128(i?50:60).copy(b,o+138);
 }return b;
}
async function keys(){
 await fs.mkdir(path.join(run,'keys'),{recursive:true});await fs.mkdir(result,{recursive:true});const actors={};
 for(const role of ['owner','alice','ben','aliceRecipient','benRecipient']){
  const key=hex(crypto.randomBytes(32));const signer=new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}),key);const publicKey=signer.publicKey;
  actors[role]={publicKey,lock:{codeHash:K,hashType:'type',args:c.hashCkb(bytes(publicKey)).slice(0,42)}};
  await fs.writeFile(path.join(run,'keys',role+'.json'),json({privateKey:key}),{mode:0o600});
 }
 await fs.writeFile(path.join(run,'actors.json'),json(actors));await save('actors',actors);
}
async function setup(){
 endpoint=(await load('runtime')).url;const actors=await load('actors');const genesis=await rpc('get_block_by_number',['0x0']);
 const system=genesis.transactions[0], groupTx=genesis.transactions[1];const providers=[];
 for(let i=0;i<system.outputs.length;i++)providers.push({outPoint:point(system.hash,i),output:system.outputs[i],bytes:bytes(system.outputs_data[i]).length,dataHash:c.hashCkb(bytes(system.outputs_data[i]))});
 const kc=providers.find(p=>p.dataHash===H.Kcode),kd=providers.find(p=>p.dataHash===H.Kdata);assert(kc&&kd);assert.equal(c.Script.from(fromRawOutput(kc.output).type).hash(),K);
 const expectedGroup=[kd.outPoint,kc.outPoint];let kdep;
 for(let i=0;i<groupTx.outputs.length;i++){
  const data=bytes(groupTx.outputs_data[i]);if(data.length!==76)continue;
  const members=[0,1].map(j=>({txHash:hex(data.subarray(4+j*36,36+j*36)),index:Number(data.readUInt32LE(36+j*36))}));
  if(JSON.stringify(members)===JSON.stringify(expectedGroup))kdep={outPoint:point(groupTx.hash,i),depType:'depGroup'};
 }assert(kdep);
 const seeds={};for(const role of ['owner','alice','ben']){
  const indexes=system.outputs.map((o,i)=>({o,i})).filter(({o})=>!o.type&&c.Script.from(fromRawOutput(o).lock).eq(actors[role].lock));assert.equal(indexes.length,1);seeds[role]=point(system.hash,indexes[0].i);
 }
 const tokenIndex=system.outputs.findIndex(o=>o.type&&c.Script.from(fromRawOutput(o).type).eq(T));assert(tokenIndex>=0);seeds.token=point(system.hash,tokenIndex);
 await save('node-profile',{localNode:await rpc('local_node_info'),consensus:await rpc('get_consensus'),genesisHeader:genesis.header,providers,kdep,kdepMembers:expectedGroup,seeds});
 const files={A:'../../test-support/binaries/always-success',F:'../../test-support/binaries/proxy',T:'../../test-support/binaries/xudt',Q:'../../policy/build/allowance'};
 const outputs=[],data=[],deployed={};let spent=0n;
 for(const [name,file]of Object.entries(files)){
  const b=await fs.readFile(path.resolve(here,file));assert.equal(c.hashCkb(b),H[name]);const cap=BigInt(b.length+61)*CKB;spent+=cap;outputs.push({capacity:cap,lock:actors.owner.lock});data.push(hex(b));deployed[name]=outputs.length-1;
 }
 const ownerSeed=await live(seeds.owner);outputs.push({capacity:BigInt(ownerSeed.cell.output.capacity)-spent-200000n,lock:actors.owner.lock});data.push('0x');
 let tx=makeTx([seeds.owner],outputs,data,[kdep],undefined,0);let signed=await sign(tx,'owner',0,kdep);const deployedResult=await commit('01-deploy-dependencies',signed.tx,signed.signing);
 for(const name of Object.keys(deployed))deployed[name]=point(deployedResult.txHash,deployed[name]);
 const allDeps=[kdep,...['A','F','T','Q'].map(n=>dep(deployed[n]))];
 const ownerForGenesis=point(deployedResult.txHash,4);const firstInput=c.CellInput.from({previousOutput:ownerForGenesis,since:0});
 const Q=c.Script.from({codeHash:H.Q,hashType:'data2',args:c.hashCkb(Buffer.concat([Buffer.from(firstInput.toBytes()),Buffer.alloc(8)]))});
 const F=c.Script.from({codeHash:H.F,hashType:'data1',args:Q.hash()});const initial=state(actors);const ownerCell=await live(ownerForGenesis);
 tx=makeTx([ownerForGenesis],[{capacity:600n*CKB,lock:A,type:Q},{capacity:BigInt(ownerCell.cell.output.capacity)-600n*CKB-FEE,lock:actors.owner.lock}],[hex(initial),'0x'],allDeps,'0x5143413100ff0000',0);
 signed=await sign(tx,'owner',0,kdep);const created=await commit('02-policy-genesis',signed.tx,signed.signing);
 const ownerFee=point(created.txHash,1),feeCell=await live(ownerFee),tokenCell=await live(seeds.token);assert.equal(read128(bytes(tokenCell.cell.data.content),0),200n);
 // Keep the first xUDT input's witness empty, matching the admitted plain
 // profile. A K witness with Some(empty input_type) is not XudtWitness data.
 tx=makeTx([ownerFee,seeds.token],[{capacity:154n*CKB,lock:F,type:T},{capacity:BigInt(feeCell.cell.output.capacity)+BigInt(tokenCell.cell.output.capacity)-154n*CKB-5000n,lock:actors.owner.lock}],[hex(le128(200)),'0x'],[kdep,dep(deployed.T)],undefined,0);
 signed=await sign(tx,'owner',0,kdep);const funded=await commit('03-fund-protected-treasury',signed.tx,signed.signing);
 const context={kdep,allDeps,deployed,seeds,Q:{codeHash:Q.codeHash,hashType:Q.hashType,args:Q.args},F:{codeHash:F.codeHash,hashType:F.hashType,args:F.args},policy:point(created.txHash,0),fund:point(funded.txHash,0)};
 await fs.writeFile(path.join(run,'context.json'),json(context));await save('setup-context',context);console.log('Setup complete; Q unchanged.');
}
async function spend(){
 const [role,quantity,expectation,name]=args;assert(['alice','ben'].includes(role));assert(['accept','shared-reject'].includes(expectation));
 const context=await load('context'),actors=await load('actors');const P=await live(context.policy),fund=await live(context.fund),actor=await live(context.seeds[role]);
 const old=bytes(P.cell.data.content),next=Buffer.from(old);const q=BigInt(quantity),slot=role==='alice'?0:1;
 if(expectation==='accept'){le128(read128(old,24)+q).copy(next,24);le128(read128(old,280+154*slot)+q).copy(next,280+154*slot);}
 // The excessive control retains a valid old state, rather than constructing
 // an invalid U=110 state. Q checks actual payout against root BEFORE memcmp.
 const total=read128(bytes(fund.cell.data.content),0);assert(q<=total);
 let tx=makeTx([context.policy,context.seeds[role],context.fund],[{...fromRawOutput(P.cell.output)},{...fromRawOutput(fund.cell.output)},{capacity:142n*CKB,lock:actors[role+'Recipient'].lock,type:T},{capacity:BigInt(actor.cell.output.capacity)-142n*CKB-FEE,lock:actors[role].lock}],[hex(next),hex(le128(total-q)),hex(le128(q)),'0x'],context.allDeps,hex(Buffer.from([81,67,65,49,1,slot,0,0])),1);
 const signed=await sign(tx,role,1,context.kdep);tx=signed.tx;
 if(expectation==='shared-reject'){
  const e=await record(name,tx,signed.signing);try{await rpc('send_transaction',[e.transaction,'passthrough']);throw new Error('Excessive payout unexpectedly accepted');}catch(error){assert(error.rpc);e.submit={method:'send_transaction',error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/Inputs\[0\]\.Type/);assert(JSON.stringify(error.rpc).includes('by-data-hash/'+H.Q.slice(2)+'.html#20'));}
  e.policyAfterRejection=await live(context.policy);e.fundAfterRejection=await live(context.fund);e.actorAfterRejection=await live(context.seeds[role]);assert.deepEqual(e.policyAfterRejection,P);await save(name,e);console.log(name,'rejected by node',JSON.stringify(e.submit.error));return;
 }
 const e=await commit(name,tx,signed.signing);context.policy=point(e.txHash,0);context.fund=point(e.txHash,1);context.seeds[role]=point(e.txHash,3);
 await fs.writeFile(path.join(run,'context.json'),json(context));const actual=await live(context.policy);const decoded=decode(actual.cell.data.content);await save(name+'-state',{outPoint:context.policy,nodeLiveCell:actual,decoded});console.log('Node state',json(decoded));
}
async function finish(){
 const context=await load('context');const p=await live(context.policy),f=await live(context.fund);const decoded=decode(p.cell.data.content);assert.equal(decoded.used,100n);assert.equal(decoded.aliceUsed,60n);assert.equal(decoded.benUsed,40n);assert.equal(read128(bytes(f.cell.data.content),0),100n);
 const tx=await rpc('get_transaction',[context.policy.txHash]);assert.equal(tx.tx_status.status,'committed');const header=await rpc('get_header',[tx.tx_status.block_hash]);assert.equal(await rpc('get_block_hash',[header.number]),header.hash);
 await save('final-chain-state',{policyOutPoint:context.policy,policyCell:p,decoded,protectedFundOutPoint:context.fund,protectedFund:f,remainingTokens:100,tip:await rpc('get_tip_header'),canonicalInclusion:{transactionStatus:tx.tx_status,header},peers:await rpc('get_peers')});console.log('PASS: Alice60 committed; Ben50 Q-rejected; Ben40 committed; canonical U100/A60/B40.');
}
await fs.mkdir(result,{recursive:true});
try{if(mode==='keys')await keys();else if(mode==='setup')await setup();else if(mode==='spend')await spend();else if(mode==='finish')await finish();else throw new Error('Unknown mode');}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
