import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ownerLock,K_DEP,Q_HASH} from './wo15e_acceptance_builder.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const upstream='0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93',sha='f636bb5a9ddb7db41c73ab263a5b5483acae2e36c53afca2257a1cbc95d83997';
async function inspect(rpc,hash,owner){
 const [consensus,genesis,tx]=await Promise.all([rpc('get_consensus'),rpc('get_block_hash',['0x0']),rpc('get_transaction',[hash])]);
 assert.equal(consensus.id,'ckb_testnet','Wrong network');assert.equal(genesis,PUDGE_GENESIS,'Wrong genesis');assert.equal(tx?.tx_status?.status,'committed','Deployment is not committed');
 const outPoint={tx_hash:hash,index:'0x0'},[header,live]=await Promise.all([rpc('get_header',[tx.tx_status.block_hash]),rpc('get_live_cell',[outPoint,true])]);
 assert(header&&header.hash===tx.tx_status.block_hash,'Missing deployment header');assert.equal(await rpc('get_block_hash',[header.number]),header.hash,'Noncanonical deployment');
 assert.equal(live.status,'live','Q Cell is not live');const cell=live.cell;assert.equal(BigInt(cell.output.capacity),2366100000000n,'Wrong Q capacity');assert(!cell.output.type,'Unexpected Q type');const lock=cell.output.lock;assert(c.Script.from({codeHash:lock.code_hash,hashType:lock.hash_type,args:lock.args}).eq(owner),'Wrong Q owner');
 const data=c.bytesFrom(cell.data.content);assert.equal(data.length,23600,'Wrong Q length');assert.equal(c.hashCkb(data),Q_HASH,'Wrong Q data hash');assert.equal(crypto.createHash('sha256').update(data).digest('hex'),sha,'Wrong Q SHA-256');
 assert.deepEqual(tx.transaction?.outputs?.[0],cell.output,'Transaction output differs');assert.equal(tx.transaction?.outputs_data?.[0],cell.data.content,'Transaction data differs');
 return {blockHash:header.hash,blockNumber:header.number,cell};
}
/** A second endpoint is required. No signed transaction is read or written. */
export async function writeVerifiedDeploymentManifest({rpc,independentRpc,hash,ownerPublicKey,directory}){
 assert(typeof rpc==='function'&&typeof independentRpc==='function'&&rpc!==independentRpc,'Independent RPC required');assert.match(hash||'',/^0x[0-9a-f]{64}$/i,'Invalid deployment hash');assert(typeof directory==='string'&&path.isAbsolute(directory),'Absolute manifest directory required');
 const owner=ownerLock(ownerPublicKey),[primary,independent]=await Promise.all([inspect(rpc,hash,owner),inspect(independentRpc,hash,owner)]);
 assert.equal(primary.blockHash,independent.blockHash,'RPCs disagree on deployment block');assert.equal(primary.blockNumber,independent.blockNumber,'RPCs disagree on block height');assert.deepEqual(primary.cell,independent.cell,'RPCs disagree on live code Cell');
 // Recheck after both reads so a stale, spent or reorganized Cell never produces a manifest.
 for(const source of [rpc,independentRpc]){assert.equal(await source('get_block_hash',[primary.blockNumber]),primary.blockHash,'Deployment reorganized');const x=await source('get_live_cell',[{tx_hash:hash,index:'0x0'},true]);assert.equal(x.status,'live','Q Cell became stale');assert.deepEqual(x.cell,primary.cell,'Q Cell changed during verification');}
 const deployed={A:{txHash:upstream,index:0},F:{txHash:upstream,index:1},Q:{txHash:hash,index:0}},allDeps=[K_DEP,...['A','F','Q'].map(n=>({outPoint:deployed[n],depType:'code'}))];
 const manifest={network:'pudge',genesis:PUDGE_GENESIS,kdep:K_DEP,deployed,allDeps,verification:{blockHash:primary.blockHash,blockNumber:primary.blockNumber,qDataHash:Q_HASH,qSha256:sha,verifiedBy:'primary and independent Pudge RPC'}};
 await fs.mkdir(directory,{recursive:true});const target=path.join(directory,'deployment.json');let file;
 try{file=await fs.open(target,'wx',0o600);await file.writeFile(JSON.stringify(manifest,null,2)+'\n');await file.sync();return {path:target,created:true,manifest};}
 catch(e){if(e.code!=='EEXIST')throw e;let existing;try{existing=JSON.parse(await fs.readFile(target,'utf8'));}catch{throw Error('Existing deployment manifest is unreadable; refusing to overwrite');}assert.equal(JSON.stringify(existing),JSON.stringify(manifest),'Existing deployment manifest differs; refusing to overwrite');return {path:target,created:false,manifest};}
 finally{if(file)await file.close();}
}
