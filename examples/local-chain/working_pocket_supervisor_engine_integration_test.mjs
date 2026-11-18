import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as c from '@ckb-ccc/core';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-supervisor-engine-'));
const run=path.join(root,'run'),evidence=path.join(root,'test-evidence');
const ownerMinimum=66100002000n,ckb=100000000n;
let runner,proxy,proxyPort,backendPort,output='',errorOutput='',lossesRemaining=0,sendCalls=0,lostResponses=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitExit=child=>new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server.address().port;}
async function close(server){if(server)await new Promise(resolve=>server.close(()=>resolve()));}
async function waitFor(check,label,timeout=240000){
 const end=Date.now()+timeout;let last;
 while(Date.now()<end){
  if(runner&&runner.exitCode!==null)throw new Error(`${label}: chain runner exited ${runner.exitCode}\n${output}\n${errorOutput}`);
  try{const value=await check();if(value)return value;}catch(cause){last=cause;}
  await pause(250);
 }
 throw new Error(`${label} timed out${last?`: ${last.message}`:''}\n${output}\n${errorOutput}`);
}
async function rpc(url,method,params=[]){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
 const body=await response.json();assert(response.ok,`${method}: HTTP ${response.status}`);assert(!body.error,`${method}: ${JSON.stringify(body.error)}`);return body.result;
}
async function api(origin,route,body){
 const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{origin,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await response.text();return {status:response.status,value:text?JSON.parse(text):null};
}
const num=value=>'0x'+BigInt(value).toString(16);
const point=value=>({tx_hash:value.txHash,index:num(value.index)});
const script=value=>({code_hash:value.codeHash,hash_type:value.hashType,args:value.args});
function raw(transaction){
 return {version:num(transaction.version),cell_deps:transaction.cellDeps.map(item=>({out_point:point(item.outPoint),dep_type:item.depType==='depGroup'?'dep_group':item.depType})),header_deps:transaction.headerDeps,inputs:transaction.inputs.map(item=>({since:num(item.since),previous_output:point(item.previousOutput)})),outputs:transaction.outputs.map(item=>({capacity:num(item.capacity),lock:script(item.lock),type:item.type?script(item.type):null})),outputs_data:transaction.outputsData,witnesses:transaction.witnesses};
}
function transactionFromRaw(value){
 const readScript=item=>item&&({codeHash:item.code_hash,hashType:item.hash_type,args:item.args});
 return c.Transaction.from({version:BigInt(value.version),cellDeps:value.cell_deps.map(item=>({outPoint:{txHash:item.out_point.tx_hash,index:Number(BigInt(item.out_point.index))},depType:item.dep_type==='dep_group'?'depGroup':item.dep_type})),headerDeps:value.header_deps,inputs:value.inputs.map(item=>({since:BigInt(item.since),previousOutput:{txHash:item.previous_output.tx_hash,index:Number(BigInt(item.previous_output.index))}})),outputs:value.outputs.map(item=>({capacity:BigInt(item.capacity),lock:readScript(item.lock),type:readScript(item.type)})),outputsData:value.outputs_data,witnesses:value.witnesses});
}
async function privateSigner(role){
 const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
 const secret=JSON.parse(await fs.readFile(path.join(run,'keys',`${role}.json`),'utf8'));
 return new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]}),secret.privateKey);
}
async function signPrepared(request,role='owner'){
 const signer=await privateSigner(role),transaction=c.Transaction.fromBytes(request.transaction),signed=await signer.signOnlyTransaction(transaction);
 return {id:request.id,transaction:signed.toHex(),hash:signed.hash()};
}
async function waitCommitted(url,hash){
 for(let i=0;i<30;i++){
  const value=await rpc(url,'get_transaction',[hash]);
  if(value?.tx_status?.status==='committed'){
   const header=await rpc(url,'get_header',[value.tx_status.block_hash]);assert.equal(await rpc(url,'get_block_hash',[header.number]),header.hash,'Transaction confirmation must be canonical');return value;
  }
  await rpc(url,'generate_block');await pause(100);
 }
 throw new Error(`Transaction did not confirm: ${hash}`);
}
async function splitOwnerFee(url,context,actors){
 const originalPolicy=await rpc(url,'get_live_cell',[point(context.policy),true]);
 const source=await rpc(url,'get_live_cell',[point(context.ownerFee),true]);assert.equal(source.status,'live');
 const capacity=BigInt(source.cell.output.capacity),fee=2000n,first=(capacity-fee)/2n,second=capacity-fee-first;
 assert(first>=ownerMinimum&&second>=ownerMinimum,'Disposable owner fee cell is too small to split into separate Pocket funding cells');
 const tx=c.Transaction.from({inputs:[{previousOutput:{txHash:context.ownerFee.txHash,index:context.ownerFee.index},since:0}],outputs:[{capacity:first,lock:c.Script.from(actors.owner.lock)},{capacity:second,lock:c.Script.from(actors.owner.lock)}],outputsData:['0x','0x'],cellDeps:[context.kdep],headerDeps:[],witnesses:['0x']});
 tx.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});
 const signed=await (await privateSigner('owner')).signOnlyTransaction(tx);
 await rpc(url,'dry_run_transaction',[raw(signed)]);assert.equal(await rpc(url,'send_transaction',[raw(signed),'passthrough']),signed.hash());await waitCommitted(url,signed.hash());
 const updated={...context,ownerFee:{txHash:signed.hash(),index:1}};
 await fs.writeFile(path.join(run,'context.json'),JSON.stringify(updated,null,2));
 await fs.writeFile(path.join(run,'pocket.json'),JSON.stringify({initial:updated,actors},null,2));
 const policyAfter=await rpc(url,'get_live_cell',[point(updated.policy),true]);assert.equal(policyAfter.status,'live');assert.equal(policyAfter.cell.data.content,originalPolicy.cell.data.content,'Fixture funding split must not change existing QCN4 policy state');
 return {updated,spare:{txHash:signed.hash(),index:0},splitHash:signed.hash(),spareCapacity:first.toString(),pocketFeeCapacity:second.toString(),originalPolicyData:originalPolicy.cell.data.content};
}
async function restartSupervisor(origin,owner,label){
 const before=JSON.parse(await fs.readFile(path.join(run,'supervisor-process.json'),'utf8')).pid;
 process.kill(before);
 return waitFor(async()=>{
  const current=JSON.parse(await fs.readFile(path.join(run,'supervisor-process.json'),'utf8')).pid;
  if(current===before)return false;
  const response=await fetch(`${origin}/api/state?actor=${encodeURIComponent(owner)}`);return response.ok?current:false;
 },label);
}
async function stopRunner(){
 try{await fs.writeFile(path.join(run,'supervisor-test-stop'),'stop\n');}catch{}
 try{const child=JSON.parse(await fs.readFile(path.join(run,'supervisor-process.json'),'utf8'));if(child.pid)process.kill(child.pid);}catch{}
 if(runner&&runner.exitCode===null){
  const ended=await Promise.race([waitExit(runner).then(()=>true),pause(20000).then(()=>false)]);
  if(!ended){try{const child=JSON.parse(await fs.readFile(path.join(run,'process.json'),'utf8'));process.kill(child.pid);}catch{}runner.kill();await Promise.race([waitExit(runner),pause(5000)]);}
 }
}

try{
 await fs.mkdir(evidence,{recursive:true});
 const proxyServer=http.createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk);
  const body=Buffer.concat(chunks),call=JSON.parse(body.toString());if(call.method==='send_transaction')sendCalls++;
  try{
   const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
   const upstream=await fetch(runtime.url,{method:'POST',headers:{'content-type':'application/json'},body});const payload=Buffer.from(await upstream.arrayBuffer());
   if(call.method==='send_transaction'&&lossesRemaining>0){lossesRemaining--;lostResponses++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'controlled send response loss after forwarding'}}));return;}
   response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});response.end(payload);
  }catch(cause){response.writeHead(502,{'content-type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:String(cause?.message||cause)}}));}
 });
 proxy=proxyServer;proxyPort=await listen(proxy);
 const hold=net.createServer();backendPort=await listen(hold);await close(hold);
 const origin=`http://127.0.0.1:${backendPort}`;
 runner=spawn('python',[path.join(here,'working_pocket_start.py'),'--scenario','supervisor','--run-dir',run,'--port',String(backendPort)],{cwd:here,windowsHide:true,env:{...process.env,QUOTACELL_TEST_RPC_PROXY:`http://127.0.0.1:${proxyPort}`,QUOTACELL_TEST_RESULTS_DIR:evidence},stdio:['ignore','pipe','pipe']});
 runner.stdout.setEncoding('utf8');runner.stderr.setEncoding('utf8');runner.stdout.on('data',chunk=>{output=(output+chunk).slice(-15000);});runner.stderr.on('data',chunk=>{errorOutput=(errorOutput+chunk).slice(-5000);});
 await waitFor(async()=>{
  for(const file of ['runtime.json','actors.json','context.json','evidence/node-profile.json'])await fs.access(path.join(run,file));
  return true;
 },'disposable chain fixture setup');
 const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
 const actors=JSON.parse(await fs.readFile(path.join(run,'actors.json'),'utf8'));
 const baseContext=JSON.parse(await fs.readFile(path.join(run,'context.json'),'utf8'));
 const profile=JSON.parse(await fs.readFile(path.join(run,'evidence','node-profile.json'),'utf8'));
 await fs.writeFile(path.join(run,'deployment.json'),JSON.stringify({genesis:profile.genesisHeader.hash,kdep:baseContext.kdep,allDeps:baseContext.allDeps,deployed:baseContext.deployed},null,2));
 const split=await splitOwnerFee(runtime.url,baseContext,actors),context=split.updated;
 await fs.writeFile(path.join(run,'supervisor-test-ready'),'ready\n');
 await waitFor(async()=>output.includes(`QuotaCell multi-Pocket supervisor: ${origin}`),'real supervisor startup');
 const pocketA=c.Script.from(context.Q).hash().toLowerCase(),owner=actors.owner.publicKey;
 const firstState=await api(origin,`/api/state?pocket=${pocketA}&actor=${encodeURIComponent(owner)}`);
 assert.equal(firstState.status,200,JSON.stringify(firstState.value));assert.equal(firstState.value.pocket,pocketA);assert.equal(firstState.value.multiPocket,true);

 const delegates=['alice','ben'].map(role=>({publicKey:actors[role].publicKey,recipient:actors[role+'Recipient'].lock,limit:(200n*ckb).toString(),perPayment:(100n*ckb).toString()}));
 const sharedLimit=(250n*ckb).toString(),draftA=randomUUID(),draftB=randomUUID(),genesisId=randomUUID();
 const genesisBody={draftId:draftA,id:genesisId,publicKey:owner,delegates,sharedLimit};
 const [staleGenesis,replayedGenesis]=await Promise.all([api(origin,'/api/external/genesis',genesisBody),api(origin,'/api/external/genesis',genesisBody)]);assert.equal(staleGenesis.status,200,JSON.stringify(staleGenesis.value));assert.equal(replayedGenesis.status,200,JSON.stringify(replayedGenesis.value));assert.equal(replayedGenesis.value.transaction,staleGenesis.value.transaction,'Concurrent retries must receive the same unsigned transaction');
 const conflictingGenesis=await api(origin,'/api/external/genesis',{...genesisBody,sharedLimit:(251n*ckb).toString()});assert.equal(conflictingGenesis.status,400,'A request ID cannot be reused with changed Pocket rules');
 const staleSignedGenesis=await signPrepared(staleGenesis.value);
 const supervisorDbPath=path.join(run,'pocket-supervisor.sqlite'),expiredReservationDb=new DatabaseSync(supervisorDbPath);
 expiredReservationDb.prepare('DELETE FROM reservations WHERE request_id=?').run(genesisId);expiredReservationDb.close();
 const sendsBeforeExpired=sendCalls,expiredGenesisResult=await api(origin,'/api/external/submit',staleSignedGenesis);
 assert.equal(expiredGenesisResult.status,200);assert.equal(expiredGenesisResult.value.state,'not-sent');assert.equal(expiredGenesisResult.value.notSent,true);
 assert.equal(sendCalls,sendsBeforeExpired,'An expired signing request must not broadcast');
 const freshGenesisBody={...genesisBody,id:randomUUID()},preparedGenesis=await api(origin,'/api/external/genesis',freshGenesisBody);assert.equal(preparedGenesis.status,200,JSON.stringify(preparedGenesis.value));
 const genesisTransaction=c.Transaction.fromBytes(preparedGenesis.value.transaction),genesisInput=genesisTransaction.inputs[0].previousOutput;
 assert(genesisInput.txHash.toLowerCase()!==context.ownerFee.txHash.toLowerCase()||BigInt(genesisInput.index)!==BigInt(context.ownerFee.index),'New Pocket genesis must not consume the existing Pocket fee Cell');
 const genesisSource=await rpc(runtime.url,'get_live_cell',[{tx_hash:genesisInput.txHash,index:num(genesisInput.index)},true]);assert.equal(genesisSource.status,'live');
 assert.equal(genesisSource.cell.output.type,null);assert.equal(genesisSource.cell.data.content,'0x');
 assert(c.Script.from({codeHash:genesisSource.cell.output.lock.code_hash,hashType:genesisSource.cell.output.lock.hash_type,args:genesisSource.cell.output.lock.args}).eq(c.Script.from(actors.owner.lock)),'Genesis must use an owner-controlled funding Cell');
 const collision=await api(origin,'/api/external/genesis',{...genesisBody,draftId:draftB,id:randomUUID()});assert.equal(collision.status,400);assert.match(collision.value.error,/already reserves one of these owner-controlled inputs|Pocket identity is already assigned to another runtime context/);
 const signedGenesis=await signPrepared(preparedGenesis.value);
 const wrongGenesisRequest=await api(origin,'/api/external/submit',{id:randomUUID(),transaction:signedGenesis.transaction});assert.equal(wrongGenesisRequest.status,200,'An expired request is reported as a recoverable non-submission');assert.equal(wrongGenesisRequest.value.state,'not-sent');assert.equal(wrongGenesisRequest.value.notSent,true,'An unknown request is explicitly distinguished from an uncertain broadcast');
 const submittedGenesis=await api(origin,'/api/external/submit',signedGenesis);assert.equal(submittedGenesis.status,200,JSON.stringify(submittedGenesis.value));assert.equal(submittedGenesis.value.state,'committed');
 const pocketB=submittedGenesis.value.pocket.toLowerCase();assert.notEqual(pocketA,pocketB);
 const sendAfterGenesis=sendCalls;
 const duplicateGenesis=await api(origin,'/api/external/submit',signedGenesis);assert.equal(duplicateGenesis.status,200);assert.equal(duplicateGenesis.value.state,'committed','A replay returns the existing committed outcome');assert.equal(duplicateGenesis.value.pocket,pocketB);assert.equal(sendCalls,sendAfterGenesis,'A replay must not broadcast again');

 const discovery=await api(origin,`/api/state?actor=${encodeURIComponent(owner)}`);assert.equal(discovery.status,200);assert.equal(discovery.value.discovery.length,2,'The owner must discover both independently identified Pockets');
 for(const pocket of [pocketA,pocketB]){const state=await api(origin,`/api/state?pocket=${pocket}&actor=${encodeURIComponent(owner)}`);assert.equal(state.status,200,`Pocket ${pocket}: ${JSON.stringify(state.value)}`);assert.equal(state.value.pocket,pocket);assert.equal(state.value.multiPocket,true);}

 const prepareDeposit=async(pocket,id)=>api(origin,'/api/external/owner',{id,pocket,operation:'deposit',role:'owner',amount:'100',publicKey:owner});
 const transactionInputs=value=>c.Transaction.fromBytes(value.transaction).inputs.map(item=>({txHash:item.previousOutput.txHash,index:Number(item.previousOutput.index)}));
 const probeRequest=randomUUID(),probeB=await prepareDeposit(pocketB,probeRequest);assert.equal(probeB.status,200,JSON.stringify(probeB.value));
 const equivalentStatus=await api(origin,'/api/external/preparation-status',{endpoint:'owner',publicKey:owner,amount:'100',role:'owner',operation:'deposit',pocket:pocketB,id:probeRequest});assert.equal(equivalentStatus.status,200,JSON.stringify(equivalentStatus.value));assert.equal(equivalentStatus.value.state,'prepared','The same bound request survives equivalent JSON property ordering');
 const selectedBInput=transactionInputs(probeB.value)[0];assert(selectedBInput,'Pocket B probe must contain its owner input');
 const rootDescriptorPath=path.join(run,'pocket.json'),originalRootDescriptor=JSON.parse(await fs.readFile(rootDescriptorPath,'utf8'));
 const rootContextPath=path.join(run,'context.json'),originalRootContext=JSON.parse(await fs.readFile(rootContextPath,'utf8'));
 const sharedRootDescriptor=structuredClone(originalRootDescriptor);sharedRootDescriptor.initial.ownerFee=selectedBInput;await fs.writeFile(rootDescriptorPath,JSON.stringify(sharedRootDescriptor,null,2));
 const sharedRootContext=structuredClone(originalRootContext);sharedRootContext.ownerFee=selectedBInput;await fs.writeFile(rootContextPath,JSON.stringify(sharedRootContext,null,2));
 await restartSupervisor(origin,owner,'supervisor restart for shared-input test');
 const sharedRequestA=randomUUID(),sharedRequestB=randomUUID(),sharedA=await prepareDeposit(pocketA,sharedRequestA);assert.equal(sharedA.status,200,JSON.stringify(sharedA.value));
 assert.deepEqual(transactionInputs(sharedA.value),[selectedBInput],'The root Pocket must use the same live owner Cell selected by Pocket B');
 const sharedB=await prepareDeposit(pocketB,sharedRequestB);
 if(sharedB.status!==400){
  const diagnosisDb=new DatabaseSync(supervisorDbPath,{readOnly:true}),reservationRows=diagnosisDb.prepare('SELECT request_id,context_id,pocket,inputs_json,phase FROM reservations WHERE request_id IN (?,?)').all(sharedRequestA,sharedRequestB);diagnosisDb.close();
  assert.fail(`Expected shared-input rejection: ${JSON.stringify({status:sharedB.status,response:sharedB.value,inputsA:transactionInputs(sharedA.value),inputsB:transactionInputs(sharedB.value),reservations:reservationRows})}`);
 }
 assert.match(sharedB.value.error,/already reserves one of these owner-controlled inputs/);
 await fs.writeFile(rootDescriptorPath,JSON.stringify(originalRootDescriptor,null,2));await fs.writeFile(rootContextPath,JSON.stringify(originalRootContext,null,2));
 await restartSupervisor(origin,owner,'supervisor restart after shared-input test');
 const releasedPrepared=new DatabaseSync(supervisorDbPath,{readOnly:true});assert.equal(releasedPrepared.prepare('SELECT 1 FROM reservations WHERE request_id IN (?,?)').all(sharedRequestA,sharedRequestB).length,0,'Unsigned requests are discarded after supervisor restart');releasedPrepared.close();

 const badSignerId=randomUUID(),badSignerRequest=await prepareDeposit(pocketB,badSignerId);assert.equal(badSignerRequest.status,200,JSON.stringify(badSignerRequest.value));
 const badSignerTx=await signPrepared(badSignerRequest.value,'alice');const badSignerResult=await api(origin,'/api/external/submit',badSignerTx);assert.equal(badSignerResult.status,200);assert.equal(badSignerResult.value.state,'not-sent');assert.match(badSignerResult.value.error,/signature|actor/i);

 const requestA=randomUUID(),requestB=randomUUID();
 const preparedA=await prepareDeposit(pocketA,requestA),preparedB=await prepareDeposit(pocketB,requestB);
 assert.equal(preparedA.status,200,JSON.stringify(preparedA.value));assert.equal(preparedB.status,200,JSON.stringify(preparedB.value));
 const txA=c.Transaction.fromBytes(preparedA.value.transaction),txB=c.Transaction.fromBytes(preparedB.value.transaction);
 const inputA=txA.inputs[0].previousOutput,inputB=txB.inputs[0].previousOutput;
 assert(inputA.txHash.toLowerCase()!==inputB.txHash.toLowerCase()||BigInt(inputA.index)!==BigInt(inputB.index),'Independent Pocket operations must use distinct owner fee inputs');
 const signedA=await signPrepared(preparedA.value),signedB=await signPrepared(preparedB.value);
 const beforeRejectedSubmissions=sendCalls;
 const wrongRequest=await api(origin,'/api/external/submit',{id:randomUUID(),transaction:signedA.transaction});assert.equal(wrongRequest.status,200);assert.equal(wrongRequest.value.state,'not-sent');
 const crossPocket=await api(origin,'/api/external/submit',{id:requestB,transaction:signedA.transaction});assert.equal(crossPocket.status,200,'A cross-Pocket signature is rejected as a known non-submission');assert.equal(crossPocket.value.state,'not-sent');
 const consumedCrossPocket=await api(origin,'/api/external/submit',signedB);assert.equal(consumedCrossPocket.status,200,'A rejected cross-Pocket submission must not leave its request replayable');assert.equal(consumedCrossPocket.value.state,'not-sent');assert.equal(sendCalls,beforeRejectedSubmissions,'Rejected requests must not broadcast');
 const requestBRecovery=randomUUID(),preparedBRecovery=await prepareDeposit(pocketB,requestBRecovery);assert.equal(preparedBRecovery.status,200,JSON.stringify(preparedBRecovery.value));
 const signedBRecovery=await signPrepared(preparedBRecovery.value);
 const beforeLost=sendCalls;lossesRemaining=2;
 const uncertainA=await api(origin,'/api/external/submit',signedA);assert.equal(uncertainA.status,200,JSON.stringify(uncertainA.value));assert.equal(uncertainA.value.state,'uncertain');assert.match(uncertainA.value.error,/controlled send response loss/);
 const uncertainB=await api(origin,'/api/external/submit',signedBRecovery);assert.equal(uncertainB.status,200,JSON.stringify(uncertainB.value));assert.equal(uncertainB.value.state,'uncertain');assert.match(uncertainB.value.error,/controlled send response loss/);
 assert.equal(sendCalls,beforeLost+2);assert.equal(lostResponses,2);
 const savedBytes={};
 for(const [id,signed] of [[requestA,signedA],[requestBRecovery,signedBRecovery]]){
  const txInfo=await rpc(runtime.url,'get_transaction',[signed.hash]);assert(txInfo?.tx_status?.status==='pending'||txInfo?.tx_status?.status==='proposed'||txInfo?.tx_status?.status==='committed');
  savedBytes[id]=signed.transaction;
 }

 const oldSupervisor=JSON.parse(await fs.readFile(path.join(run,'supervisor-process.json'),'utf8')).pid;
 const db=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'),{readOnly:true});
 const claims=Object.fromEntries([requestA,requestBRecovery].map(id=>[id,db.prepare('SELECT * FROM reservations WHERE request_id=?').get(id)]));
 assert.equal(claims[requestA].phase,'journaled');assert.equal(claims[requestBRecovery].phase,'journaled');
 assert.equal(claims[requestA].pocket,pocketA);assert.equal(claims[requestBRecovery].pocket,pocketB);assert.notEqual(claims[requestA].context_id,claims[requestBRecovery].context_id);
 db.close();
 const newSupervisor=await restartSupervisor(origin,owner,'supervisor restart recovery');
 assert.notEqual(newSupervisor,oldSupervisor);

 const recoveredDb=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'),{readOnly:true});
 for(const id of [requestA,requestBRecovery]){const row=recoveredDb.prepare('SELECT phase,tx_hash,inputs_json FROM reservations WHERE request_id=?').get(id);assert.equal(row.phase,'journaled');assert(row.tx_hash);}
 const contextBRow=recoveredDb.prepare('SELECT directory FROM contexts WHERE pocket=?').get(pocketB);assert(contextBRow);recoveredDb.close();
 const dirB=path.join(run,contextBRow.directory);
 for(const [id,pocket,dir] of [[requestA,pocketA,run],[requestBRecovery,pocketB,dirB]]){
  const journal=new DatabaseSync(path.join(dir,'working-pocket.sqlite'),{readOnly:true});
  const row=journal.prepare('SELECT id,pocket,tx_hash,signed,state,phase FROM intents WHERE id=?').get(id);assert.equal(row.pocket,pocket);assert.equal(row.tx_hash,id===requestA?signedA.hash:signedBRecovery.hash);assert.equal(row.state,'uncertain');
  assert.equal(transactionFromRaw(JSON.parse(row.signed)).toHex(),savedBytes[id],'The exact signed transaction must survive supervisor restart');journal.close();
 }

 const reconcileA=await api(origin,'/api/reconcile',{pocket:pocketA});assert.equal(reconcileA.status,200,JSON.stringify(reconcileA.value));assert(reconcileA.value.outcomes.some(item=>item.txHash===signedA.hash&&item.status==='committed'));
 const afterA=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'),{readOnly:true});
 assert.equal(afterA.prepare('SELECT 1 FROM reservations WHERE request_id=?').get(requestA),undefined,'Canonical reconciliation releases only Pocket A input claims');
 assert.equal(afterA.prepare('SELECT phase FROM reservations WHERE request_id=?').get(requestBRecovery).phase,'journaled','Pocket B reservation remains until its own journal reconciliation');afterA.close();
 const reconcileB=await api(origin,'/api/reconcile',{pocket:pocketB});assert.equal(reconcileB.status,200,JSON.stringify(reconcileB.value));assert(reconcileB.value.outcomes.some(item=>item.txHash===signedBRecovery.hash&&item.status==='committed'));
 const finalDb=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'),{readOnly:true});
 assert.equal(finalDb.prepare('SELECT 1 FROM reservations WHERE request_id IN (?,?)').all(requestA,requestBRecovery).length,0);finalDb.close();
 const replayA=await api(origin,'/api/external/submit',signedA),replayB=await api(origin,'/api/external/submit',signedBRecovery);assert.equal(replayA.status,200);assert.equal(replayB.status,200);assert.equal(replayA.value.state,'committed');assert.equal(replayB.value.state,'committed');assert.equal(sendCalls,beforeLost+2,'Restart and replay checks must not broadcast again');

 const finalDiscovery=await api(origin,`/api/state?actor=${encodeURIComponent(owner)}`);assert.equal(finalDiscovery.value.discovery.length,2);
 const policyCell=await rpc(runtime.url,'get_live_cell',[point(context.policy),true]);assert.equal(policyCell.status,'live');
 assert.equal(policyCell.cell.data.content,split.originalPolicyData,'Creating another Pocket must not alter the original Pocket policy Cell');
 const rootOwnerChange=await rpc(runtime.url,'get_live_cell',[{tx_hash:signedA.hash,index:'0x1'},true]);assert.equal(rootOwnerChange.status,'live','The original Pocket deposit must return its owner fee change Cell');
 assert.equal(rootOwnerChange.cell.data.content,'0x');assert.equal(rootOwnerChange.cell.output.type,null);assert(c.Script.from({codeHash:rootOwnerChange.cell.output.lock.code_hash,hashType:rootOwnerChange.cell.output.lock.hash_type,args:rootOwnerChange.cell.output.lock.args}).eq(c.Script.from(actors.owner.lock)));
 const contextDb=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'),{readOnly:true});
 const rootA=contextDb.prepare('SELECT directory FROM contexts WHERE pocket=?').get(pocketA),contextBFinal=contextDb.prepare('SELECT directory FROM contexts WHERE pocket=?').get(pocketB);contextDb.close();
 assert.equal(rootA.directory,'.');assert(contextBFinal.directory.startsWith('contexts'+path.sep));
 const evidenceValue={result:'PASS',scenario:'real CKB engine with loopback multi-Pocket supervisor',network:'disposable CKB dev chain only',pockets:{original:pocketA,new:pocketB},owner,fixtureFundingSplit:{transaction:split.splitHash,spareCell:split.spare,spareCapacity:split.spareCapacity,pocketFeeCapacity:split.pocketFeeCapacity},genesis:{transaction:signedGenesis.hash,pocket:pocketB,committed:submittedGenesis.value.state},negativeChecks:['competing genesis identity and input rejected','shared owner fee input reservation','unknown request ID','wrong signer','cross-Pocket signed request','duplicate genesis submission','duplicate uncertain transaction submission'],isolatedOperations:{pocketA:{request:requestA,input:{txHash:inputA.txHash,index:Number(inputA.index)},transaction:signedA.hash},pocketB:{request:requestBRecovery,input:{txHash:inputB.txHash,index:Number(inputB.index)},transaction:signedBRecovery.hash}},recovery:{supervisorRestarted:true,exactSignedBytesPreserved:true,uncertainReservationsRecovered:true,selectedPocketAReconcileReleasedOnlyA:true,pocketBClaimReleasedAfterItsReconcile:true,lostResponses,sendCalls},historicalPolicyCellUnchanged:true,noPublicTransaction:true};
 await fs.writeFile(path.join(evidence,'supervisor-engine-integration.json'),JSON.stringify(evidenceValue,null,2));
 console.log('PASS real-engine supervisor integration: distinct Pocket contexts, real genesis and deposits, cross-context/signature rejection, uncertain-send recovery after restart, per-Pocket reservation release');
}catch(cause){
 console.error(cause?.stack||cause);console.error(`Runner output:\n${output}\n${errorOutput}`);process.exitCode=1;
}finally{
 await stopRunner();await close(proxy);
 if(runner&&runner.exitCode===null)await Promise.race([waitExit(runner),pause(5000)]);
 try{const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));await rpc(runtime.url,'get_tip_header');throw new Error('Disposable CKB node is still accepting RPC after cleanup');}catch(cause){if(cause?.message==='Disposable CKB node is still accepting RPC after cleanup'){console.error(cause.message);process.exitCode=1;}}
 await fs.rm(root,{recursive:true,force:true});
}
