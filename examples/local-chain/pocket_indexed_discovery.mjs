// Indexer results are hints. A trusted node independently verifies each candidate.
import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import {validatePolicy} from './pocket_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const script=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
const raw=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
export async function discoverIndexed({rpc,lock,policy,expected,includeUnsupported=false,maxPages=100,pageSize=100}){
 assert((await rpc('get_consensus')).id==='ckb_testnet','Wrong network');
 assert.equal(await rpc('get_block_hash',['0x0']),PUDGE_GENESIS,'Wrong network genesis');
 const tip=await rpc('get_tip_header'),indexed=await rpc('get_indexer_tip');
 assert(indexed && indexed.block_number===tip.number && indexed.block_hash===tip.hash,'Indexer lag or chain-tip mismatch');
 assert.equal(await rpc('get_block_hash',[tip.number]),tip.hash,'Noncanonical indexed tip');
 assert(Number.isSafeInteger(maxPages)&&maxPages>0&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=1000,'Invalid pagination bounds');
 const type=policy?'type':'lock',target=script(policy||lock);
 if(policy)assert(target.codeHash===Q&&target.hashType==='data2'&&/^0x[0-9a-f]{64}$/i.test(target.args),'Invalid QCN4 policy identity');
 const key={script:raw(target),script_type:type,script_search_mode:'exact',with_data:true,...(policy||includeUnsupported?{}:{filter:{script_len_range:['0x0','0x1'],output_data_len_range:['0x0','0x1']}})};let cursor;const cells=[],unsupported=[],seen=new Set();let finished=false;
 for(let page=0;page<maxPages;page++){
  const args=[key,'asc','0x'+pageSize.toString(16)];if(cursor!==undefined)args.push(cursor);
  const result=await rpc('get_cells',args);assert(result&&Array.isArray(result.objects)&&typeof result.last_cursor==='string','Invalid indexer response');
  for(const item of result.objects){
   const point=item.out_point;assert(point&&/^0x[0-9a-f]{64}$/i.test(point.tx_hash)&&/^0x[0-9a-f]+$/i.test(point.index),'Invalid outpoint');
   const id=point.tx_hash+':'+point.index;assert(!seen.has(id),'Duplicate indexer outpoint');seen.add(id);
   const live=await rpc('get_live_cell',[point,true]);assert.equal(live.status,'live','Stale indexed cell');
   assert.deepEqual(live.cell.output,item.output,'Indexer output mismatch');assert.equal(live.cell.data.content,item.output_data,'Indexer data mismatch');
   const output=live.cell.output;assert(output[type]&&script(output[type]).eq(target),'Indexed script mismatch');
   const tx=await rpc('get_transaction',[point.tx_hash]);assert.equal(tx?.tx_status?.status,'committed','Uncommitted indexed transaction');
   const header=await rpc('get_header',[tx.tx_status.block_hash]);assert(header&&header.number===item.block_number,'Indexed block mismatch');
   assert.equal(await rpc('get_block_hash',[header.number]),header.hash,'Noncanonical cell transaction');
   const n=Number(BigInt(point.index));assert.deepEqual(tx.transaction.outputs[n],output,'Transaction output mismatch');assert.equal(tx.transaction.outputs_data[n],live.cell.data.content,'Transaction data mismatch');
   if(policy)validatePolicy(live.cell,target,expected);else if(output.type||live.cell.data.content!=='0x'){assert(includeUnsupported,'Unsupported matching cell');unsupported.push({outPoint:point,cell:live.cell,blockHash:header.hash,blockNumber:header.number});continue;}
   cells.push({outPoint:point,cell:live.cell,blockHash:header.hash,blockNumber:header.number});
  }
  if(result.objects.length<pageSize){finished=true;break;}
  assert(result.last_cursor!=='0x'&&result.last_cursor!==cursor,'Indexer cursor did not advance');cursor=result.last_cursor;
 }
 assert(finished,'Indexer pagination limit exceeded');
 const end=await rpc('get_indexer_tip');assert.deepEqual(end,indexed,'Indexer tip changed during scan');
 const nodeEnd=await rpc('get_tip_header');assert.equal(nodeEnd.hash,tip.hash,'Node tip changed during scan');
 assert.equal(await rpc('get_block_hash',[tip.number]),tip.hash,'Chain reorganized during scan');
 for(const item of [...cells,...unsupported]){const current=await rpc('get_live_cell',[item.outPoint,true]);assert.equal(current.status,'live','Cell became stale');assert.deepEqual(current.cell,item.cell,'Cell changed during scan');}
 if(policy)assert.equal(cells.length,1,cells.length?'Ambiguous live policy':'Policy not found');
 return {cells,unsupported,indexedTip:indexed,genesis:PUDGE_GENESIS};
}
