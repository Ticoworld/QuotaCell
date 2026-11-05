// Bounded canonical-chain discovery for the isolated-node QCN4 experiment.
// RPC is a caller-supplied trusted node. This is not a public indexer.
import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const A='0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const toScript=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
const num=x=>'0x'+BigInt(x).toString(16);
const read128=(b,o)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n);
function validate(cell,policy,expected){
 const output=cell.output;assert(output.type&&toScript(output.type).eq(policy),'Policy identity mismatch');
 assert(toScript(output.lock).eq(c.Script.from({codeHash:A,hashType:'data1',args:'0x'})),'Policy lock mismatch');
 assert(BigInt(output.capacity)>=60000000000n,'Insufficient policy capacity');
 const data=cell.data.content;assert(/^0x[0-9a-f]{932}$/i.test(data),'Malformed policy state');const b=Buffer.from(data.slice(2),'hex');
 assert.equal(b.subarray(0,7).toString('hex'),'51434e34040000','Invalid active policy header');assert((b[7]&~3)===0,'Invalid delegate mask');assert(b.subarray(40,125).every(x=>x===0),'Nonzero reserved state');
 assert.equal(read128(b,8),BigInt(expected.sharedLimit),'Shared limit mismatch');assert(read128(b,24)<=read128(b,8),'Invalid shared usage');assert.equal(read128(b,280)+read128(b,434),read128(b,24),'Usage counters mismatch');
 assert.equal('0x'+b.subarray(125,158).toString('hex'),expected.ownerPublicKey.toLowerCase(),'Owner mismatch');
 assert(Array.isArray(expected.delegates)&&expected.delegates.length===2,'Expected two delegates');
 const actorKeys=[expected.ownerPublicKey,...expected.delegates.map(d=>d.publicKey)];
 assert.equal(new Set(actorKeys.map(x=>x.toLowerCase())).size,3,'Duplicate actor');
 const actorLocks=actorKeys.map(x=>{assert.match(x,/^0x0[23][0-9a-f]{64}$/i,'Invalid actor key');return c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(Buffer.from(x.slice(2),'hex')).slice(0,42)});});
 const recipients=[];
 for(const [i,d] of expected.delegates.entries()){
  const off=158+154*i;assert.equal('0x'+b.subarray(off,off+33).toString('hex'),d.publicKey.toLowerCase(),'Delegate mismatch');
  const recipient=c.Script.fromBytes(b.subarray(off+33,off+106));assert(recipient.eq(toScript(d.recipient)),'Recipient mismatch');
  assert(recipient.codeHash===K&&recipient.hashType==='type'&&/^0x[0-9a-f]{40}$/i.test(recipient.args),'Invalid recipient');
  assert(!actorLocks.some(x=>x.eq(recipient))&&!recipients.some(x=>x.eq(recipient)),'Duplicate recipient');recipients.push(recipient);
  const limit=read128(b,off+106),used=read128(b,off+122),per=read128(b,off+138);
  assert.equal(limit,BigInt(d.limit),'Delegate limit mismatch');assert.equal(per,BigInt(d.perPayment),'Payment ceiling mismatch');assert(used<=limit&&limit<=read128(b,8)&&per>0n&&per<=limit,'Invalid limits');
 }
 return {owner:expected.ownerPublicKey,sharedLimit:read128(b,8).toString(),delegates:expected.delegates.map(d=>({publicKey:d.publicKey,recipient:toScript(d.recipient).toHex(),limit:String(d.limit),perPayment:String(d.perPayment)}))};
}
export async function discoverPolicy({rpc,policy:policyLike,expected,maxBlocks=10000}){
 const policy=toScript(policyLike);assert(policy.codeHash===Q&&policy.hashType==='data2'&&/^0x[0-9a-f]{64}$/i.test(policy.args),'Invalid QCN4 policy identity');
 assert(Number.isSafeInteger(maxBlocks)&&maxBlocks>0,'Invalid scan bound');const tip=await rpc('get_tip_header');const height=BigInt(tip.number);assert(height<BigInt(maxBlocks),'Chain exceeds scan bound');
 const candidates=[];
 for(let i=0n;i<=height;i++){
  const block=await rpc('get_block_by_number',[num(i)]);assert(block&&block.header.number===num(i),'Missing canonical block');assert.equal(await rpc('get_block_hash',[num(i)]),block.header.hash,'Noncanonical block');
  for(const tx of block.transactions)for(const [index,out] of tx.outputs.entries())if(out.type&&toScript(out.type).eq(policy)){
   const p={tx_hash:tx.hash,index:num(index)},live=await rpc('get_live_cell',[p,true]);if(live.status==='live'){
    assert.deepEqual(live.cell.output,out,'Live output differs from canonical block');assert.equal(live.cell.data.content,tx.outputs_data[index],'Live data differs from canonical block');candidates.push({outPoint:p,cell:live.cell,blockHash:block.header.hash,blockNumber:block.header.number});
   }
  }
 }
 assert.equal(await rpc('get_block_hash',[tip.number]),tip.hash,'Chain reorganized during scan');
 assert.equal(candidates.length,1,candidates.length?'Ambiguous live policy':'Policy not found');
 const found=candidates[0],latest=await rpc('get_live_cell',[found.outPoint,true]);assert.equal(latest.status,'live','Policy became stale');assert.deepEqual(latest.cell,found.cell,'Policy changed during scan');
 const state=validate(found.cell,policy,expected);return {outPoint:found.outPoint,blockHash:found.blockHash,blockNumber:found.blockNumber,policyHash:policy.hash(),typeId:policy.args,state,scanTip:tip.hash};
}
