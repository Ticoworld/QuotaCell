// Indexer results are hints. A trusted node independently verifies each candidate.
import * as c from '@ckb-ccc/core';
import { ECDH } from 'node:crypto';
import assert from 'node:assert/strict';
import {validatePolicy} from './pocket_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const A='0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const MAX_INDEXER_LAG=64; // Keep discovery useful during ordinary indexer catch-up without accepting an unbounded stale view.
const script=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
const raw=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
async function captureSnapshot({rpc,indexedSnapshot,maxIndexerLag}){
 assert(Number.isSafeInteger(maxIndexerLag)&&maxIndexerLag>=0&&maxIndexerLag<=10000,'Invalid indexer lag bound');
 const [tip,indexed]=await Promise.all([rpc('get_tip_header'),indexedSnapshot?Promise.resolve(indexedSnapshot):rpc('get_indexer_tip')]);
 assert(tip&&/^0x[0-9a-f]+$/i.test(tip.number)&&/^0x[0-9a-f]{64}$/i.test(tip.hash),'Invalid node tip');
 assert(indexed&&/^0x[0-9a-f]+$/i.test(indexed.block_number)&&/^0x[0-9a-f]{64}$/i.test(indexed.block_hash),'Invalid indexer tip');
 const nodeHeight=BigInt(tip.number),indexerHeight=BigInt(indexed.block_number);
 assert(indexerHeight<=nodeHeight,'Indexer is ahead of node tip');
 assert(nodeHeight-indexerHeight<=BigInt(maxIndexerLag),'Indexer lag exceeds bounded discovery window');
 assert.equal((await rpc('get_block_hash',[indexed.block_number])).toLowerCase(),indexed.block_hash.toLowerCase(),'Noncanonical indexed tip');
 assert.equal((await rpc('get_block_hash',[tip.number])).toLowerCase(),tip.hash.toLowerCase(),'Noncanonical node tip');
 return {tip,indexed};
}
async function verifySnapshotCanonical({rpc,tip,indexed}){
 const [indexedHash,tipHash]=await Promise.all([rpc('get_block_hash',[indexed.block_number]),rpc('get_block_hash',[tip.number])]);
 assert.equal(indexedHash.toLowerCase(),indexed.block_hash.toLowerCase(),'Chain reorganized during scan');
 assert.equal(tipHash.toLowerCase(),tip.hash.toLowerCase(),'Node tip changed during scan');
}
async function mapConcurrent(items,limit,callback){
 const results=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const index=next++;if(index>=items.length)return;results[index]=await callback(items[index],index);}}));
 return results;
}
async function scanIndexed({rpc,lock,policy,expected,includeUnsupported,maxPages,pageSize,snapshot,verified}){
 const {tip,indexed}=snapshot;
 assert(Number.isSafeInteger(maxPages)&&maxPages>0&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=1000,'Invalid pagination bounds');
 const type=policy?'type':'lock',target=script(policy||lock);
 if(policy)assert(target.codeHash===Q&&target.hashType==='data2'&&/^0x[0-9a-f]{64}$/i.test(target.args),'Invalid QCN4 policy identity');
 const key={script:raw(target),script_type:type,script_search_mode:'exact',with_data:true,...(policy||includeUnsupported?{}:{filter:{script_len_range:['0x0','0x1'],output_data_len_range:['0x0','0x1']}})};let cursor;const cells=[],unsupported=[],seen=new Set();let finished=false;
 for(let page=0;page<maxPages;page++){
  const args=[key,'asc','0x'+pageSize.toString(16)];if(cursor!==undefined)args.push(cursor);
  const result=await rpc('get_cells',args);assert(result&&Array.isArray(result.objects)&&typeof result.last_cursor==='string','Invalid indexer response');
  const validated=await mapConcurrent(result.objects,12,async item=>{
   const point=item.out_point;assert(point&&/^0x[0-9a-f]{64}$/i.test(point.tx_hash)&&/^0x[0-9a-f]+$/i.test(point.index),'Invalid outpoint');
   assert(BigInt(item.block_number)<=BigInt(indexed.block_number),'Indexer returned a Cell beyond its snapshot tip');
   const id=point.tx_hash+':'+point.index;assert(!seen.has(id),'Duplicate indexer outpoint');seen.add(id);
   const live=await rpc('get_live_cell',[point,true]);assert.equal(live.status,'live','Stale indexed cell');
   assert.deepEqual(live.cell.output,item.output,'Indexer output mismatch');assert.equal(live.cell.data.content,item.output_data,'Indexer data mismatch');
   const output=live.cell.output;assert(output[type]&&script(output[type]).eq(target),'Indexed script mismatch');
   if(policy){
    const {tx,header}=await verified.transaction(point.tx_hash,item.block_number),n=Number(BigInt(point.index));
    assert.deepEqual(tx.transaction.outputs[n],output,'Transaction output mismatch');assert.equal(tx.transaction.outputs_data[n],live.cell.data.content,'Transaction data mismatch');
    validatePolicy(live.cell,target,expected);return {kind:'cell',value:{outPoint:point,cell:live.cell,blockHash:header.hash,blockNumber:header.number}};
   }
   if(output.type||live.cell.data.content!=='0x'){assert(includeUnsupported,'Unsupported matching cell');return {kind:'unsupported',value:{outPoint:point,cell:live.cell}};}
   return {kind:'cell',value:{outPoint:point,cell:live.cell}};
  });
  for(const item of validated)(item.kind==='cell'?cells:unsupported).push(item.value);
  if(result.objects.length<pageSize){finished=true;break;}
  assert(result.last_cursor!=='0x'&&result.last_cursor!==cursor,'Indexer cursor did not advance');cursor=result.last_cursor;
 }
 assert(finished,'Indexer pagination limit exceeded');
 if(policy)assert.equal(cells.length,1,cells.length?'Ambiguous live policy':'Policy not found');
 return {cells,unsupported,indexedTip:indexed,genesis:PUDGE_GENESIS};
}
export async function discoverIndexedBatch({rpc,queries,indexedSnapshot,maxIndexerLag=MAX_INDEXER_LAG,networkVerified=false,finalCellValidation=true}){
 assert(Array.isArray(queries)&&queries.length>0,'Indexed discovery needs at least one query');
 if(!networkVerified){
  const [consensus,genesis]=await Promise.all([rpc('get_consensus'),rpc('get_block_hash',['0x0'])]);
  assert(consensus.id==='ckb_testnet','Wrong network');assert.equal(genesis,PUDGE_GENESIS,'Wrong network genesis');
 }
 const snapshot=await captureSnapshot({rpc,indexedSnapshot,maxIndexerLag});
 const verified={
  transactions:new Map(),
  headers:new Map(),
  transaction(txHash,expectedNumber){
   const key=txHash.toLowerCase();
   if(!this.transactions.has(key))this.transactions.set(key,(async()=>{
    const tx=await rpc('get_transaction',[txHash]);assert.equal(tx?.tx_status?.status,'committed','Uncommitted indexed transaction');
    const header=await rpc('get_header',[tx.tx_status.block_hash]);assert(header&&BigInt(header.number)===BigInt(expectedNumber),'Indexed block mismatch');
    const height=BigInt(header.number).toString();
    if(!this.headers.has(height))this.headers.set(height,(async()=>rpc('get_block_hash',[header.number]))());
    assert.equal((await this.headers.get(height)).toLowerCase(),header.hash.toLowerCase(),'Noncanonical cell transaction');
    return {tx,header};
   })());
   return this.transactions.get(key).then(proof=>{assert(BigInt(proof.header.number)===BigInt(expectedNumber),'Indexed block mismatch');return proof;});
  }
 };
 const results=await Promise.all(queries.map(query=>scanIndexed({rpc,includeUnsupported:false,maxPages:100,pageSize:100,...query,snapshot,verified})));
 await verifySnapshotCanonical({rpc,...snapshot});
 const candidates=new Map();
 for(const result of results)for(const item of [...result.cells,...result.unsupported])candidates.set(item.outPoint.txHash+':'+item.outPoint.index,item);
 if(finalCellValidation)await mapConcurrent([...candidates.values()],12,async item=>{
  const current=await rpc('get_live_cell',[item.outPoint,true]);assert.equal(current.status,'live','Cell became stale');assert.deepEqual(current.cell,item.cell,'Cell changed during scan');
 });
 return results;
}
export async function discoverIndexed(options){
 const [result]=await discoverIndexedBatch({rpc:options.rpc,queries:[options],indexedSnapshot:options.indexedSnapshot,maxIndexerLag:options.maxIndexerLag});
 return result;
}

const transientTipDrift=['Indexer is ahead of node tip','Indexer returned a Cell beyond its snapshot tip','Node tip changed during scan','Chain reorganized during scan','Stale indexed cell','Cell became stale','Cell changed during scan'];
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
export async function discoverActorPolicies({rpc,publicKey,maxPages=100,pageSize=100,indexedSnapshot,maxIndexerLag=MAX_INDEXER_LAG}){
 assert(/^0x0[23][0-9a-f]{64}$/i.test(publicKey),'Invalid compressed public key');
 assert(Number.isSafeInteger(maxPages)&&maxPages>0&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=1000,'Invalid pagination bounds');
 assert((await rpc('get_consensus')).id==='ckb_testnet','Wrong network');
 assert.equal(await rpc('get_block_hash',['0x0']),PUDGE_GENESIS,'Wrong network genesis');
 const {tip,indexed}=await captureSnapshot({rpc,indexedSnapshot,maxIndexerLag});
 const key={script:{code_hash:Q,hash_type:'data2',args:'0x'},script_type:'type',script_search_mode:'prefix',with_data:true};
 const candidates=[],seen=new Set();let cursor,finished=false;
 for(let page=0;page<maxPages;page++){
  const args=[key,'asc','0x'+pageSize.toString(16)];if(cursor!==undefined)args.push(cursor);
  const result=await rpc('get_cells',args);assert(result&&Array.isArray(result.objects)&&typeof result.last_cursor==='string','Invalid indexer response');
  for(const item of result.objects){
   const point=item.out_point;assert(point&&/^0x[0-9a-f]{64}$/i.test(point.tx_hash)&&/^0x[0-9a-f]+$/i.test(point.index),'Invalid outpoint');
   const id=point.tx_hash+':'+point.index;assert(!seen.has(id),'Duplicate indexer outpoint');seen.add(id);
   assert(BigInt(item.block_number)<=BigInt(indexed.block_number),'Indexer returned a Cell beyond its snapshot tip');
   const indexedOutput=item.output;assert(indexedOutput.type&&script(indexedOutput.type).codeHash===Q&&script(indexedOutput.type).hashType==='data2'&&/^0x[0-9a-f]{64}$/i.test(script(indexedOutput.type).args),'Invalid QCN4 identity');
   const live=await rpc('get_live_cell',[point,true]);assert.equal(live.status,'live','Stale indexed policy');
   assert.deepEqual(live.cell.output,indexedOutput,'Indexer output mismatch');assert.equal(live.cell.data.content,item.output_data,'Indexer data mismatch');
   const output=live.cell.output;assert(script(output.lock).eq(c.Script.from({codeHash:A,hashType:'data1',args:'0x'})),'Policy lock mismatch');
   assert(/^0x(?:[0-9a-f]{2})*$/i.test(live.cell.data.content),'Malformed QCN4/QCT4 state');
   const data=Buffer.from(live.cell.data.content.slice(2),'hex');let role;
   if(data.length===466){assert.equal(data.subarray(0,7).toString('hex'),'51434e34040000','Invalid active policy header');assert((data[7]&~3)===0,'Invalid delegate mask');assert(data.subarray(40,125).every(x=>x===0),'Nonzero reserved state');
    const read128=offset=>data.readBigUInt64LE(offset)+(data.readBigUInt64LE(offset+8)<<64n),terms={ownerPublicKey:'0x'+data.subarray(125,158).toString('hex'),sharedLimit:read128(8).toString(),delegates:[0,1].map(i=>{const o=158+154*i;return {publicKey:'0x'+data.subarray(o,o+33).toString('hex'),recipient:c.Script.fromBytes(data.subarray(o+33,o+106)),limit:read128(o+106).toString(),perPayment:read128(o+138).toString()};})};
    validatePolicy(live.cell,script(output.type),terms);
    if(terms.ownerPublicKey===publicKey.toLowerCase())role='owner';else for(let i=0;i<2;i++)if(terms.delegates[i].publicKey===publicKey.toLowerCase())role=i?'ben':'alice';
   }else if(data.length===28){assert.equal(data.subarray(0,8).toString('hex'),'5143543404000100','Invalid terminal state');assert(BigInt(output.capacity)>=13400000000n,'Insufficient terminal capacity');const args=c.hashCkb(Buffer.from(publicKey.slice(2),'hex')).slice(0,42);if('0x'+data.subarray(8).toString('hex')===args)role='owner';}
   else throw Error('Malformed QCN4/QCT4 state');
   if(!role)continue;
   const txResult=await rpc('get_transaction',[point.tx_hash]);assert.equal(txResult?.tx_status?.status,'committed','Uncommitted indexed policy');
   const header=await rpc('get_header',[txResult.tx_status.block_hash]);assert(header&&header.number===item.block_number,'Indexed block mismatch');
   assert.equal(await rpc('get_block_hash',[header.number]),header.hash,'Noncanonical policy block');
   const n=Number(BigInt(point.index));assert.deepEqual(txResult.transaction.outputs[n],output,'Canonical transaction output mismatch');assert.equal(txResult.transaction.outputs_data[n],live.cell.data.content,'Canonical transaction data mismatch');
   candidates.push({role,publicKey,closed:data.length===28,outPoint:point,cell:live.cell,policy:script(output.type),policyHash:script(output.type).hash(),blockHash:header.hash,blockNumber:header.number});
  }
  if(result.objects.length<pageSize){finished=true;break;}
  assert(result.last_cursor!=='0x'&&result.last_cursor!==cursor,'Indexer cursor did not advance');cursor=result.last_cursor;
 }
 assert(finished,'Indexer pagination limit exceeded');
 await verifySnapshotCanonical({rpc,tip,indexed});
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
