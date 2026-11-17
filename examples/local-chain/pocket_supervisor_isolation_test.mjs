import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {startPocketSupervisor} from './working_pocket_supervisor.mjs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const run=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-pocket-supervisor-'));
const genesis='0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const owner='0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const otherOwner='0x03'+'22'.repeat(32);
const idA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',idB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',idC='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function availablePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
async function post(origin,route,value){return fetch(`${origin}${route}`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify(value)});}
let supervisor;
try{
 await fs.mkdir(path.join(run,'evidence'));
 await fs.writeFile(path.join(run,'runtime.json'),JSON.stringify({url:'https://testnet.ckb.dev/'}));
 await fs.writeFile(path.join(run,'deployment.json'),JSON.stringify({network:'pudge',genesis}));
 await fs.writeFile(path.join(run,'evidence','node-profile.json'),JSON.stringify({genesisHeader:{hash:genesis}}));
 const worker=path.join(here,'pocket_supervisor_test_worker.mjs');
 let port=await availablePort();supervisor=await startPocketSupervisor({run,port,worker});
 const origin=`http://127.0.0.1:${port}`;
 assert.equal((await fetch(`${origin}/api/internal/resolve?pocket=0x${'11'.repeat(32)}&actor=${owner}`)).status,404,'Internal resolver must not be public');
 const draftA={id:idA,draftId:idA,publicKey:owner,delegates:[],sharedLimit:'12200000000'};
 const preparedA=await post(origin,'/api/external/genesis',draftA);assert.equal(preparedA.status,200);const preparedAData=await preparedA.json();
 await assert.rejects(startPocketSupervisor({run,port:await availablePort(),worker}),/already in use/,'A second supervisor must not open the same runtime');
 const changedOwner=await post(origin,'/api/external/genesis',{...draftA,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',publicKey:otherOwner});assert.equal(changedOwner.status,400);assert.match((await changedOwner.json()).error,/already bound to another owner/);
 const draftB={...draftA,id:idB,draftId:idB};
 const collision=await post(origin,'/api/external/genesis',draftB);assert.equal(collision.status,400);assert.match((await collision.json()).error,/reserves one of these owner-controlled inputs/);
 const draftC={...draftA,id:idC,draftId:idC,sharedLimit:'distinct'};
 const preparedC=await post(origin,'/api/external/genesis',draftC);assert.equal(preparedC.status,200);
 const preparedCData=await preparedC.json();
 const crossPocket=await post(origin,'/api/external/submit',{id:idC,transaction:preparedAData.transaction});assert.equal(crossPocket.status,400);assert.match((await crossPocket.json()).error,/does not match this Pocket request/);
 const submitted=await post(origin,'/api/external/submit',{id:idA,transaction:preparedAData.transaction});assert.equal(submitted.status,200);assert.equal((await submitted.json()).state,'uncertain');
 await supervisor.close();supervisor=null;

 port=await availablePort();supervisor=await startPocketSupervisor({run,port,worker});
 const restartedOrigin=`http://127.0.0.1:${port}`;
 const replay=await post(restartedOrigin,'/api/external/submit',{id:idA,transaction:'0x00'});assert.equal(replay.status,400,'A prepared signature request cannot be reused after restart');
 const blockedAfterRestart=await post(restartedOrigin,'/api/external/genesis',draftB);assert.equal(blockedAfterRestart.status,400);assert.match((await blockedAfterRestart.json()).error,/reserves one of these owner-controlled inputs/);
 const unjournaledAfterRestart=await post(restartedOrigin,'/api/external/submit',{id:idC,transaction:preparedCData.transaction});assert.equal(unjournaledAfterRestart.status,400,'Unsigned prepared requests are discarded after restart');

 const db=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'));
 const contextA=db.prepare('SELECT directory FROM contexts WHERE draft_id=?').get(idA).directory;
 const contextB=db.prepare('SELECT directory FROM contexts WHERE draft_id=?').get(idB).directory;
 assert.equal(await fs.access(path.join(run,contextA,'intents.json')).then(()=>true,()=>false),true,'Uncertain intent remains in its own Pocket context');
 assert.equal(await fs.access(path.join(run,contextB,'intents.json')).then(()=>true,()=>false),false,'Another Pocket journal remains separate');
 const claim=db.prepare('SELECT context_id,phase,inputs_json FROM reservations WHERE request_id=?').get(idA);
 assert.equal(claim.context_id,db.prepare('SELECT id FROM contexts WHERE draft_id=?').get(idA).id);
 assert.equal(claim.phase,'journaled');
 db.close();

 const recovered=await fetch(`${restartedOrigin}/api/state?pocket=${preparedAData.pocket}&actor=${encodeURIComponent(owner)}`);
 assert.equal(recovered.status,200,'A Pocket that confirms after an uncertain submit must reopen after restart');
 assert.equal((await recovered.json()).pocket,preparedAData.pocket);
 const afterRecovery=new DatabaseSync(path.join(run,'pocket-supervisor.sqlite'));
 assert.equal(afterRecovery.prepare('SELECT 1 FROM reservations WHERE request_id=?').get(idA),undefined,'Confirmed input claim must be released after journal reconciliation');
 afterRecovery.close();
 console.log('PASS multi-Pocket isolation and delayed genesis recovery: overlapping inputs block, journals stay separate, uncertain claims survive restart, and a later confirmed Pocket reopens from its recovered descriptor');
}finally{if(supervisor)await supervisor.close();await fs.rm(run,{recursive:true,force:true});}
