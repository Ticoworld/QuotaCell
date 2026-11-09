import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {findFundingCell} from './wo15e_funding_discovery.mjs';
import {verifyWalletTransaction} from './pocket_signing.mjs';
import {buildAcceptanceTransaction,ownerLock,K_DEP} from './wo15e_acceptance_builder.mjs';
import {verifyNetwork,PUDGE_GENESIS} from './pocket_network.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const endpoint=process.env.QUOTACELL_PUDGE_RPC||'https://testnet.ckb.dev/';
const port=Number(process.env.QUOTACELL_ACCEPT_PORT||4175);assert(Number.isInteger(port)&&port>1024&&port<65536);
const origin=`http://127.0.0.1:${port}`;
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const kh=['0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4','0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649'];
const group=K_DEP;
const point=p=>({tx_hash:p.txHash,index:'0x'+BigInt(p.index).toString(16)});
let rid=0;async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rid,method,params}),signal:AbortSignal.timeout(15000)});assert(r.ok,`RPC HTTP ${r.status}`);const x=await r.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result;}
async function live(p){const x=await rpc('get_live_cell',[p,true]);assert.equal(x.status,'live','Funding or dependency Cell is stale');return x.cell;}
async function checkEnvironment(){await verifyNetwork({mode:'pudge-readonly',url:endpoint,rpc,expectedGenesis:PUDGE_GENESIS,developmentSigner:false});const g=await live(point(group.outPoint)),b=Buffer.from(g.data.content.slice(2),'hex');assert.equal(b.length,76);assert.equal(b.readUInt32LE(0),2);assert.equal(c.hashCkb(b),'0xf66ca3517241864672b7f47d093aec4d6d4d07824068993eacd728eb9078e236');for(let i=0;i<2;i++){const p={tx_hash:'0x'+b.subarray(4+i*36,36+i*36).toString('hex'),index:'0x'+b.readUInt32LE(36+i*36).toString(16)},x=await live(p);assert.equal(c.hashCkb(c.bytesFrom(x.data.content)),kh[i]);if(i===1){const t=x.output.type;assert(t);assert.equal(c.Script.from({codeHash:t.code_hash,hashType:t.hash_type,args:t.args}).hash(),K);}}}
const client=new c.ClientPublicTestnet({url:endpoint,fallbacks:[]});
const script=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
const toRaw=t=>({version:'0x0',cell_deps:t.cellDeps.map(d=>({out_point:point(d.outPoint),dep_type:d.depType==='depGroup'?'dep_group':'code'})),header_deps:[],inputs:t.inputs.map(i=>({since:'0x0',previous_output:point(i.previousOutput)})),outputs:t.outputs.map(o=>({capacity:'0x'+o.capacity.toString(16),lock:script(o.lock),type:o.type?script(o.type):null})),outputs_data:t.outputsData,witnesses:t.witnesses});
let request,acceptedPublicKey;
async function prepare(body){
 assert(['sign-only','deployment'].includes(body.operation));const owner=ownerLock(body.publicKey);if(body.operation==='deployment')assert.equal(body.publicKey,acceptedPublicKey,'Complete a verified sign-only check with this wallet first');await checkEnvironment();
 const feeRate=BigInt((await rpc('get_fee_rate_statistics',['0x65'])).median);assert(feeRate>0n,'No fee estimate');
 let code;if(body.operation==='deployment')code=await fs.readFile(path.join(here,'../../policy/build/allowance-native-v2'));
 const estimate=(feeRate*(code?26000n:2000n)+999n)/1000n,minimum=(code?23722n:61n)*100000000n+estimate;
 let found;for(let i=0;i<3;i++){try{found=await findFundingCell({rpc,lock:owner,minimum});break;}catch(e){if(!/lag or chain-tip mismatch/.test(e.message)||i===2)throw e;}}
 const {tx,candidate:chosen,input,fee,codeCapacity:protectedCapacity,change}=buildAcceptanceTransaction({operation:body.operation,publicKey:body.publicKey,cells:found.cells,feeRate,code});
 const info=await tx.getSignHashInfo(owner,client);assert.equal(info.position,0);
 const token=crypto.randomUUID(),prepared=tx.toHex();request={token,publicKey:body.publicKey,prepared,message:info.message,point:chosen.outPoint,operation:body.operation,expires:Date.now()+300000};
 return {token,transaction:prepared,raw:toRaw(tx),publicKey:body.publicKey,review:{operation:body.operation,network:'Pudge testnet',genesis:PUDGE_GENESIS,transactionHash:tx.hash(),input:chosen.outPoint,totalInput:input.toString(),fee:fee.toString(),feeRate:feeRate.toString(),destinationLock:script(owner),codeHash:code?c.hashCkb(code):null,codeCellCapacity:protectedCapacity.toString(),change:change.toString(),codeCellPolicy:code?'Owner-controlled and replaceable: spending it breaks dependencies of existing Pockets.':'No code Cell',broadcast:'Disabled: this screen only signs; no transaction is sent.'}};
}
async function verify(body){assert(request&&body.token===request.token,'Unknown signing request');const r=request;request=undefined;assert(Date.now()<r.expires,'Signing request expired');await checkEnvironment();await live(r.point);const prepared=c.Transaction.fromBytes(r.prepared),signed=c.Transaction.fromBytes(body.transaction);verifyWalletTransaction({prepared,signed,message:r.message,publicKey:r.publicKey,position:0});const result={result:'signature-verified',transactionHash:signed.hash(),publicKey:r.publicKey,network:'Pudge testnet',operation:r.operation,broadcast:false,provider:'browser-reported UTXO Global; independent attribution requires user observation',verifiedAt:new Date().toISOString()};await fs.mkdir(path.join(here,'.local'),{recursive:true});await fs.appendFile(path.join(here,'.local/wo15e-signature-diagnostics.jsonl'),JSON.stringify(result)+'\n');if(r.operation==='sign-only')acceptedPublicKey=r.publicKey;return result;}
const bundle=(await build({entryPoints:[path.join(here,'wo15e_wallet_acceptance_browser.mjs')],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome110'})).outputFiles[0].contents;
const html=await fs.readFile(path.join(here,'wo15e_wallet_acceptance.html'));
http.createServer(async(req,res)=>{try{
 assert.equal(req.headers.host,`127.0.0.1:${port}`,'Invalid host');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html);}
 if(req.method==='GET'&&req.url==='/wallet.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});return res.end(bundle);}
 assert.equal(req.method,'POST');assert.equal(req.headers.origin,origin);let text='';for await(const x of req){text+=x;assert(text.length<250000);}const body=JSON.parse(text);
 let result;if(req.url==='/api/ckb'){assert(['get_live_cell','get_transaction','get_tip_header','get_header','get_block_hash','get_consensus','get_fee_rate_statistics'].includes(body.method));result={jsonrpc:'2.0',id:body.id,result:await rpc(body.method,body.params||[])};}else if(req.url==='/api/prepare')result=await prepare(body);else if(req.url==='/api/verify')result=await verify(body);else throw Error('Unknown endpoint');
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}}).listen(port,'127.0.0.1',()=>console.log(`WO15E sign-only screen ${origin}`));
