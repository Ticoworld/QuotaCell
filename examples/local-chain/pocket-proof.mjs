// WO-07 only: a disposable dev-chain proof, not a wallet or supported SDK.
import * as c from '@ckb-ccc/core';
import {buildGenesis} from './pocket_genesis.mjs';
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
const H={A:'0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1',F:'0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a',T:'0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95',Q:'0xc224bed30f3b40e9a1c14640ea503d95aab00700364d1237e5e16bc8cda5e04f',Kcode:'0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649',Kdata:'0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4'};
H.Q=JSON.parse(await fs.readFile(path.resolve(here,'../../policy/build/q-native-v2-build.json'),'utf8')).ckb_data_hash;
const A=c.Script.from({codeHash:H.A,hashType:'data1',args:'0x'});
const T=c.Script.from({codeHash:H.T,hashType:'data1',args:'0x59297894bff4b8f7e1427bf4943b467ba168565d25fe75de207c146debaec14b'});
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const save=async(n,x)=>fs.writeFile(path.join(result,n+'.json'),json(x));
const load=async n=>JSON.parse(await fs.readFile(path.join(run,n+'.json'),'utf8'));
const le128=n=>{const b=Buffer.alloc(16);b.writeBigUInt64LE(BigInt(n)&((1n<<64n)-1n));b.writeBigUInt64LE(BigInt(n)>>64n,8);return b;};
const read128=(b,o)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n);
const decode=data=>{const b=bytes(data);if(b.length===28){assert.equal(b.subarray(0,8).toString('hex'),'5143543202000100');return {version:2,phase:1,mask:0,bytes:28,ownerLockArgs:hex(b.subarray(8))};}assert.equal(b.length,466);return {version:2,phase:b[6],mask:b[7],limit:read128(b,8),used:read128(b,24),aliceLimit:read128(b,264),aliceUsed:read128(b,280),benLimit:read128(b,418),benUsed:read128(b,434)};};
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
 const files={A:'../../test-support/binaries/always-success',F:'../../test-support/binaries/proxy',Q:'../../policy/build/allowance-native-v2'};
 const outputs=[],data=[],deployed={};let spent=0n;
 for(const [name,file]of Object.entries(files)){
  const b=await fs.readFile(path.resolve(here,file));assert.equal(c.hashCkb(b),H[name]);const cap=BigInt(b.length+61)*CKB;spent+=cap;outputs.push({capacity:cap,lock:actors.owner.lock});data.push(hex(b));deployed[name]=outputs.length-1;
 }
 const ownerSeed=await live(seeds.owner);outputs.push({capacity:BigInt(ownerSeed.cell.output.capacity)-spent-200000n,lock:actors.owner.lock});data.push('0x');
 let tx=makeTx([seeds.owner],outputs,data,[kdep],undefined,0);let signed=await sign(tx,'owner',0,kdep);const deployedResult=await commit('01-deploy-dependencies',signed.tx,signed.signing);
 for(const name of Object.keys(deployed))deployed[name]=point(deployedResult.txHash,deployed[name]);
 const allDeps=[kdep,...['A','F','Q'].map(n=>dep(deployed[n]))];
 const ownerForGenesis=point(deployedResult.txHash,3),ownerCell=await live(ownerForGenesis);
 const built=buildGenesis({ownerPublicKey:actors.owner.publicKey,delegates:['alice','ben'].map(role=>({publicKey:actors[role].publicKey,recipient:actors[role+'Recipient'].lock,limit:200n*CKB,perPayment:100n*CKB})),sharedLimit:250n*CKB,ownerInput:ownerCell,deps:allDeps});
 const Q=built.policy,F=c.Script.from({codeHash:H.F,hashType:'data1',args:Q.hash()});tx=built.transaction;
 signed=await sign(tx,'owner',0,kdep);const created=await commit('02-policy-genesis',signed.tx,signed.signing);
 const ownerFee=point(created.txHash,1),feeCell=await live(ownerFee);
 // Keep the first xUDT input's witness empty, matching the admitted plain
 // profile. A K witness with Some(empty input_type) is not XudtWitness data.
 tx=makeTx([ownerFee],[{capacity:1000n*CKB,lock:F},{capacity:BigInt(feeCell.cell.output.capacity)-1000n*CKB-FEE,lock:actors.owner.lock}],['0x','0x'],[kdep],undefined,0);
 signed=await sign(tx,'owner',0,kdep);const funded=await commit('03-fund-protected-treasury',signed.tx,signed.signing);
 const context={kdep,allDeps,deployed,seeds,ownerFee:point(funded.txHash,1),Q:{codeHash:Q.codeHash,hashType:Q.hashType,args:Q.args},F:{codeHash:F.codeHash,hashType:F.hashType,args:F.args},policy:point(created.txHash,0),fund:point(funded.txHash,0)};
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
async function buildRace(){
 const [role,quantity,name]=args;assert(['alice','ben'].includes(role));
 const context=await load('context'),actors=await load('actors');
 const P=await live(context.policy),fund=await live(context.fund),actor=await live(context.seeds[role]);
 const old=bytes(P.cell.data.content),next=Buffer.from(old),q=BigInt(quantity),slot=role==='alice'?0:1;
 const total=read128(bytes(fund.cell.data.content),0);assert(q>0&&q<=total);
 le128(read128(old,24)+q).copy(next,24);le128(read128(old,280+154*slot)+q).copy(next,280+154*slot);
 const tx=makeTx([context.policy,context.seeds[role],context.fund],[{...fromRawOutput(P.cell.output)},{...fromRawOutput(fund.cell.output)},{capacity:142n*CKB,lock:actors[role+'Recipient'].lock,type:T},{capacity:BigInt(actor.cell.output.capacity)-142n*CKB-FEE,lock:actors[role].lock}],[hex(next),hex(le128(total-q)),hex(le128(q)),'0x'],context.allDeps,hex(Buffer.from([81,67,65,49,1,slot,0,0])),1);
 const signed=await sign(tx,role,1,context.kdep),e=await record(name,signed.tx,signed.signing);
 await fs.writeFile(path.join(run,name+'-signed.json'),json({hash:signed.tx.hash(),transaction:e.transaction,signing:signed.signing}));
 console.log('Built from policy',context.policy.txHash,'as',process.pid,name,signed.tx.hash());
}
async function submitRace(){
 const [name,crash='no']=args;const saved=await load(name+'-signed');
 const release=path.join(run,'race-release');
 for(let i=0;i<600&&!await fs.stat(release).then(()=>true,()=>false);i++)await sleep(50);
 assert(await fs.stat(release).then(()=>true,()=>false),'race barrier timeout');
 const response={name,processId:process.pid,txHash:saved.hash,startedUTC:new Date().toISOString()};
 try{response.rpcResult=await rpc('send_transaction',[saved.transaction,'passthrough']);}
 catch(error){response.rpcError=error.rpc??{message:error.message};}
 response.finishedUTC=new Date().toISOString();
 if(crash==='on-rpc-error'&&response.rpcError){console.log('Simulated process death after RPC response loss, before receipt persistence',name,saved.hash);process.exit(74);}
 if(crash==='after-rpc-success'&&response.rpcResult){console.log('Simulated process death after RPC success before receipt persistence',name,saved.hash);process.exit(73);}
 await fs.writeFile(path.join(result,name+'-submit.json'),json(response));console.log('Submission outcome',json(response));
}
async function reconcileRace(){
 const name=args[0],saved=await load(name+'-signed');let transaction;
 try{transaction=await rpc('get_transaction',[saved.hash]);}catch(e){transaction={rpcError:e.rpc??e.message};}
 const points=saved.transaction.inputs.map(i=>i.previous_output);
 const liveInputs=[];for(const p of points)liveInputs.push(await rpc('get_live_cell',[p,true]));
 const entry={name,processId:process.pid,txHash:saved.hash,transaction,inputs:liveInputs,tip:await rpc('get_tip_header')};
 await fs.writeFile(path.join(result,name+'-reconciled.json'),json(entry));console.log('Reconciled',name,transaction?.tx_status?.status??'unknown',saved.hash);
}
async function staleResubmit(){
 const name=args[0],saved=await load(name+'-signed'),entry={name,processId:process.pid,txHash:saved.hash,attemptedUTC:new Date().toISOString()};
 try{entry.result=await rpc('send_transaction',[saved.transaction,'passthrough']);}
 catch(error){entry.error=error.rpc??{message:error.message};}
 entry.finishedUTC=new Date().toISOString();await fs.writeFile(path.join(result,name+'-stale-resubmit.json'),json(entry));console.log('Stale transaction resubmission',json(entry));
}
async function finish(){
 const context=await load('context');const p=await live(context.policy),f=await live(context.fund);const decoded=decode(p.cell.data.content);assert.equal(decoded.used,100n);assert.equal(decoded.aliceUsed,60n);assert.equal(decoded.benUsed,40n);assert.equal(read128(bytes(f.cell.data.content),0),100n);
 const tx=await rpc('get_transaction',[context.policy.txHash]);assert.equal(tx.tx_status.status,'committed');const header=await rpc('get_header',[tx.tx_status.block_hash]);assert.equal(await rpc('get_block_hash',[header.number]),header.hash);
 await save('final-chain-state',{policyOutPoint:context.policy,policyCell:p,decoded,protectedFundOutPoint:context.fund,protectedFund:f,remainingTokens:100,tip:await rpc('get_tip_header'),canonicalInclusion:{transactionStatus:tx.tx_status,header},peers:await rpc('get_peers')});console.log('PASS: Alice60 committed; Ben50 Q-rejected; Ben40 committed; canonical U100/A60/B40.');
}
async function lifecycle(){
 const context=await load('context'),actors=await load('actors');
 const initialPolicy=await live(context.policy),initialFund=await live(context.fund),alice=await live(context.seeds.alice);
 const initialState=bytes(initialPolicy.cell.data.content),paidState=Buffer.from(initialState),paid=10n;
 le128(paid).copy(paidState,24);le128(paid).copy(paidState,280);
 const initialAmount=read128(bytes(initialFund.cell.data.content),0);
 let tx=makeTx([context.policy,context.seeds.alice,context.fund],
  [{...fromRawOutput(initialPolicy.cell.output)},{...fromRawOutput(initialFund.cell.output)},
   {capacity:142n*CKB,lock:actors.aliceRecipient.lock,type:T},
   {capacity:BigInt(alice.cell.output.capacity)-142n*CKB-FEE,lock:actors.alice.lock}],
  [hex(paidState),hex(le128(initialAmount-paid)),hex(le128(paid))],context.allDeps,'0x5143413101000000',1);
 let signed=await sign(tx,'alice',1,context.kdep);const authorized=await commit('01-authorized-v2-payment',signed.tx,signed.signing);
 context.policy=point(authorized.txHash,0);context.fund=point(authorized.txHash,1);context.seeds.alice=point(authorized.txHash,3);
 await fs.writeFile(path.join(run,'context.json'),json(context));await save('01-authorized-v2-state',{policy:await live(context.policy),fund:await live(context.fund),spent:paid});
 const livePolicy=await live(context.policy),liveFund=await live(context.fund),ben=await live(context.seeds.ben);
 const overpay=51n,liveAmount=read128(bytes(liveFund.cell.data.content),0);
 tx=makeTx([context.policy,context.seeds.ben,context.fund],
  [{...fromRawOutput(livePolicy.cell.output)},{...fromRawOutput(liveFund.cell.output)},
   {capacity:142n*CKB,lock:actors.benRecipient.lock,type:T},
   {capacity:BigInt(ben.cell.output.capacity)-142n*CKB-FEE,lock:actors.ben.lock}],
  [livePolicy.cell.data.content,hex(le128(liveAmount-overpay)),hex(le128(overpay)),'0x'],context.allDeps,'0x5143413101010000',1);
 signed=await sign(tx,'ben',1,context.kdep);const limitReject=await record('01-reject-v2-over-limit-payment',signed.tx,signed.signing);
 try{limitReject.submit={result:await rpc('send_transaction',[limitReject.transaction,'passthrough'])};throw new Error('Over-limit v2 payment unexpectedly accepted');}
 catch(error){assert(error.rpc);limitReject.submit={error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/Inputs\[0\]\.Type/);}
 limitReject.policyAfterRejection=await live(context.policy);limitReject.fundAfterRejection=await live(context.fund);await save('01-reject-v2-over-limit-payment',limitReject);
 const policy=await live(context.policy),fund=await live(context.fund),feeCell=await live(context.ownerFee);
 const terminal=Buffer.concat([Buffer.from('QCT2\x02\x00\x01\x00','binary'),bytes(actors.owner.lock.args)]);
 const out=fromRawOutput(policy.cell.output);
 const minOutput=c.CellOutput.from({capacity:0n,lock:out.lock,type:out.type});
 const terminalCapacity=BigInt(minOutput.occupiedSize+terminal.length)*CKB;
 assert.equal(terminal.length,28);assert.equal(terminalCapacity,134n*CKB);
 // A compact state cannot substitute another rescue identity at closure.
 const wrongTerminal=Buffer.from(terminal);wrongTerminal[8]^=1;
 tx=makeTx([context.policy,context.ownerFee,context.fund],
  [{...out,capacity:terminalCapacity},{capacity:154n*CKB,lock:actors.owner.lock,type:T},
   {capacity:BigInt(feeCell.cell.output.capacity)+BigInt(policy.cell.output.capacity)-terminalCapacity-FEE,lock:actors.owner.lock}],
  [hex(wrongTerminal),hex(le128(read128(bytes(fund.cell.data.content),0))),'0x'],context.allDeps,'0x5143413104ff0000',1);
 signed=await sign(tx,'owner',1,context.kdep);const tampered=await record('02-reject-wrong-terminal-owner',signed.tx,signed.signing);
 try{tampered.submit={result:await rpc('send_transaction',[tampered.transaction,'passthrough'])};throw new Error('Wrong terminal owner unexpectedly accepted');}
 catch(error){assert(error.rpc);tampered.submit={error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/Inputs\[0\]\.Type/);}
 tampered.policyAfterRejection=await live(context.policy);await save('02-reject-wrong-terminal-owner',tampered);
 tx=makeTx([context.policy,context.ownerFee,context.fund],
  [{...out,capacity:terminalCapacity},{capacity:154n*CKB,lock:actors.owner.lock,type:T},
   {capacity:BigInt(feeCell.cell.output.capacity)+BigInt(policy.cell.output.capacity)-terminalCapacity-FEE,lock:actors.owner.lock}],
  [hex(terminal),hex(le128(read128(bytes(fund.cell.data.content),0))),'0x'],context.allDeps,'0x5143413105ff0000',1);
 signed=await sign(tx,'owner',1,context.kdep);const forged=await record('02-reject-forged-terminal-from-active',signed.tx,signed.signing);
 try{forged.submit={result:await rpc('send_transaction',[forged.transaction,'passthrough'])};throw new Error('Forged terminalization unexpectedly accepted');}
 catch(error){assert(error.rpc);forged.submit={error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/error code 25/);}
 forged.policyAfterRejection=await live(context.policy);await save('02-reject-forged-terminal-from-active',forged);
 tx=makeTx([context.policy,context.ownerFee,context.fund],
  [{...out,capacity:terminalCapacity},
   {capacity:154n*CKB,lock:actors.owner.lock,type:T},
   {capacity:BigInt(feeCell.cell.output.capacity)+BigInt(policy.cell.output.capacity)-terminalCapacity-FEE,lock:actors.owner.lock}],
  [hex(terminal),hex(le128(read128(bytes(fund.cell.data.content),0))),'0x'],context.allDeps,'0x5143413104ff0000',1);
 signed=await sign(tx,'owner',1,context.kdep);
 const close=await commit('02-owner-close-compact',signed.tx,signed.signing);
 context.policy=point(close.txHash,0);context.ownerTokens=point(close.txHash,1);context.ownerFee=point(close.txHash,2);
 const closed=await live(context.policy);assert.equal(closed.cell.data.content,hex(terminal));
 const closeAccounting={activeStateBytes:466,terminalStateBytes:terminal.length,policyInputShannons:policy.cell.output.capacity,
  terminalOccupiedShannons:terminalCapacity,ownerCapacityReleasedShannons:BigInt(policy.cell.output.capacity)-terminalCapacity,
  closeFeeShannons:close.feeShannon,ownerChangeShannons:close.transaction.outputs[2].capacity};
 await save('03-compact-closed-live',{policy:closed,decoded:decode(closed.cell.data.content),accounting:closeAccounting});
 const renewal=Buffer.alloc(57);renewal.write('QCA1');renewal[4]=2;renewal[5]=255;le128(1n).copy(renewal,8);
 const closedFee=await live(context.ownerFee);
 tx=makeTx([context.policy,context.ownerFee],[{...fromRawOutput(closed.cell.output)},
  {capacity:BigInt(closedFee.cell.output.capacity)-FEE,lock:actors.owner.lock}],
  [hex(terminal),'0x'],context.allDeps,hex(renewal),1);
 signed=await sign(tx,'owner',1,context.kdep);const reenable=await record('03-reject-reenable-after-close',signed.tx,signed.signing);
 try{reenable.submit={result:await rpc('send_transaction',[reenable.transaction,'passthrough'])};throw new Error('Delegate re-enable after closure unexpectedly accepted');}
 catch(error){assert(error.rpc);reenable.submit={error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/error code 25/);}
 reenable.policyAfterRejection=await live(context.policy);await save('03-reject-reenable-after-close',reenable);
 // A deposit after closure creates another proxy-locked fund Cell and remains
 // recoverable because the compact terminal policy retains its exact identity.
 const ownerFeeCell=await live(context.ownerFee),ownerTokens=await live(context.ownerTokens);
 const ownerTokenAmount=read128(bytes(ownerTokens.cell.data.content),0);
 tx=makeTx([context.ownerFee,context.ownerTokens],
  [{capacity:154n*CKB,lock:fromRawOutput(fund.cell.output).lock,type:T},
   {capacity:154n*CKB,lock:actors.owner.lock,type:T},
   {capacity:BigInt(ownerFeeCell.cell.output.capacity)+BigInt(ownerTokens.cell.output.capacity)-308n*CKB-FEE,lock:actors.owner.lock}],
  [hex(le128(50n)),hex(le128(ownerTokenAmount-50n)),'0x'],[context.kdep,dep(context.deployed.T)],undefined,0);
 signed=await sign(tx,'owner',0,context.kdep);const late=await commit('04-late-deposit-after-close',signed.tx,signed.signing);
 context.lateFund=point(late.txHash,0);context.ownerTokens=point(late.txHash,1);context.ownerFee=point(late.txHash,2);
 await save('05-terminal-survives-late-deposit',{terminalPolicy:await live(context.policy),lateFund:await live(context.lateFund),lateTokenAmount:50});
 // A delegate cannot use the same late deposit after closure.
 const lateCell=await live(context.lateFund),aliceCell=await live(context.seeds.alice),terminalCell=await live(context.policy);
 const terminalOut=fromRawOutput(terminalCell.cell.output),fundOut=fromRawOutput(lateCell.cell.output);
 tx=makeTx([context.policy,context.seeds.alice,context.lateFund],
  [{...terminalOut},{...fundOut},{capacity:142n*CKB,lock:actors.aliceRecipient.lock,type:T},
   {capacity:BigInt(aliceCell.cell.output.capacity)-142n*CKB-FEE,lock:actors.alice.lock}],
  [hex(terminal),hex(le128(30n)),hex(le128(20n)),'0x'],context.allDeps,'0x5143413101000000',1);
 signed=await sign(tx,'alice',1,context.kdep);const afterClose=await record('06-reject-delegate-after-close',signed.tx,signed.signing);
 try{afterClose.submit={result:await rpc('send_transaction',[afterClose.transaction,'passthrough'])};throw new Error('Delegate payment after closure unexpectedly accepted');}
 catch(error){assert(error.rpc);afterClose.submit={error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/Inputs\[0\]\.Type/);}
 afterClose.policyAfterRejection=await live(context.policy);afterClose.fundAfterRejection=await live(context.lateFund);await save('06-reject-delegate-after-close',afterClose);
 // Owner sweeps the late deposit while preserving the compact policy state.
 const terminalFee=await live(context.ownerFee),lateForSweep=await live(context.lateFund);
 tx=makeTx([context.policy,context.ownerFee,context.lateFund],
  [{...terminalOut},{capacity:154n*CKB,lock:actors.owner.lock,type:T},
   {capacity:BigInt(terminalFee.cell.output.capacity)+BigInt(terminalCell.cell.output.capacity)-134n*CKB-FEE,lock:actors.owner.lock}],
  [hex(terminal),hex(le128(50n)),'0x'],context.allDeps,'0x5143413105ff0000',1);
 signed=await sign(tx,'owner',1,context.kdep);const swept=await commit('07-owner-sweeps-late-deposit',signed.tx,signed.signing);
 context.policy=point(swept.txHash,0);context.ownerTokens=point(swept.txHash,1);context.ownerFee=point(swept.txHash,2);
 const finalPolicy=await live(context.policy);assert.equal(finalPolicy.cell.data.content,hex(terminal));
 await save('08-final-capital-state',{policy:finalPolicy,decoded:decode(finalPolicy.cell.data.content),ownerTokenCell:await live(context.ownerTokens),accounting:closeAccounting,
  conclusions:{lateDepositRecovered:true,delegatedPaymentAfterClosureRejected:true,terminalIdentityStable:true}});
 const deleted=makeTx([context.policy,context.ownerFee],[{capacity:BigInt(finalPolicy.cell.output.capacity)+BigInt((await live(context.ownerFee)).cell.output.capacity)-FEE,lock:actors.owner.lock}],['0x'],context.allDeps,'0x5143413105ff0000',1);
 signed=await sign(deleted,'owner',1,context.kdep);const deletion=await record('09-reject-terminal-deletion',signed.tx,signed.signing);
 try{deletion.submit={result:await rpc('send_transaction',[deletion.transaction,'passthrough'])};throw new Error('Terminal policy deletion unexpectedly accepted');}
 catch(error){assert(error.rpc);deletion.submit={error:error.rpc};assert.equal(error.rpc.code,-302);assert.match(JSON.stringify(error.rpc),/Inputs\[0\]\.Type/);}
 deletion.policyAfterRejection=await live(context.policy);await save('09-reject-terminal-deletion',deletion);
}
async function nativeLifecycle(){
 const ctx=await load('context'), actors=await load('actors');
 const act=(op,slot=255,extra=[])=>hex(Buffer.from([81,67,65,49,op,slot,0,0,...extra]));
 async function reject(name,tx,role,code){
  const signed=await sign(tx,role,1,ctx.kdep), e=await record(name,signed.tx,signed.signing);
  try { await rpc('send_transaction',[e.transaction,'passthrough']); throw new Error(name+' unexpectedly accepted'); }
  catch(err){assert(err.rpc,err.stack);e.submit={error:err.rpc};assert.equal(err.rpc.code,-302);if(code)assert.match(JSON.stringify(err.rpc),new RegExp('error code '+code));if(name==='reject-dupdep')assert.match(JSON.stringify(err.rpc),/DuplicateCellDeps/);}
  await save(name,e);
 }
 async function payment(role,q,variant='valid'){
  const slot=role==='alice'?0:1, p=await live(ctx.policy), f=await live(ctx.fund), actor=await live(ctx.seeds[role]);
  const old=bytes(p.cell.data.content),next=Buffer.from(old), amount=q*CKB;
  if(variant!=='shared' && variant!=='disabled') {le128(read128(old,24)+amount).copy(next,24);le128(read128(old,280+154*slot)+amount).copy(next,280+154*slot);}
  const extra=ctx.fund2?await live(ctx.fund2):null;
  const protectedCap=BigInt(f.cell.output.capacity)+(extra?BigInt(extra.cell.output.capacity):0n), feeCap=BigInt(actor.cell.output.capacity);
  const outputs=[fromRawOutput(p.cell.output),{capacity:protectedCap-amount,lock:ctx.F},{capacity:amount,lock:actors[role+'Recipient'].lock},{capacity:feeCap-FEE,lock:actors[role].lock}];
  if(variant==='recipient') outputs[2].lock=actors[role==='alice'?'benRecipient':'aliceRecipient'].lock;
  if(variant==='divert') outputs[1].lock=actors[role].lock;
  if(variant==='extract') {outputs[1].capacity-=CKB;outputs[3].capacity+=CKB;}
  if(variant==='fee') outputs[1].capacity-=1000n;
  if(variant==='split') {outputs[2].capacity-=61n*CKB;outputs.push({capacity:61n*CKB,lock:actors[role+'Recipient'].lock});}
  if(variant==='malformed') next[40]=1;
  if(variant==='excessfee') outputs[3].capacity-=1000000n;
  if(variant==='identity') outputs[1].lock={...ctx.F,args:'0x'+'00'.repeat(32)};
  const deps=variant==='dupdep'?[...ctx.allDeps,dep(ctx.deployed.A)]:ctx.allDeps;
  const tx=makeTx([ctx.policy,ctx.seeds[role],ctx.fund,...(ctx.fund2?[ctx.fund2]:[])],outputs,outputs.map((_,i)=>i===0?hex(next):'0x'),deps,act(1,slot),1);
  if(variant!=='valid'){await reject('reject-'+variant,tx,role,variant==='recipient'?28:variant==='extract'||variant==='fee'||variant==='excessfee'?23:variant==='shared'?20:variant==='disabled'?17:variant==='malformed'?10:variant==='dupdep'?null:13);return;}
  const signed=await sign(tx,role,1,ctx.kdep),e=await commit('pay-'+role,signed.tx,signed.signing);
  ctx.policy=point(e.txHash,0);ctx.fund=point(e.txHash,1);ctx.seeds[role]=point(e.txHash,3);delete ctx.fund2;return e;
 }
 const initial=await live(ctx.policy),impostor=await live(ctx.seeds.alice),badState=bytes(initial.cell.data.content);badState[7]&=~1;
 const unauthorized=makeTx([ctx.policy,ctx.seeds.alice],[fromRawOutput(initial.cell.output),{capacity:BigInt(impostor.cell.output.capacity)-FEE,lock:actors.alice.lock}],[hex(badState),'0x'],ctx.allDeps,act(3,255,[1]),1);
 await reject('unauthorized-revoke',unauthorized,'alice',15);
 let funding=await live(ctx.ownerFee),extraTx=makeTx([ctx.ownerFee],[{capacity:200n*CKB,lock:ctx.F},{capacity:BigInt(funding.cell.output.capacity)-200n*CKB-FEE,lock:actors.owner.lock}],['0x','0x'],[ctx.kdep],undefined,0);
 let extraSigned=await sign(extraTx,'owner',0,ctx.kdep),extraCommit=await commit('second-fund',extraSigned.tx,extraSigned.signing);ctx.fund2=point(extraCommit.txHash,0);ctx.ownerFee=point(extraCommit.txHash,1);
 await payment('alice',100n,'recipient');await payment('alice',100n,'divert');await payment('alice',100n,'identity');await payment('alice',100n,'extract');await payment('alice',100n,'fee');await payment('alice',100n,'excessfee');await payment('alice',100n,'malformed');await payment('alice',100n,'dupdep');await payment('alice',130n,'split');
 const stale=structuredClone(ctx.policy),alicePayment=await payment('alice',100n);await payment('ben',100n);await payment('alice',61n,'shared');
 const staleResult=await rpc('get_live_cell',[outpointJSON(stale),true]);assert.notEqual(staleResult.status,'live');let staleError;try{await rpc('send_transaction',[alicePayment.transaction,'passthrough']);throw new Error('stale transaction accepted');}catch(err){assert(err.rpc);assert.equal(err.rpc.code,-301);staleError=err.rpc;}await save('stale-policy',{outpoint:stale,result:staleResult,error:staleError});
 let p=await live(ctx.policy), owner=await live(ctx.ownerFee), old=bytes(p.cell.data.content),next=Buffer.from(old);next[7]&=~1;
 let tx=makeTx([ctx.policy,ctx.ownerFee],[fromRawOutput(p.cell.output),{capacity:BigInt(owner.cell.output.capacity)-FEE,lock:actors.owner.lock}],[hex(next),'0x'],ctx.allDeps,act(3,255,[1]),1);
 let signed=await sign(tx,'owner',1,ctx.kdep),e=await commit('owner-revoke-alice',signed.tx,signed.signing);ctx.policy=point(e.txHash,0);ctx.ownerFee=point(e.txHash,1);
 await payment('alice',61n,'disabled');
 p=await live(ctx.policy);owner=await live(ctx.ownerFee);const fund=await live(ctx.fund),terminal=Buffer.concat([Buffer.from('5143543404000100','hex'),bytes(actors.owner.lock.args)]),release=BigInt(p.cell.output.capacity)-134n*CKB;
 tx=makeTx([ctx.policy,ctx.ownerFee,ctx.fund],[{...fromRawOutput(p.cell.output),capacity:134n*CKB},{capacity:BigInt(fund.cell.output.capacity),lock:actors.owner.lock},{capacity:BigInt(owner.cell.output.capacity)+release-FEE,lock:actors.owner.lock}],[hex(terminal),'0x','0x'],ctx.allDeps,act(4),1);
 signed=await sign(tx,'owner',1,ctx.kdep);e=await commit('owner-close-recover',signed.tx,signed.signing);ctx.policy=point(e.txHash,0);ctx.ownerFee=point(e.txHash,2);
 owner=await live(ctx.ownerFee);tx=makeTx([ctx.ownerFee],[{capacity:200n*CKB,lock:ctx.F},{capacity:BigInt(owner.cell.output.capacity)-200n*CKB-FEE,lock:actors.owner.lock}],['0x','0x'],[ctx.kdep],undefined,0);
 signed=await sign(tx,'owner',0,ctx.kdep);e=await commit('late-deposit',signed.tx,signed.signing);const late=point(e.txHash,0);ctx.ownerFee=point(e.txHash,1);
 const latePolicy=await live(ctx.policy),aliceFee=await live(ctx.seeds.alice);
 tx=makeTx([ctx.policy,ctx.seeds.alice,late],[fromRawOutput(latePolicy.cell.output),{capacity:100n*CKB,lock:ctx.F},{capacity:100n*CKB,lock:actors.aliceRecipient.lock},{capacity:BigInt(aliceFee.cell.output.capacity)-FEE,lock:actors.alice.lock}],[hex(terminal),'0x','0x','0x'],ctx.allDeps,act(1,0),1);
 await reject('delegate-after-close',tx,'alice',15);
 p=await live(ctx.policy);owner=await live(ctx.ownerFee);tx=makeTx([ctx.policy,ctx.ownerFee,late],[fromRawOutput(p.cell.output),{capacity:200n*CKB,lock:actors.owner.lock},{capacity:BigInt(owner.cell.output.capacity)-FEE,lock:actors.owner.lock}],[hex(terminal),'0x','0x'],ctx.allDeps,act(5),1);
 signed=await sign(tx,'owner',1,ctx.kdep);e=await commit('owner-late-sweep',signed.tx,signed.signing);ctx.policy=point(e.txHash,0);
 await save('native-final',{policy:await live(ctx.policy),initialFundCKB:1200,paidCKB:200,recoveredFundCKB:1000,lateRecoveredCKB:200,policyReleasedCKB:466,terminalCKB:134});
}
await fs.mkdir(result,{recursive:true});
try{if(mode==='keys')await keys();else if(mode==='setup')await setup();else if(mode==='native')await nativeLifecycle();else throw new Error('Unknown mode');}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
