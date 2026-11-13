import assert from 'node:assert/strict';
import {discoverIndexedWithRetry} from './pocket_indexed_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';

const nodeTip={number:'0x12',hash:'0x'+'12'.repeat(32)};
const indexedTip={block_number:'0x10',block_hash:'0x'+'10'.repeat(32)};
let indexerCalls=0,cellsCalls=0;
const rpc=async(method,params=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};
 if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:params[0]===indexedTip.block_number?indexedTip.block_hash:nodeTip.hash;
 if(method==='get_tip_header')return nodeTip;
 if(method==='get_indexer_tip'){
  indexerCalls++;
  return indexerCalls===2?{block_number:'0x11',block_hash:'0x'+'11'.repeat(32)}:indexedTip;
 }
 if(method==='get_cells'){cellsCalls++;return {objects:[],last_cursor:'0x'};}
 throw new Error(`Unexpected RPC method ${method}`);
};

const result=await discoverIndexedWithRetry({rpc,lock:{codeHash:'0x'+'22'.repeat(32),hashType:'type',args:'0x'}});
assert.equal(result.indexedTip.block_hash,indexedTip.block_hash);
assert.equal(cellsCalls,2,'A moving indexer tip should restart the complete scan once');

let consensusCalls=0;
await assert.rejects(discoverIndexedWithRetry({rpc:async method=>{
 if(method==='get_consensus'){consensusCalls++;return {id:'ckb'};}
 throw new Error(`Unexpected RPC method ${method}`);
}}),/Wrong network/);
assert.equal(consensusCalls,1,'Non-tip validation failures must not retry');

console.log('Indexed discovery retries transient tip drift and preserves fail-closed validation');
