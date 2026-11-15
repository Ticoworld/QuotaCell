import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import * as c from '@ckb-ccc/core';
import { discoverActorPolicies } from './pocket_indexed_discovery.mjs';
import { PUDGE_GENESIS } from './pocket_network.mjs';

const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const A='0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const key=n=>{const e=createECDH('secp256k1');e.setPrivateKey(Buffer.from(n.toString(16).padStart(64,'0'),'hex'));return '0x'+e.getPublicKey(null,'compressed').toString('hex');};
const actors=[key(1),key(2),key(3)];
const lockFor=pk=>c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(Buffer.from(pk.slice(2),'hex')).slice(0,42)});
let state=Buffer.alloc(466);state.write('QCN4');state.writeUInt16LE(4,4);state[7]=3;
const put128=(offset,n)=>{state.writeBigUInt64LE(BigInt(n)&((1n<<64n)-1n),offset);state.writeBigUInt64LE(BigInt(n)>>64n,offset+8);};
put128(8,122n*100000000n);
for(const [i,pk] of actors.entries())Buffer.from(pk.slice(2),'hex').copy(state,i===0?125:158+154*(i-1));
for(let i=0;i<2;i++){const offset=158+154*i,recipient=c.Script.from({codeHash:K,hashType:'type',args:'0x'+(i?'22':'11').repeat(20)});Buffer.from(recipient.toBytes()).copy(state,offset+33);put128(offset+106,122n*100000000n);put128(offset+138,61n*100000000n);}
const policyArgs='0x'+'ab'.repeat(32),policy={code_hash:Q,hash_type:'data2',args:policyArgs};
const output={capacity:'0xdf8475800',lock:{code_hash:A,hash_type:'data1',args:'0x'},type:policy};
let data='0x'+state.toString('hex');const point={tx_hash:'0x'+'55'.repeat(32),index:'0x0'},block='0x'+'33'.repeat(32),tip='0x'+'44'.repeat(32);
const indexed={out_point:point,block_number:'0x1',output,output_data:data};
let calls=0;
const rpc=async(method,params=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};
 if(method==='get_tip_header')return {number:'0x1',hash:block};
 if(method==='get_indexer_tip')return {block_number:'0x1',block_hash:block};
 if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:params[0]==='0x1'?block:tip;
 if(method==='get_cells'){calls++;assert.equal(params[0].script_search_mode,'prefix');return {objects:[indexed],last_cursor:'0x'};}
 if(method==='get_transaction')return {tx_status:{status:'committed',block_hash:block},transaction:{outputs:[output],outputs_data:[data]}};
 if(method==='get_header')return {number:'0x1',hash:block};
 if(method==='get_live_cell')return {status:'live',cell:{output,data:{content:data}}};
 throw new Error(`Unexpected RPC method ${method}`);
};

for(const [index,role] of ['owner','alice','ben'].entries()){
 const result=await discoverActorPolicies({rpc,publicKey:actors[index],pageSize:2});
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].role,role);assert.equal(result.candidates[0].policyHash,c.Script.from({codeHash:Q,hashType:'data2',args:policyArgs}).hash());
}
assert.equal(calls,3,'Each actor gets a bounded indexer query');
await assert.rejects(discoverActorPolicies({rpc,publicKey:'0x'+'02'.repeat(33),maxPages:0}),/Invalid pagination bounds/);
state=Buffer.alloc(28);state.write('QCT4');state.writeUInt16LE(4,4);state[6]=1;Buffer.from(lockFor(actors[0]).args.slice(2),'hex').copy(state,8);data='0x'+state.toString('hex');indexed.output_data=data;output.capacity='0x31eb3c600';
const terminal=await discoverActorPolicies({rpc,publicKey:actors[0],pageSize:2});assert.equal(terminal.candidates.length,1);assert.equal(terminal.candidates[0].role,'owner');assert.equal(terminal.candidates[0].closed,true);
const delegate=await discoverActorPolicies({rpc,publicKey:actors[1],pageSize:2});assert.equal(delegate.candidates.length,0,'QCT4 does not disclose delegate identities');
console.log('Actor discovery validates canonical active roles and closed owner identity without inventing terminal delegate keys');
