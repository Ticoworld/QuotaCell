import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const hex=n=>'0x'+BigInt(n).toString(16);
const readScript=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
const rpcScript=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
// Select one independently verified input, rather than claiming a complete
// wallet snapshot. New blocks may arrive as long as the original anchor and
// the selected transaction remain canonical and the Cell stays live.
export async function findFundingCell({rpc,lock:lockLike,minimum,pageSize=100}){
 const lock=readScript(lockLike),min=BigInt(minimum);assert(min>0n&&min<(1n<<64n)-1n,'Invalid minimum capacity');
 assert(Number.isInteger(pageSize)&&pageSize>0&&pageSize<=1000,'Invalid page size');
 const [consensus,genesis]=await Promise.all([rpc('get_consensus'),rpc('get_block_hash',['0x0'])]);
 assert.equal(consensus.id,'ckb_testnet','Wrong network');assert.equal(genesis,PUDGE_GENESIS,'Wrong network genesis');
 const tip=await rpc('get_tip_header'),indexed=await rpc('get_indexer_tip');assert(indexed&&tip.number===indexed.block_number&&tip.hash===indexed.block_hash,'Indexer lag or chain-tip mismatch');
 const key={script:rpcScript(lock),script_type:'lock',script_search_mode:'exact',with_data:true,filter:{script_len_range:['0x0','0x1'],output_data_len_range:['0x0','0x1'],output_capacity_range:[hex(min),'0xffffffffffffffff']}};
 const page=await rpc('get_cells',[key,'desc',hex(pageSize)]);assert(page&&Array.isArray(page.objects),'Invalid indexer response');
 if(!page.objects.length)throw Error('No single eligible funding Cell found by the indexer; fund the wallet with a plain Cell covering the displayed minimum and current fee');
 const items=page.objects.slice().sort((a,b)=>BigInt(a.output.capacity)<BigInt(b.output.capacity)?-1:1);const item=items[0],p=item.out_point;
 assert(p&&/^0x[0-9a-f]{64}$/i.test(p.tx_hash)&&/^0x[0-9a-f]+$/i.test(p.index),'Invalid indexed outpoint');
 const [live,tx]=await Promise.all([rpc('get_live_cell',[p,true]),rpc('get_transaction',[p.tx_hash])]);
 assert.equal(live.status,'live','Stale indexed Cell');assert.deepEqual(live.cell.output,item.output,'Indexed output mismatch');assert.equal(live.cell.data.content,item.output_data,'Indexed data mismatch');
 const out=live.cell.output;assert(readScript(out.lock).eq(lock),'Funding lock mismatch');assert(!out.type&&live.cell.data.content==='0x','Funding Cell must be plain');assert(BigInt(out.capacity)>=min,'Funding Cell capacity mismatch');
 assert.equal(tx?.tx_status?.status,'committed','Funding transaction is not committed');const header=await rpc('get_header',[tx.tx_status.block_hash]);assert(header&&header.number===item.block_number,'Funding block mismatch');
 const n=Number(BigInt(p.index));assert(Number.isSafeInteger(n)&&n>=0,'Invalid output index');assert.deepEqual(tx.transaction.outputs[n],out,'Funding transaction output mismatch');assert.equal(tx.transaction.outputs_data[n],live.cell.data.content,'Funding transaction data mismatch');
 const end=await rpc('get_indexer_tip');assert(end&&BigInt(end.block_number)>=BigInt(indexed.block_number),'Indexer moved backwards');
 const [anchorHash,cellBlockHash,endHash,current]=await Promise.all([rpc('get_block_hash',[indexed.block_number]),rpc('get_block_hash',[header.number]),rpc('get_block_hash',[end.block_number]),rpc('get_live_cell',[p,true])]);
 assert.equal(anchorHash,indexed.block_hash,'Chain reorganized during funding lookup');assert.equal(cellBlockHash,header.hash,'Funding block is noncanonical');assert.equal(endHash,end.block_hash,'Indexer tip is noncanonical');assert.equal(current.status,'live','Funding Cell became stale');assert.deepEqual(current.cell,live.cell,'Funding Cell changed');
 return {cells:[{outPoint:p,cell:live.cell,blockHash:header.hash,blockNumber:header.number}],indexedTip:end,anchor:indexed};
}
