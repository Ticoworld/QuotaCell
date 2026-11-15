import assert from 'node:assert/strict';
import {discoverIndexedWithRetry,withIndexedTipRetry} from './pocket_indexed_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';

const nodeTip={number:'0x12',hash:'0x'+'12'.repeat(32)};
const indexedTip={block_number:'0x10',block_hash:'0x'+'10'.repeat(32)};
let cellsCalls=0;
const rpc=async(method,params=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};
 if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:params[0]===indexedTip.block_number?indexedTip.block_hash:nodeTip.hash;
 if(method==='get_tip_header')return nodeTip;
 if(method==='get_indexer_tip')return indexedTip;
 if(method==='get_cells'){cellsCalls++;return {objects:[],last_cursor:'0x'};}
 throw new Error(`Unexpected RPC method ${method}`);
};

const result=await discoverIndexedWithRetry({rpc,lock:{codeHash:'0x'+'22'.repeat(32),hashType:'type',args:'0x'}});
assert.equal(result.indexedTip.block_hash,indexedTip.block_hash);
assert.equal(cellsCalls,1,'A stable canonical indexer snapshot two blocks behind the node is searched once');
const beforeBoundedLag=cellsCalls;
await assert.rejects(discoverIndexedWithRetry({rpc,maxIndexerLag:1,lock:{codeHash:'0x'+'22'.repeat(32),hashType:'type',args:'0x'}}),/Indexer lag exceeds bounded discovery window/);
assert.equal(cellsCalls,beforeBoundedLag,'A snapshot beyond the configured bound is rejected before searching');

let lagCalls=0,lagCellQueries=0;
const lagRpc=async(method,params=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};
 if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:params[0]===indexedTip.block_number?indexedTip.block_hash:nodeTip.hash;
 if(method==='get_tip_header')return nodeTip;
 if(method==='get_indexer_tip'){lagCalls++;return lagCalls===1?indexedTip:{block_number:nodeTip.number,block_hash:nodeTip.hash};}
 if(method==='get_cells'){lagCellQueries++;return {objects:[],last_cursor:'0x'};}
 throw new Error(`Unexpected lagging-indexer RPC method ${method}`);
};
const caughtUpScan=await discoverIndexedWithRetry({rpc:lagRpc,lock:{codeHash:'0x'+'22'.repeat(32),hashType:'type',args:'0x'}},{attempts:3,delayMs:0});
assert.equal(lagCalls,1,'A stable older indexer tip is accepted without waiting for the node tip');assert.equal(lagCellQueries,1,'Candidate search runs against the bounded older snapshot');assert.equal(caughtUpScan.indexedTip.block_number,indexedTip.block_number);

const recentLock={codeHash:'0x'+'44'.repeat(32),hashType:'type',args:'0x'},recentOutput={capacity:'0x1',lock:{code_hash:recentLock.codeHash,hash_type:recentLock.hashType,args:recentLock.args},type:null};
const recentPoint={tx_hash:'0x'+'55'.repeat(32),index:'0x0'},recentItem={out_point:recentPoint,block_number:nodeTip.number,output:recentOutput,output_data:'0x'};
let movingIndexCalls=0,movingCellQueries=0;
const movingRpc=async(method,params=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};
 if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:params[0]===indexedTip.block_number?indexedTip.block_hash:nodeTip.hash;
 if(method==='get_tip_header')return nodeTip;
 if(method==='get_indexer_tip'){movingIndexCalls++;return movingIndexCalls===1?indexedTip:{block_number:nodeTip.number,block_hash:nodeTip.hash};}
 if(method==='get_cells'){movingCellQueries++;return {objects:[recentItem],last_cursor:'0x'};}
 if(method==='get_live_cell')return {status:'live',cell:{output:recentOutput,data:{content:'0x'}}};
 if(method==='get_transaction')return {tx_status:{status:'committed',block_hash:nodeTip.hash},transaction:{outputs:[recentOutput],outputs_data:['0x']}};
 if(method==='get_header')return {number:nodeTip.number,hash:nodeTip.hash};
 throw new Error(`Unexpected moving-indexer RPC method ${method}`);
};
const movedDuringScan=await discoverIndexedWithRetry({rpc:movingRpc,lock:recentLock},{attempts:3,delayMs:0});
assert.equal(movingIndexCalls,2,'A result newer than its starting indexer snapshot causes a bounded retry');
assert.equal(movingCellQueries,2);assert.equal(movedDuringScan.cells.length,1,'A newly indexed canonical live Cell is returned after retry');

let consensusCalls=0;
await assert.rejects(discoverIndexedWithRetry({rpc:async method=>{
 if(method==='get_consensus'){consensusCalls++;return {id:'ckb'};}
 throw new Error(`Unexpected RPC method ${method}`);
}}),/Wrong network/);
assert.equal(consensusCalls,1,'Non-tip validation failures must not retry');

let batchCalls=0;
const batch=await withIndexedTipRetry(async()=>{
 batchCalls++;
 if(batchCalls===1)throw Error('Indexed snapshots differ');
 return 'consistent snapshot';
},{attempts:2,delayMs:0});
assert.equal(batch,'consistent snapshot');
assert.equal(batchCalls,2,'A moving multi-scan indexer snapshot should retry the whole scan set');

let aheadCalls=0;
const caughtUp=await withIndexedTipRetry(async()=>{
 aheadCalls++;
 if(aheadCalls===1)throw Error('Indexer is ahead of node tip');
 return 'node caught up';
},{attempts:2,delayMs:0});
assert.equal(caughtUp,'node caught up');
assert.equal(aheadCalls,2,'An indexer briefly ahead of the node should retry without weakening tip checks');

const cellBlock='0x'+'33'.repeat(32),lock={codeHash:'0x'+'44'.repeat(32),hashType:'type',args:'0x'};
const output={capacity:'0x1',lock:{code_hash:lock.codeHash,hash_type:lock.hashType,args:lock.args},type:null};
const indexedCell={out_point:{tx_hash:'0x'+'55'.repeat(32),index:'0x0'},block_number:'0x1',output,output_data:'0x'};
let liveCalls=0;
const staleTip={number:'0x1',hash:cellBlock};
const staleRpc=async(method,params=[])=>{
 if(method==='get_consensus')return {id:'ckb_testnet'};
 if(method==='get_block_hash')return params[0]==='0x0'?PUDGE_GENESIS:params[0]==='0x1'?cellBlock:nodeTip.hash;
 if(method==='get_tip_header')return staleTip;
 if(method==='get_indexer_tip')return {block_number:'0x1',block_hash:cellBlock};
 if(method==='get_cells')return {objects:[indexedCell],last_cursor:'0x'};
 if(method==='get_live_cell'){
  liveCalls++;
  if(liveCalls===1)return {status:'dead'};
  return {status:'live',cell:{output,data:{content:'0x'}}};
 }
 if(method==='get_transaction')return {tx_status:{status:'committed',block_hash:cellBlock},transaction:{outputs:[output],outputs_data:['0x']}};
 if(method==='get_header')return {number:'0x1',hash:cellBlock};
 throw new Error(`Unexpected stale-indexer RPC method ${method}`);
};
const retriedScan=await discoverIndexedWithRetry({rpc:staleRpc,lock});
assert.equal(retriedScan.cells.length,1,'The whole indexer scan should succeed after the indexer catches up');
assert.equal(liveCalls,3,'A stale candidate must restart discovery and independently recheck the returned live Cell');

let changedCalls=0;
await assert.rejects(withIndexedTipRetry(async()=>{
 changedCalls++;
 throw Error('Cell changed during scan');
},{attempts:3,delayMs:0}),/Cell changed during scan/);
assert.equal(changedCalls,3,'Persistent cell changes remain fail-closed after bounded retries');

let batchNetworkCalls=0;
await assert.rejects(withIndexedTipRetry(async()=>{batchNetworkCalls++;throw Error('Wrong network');}),/Wrong network/);
assert.equal(batchNetworkCalls,1,'Non-tip failures must not retry a multi-scan snapshot');

console.log('Indexed discovery retries bounded tip drift and coherent snapshot scans while preserving fail-closed validation');
