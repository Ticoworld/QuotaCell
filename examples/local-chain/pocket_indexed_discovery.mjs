// Indexer results are hints. A trusted node independently verifies each candidate.
import * as c from '@ckb-ccc/core';
import { ECDH } from 'node:crypto';
import assert from 'node:assert/strict';
import {validatePolicy} from './pocket_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const A='0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const script=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
const raw=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
export async function discoverIndexed({rpc,lock,policy,expected,includeUnsupported=false,maxPages=100,pageSize=100,indexedSnapshot}){
 assert((await rpc('get_consensus')).id==='ckb_testnet','Wrong network');
 assert.equal(await rpc('get_block_hash',['0x0']),PUDGE_GENESIS,'Wrong network genesis');
 const tip=await rpc('get_tip_header'),indexed=indexedSnapshot||await rpc('get_indexer_tip');
 assert(indexed&&/^0x[0-9a-f]+$/i.test(indexed.block_number)&&/^0x[0-9a-f]{64}$/i.test(indexed.block_hash),'Invalid indexer tip');
 assert(BigInt(indexed.block_number)<=BigInt(tip.number),'Indexer is ahead of node tip');
 assert.equal(await rpc('get_block_hash',[indexed.block_number]),indexed.block_hash,'Noncanonical indexed tip');
 assert(BigInt(indexed.block_number)===BigInt(tip.number)&&indexed.block_hash.toLowerCase()===tip.hash.toLowerCase(),'Indexer lag or chain-tip mismatch');
 assert(Number.isSafeInteger(maxPages)&&maxPages>0&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=1000,'Invalid pagination bounds');
 const type=policy?'type':'lock',target=script(policy||lock);
 if(policy)assert(target.codeHash===Q&&target.hashType==='data2'&&/^0x[0-9a-f]{64}$/i.test(target.args),'Invalid QCN4 policy identity');
 const key={script:raw(target),script_type:type,script_search_mode:'exact',with_data:true,...(policy||includeUnsupported?{}:{filter:{script_len_range:['0x0','0x1'],output_data_len_range:['0x0','0x1']}})};let cursor;const cells=[],unsupported=[],seen=new Set();let finished=false;
 for(let page=0;page<maxPages;page++){
  const args=[key,'asc','0x'+pageSize.toString(16)];if(cursor!==undefined)args.push(cursor);
  const result=await rpc('get_cells',args);assert(result&&Array.isArray(result.objects)&&typeof result.last_cursor==='string','Invalid indexer response');
  for(const item of result.objects){
   const point=item.out_point;assert(point&&/^0x[0-9a-f]{64}$/i.test(point.tx_hash)&&/^0x[0-9a-f]+$/i.test(point.index),'Invalid outpoint');
   assert(BigInt(item.block_number)<=BigInt(indexed.block_number),'Indexer returned a Cell beyond its snapshot tip');
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
 assert.equal(await rpc('get_block_hash',[indexed.block_number]),indexed.block_hash,'Chain reorganized during scan');
 for(const item of [...cells,...unsupported]){const current=await rpc('get_live_cell',[item.outPoint,true]);assert.equal(current.status,'live','Cell became stale');assert.deepEqual(current.cell,item.cell,'Cell changed during scan');}
 if(policy)assert.equal(cells.length,1,cells.length?'Ambiguous live policy':'Policy not found');
 return {cells,unsupported,indexedTip:indexed,genesis:PUDGE_GENESIS};
}

const transientTipDrift=['Indexer lag or chain-tip mismatch','Indexer is ahead of node tip','Indexer tip changed during scan','Node tip changed during scan','Chain reorganized during scan','Stale indexed cell','Cell became stale','Cell changed during scan'];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function withIndexedTipRetry(operation,{attempts=5,delayMs=250}={}){
 assert(Number.isSafeInteger(attempts)&&attempts>0,'Invalid discovery retry count');
 for(let attempt=1;;attempt++){
  try{return await operation();}
  catch(error){
   if((!transientTipDrift.some(message=>error.message.startsWith(message))&&!error.message.startsWith('Indexed snapshots differ'))||attempt>=attempts)throw error;
   await delay(delayMs*attempt);
  }
 }
}
export const discoverIndexedWithRetry=(options,retry)=>withIndexedTipRetry(()=>discoverIndexed(options),retry);

// Discover live policies by QCN4 code identity, then derive the matching role
// from validated active-state public keys. The indexer is only a candidate source.
export async function discoverActorPolicies({rpc,publicKey,maxPages=100,pageSize=100,indexedSnapshot}){
 assert(/^0x0[23][0-9a-f]{64}$/i.test(publicKey),'Invalid compressed public key');
 assert(Number.isSafeInteger(maxPages)&&maxPages>0&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=1000,'Invalid pagination bounds');
 assert((await rpc('get_consensus')).id==='ckb_testnet','Wrong network');
 assert.equal(await rpc('get_block_hash',['0x0']),PUDGE_GENESIS,'Wrong network genesis');
 const tip=await rpc('get_tip_header'),indexed=indexedSnapshot||await rpc('get_indexer_tip');
 assert(indexed&&/^0x[0-9a-f]+$/i.test(indexed.block_number)&&/^0x[0-9a-f]{64}$/i.test(indexed.block_hash),'Invalid indexer tip');
 assert(BigInt(indexed.block_number)<=BigInt(tip.number),'Indexer is ahead of node tip');
 assert.equal(await rpc('get_block_hash',[indexed.block_number]),indexed.block_hash,'Noncanonical indexed tip');
 assert(BigInt(indexed.block_number)===BigInt(tip.number)&&indexed.block_hash.toLowerCase()===tip.hash.toLowerCase(),'Indexer lag or chain-tip mismatch');
 const key={script:{code_hash:Q,hash_type:'data2',args:'0x'},script_type:'type',script_search_mode:'prefix',with_data:true};
 const candidates=[],seen=new Set();let cursor,finished=false;
 for(let page=0;page<maxPages;page++){
  const args=[key,'asc','0x'+pageSize.toString(16)];if(cursor!==undefined)args.push(cursor);
  const result=await rpc('get_cells',args);assert(result&&Array.isArray(result.objects)&&typeof result.last_cursor==='string','Invalid indexer response');
  for(const item of result.objects){
   const point=item.out_point;assert(point&&/^0x[0-9a-f]{64}$/i.test(point.tx_hash)&&/^0x[0-9a-f]+$/i.test(point.index),'Invalid outpoint');
   const id=point.tx_hash+':'+point.index;assert(!seen.has(id),'Duplicate indexer outpoint');seen.add(id);
   assert(BigInt(item.block_number)<=BigInt(indexed.block_number),'Indexer returned a Cell beyond its snapshot tip');
   const txResult=await rpc('get_transaction',[point.tx_hash]);assert.equal(txResult?.tx_status?.status,'committed','Uncommitted indexed policy');
   const header=await rpc('get_header',[txResult.tx_status.block_hash]);assert(header&&header.number===item.block_number,'Indexed block mismatch');
   assert.equal(await rpc('get_block_hash',[header.number]),header.hash,'Noncanonical policy block');
   const output=item.output;assert(output.type&&script(output.type).codeHash===Q&&script(output.type).hashType==='data2'&&/^0x[0-9a-f]{64}$/i.test(script(output.type).args),'Invalid QCN4 identity');
   assert(script(output.lock).eq(c.Script.from({codeHash:A,hashType:'data1',args:'0x'})),'Policy lock mismatch');
   const live=await rpc('get_live_cell',[point,true]);assert.equal(live.status,'live','Stale indexed policy');
   assert.deepEqual(live.cell.output,output,'Indexer output mismatch');assert.equal(live.cell.data.content,item.output_data,'Indexer data mismatch');
   const n=Number(BigInt(point.index));assert.deepEqual(txResult.transaction.outputs[n],output,'Canonical transaction output mismatch');assert.equal(txResult.transaction.outputs_data[n],live.cell.data.content,'Canonical transaction data mismatch');
   const data=Buffer.from(live.cell.data.content.slice(2),'hex');let role;
   if(data.length===466){assert.equal(data.subarray(0,7).toString('hex'),'51434e34040000','Invalid active policy header');assert((data[7]&~3)===0,'Invalid delegate mask');assert(data.subarray(40,125).every(x=>x===0),'Nonzero reserved state');
    const read128=offset=>data.readBigUInt64LE(offset)+(data.readBigUInt64LE(offset+8)<<64n),terms={ownerPublicKey:'0x'+data.subarray(125,158).toString('hex'),sharedLimit:read128(8).toString(),delegates:[0,1].map(i=>{const o=158+154*i;return {publicKey:'0x'+data.subarray(o,o+33).toString('hex'),recipient:c.Script.fromBytes(data.subarray(o+33,o+106)),limit:read128(o+106).toString(),perPayment:read128(o+138).toString()};})};
    validatePolicy(live.cell,script(output.type),terms);
    if('0x'+data.subarray(125,158).toString('hex')===publicKey.toLowerCase())role='owner';
    else for(let i=0;i<2;i++)if('0x'+data.subarray(158+i*154,191+i*154).toString('hex')===publicKey.toLowerCase())role=i?'ben':'alice';
   }else if(data.length===28){assert.equal(data.subarray(0,8).toString('hex'),'5143543404000100','Invalid terminal state');assert(BigInt(output.capacity)>=13400000000n,'Insufficient terminal capacity');const args=c.hashCkb(Buffer.from(publicKey.slice(2),'hex')).slice(0,42);if('0x'+data.subarray(8).toString('hex')===args)role='owner';}
   else throw Error('Malformed QCN4/QCT4 state');
   if(role)candidates.push({role,publicKey,closed:data.length===28,outPoint:point,cell:live.cell,policy:script(output.type),policyHash:script(output.type).hash(),blockHash:header.hash,blockNumber:header.number});
  }
  if(result.objects.length<pageSize){finished=true;break;}
  assert(result.last_cursor!=='0x'&&result.last_cursor!==cursor,'Indexer cursor did not advance');cursor=result.last_cursor;
 }
 assert(finished,'Indexer pagination limit exceeded');
 assert.equal(await rpc('get_block_hash',[indexed.block_number]),indexed.block_hash,'Chain reorganized during scan');
 for(const item of candidates){const current=await rpc('get_live_cell',[item.outPoint,true]);assert.equal(current.status,'live','Cell became stale');assert.deepEqual(current.cell,item.cell,'Cell changed during scan');}
 return {candidates,indexedTip:indexed,genesis:PUDGE_GENESIS};
}

// The public path above is indexer-only. This bounded block walk exists only for
// disposable ckb_dev nodes, which do not run the Pudge indexer API.
export async function discoverActorPoliciesLocal({rpc,publicKey,expectedGenesis,maxBlocks=10000}){
 assert(/^0x0[23][0-9a-f]{64}$/i.test(publicKey),'Invalid compressed public key');
 assert(Number.isSafeInteger(maxBlocks)&&maxBlocks>0&&maxBlocks<=10000,'Invalid local discovery bound');
 assert.equal((await rpc('get_consensus')).id,'ckb_dev','Local discovery requires an isolated dev chain');
 const genesis=await rpc('get_block_hash',['0x0']);assert.match(genesis,/^0x[0-9a-f]{64}$/i);if(expectedGenesis)assert.equal(genesis,expectedGenesis,'Wrong isolated-chain genesis');
 const tip=await rpc('get_tip_header'),height=BigInt(tip.number);assert(height+1n<=BigInt(maxBlocks),'Local discovery block limit exceeded');
 const target=publicKey.toLowerCase(),candidates=[];
 for(let number=0n;number<=height;number++){
  const at='0x'+number.toString(16),block=await rpc('get_block_by_number',[at]);
  assert(block&&block.header.number===at,'Missing local canonical block');
  assert.equal(await rpc('get_block_hash',[at]),block.header.hash,'Noncanonical local block');
  for(const tx of block.transactions)for(const [index,output] of tx.outputs.entries()){
   if(!output.type)continue;
   const policy=script(output.type);if(policy.codeHash!==Q)continue;
   assert.equal(policy.hashType,'data2','Invalid QCN4 hash type');assert(/^0x[0-9a-f]{64}$/i.test(policy.args),'Invalid QCN4 Type ID');
   assert(script(output.lock).eq(c.Script.from({codeHash:A,hashType:'data1',args:'0x'})),'Policy lock mismatch');
   const outPoint={tx_hash:tx.hash,index:'0x'+index.toString(16)},cell=await rpc('get_live_cell',[outPoint,true]);
   if(cell.status!=='live')continue;
   assert.deepEqual(cell.cell.output,output,'Live output differs from canonical local block');
   assert.equal(cell.cell.data.content,tx.outputs_data[index],'Live data differs from canonical local block');
   const data=Buffer.from(cell.cell.data.content.slice(2),'hex');let role,closed=false;
   if(data.length===466){
    assert.equal(data.subarray(0,7).toString('hex'),'51434e34040000','Invalid active policy header');
    const read128=offset=>data.readBigUInt64LE(offset)+(data.readBigUInt64LE(offset+8)<<64n);
    const ownerBytes=data.subarray(125,158),ownerPublicKey='0x'+ownerBytes.toString('hex');
    ECDH.convertKey(ownerBytes,'secp256k1',undefined,undefined,'compressed');
    const delegates=[0,1].map(i=>{const offset=158+154*i,keyBytes=data.subarray(offset,offset+33);ECDH.convertKey(keyBytes,'secp256k1',undefined,undefined,'compressed');return {publicKey:'0x'+keyBytes.toString('hex'),recipient:c.Script.fromBytes(data.subarray(offset+33,offset+106)),limit:read128(offset+106).toString(),perPayment:read128(offset+138).toString()};});
    const expected={ownerPublicKey,sharedLimit:read128(8).toString(),delegates};validatePolicy(cell.cell,policy,expected);
    if(ownerPublicKey.toLowerCase()===target)role='owner';
    else for(let i=0;i<2;i++)if(delegates[i].publicKey.toLowerCase()===target)role=i?'ben':'alice';
   }else if(data.length===28){
    closed=true;assert.equal(data.subarray(0,8).toString('hex'),'5143543404000100','Invalid terminal state');
    assert(BigInt(output.capacity)>=13400000000n,'Insufficient terminal capacity');
    const ownerArgs=c.hashCkb(Buffer.from(target.slice(2),'hex')).slice(0,42);
    if('0x'+data.subarray(8).toString('hex')===ownerArgs)role='owner';
   }else throw Error('Malformed QCN4/QCT4 state');
   if(role)candidates.push({role,publicKey:target,closed,outPoint,cell:cell.cell,policy,policyHash:policy.hash(),blockHash:block.header.hash,blockNumber:block.header.number});
  }
 }
 assert.equal(await rpc('get_block_hash',[tip.number]),tip.hash,'Local chain reorganized during scan');
 for(const candidate of candidates){const current=await rpc('get_live_cell',[candidate.outPoint,true]);assert.equal(current.status,'live','Local policy became stale');assert.deepEqual(current.cell,candidate.cell,'Local policy changed during scan');}
 return {candidates,genesis,scanTip:tip.hash};
}
