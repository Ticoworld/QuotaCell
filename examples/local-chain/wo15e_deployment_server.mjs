// Local operator surface for explicit user-approved testnet deployment only.
import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {findFundingCell} from './wo15e_funding_discovery.mjs';
import {verifyWalletTransaction} from './pocket_signing.mjs';
import {buildAcceptanceTransaction,ownerLock,K_DEP} from './wo15e_acceptance_builder.mjs';
import {verifyNetwork,PUDGE_GENESIS} from './pocket_network.mjs';
import {prepareReviewedDeployment,reconcileDeployment} from './wo15e_deployment_submission.mjs';
import {writeVerifiedDeploymentManifest} from './wo15e_deployment_manifest.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.QUOTACELL_DEPLOY_PORT||4176),url=process.env.QUOTACELL_PUDGE_RPC||'https://testnet.ckb.dev/';assert(Number.isInteger(port)&&port>1024&&port<65536);
const origin=`http://127.0.0.1:${port}`,num=n=>'0x'+BigInt(n).toString(16),point=p=>({tx_hash:p.txHash,index:num(p.index)}),script=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
const raw=t=>({version:num(t.version),cell_deps:t.cellDeps.map(d=>({out_point:point(d.outPoint),dep_type:d.depType==='depGroup'?'dep_group':'code'})),header_deps:t.headerDeps,inputs:t.inputs.map(i=>({since:num(i.since),previous_output:point(i.previousOutput)})),outputs:t.outputs.map(o=>({capacity:num(o.capacity),lock:script(o.lock),type:o.type?script(o.type):null})),outputs_data:t.outputsData,witnesses:t.witnesses});
let id=0;async function rpc(method,params=[]){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(15000)});assert(r.ok,`RPC HTTP ${r.status}`);const x=await r.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result;}
async function checkNetwork(){await verifyNetwork({mode:'pudge-readonly',url,rpc,expectedGenesis:PUDGE_GENESIS,developmentSigner:false});}
async function live(p){const x=await rpc('get_live_cell',[p,true]);assert.equal(x.status,'live','Required Cell is stale');return x.cell;}
async function dependencies(){
 await checkNetwork();const g=await live(point(K_DEP.outPoint)),b=Buffer.from(g.data.content.slice(2),'hex');assert.equal(b.length,76);assert.equal(b.readUInt32LE(0),2);assert.equal(c.hashCkb(b),'0xf66ca3517241864672b7f47d093aec4d6d4d07824068993eacd728eb9078e236');
 const expected=['0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4','0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649'];
 for(let i=0;i<2;i++){const p={tx_hash:'0x'+b.subarray(4+i*36,36+i*36).toString('hex'),index:num(b.readUInt32LE(36+i*36))},cell=await live(p);assert.equal(c.hashCkb(c.bytesFrom(cell.data.content)),expected[i]);if(i===1){const t=cell.output.type;assert(t);assert.equal(c.Script.from({codeHash:t.code_hash,hashType:t.hash_type,args:t.args}).hash(),'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8');}}
 for(const [index,hash] of [['0x0','0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1'],['0x1','0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a']]){const cell=await live({tx_hash:'0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93',index});assert.equal(c.hashCkb(c.bytesFrom(cell.data.content)),hash);}
}
await fs.mkdir(path.join(here,'.local'),{recursive:true});const db=new DatabaseSync(process.env.QUOTACELL_DEPLOY_JOURNAL||path.join(here,'.local/wo15e-deployment-journal.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS journal (hash TEXT PRIMARY KEY, state TEXT NOT NULL, owner TEXT NOT NULL, metadata TEXT NOT NULL)');
const get=db.prepare('SELECT * FROM journal WHERE hash=?'),all=db.prepare('SELECT hash,state,owner,metadata FROM journal ORDER BY rowid DESC'),put=db.prepare('INSERT INTO journal(hash,state,owner,metadata) VALUES(?,?,?,?) ON CONFLICT(hash) DO UPDATE SET state=excluded.state,metadata=excluded.metadata');
const client=new c.ClientPublicTestnet({url,fallbacks:[]});let request,acceptedPublicKey,ticket,ticketExpires=0,busy=false;
function latest(){return all.all().map(x=>({hash:x.hash,state:x.state,owner:x.owner,metadata:JSON.parse(x.metadata)}));}
function journalFor(owner){return async value=>{assert(/^0x[0-9a-f]{64}$/i.test(value.hash||''),'Invalid journal hash');const previous=get.get(value.hash);assert(!previous||previous.owner===owner,'Owner mismatch');const allowed={};for(const k of ['hash','state','phase','input','fee','rate','codeHash','codeCapacity','change','ownerLock','network','blockHash','blockNumber','outPoint','reason'])if(value[k]!==undefined)allowed[k]=value[k];db.exec('BEGIN IMMEDIATE');try{put.run(value.hash,value.state,owner,JSON.stringify(allowed));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};}
async function prepare(body){
 assert(['sign-only','deployment'].includes(body.operation));const owner=ownerLock(body.publicKey);if(body.operation==='deployment'){assert.equal(body.publicKey,acceptedPublicKey,'First verify a sign-only signature with this wallet');assert(!latest().some(x=>x.state!=='committed'),'An earlier deployment outcome requires reconciliation');}await dependencies();
 const rate=BigInt((await rpc('get_fee_rate_statistics',['0x65'])).median);assert(rate>0n);const code=body.operation==='deployment'?await fs.readFile(path.join(here,'../../policy/build/allowance-native-v2')):undefined;const fee=(rate*(code?26000n:2000n)+999n)/1000n,minimum=(code?23722n:61n)*100000000n+fee;
 let found;for(let i=0;i<3;i++){try{found=await findFundingCell({rpc,lock:owner,minimum});break;}catch(e){if(!/lag or chain-tip mismatch/.test(e.message)||i===2)throw e;}}
 const built=buildAcceptanceTransaction({operation:body.operation,publicKey:body.publicKey,cells:found.cells,feeRate:rate,code}),info=await built.tx.getSignHashInfo(owner,client);assert.equal(info.position,0);
 const token=crypto.randomUUID(),prepared=built.tx.toHex();request={token,prepared,message:info.message,publicKey:body.publicKey,operation:body.operation,input:built.candidate.outPoint,expires:Date.now()+300000};ticket=undefined;
 return {token,transaction:prepared,raw:raw(built.tx),publicKey:body.publicKey,review:{operation:body.operation,network:'Pudge',hash:built.tx.hash(),input:built.candidate.outPoint,totalInput:built.input.toString(),fee:built.fee.toString(),feeRate:rate.toString(),codeHash:code?c.hashCkb(code):null,codeCapacity:built.codeCapacity.toString(),change:built.change.toString(),ownerLock:script(owner),warning:'The code Cell is owner-controlled and replaceable. Consuming it can break dependent Pockets.'}};
}
async function verify(body){assert(request&&body.token===request.token,'Unknown request');const r=request;request=undefined;assert(Date.now()<r.expires,'Request expired');await dependencies();await live(r.input);const prepared=c.Transaction.fromBytes(r.prepared),signed=c.Transaction.fromBytes(body.transaction);verifyWalletTransaction({prepared,signed,message:r.message,publicKey:r.publicKey,position:0});
 if(r.operation==='sign-only'){acceptedPublicKey=r.publicKey;return {state:'signature-verified',operation:'sign-only',hash:signed.hash(),publicKey:r.publicKey};}
 ticket=await prepareReviewedDeployment({rpc,prepared,signed,publicKey:r.publicKey,message:r.message,record:journalFor(r.publicKey),verifyDependencies:dependencies});ticketExpires=Date.now()+300000;return {state:'dry-run-passed',review:ticket.review};
}
async function submit(body){assert(ticket,'No verified deployment ready');assert(Date.now()<ticketExpires,'Deployment approval expired');const selected=ticket;ticket=undefined;return selected.submit({approvedHash:body.approvedHash,broadcastEnabled:body.broadcastEnabled===true});}
async function reconcile(body){
 const entry=get.get(body.hash);assert(entry,'Unknown deployment hash');await dependencies();const save=journalFor(entry.owner);
 // Keep new deployments blocked until a second endpoint verifies the committed Cell and the manifest exists.
 const result=await reconcileDeployment({rpc,hash:body.hash,ownerPublicKey:entry.owner,record:v=>save(v.state==='committed'?{...v,state:'verification-pending'}:v)});
 if(result.state!=='committed')return result;
 try{
  const second=process.env.QUOTACELL_PUDGE_INDEPENDENT_RPC||'https://testnet.ckbapp.dev/';
  assert.match(second,/^https:\/\/[^/]+\/?$/,'Independent RPC must be HTTPS');assert.notEqual(new URL(second).origin,new URL(url).origin,'Independent RPC must use a distinct origin');
  const independentRpc=async(method,params=[])=>{assert(['get_consensus','get_block_hash','get_transaction','get_header','get_live_cell'].includes(method),'Independent RPC method forbidden');const r=await fetch(second,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(15000)});assert(r.ok,`Independent RPC HTTP ${r.status}`);const x=await r.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result;};
  const directory=path.resolve(process.env.QUOTACELL_DEPLOY_MANIFEST_DIR||path.join(here,'.local/wo15e-pudge'));
  const manifest=await writeVerifiedDeploymentManifest({rpc,independentRpc,hash:body.hash,ownerPublicKey:entry.owner,directory});await save(result);return {...result,manifestPath:manifest.path,manifestCreated:manifest.created};
 }catch(e){return {...result,state:'verification-pending',reason:e.message};}
}
const bundle=(await build({entryPoints:[path.join(here,'wo15e_deployment_browser.mjs')],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome110'})).outputFiles[0].contents,html=await fs.readFile(path.join(here,'wo15e_deployment.html'));
http.createServer(async(req,res)=>{try{
 assert.equal(req.headers.host,`127.0.0.1:${port}`,'Invalid host');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html);}if(req.method==='GET'&&req.url==='/wallet.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(bundle);}if(req.method==='GET'&&req.url==='/api/journal'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(latest()));}
 assert.equal(req.method,'POST');assert.equal(req.headers.origin,origin);assert.equal(req.headers['content-type'],'application/json');let body='';for await(const b of req){body+=b;assert(body.length<250000);}const input=JSON.parse(body);
 if(req.url==='/api/ckb'){assert(['get_live_cell','get_transaction','get_tip_header','get_header','get_block_hash','get_consensus','get_fee_rate_statistics'].includes(input.method));const result=await rpc(input.method,input.params||[]);res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));}
 assert(!busy,'Another operation is in progress');busy=true;try{const result=req.url==='/api/prepare'?await prepare(input):req.url==='/api/verify'?await verify(input):req.url==='/api/broadcast'?await submit(input):req.url==='/api/reconcile'?await reconcile(input):(()=>{throw Error('Unknown endpoint')})();res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(result));}finally{busy=false;}
 }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}}).listen(port,'127.0.0.1',()=>console.log(`WO15E deployment review ${origin}`));
