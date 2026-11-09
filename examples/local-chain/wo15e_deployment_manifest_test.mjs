import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as c from '@ckb-ccc/core';
import {writeVerifiedDeploymentManifest} from './wo15e_deployment_manifest.mjs';
import {ownerLock,K_DEP,Q_HASH} from './wo15e_acceptance_builder.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const records=JSON.parse(await fs.readFile(new URL('../../evidence/working-pocket-local/transactions.json',import.meta.url),'utf8')),ownerPublicKey=records.records[0].actor,lock=ownerLock(ownerPublicKey),code=await fs.readFile(new URL('../../policy/build/allowance-native-v2',import.meta.url));
const hash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32),output={capacity:'0x'+(23661n*100000000n).toString(16),lock:{code_hash:lock.codeHash,hash_type:lock.hashType,args:lock.args},type:null},data='0x'+code.toString('hex'),cell={output,data:{content:data}};
function node(options={}){let liveCalls=0;return async(method,params=[])=>{if(method==='get_consensus')return {id:options.wrong?'ckb':'ckb_testnet'};if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:options.reorg?'0x'+'33'.repeat(32):blockHash;if(method==='get_transaction')return {tx_status:{status:options.pending?'pending':'committed',block_hash:blockHash},transaction:{outputs:[output],outputs_data:[data]}};if(method==='get_header')return {hash:blockHash,number:'0x64'};if(method==='get_live_cell'){liveCalls++;if(options.stale||(options.staleLater&&liveCalls>1))return {status:'dead'};return {status:'live',cell:options.wrongData?{output,data:{content:'0x00'}}:cell};}throw Error(method);};}
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-manifest-')),dir2=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-manifest-conflict-'));const target=path.join(dir,'deployment.json'),target2=path.join(dir2,'deployment.json');
try{
 const rpc=node(),independentRpc=node();const first=await writeVerifiedDeploymentManifest({rpc,independentRpc,hash,ownerPublicKey,directory:dir});assert.equal(first.created,true);const saved=JSON.parse(await fs.readFile(target,'utf8'));assert.equal(saved.genesis,PUDGE_GENESIS);assert.equal(saved.kdep.outPoint.txHash,K_DEP.outPoint.txHash);assert.equal(saved.deployed.Q.txHash,hash);assert.equal(saved.allDeps[3].outPoint.txHash,hash);assert.equal(saved.verification.qDataHash,Q_HASH);assert.equal((await writeVerifiedDeploymentManifest({rpc,independentRpc,hash,ownerPublicKey,directory:dir})).created,false);
 await fs.writeFile(target2,'{"preserve":true}');await assert.rejects(()=>writeVerifiedDeploymentManifest({rpc,independentRpc,hash,ownerPublicKey,directory:dir2}),/refusing to overwrite/);assert.equal(await fs.readFile(target2,'utf8'),'{"preserve":true}');
 for(const [options,pattern] of [[{pending:true},/not committed/],[{wrong:true},/Wrong network/],[{reorg:true},/Noncanonical/],[{stale:true},/not live/],[{staleLater:true},/became stale/],[{wrongData:true},/Wrong Q length/]])await assert.rejects(()=>writeVerifiedDeploymentManifest({rpc,independentRpc:node(options),hash,ownerPublicKey,directory:dir}),pattern);
 await assert.rejects(()=>writeVerifiedDeploymentManifest({rpc,independentRpc:rpc,hash,ownerPublicKey,directory:dir}),/Independent RPC/);
 console.log('PASS dual-RPC canonical/live Q verification, schema, stale/reorg failures and create-only manifest; no network calls');
}finally{for(const f of [target,target2])await fs.unlink(f).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(dir);await fs.rmdir(dir2);}
