import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as c from '@ckb-ccc/core';
import {discoverIndexed} from './pocket_indexed_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const evidence=JSON.parse(await fs.readFile(new URL('../../evidence/pocket-native-v2/pay-alice.json',import.meta.url),'utf8'));
const [policy,actor,fund]=evidence.resolvedInputs;
const P=(x)=>({tx_hash:x.outPoint.txHash,index:'0x'+BigInt(x.outPoint.index).toString(16)});
const tip={number:'0x64',hash:'0x'+'12'.repeat(32)}, block='0x'+'34'.repeat(32);
function fixture(cells){let calls=0;return async(method,args=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};if(method==='get_block_hash')return args[0]==='0x0'?PUDGE_GENESIS:args[0]==='0x64'?tip.hash:block;
 if(method==='get_tip_header')return tip;if(method==='get_indexer_tip')return {block_number:tip.number,block_hash:tip.hash};
 if(method==='get_cells'){const page=calls++;return {objects:cells.slice(page,page+1).map(x=>({out_point:P(x),output:x.cell.output,output_data:x.cell.data.content,block_number:'0x20'})),last_cursor:'0x'+(page+1).toString(16)};}
 if(method==='get_live_cell'){const x=cells.find(x=>JSON.stringify(P(x))===JSON.stringify(args[0]));return x?{status:'live',cell:x.cell}:{status:'dead'};}
 if(method==='get_transaction'){const x=cells.find(x=>x.outPoint.txHash===args[0]),i=Number(x.outPoint.index),outputs=[],outputs_data=[];outputs[i]=x.cell.output;outputs_data[i]=x.cell.data.content;return {tx_status:{status:'committed',block_hash:block},transaction:{outputs,outputs_data}};}
 if(method==='get_header')return {hash:block,number:'0x20'};throw Error(method);
};}
const lock=actor.cell.output.lock;
let rpc=fixture([actor]);let result=await discoverIndexed({rpc,lock,pageSize:1});assert.equal(result.cells.length,1);assert.equal(result.genesis,PUDGE_GENESIS);
const duplicate=structuredClone(actor);duplicate.outPoint.txHash='0x'+'55'.repeat(32);result=await discoverIndexed({rpc:fixture([actor,duplicate]),lock,pageSize:1});assert.equal(result.cells.length,2);
for(const [name,override,pattern] of [
 ['stale',async(m,p,next)=>m==='get_live_cell'?{status:'dead'}:next(m,p),/Stale/],
 ['wrong script',async(m,p,next)=>{const v=await next(m,p);if(m==='get_cells'&&v.objects.length)v.objects[0].output.lock.args='0x'+'00'.repeat(20);return v},/mismatch/],
 ['lag',async(m,p,next)=>m==='get_indexer_tip'?{block_number:'0x63',block_hash:tip.hash}:next(m,p),/lag/],
 ['wrong network',async(m,p,next)=>m==='get_consensus'?{id:'ckb'}:next(m,p),/Wrong network/],
 ['rpc failure',async(m,p,next)=>{if(m==='get_cells')throw Error('RPC interrupted');return next(m,p)},/RPC interrupted/],
 ['tip changed',async(m,p,next)=>{const v=await next(m,p);if(m==='get_block_hash'&&p[0]==='0x64')return '0x'+'00'.repeat(32);return v},/Noncanonical/]
]){const next=fixture([structuredClone(actor)]);await assert.rejects(()=>discoverIndexed({rpc:(m,p)=>override(m,p,next),lock,pageSize:1}),pattern,name);}
const bytes=Buffer.from(policy.cell.data.content.slice(2),'hex'),u=o=>bytes.readBigUInt64LE(o)+(bytes.readBigUInt64LE(o+8)<<64n);
const expected={ownerPublicKey:'0x'+bytes.subarray(125,158).toString('hex'),sharedLimit:u(8).toString(),delegates:[158,312].map(o=>({publicKey:'0x'+bytes.subarray(o,o+33).toString('hex'),recipient:c.Script.fromBytes(bytes.subarray(o+33,o+106)),limit:u(o+106).toString(),perPayment:u(o+138).toString()}))};
const policyCopy=structuredClone(policy);policyCopy.outPoint.txHash='0x'+'66'.repeat(32);
assert.equal((await discoverIndexed({rpc:fixture([policy]),policy:policy.cell.output.type,expected,pageSize:1})).cells.length,1);
await assert.rejects(()=>discoverIndexed({rpc:fixture([policy,policyCopy]),policy:policy.cell.output.type,expected,pageSize:1}),/Ambiguous/);
await assert.rejects(()=>discoverIndexed({rpc:fixture([]),policy:policy.cell.output.type,expected,pageSize:1}),/Policy not found/);
await assert.rejects(()=>discoverIndexed({rpc:fixture([policy]),policy:policy.cell.output.type,expected:{...expected,sharedLimit:'1'},pageSize:1}),/Shared limit mismatch/);
await assert.rejects(()=>discoverIndexed({rpc:fixture([actor]),policy:{...policy.cell.output.type,code_hash:'0x'+'00'.repeat(32)},expected:{}}),/Invalid QCN4/);
console.log('PASS indexed pagination, multiple cells, stale, script, network, lag, RPC and canonical checks');
