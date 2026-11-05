// Offline verification of the selected public browser-to-node evidence.
import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const evidence=JSON.parse(await fs.readFile(new URL('../../evidence/working-pocket-local/transactions.json',import.meta.url),'utf8'));
const bytes=x=>Buffer.from(x.slice(2),'hex');
const script=s=>({codeHash:s.code_hash,hashType:s.hash_type,args:s.args});
const point=p=>({txHash:p.tx_hash,index:BigInt(p.index)});
assert.equal(evidence.records.length,6);
assert.deepEqual(evidence.records.map(x=>x.operation),['pay','pay','revoke','close','deposit','sweep']);
for(const row of evidence.records){
 assert.equal(row.genesis,evidence.genesis);assert.equal(row.state,'committed');assert.equal(row.nodeStatus.status,'committed');assert.equal(row.nodeStatus.block_hash,row.blockHeader.hash);
 const r=row.signed,tx=c.Transaction.from({version:BigInt(r.version),cellDeps:r.cell_deps.map(x=>({outPoint:point(x.out_point),depType:x.dep_type==='dep_group'?'depGroup':'code'})),headerDeps:r.header_deps,inputs:r.inputs.map(x=>({previousOutput:point(x.previous_output),since:BigInt(x.since)})),outputs:r.outputs.map(x=>({capacity:BigInt(x.capacity),lock:script(x.lock),type:x.type?script(x.type):undefined})),outputsData:r.outputs_data,witnesses:r.witnesses});
 assert.equal(tx.hash(),row.tx_hash);
 const pos=row.operation==='deposit'?0:1,w=c.WitnessArgs.fromBytes(tx.witnesses[pos]),signature=w.lock;w.lock='0x'+'00'.repeat(65);const witness=bytes(w.toHex()),len=Buffer.alloc(8);len.writeBigUInt64LE(BigInt(witness.length));
 const digest=c.hashCkb(Buffer.concat([bytes(tx.hash()),len,witness]));assert(c.verifyMessageSecp256k1(digest,signature,row.actor));
 if(row.operation==='pay'){assert.equal(tx.outputs[2].capacity,BigInt(row.amount));assert.equal(tx.outputs[2].lock.args,row.recipient);}
 if(row.operation==='close'){assert.equal(tx.outputs[0].capacity,13400000000n);assert.equal(tx.outputs[1].capacity,BigInt(row.amount));}
 if(row.operation==='deposit')assert.equal(tx.outputs[0].capacity,BigInt(row.amount));
 if(row.operation==='sweep')assert.equal(tx.outputs[1].capacity,BigInt(row.amount));
}
console.log('PASS: six recorded transaction hashes, actor signatures, action amounts and terminal capacity');
