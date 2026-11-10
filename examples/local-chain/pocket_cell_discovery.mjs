// Discover plain owner or protected cells by exact lock on a bounded local chain.
// The caller must treat returned cells as a snapshot and recheck before use.
import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
const script=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
const num=x=>'0x'+BigInt(x).toString(16);
export async function discoverPlainCells({rpc,lock:lockLike,maxBlocks=10000,includeUnsupported=false}){
 const lock=script(lockLike);assert(Number.isSafeInteger(maxBlocks)&&maxBlocks>0,'Invalid scan bound');
 const tip=await rpc('get_tip_header'),height=BigInt(tip.number);assert(height<BigInt(maxBlocks),'Chain exceeds scan bound');const matches=[],unsupported=[];
 for(let i=0n;i<=height;i++){
  const block=await rpc('get_block_by_number',[num(i)]);assert(block&&block.header.number===num(i),'Missing canonical block');assert.equal(await rpc('get_block_hash',[num(i)]),block.header.hash,'Noncanonical block');
  for(const tx of block.transactions)for(const [index,out] of tx.outputs.entries())if(script(out.lock).eq(lock)){
   const outPoint={tx_hash:tx.hash,index:num(index)},live=await rpc('get_live_cell',[outPoint,true]);if(live.status!=='live')continue;
   assert.deepEqual(live.cell.output,out,'Live output differs from canonical block');assert.equal(live.cell.data.content,tx.outputs_data[index],'Live data differs from canonical block');
   if(out.type||live.cell.data.content!=='0x'){assert(includeUnsupported,'Unsupported matching cell');unsupported.push({outPoint,cell:live.cell});continue;}matches.push({outPoint,cell:live.cell});
  }
 }
 assert.equal(await rpc('get_block_hash',[tip.number]),tip.hash,'Chain reorganized during scan');
 for(const item of [...matches,...unsupported]){const live=await rpc('get_live_cell',[item.outPoint,true]);assert.equal(live.status,'live','Cell became stale');assert.deepEqual(live.cell,item.cell,'Cell changed during scan');}
 return {cells:matches,unsupported,scanTip:tip.hash};
}
