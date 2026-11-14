import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as c from '@ckb-ccc/core';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-wo18-external-'));
const run=path.join(root,'run');
const counts=new Map();
let failNextDryRun=false,loseNextSendResponse=false;
let wrongNetwork=false,staleOutPoint,staleResponses=0;
let runner,proxy,standaloneServer,ckbProcess,proxyPort;
let stdout='',stderr='',temporaryBuildMetadata=false;

function listen(server){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});}
function close(server){return new Promise(resolve=>server.close(()=>resolve()));}
function waitExit(child){return new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);});}
async function waitFor(check,label,timeout=240000){
 const started=Date.now();let last;
 while(Date.now()-started<timeout){
  if(runner&&runner.exitCode!==null)throw new Error(label+' failed; runner exited '+runner.exitCode+'\n'+stdout+'\n'+stderr);
  try{const value=await check();if(value)return value;}catch(e){last=e;}await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error(label+' timed out'+(last?': '+last.message:'' )+'\n'+stdout+'\n'+stderr);
}
async function post(origin,route,body){
 const response=await fetch(origin+route,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const value=await response.json();return {status:response.status,value};
}
async function prepareOwner(origin,actors,operation,amount,id){
 const request=await post(origin,'/api/external/owner',{id,operation,role:operation==='revoke'?'alice':'owner',amount,publicKey:actors.owner.publicKey});
 assert.equal(request.status,200,JSON.stringify(request.value));
 return request.value;
}
async function signPrepared(runPath,request,role,alterOutputs=false){
 const runtime=JSON.parse(await fs.readFile(path.join(runPath,'runtime.json'),'utf8'));
 const secret=JSON.parse(await fs.readFile(path.join(runPath,'keys',role+'.json'),'utf8'));
 const client=new c.ClientPublicTestnet({url:runtime.url,fallbacks:[]});
 const signer=new c.SignerCkbPrivateKey(client,secret.privateKey);
 let prepared=c.Transaction.fromBytes(request.transaction);
 if(alterOutputs)prepared=c.Transaction.from({version:prepared.version,cellDeps:prepared.cellDeps,headerDeps:prepared.headerDeps,inputs:prepared.inputs,outputs:prepared.outputs.map((o,i)=>i===1?{capacity:o.capacity+1n,lock:o.lock,type:o.type}:o),outputsData:prepared.outputsData,witnesses:prepared.witnesses});
 const signed=await signer.signOnlyTransaction(prepared);
 return {id:request.id,transaction:signed.toHex(),hash:signed.hash()};
}
async function prepareAndSign(origin,runPath,actors,operation,amount,id,signingRole='owner'){
 const request=await prepareOwner(origin,actors,operation,amount,id);
 return signPrepared(runPath,request,signingRole);
}
function transactionFromRaw(x){
 const script=s=>s&&({codeHash:s.code_hash,hashType:s.hash_type,args:s.args});
 return c.Transaction.from({version:BigInt(x.version),cellDeps:x.cell_deps.map(d=>({outPoint:{txHash:d.out_point.tx_hash,index:Number(BigInt(d.out_point.index))},depType:d.dep_type==='dep_group'?'depGroup':d.dep_type})),headerDeps:x.header_deps,inputs:x.inputs.map(i=>({since:BigInt(i.since),previousOutput:{txHash:i.previous_output.tx_hash,index:Number(BigInt(i.previous_output.index))}})),outputs:x.outputs.map(o=>({capacity:BigInt(o.capacity),lock:script(o.lock),type:script(o.type)})),outputsData:x.outputs_data,witnesses:x.witnesses});
}
function readRow(id){
 const db=new DatabaseSync(path.join(run,'working-pocket.sqlite'),{readOnly:true});
 db.exec('BEGIN');
 const columns=process.env.QUOTACELL_EXPECT_SELF_BLOCK==='1'?'id,state,tx_hash,signed':'id,state,tx_hash,signed,phase';
 const row=db.prepare(`SELECT ${columns} FROM intents WHERE id=?`).get(id);
 db.exec('COMMIT');db.close();return row;
}
async function stopRunnerAndNode(closeProxyServer=true){
 if(runner&&runner.exitCode===null){
  const result=spawnSync('powershell.exe',['-NoProfile','-Command','(Get-NetTCPConnection -State Listen -LocalPort '+backendPort+' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)'],{encoding:'utf8'});
  const pid=Number((result.stdout||'').trim());if(pid>0)try{process.kill(pid);}catch{}
  const exited=await Promise.race([waitExit(runner).then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),20000))]);
  if(!exited){
   try{const processInfo=JSON.parse(await fs.readFile(path.join(run,'process.json'),'utf8'));process.kill(processInfo.pid);}catch{}
   runner.kill();await Promise.race([waitExit(runner),new Promise(resolve=>setTimeout(resolve,5000))]);
  }
  runner=null;
 }
 if(closeProxyServer)try{await close(proxy);}catch{}
}

let backendPort;
try{
 const buildMetadata=path.resolve(here,'../../policy/build/q-native-v2-build.json');
 try{await fs.access(buildMetadata);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const existingBytecode=await fs.readFile(path.resolve(here,'../../policy/build/allowance-native-v2'));
  assert.equal(c.hashCkb(existingBytecode),'0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e','Existing QCN4 bytecode mismatch');
  await fs.writeFile(buildMetadata,JSON.stringify({ckb_data_hash:c.hashCkb(existingBytecode)}));temporaryBuildMetadata=true;
 }
 const proxyServer=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=Buffer.concat(chunks),call=JSON.parse(body.toString()),method=call.method;
  counts.set(method,(counts.get(method)||0)+1);
  if(method==='get_consensus'&&wrongNetwork){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result:{id:'ckb_testnet'}}));return;}
  if(method==='get_live_cell'&&staleOutPoint&&call.params?.[0]?.tx_hash?.toLowerCase()===staleOutPoint.txHash.toLowerCase()&&BigInt(call.params[0].index)===BigInt(staleOutPoint.index)){staleOutPoint=undefined;staleResponses++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result:{status:'dead'}}));return;}
  if(method==='dry_run_transaction'&&failNextDryRun){failNextDryRun=false;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'controlled dry-run failure'}}));return;}
  try{
   const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
   const upstream=await fetch(runtime.url,{method:'POST',headers:{'content-type':'application/json'},body});
   const upstreamBody=Buffer.from(await upstream.arrayBuffer());
   if(method==='send_transaction'&&loseNextSendResponse){loseNextSendResponse=false;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'controlled send response loss after forwarding'}}));return;}
   res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});res.end(upstreamBody);
  }catch(error){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:error.message}}));}
 });
 proxyPort=await listen(proxyServer);proxy=proxyServer;
 const hold=net.createServer();backendPort=await listen(hold);await close(hold);
 const origin='http://127.0.0.1:'+backendPort;
 runner=spawn('python',[path.join(here,'working_pocket_start.py'),'--scenario','app','--run-dir',run,'--port',String(backendPort)],{
  cwd:here,windowsHide:true,env:{...process.env,QUOTACELL_TEST_RPC_PROXY:'http://127.0.0.1:'+proxyPort},stdio:['ignore','pipe','pipe']
 });
 runner.stdout.setEncoding('utf8');runner.stderr.setEncoding('utf8');
 runner.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-12000);});runner.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
 await waitFor(async()=>stdout.includes('Working Pocket isolated: '+origin), 'isolated backend startup');
 const actors=JSON.parse(await fs.readFile(path.join(run,'actors.json'),'utf8'));

 if(process.env.QUOTACELL_EXPECT_SELF_BLOCK!=='1'){
  wrongNetwork=true;
  const wrongNetworkResult=await post(origin,'/api/external/owner',{id:'593c148e-28a7-4a51-a4a7-8316a1d773cb',operation:'deposit',amount:'256',publicKey:actors.owner.publicKey});
  wrongNetwork=false;assert.equal(wrongNetworkResult.status,400);assert.match(wrongNetworkResult.value.error,/Only isolated CKB dev chains/);

  const staleId='cda56a77-7fe5-44e9-90d1-a18a640a63d9';
  const staleRequest=await prepareOwner(origin,actors,'deposit','256',staleId);
  const staleSigned=await signPrepared(run,staleRequest,'owner');
  const staleTx=c.Transaction.fromBytes(staleRequest.transaction),staleInput=staleTx.inputs[0].previousOutput;
  staleOutPoint={txHash:staleInput.txHash,index:'0x'+BigInt(staleInput.index).toString(16)};
  const sendsBeforeStale=counts.get('send_transaction')||0;
  const staleResult=await post(origin,'/api/external/submit',staleSigned);
  assert.equal(staleResult.status,400,JSON.stringify({response:staleResult,staleResponses,staleOutPoint}));assert.match(staleResult.value.error,/stale|live/i);assert.equal(staleResponses,1);assert.equal(readRow(staleId),undefined);assert.equal(counts.get('send_transaction')||0,sendsBeforeStale);

  const wrongSignerId='8fb51e0a-19d4-414a-8a36-31305f7b7382';
  const wrongSignerRequest=await prepareOwner(origin,actors,'deposit','256',wrongSignerId);
  const wrongSigner=await signPrepared(run,wrongSignerRequest,'alice');
  const wrongSignerResult=await post(origin,'/api/external/submit',wrongSigner);
  assert.equal(wrongSignerResult.status,400);assert.match(wrongSignerResult.value.error,/Invalid actor signature/);assert.equal(readRow(wrongSignerId),undefined);

  const alteredId='4b2b4cef-5b72-4174-93bf-47bf79e7478c';
  const alteredRequest=await prepareOwner(origin,actors,'deposit','256',alteredId);
  const altered=await signPrepared(run,alteredRequest,'owner',true);
  const alteredResult=await post(origin,'/api/external/submit',altered);
  assert.equal(alteredResult.status,400);assert.match(alteredResult.value.error,/altered transaction fields/);assert.equal(readRow(alteredId),undefined);
 }

 const depositId='7fbe1738-1ac5-4a67-8eb0-1bc854dc23ce';
 const signedDeposit=await prepareAndSign(origin,run,actors,'deposit','256',depositId);
 const beforeSend=counts.get('send_transaction')||0;
 loseNextSendResponse=true;
 const deposit=await post(origin,'/api/external/submit',signedDeposit);

 if(process.env.QUOTACELL_EXPECT_SELF_BLOCK==='1'){
  assert.equal(deposit.status,200,JSON.stringify(deposit.value));
  assert.equal(deposit.value.state,'uncertain');assert.equal(deposit.value.phase,'dry-run');
  assert.match(deposit.value.error,/earlier outcome is uncertain/);
  assert.equal(counts.get('dry_run_transaction')||0,0,'Self-conflict must stop before dry_run_transaction');
  assert.equal(counts.get('send_transaction')||0,beforeSend,'Self-conflict must make zero send_transaction calls');
  assert.equal(readRow(depositId).tx_hash,signedDeposit.hash);
  console.log('PASS reproduced public external submission self-block: persisted row made its own snapshot unresolved before dry-run and send');
 }else{
  assert.equal(deposit.status,200,JSON.stringify(deposit.value));assert.equal(deposit.value.state,'uncertain',JSON.stringify(deposit.value));
  assert.equal(deposit.value.phase,'submit');assert.match(deposit.value.error,/controlled send response loss/);
  assert.equal(deposit.value.txHash,signedDeposit.hash);assert.equal(counts.get('dry_run_transaction'),1);
  assert.equal(counts.get('send_transaction'),beforeSend+1,'Passing dry-run must reach send exactly once');
  const submittedRow=readRow(depositId);assert.equal(submittedRow.tx_hash,signedDeposit.hash);assert.equal(submittedRow.state,'uncertain');assert.equal(submittedRow.phase,'submit-uncertain');
  assert.equal(transactionFromRaw(JSON.parse(submittedRow.signed)).toHex(),signedDeposit.transaction,'Submission timeout must preserve the exact original signed transaction bytes');
  const reconciled=await post(origin,'/api/reconcile',{});assert.equal(reconciled.status,200,JSON.stringify(reconciled.value));
  assert(reconciled.value.outcomes.some(item=>item.txHash===signedDeposit.hash&&item.status==='committed'),'Accepted timed-out transaction must reconcile without resending');
  assert.equal(counts.get('send_transaction'),beforeSend+1);assert.equal(readRow(depositId).tx_hash,signedDeposit.hash);
  const duplicate=await post(origin,'/api/external/submit',signedDeposit);
  assert.equal(duplicate.status,400);assert.equal(counts.get('send_transaction'),beforeSend+1,'Duplicate submit must not send twice');
  assert.equal(readRow(depositId).tx_hash,signedDeposit.hash);assert.equal(readRow(depositId).state,'committed');

  const revokeId='bead4fb7-6454-49e1-a680-d66ee93205f2';
  const signedRevoke=await prepareAndSign(origin,run,actors,'revoke',undefined,revokeId);
  failNextDryRun=true;
  const rejected=await post(origin,'/api/external/submit',signedRevoke);
  assert.equal(rejected.status,200,JSON.stringify(rejected.value));assert.equal(rejected.value.state,'uncertain');
  assert.equal(rejected.value.phase,'dry-run');assert.match(rejected.value.error,/controlled dry-run failure/);
  assert.equal(counts.get('send_transaction'),beforeSend+1,'A failing dry-run must make zero additional send calls');
  assert.equal(readRow(revokeId).tx_hash,signedRevoke.hash);assert.equal(readRow(revokeId).phase,'dry-run-failed');
  const blockedId='2da9a2b2-1381-4707-957d-08d0f60e41e1';
  const blocked=await post(origin,'/api/external/owner',{id:blockedId,operation:'deposit',amount:'256',publicKey:actors.owner.publicKey});
  assert.equal(blocked.status,400);assert.match(blocked.value.error,/earlier outcome is uncertain/);assert.equal(readRow(blockedId),undefined);

  await stopRunnerAndNode(false);
  const processInfo=JSON.parse(await fs.readFile(path.join(run,'process.json'),'utf8'));
  const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
  ckbProcess=spawn(processInfo.exe,['-C',processInfo.directory,'run'],{cwd:here,windowsHide:true,stdio:'ignore'});
  await waitFor(async()=>{
   const response=await fetch(runtime.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'get_tip_header',params:[]}),signal:AbortSignal.timeout(2000)});
   const value=await response.json();return value.result?.hash;
  },'local chain restart');
  runner=undefined;stdout='';stderr='';
  standaloneServer=spawn('node',['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(backendPort)],{cwd:here,windowsHide:true,env:{...process.env,QUOTACELL_DEV_SIGNER:'1',QUOTACELL_TEST_RPC_PROXY:'http://127.0.0.1:'+proxyPort},stdio:['ignore','pipe','pipe']});
  standaloneServer.stdout.setEncoding('utf8');standaloneServer.stderr.setEncoding('utf8');
  standaloneServer.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-4000);});standaloneServer.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
  await waitFor(async()=>stdout.includes('Working Pocket isolated: '+origin),'backend restart');
  const stateResponse=await fetch(origin+'/api/state'),state=await stateResponse.json();
  assert.equal(stateResponse.status,200);assert.equal(state.unresolved,true);
  assert(state.history.some(item=>item.tx_hash===signedDeposit.hash&&item.state==='committed'));
  assert(state.history.some(item=>item.tx_hash===signedRevoke.hash&&item.state==='uncertain'));
  assert.equal(readRow(revokeId).phase,'dry-run-failed');
  console.log('PASS external HTTP submission and restart: network, stale input, signer and output rejection; signed deposit sent once; dry-run failure sent zero times; same journal reopened conservatively');
 }
}catch(error){
 console.error(error.stack||error);
 console.error('runner/backend output: '+stdout+'\n'+stderr);
 process.exitCode=1;
}finally{
 await stopRunnerAndNode();
 if(standaloneServer&&standaloneServer.exitCode===null){standaloneServer.kill();await Promise.race([waitExit(standaloneServer),new Promise(resolve=>setTimeout(resolve,5000))]);}
 if(ckbProcess&&ckbProcess.exitCode===null){ckbProcess.kill();await Promise.race([waitExit(ckbProcess),new Promise(resolve=>setTimeout(resolve,5000))]);}
 if(temporaryBuildMetadata)await fs.rm(path.resolve(here,'../../policy/build/q-native-v2-build.json'),{force:true});
 await fs.rm(root,{recursive:true,force:true});
}
