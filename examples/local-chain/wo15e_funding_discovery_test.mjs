import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {findFundingCell} from './wo15e_funding_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const e=JSON.parse(await fs.readFile(new URL('../../evidence/pocket-native-v2/pay-alice.json',import.meta.url),'utf8')),actor=e.resolvedInputs[1],lock=actor.cell.output.lock;
const outPoint={tx_hash:actor.outPoint.txHash,index:'0x'+BigInt(actor.outPoint.index).toString(16)},anchor='0x'+'11'.repeat(32),newTip='0x'+'22'.repeat(32),block='0x'+'33'.repeat(32),index=Number(actor.outPoint.index);
function fake(options={}){let indexerCalls=0,liveCalls=0;return async(method,params=[])=>{
 if(method==='get_consensus')return {id:options.wrongNetwork?'ckb':'ckb_testnet'};
 if(method==='get_tip_header')return {number:'0x64',hash:anchor};
 if(method==='get_indexer_tip'){indexerCalls++;return indexerCalls===1?{block_number:options.lag?'0x63':'0x64',block_hash:anchor}:{block_number:'0x65',block_hash:newTip};}
 if(method==='get_cells')return {objects:options.empty?[]:[{out_point:outPoint,output:actor.cell.output,output_data:actor.cell.data.content,block_number:'0x20'}]};
 if(method==='get_live_cell'){liveCalls++;return options.stale||(options.staleLater&&liveCalls>1)?{status:'dead'}:{status:'live',cell:structuredClone(actor.cell)};}
 if(method==='get_transaction'){const outputs=[],outputs_data=[];outputs[index]=actor.cell.output;outputs_data[index]=options.badData?'0x01':actor.cell.data.content;return {tx_status:{status:'committed',block_hash:block},transaction:{outputs,outputs_data}};}
 if(method==='get_header')return {hash:block,number:'0x20'};
 if(method==='get_block_hash'){if(params[0]==='0x0')return PUDGE_GENESIS;if(params[0]==='0x64')return options.reorg?newTip:anchor;if(params[0]==='0x65')return newTip;if(params[0]==='0x20')return block;}
 throw Error(`Unexpected ${method}`);
};}
const accepted=await findFundingCell({rpc:fake(),lock,minimum:6100000000n});assert.equal(accepted.cells.length,1);assert.equal(accepted.anchor.block_hash,anchor);assert.equal(accepted.indexedTip.block_hash,newTip);
for(const [options,pattern] of [[{stale:true},/Stale/],[{staleLater:true},/became stale/],[{lag:true},/lag/],[{wrongNetwork:true},/Wrong network/],[{reorg:true},/reorganized/],[{empty:true},/No single eligible/],[{badData:true},/data mismatch/]])await assert.rejects(()=>findFundingCell({rpc:fake(options),lock,minimum:6100000000n}),pattern);
await assert.rejects(()=>findFundingCell({rpc:fake(),lock:{...lock,args:'0x'+'00'.repeat(20)},minimum:6100000000n}),/Funding lock mismatch/);
await assert.rejects(()=>findFundingCell({rpc:fake(),lock,minimum:BigInt(actor.cell.output.capacity)+1n}),/capacity mismatch/);
console.log('PASS single funding Cell verification with advancing tip; stale, lagging, reorg and mismatched results rejected');
