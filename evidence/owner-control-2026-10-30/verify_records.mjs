// Independent offline reconstruction of the new signed records. No RPC/signing.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [repo,dir]=process.argv.slice(2);
const c=await import(pathToFileURL(path.resolve(repo,'examples/local-chain/node_modules/@ckb-ccc/core/dist/index.mjs')));
const entries=[];
for(const file of fs.readdirSync(dir).sort()){
 if(!file.endsWith('.json'))continue;
 const e=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
 if(!e.transaction||!e.signing)continue;
 const t=e.transaction,s=e.signing;
 const script=o=>({codeHash:o.code_hash,hashType:o.hash_type,args:o.args});
 const tx=c.Transaction.from({version:t.version,cellDeps:t.cell_deps.map(d=>({outPoint:{txHash:d.out_point.tx_hash,index:d.out_point.index},depType:d.dep_type==='dep_group'?'depGroup':'code'})),headerDeps:t.header_deps,
 inputs:t.inputs.map(i=>({since:i.since,previousOutput:{txHash:i.previous_output.tx_hash,index:i.previous_output.index}})),
 outputs:t.outputs.map(o=>({capacity:o.capacity,lock:script(o.lock),type:o.type?script(o.type):undefined})),outputsData:t.outputs_data,witnesses:t.witnesses});
 assert.equal(tx.hash(),e.txHash);assert.equal(c.hexFrom(tx.toBytes()),e.serialized);assert.equal(tx.toBytes().length,e.bytes);
 const chunks=[Buffer.from(tx.hash().slice(2),'hex')],indexes=[];
 for(let i=0;i<e.resolvedInputs.length;i++){
  if(!['code_hash','hash_type','args'].every(k=>e.resolvedInputs[i].cell.output.lock[k]===s.actorLock[k]))continue;
  indexes.push(i);let w=tx.witnesses[i];if(i===s.position){const a=c.WitnessArgs.fromBytes(w);a.lock='0x'+'00'.repeat(65);w=a.toHex();}
  const b=Buffer.from(w.slice(2),'hex'),len=Buffer.alloc(8);len.writeBigUInt64LE(BigInt(b.length));chunks.push(len,b);
 }
 assert.deepEqual(indexes,s.signedWitnessIndexes);const pre=Buffer.concat(chunks);assert.equal('0x'+pre.toString('hex'),s.digestPreimage);
 assert.equal(c.hashCkb(pre),s.message);assert(c.verifyMessageSecp256k1(s.message,s.signature,s.publicKey));assert.equal(c.recoverMessageSecp256k1(s.message,s.signature),s.publicKey);
 assert.equal(tx.getWitnessArgs(s.position).lock,s.signature);
 const fee=e.resolvedInputs.reduce((a,x)=>a+BigInt(x.cell.output.capacity),0n)-tx.outputs.reduce((a,x)=>a+x.capacity,0n);assert.equal(fee.toString(),e.feeShannon);
 if(e.inclusion){assert.equal(e.inclusion.status.status,'committed');assert.equal(e.nodeTransaction.tx_status.block_hash,e.inclusion.header.hash);}
 if(file==='07-disabled-delegate-rejected.json'){assert.equal(e.submit.error.code,-302);assert(e.submit.error.message.includes('.html#17'));assert(e.submit.error.message.includes('Inputs[0].Type'));}
 entries.push({file,txHash:e.txHash,signature:s.role,feeShannons:fee.toString(),status:e.inclusion?'committed':e.notSubmitted?'dry-run only':'Q17 rejected'});
}
const required=['02-policy-genesis.json','03-fund-protected-treasury.json','05-owner-revoke.json','07-disabled-delegate-rejected.json','08-enabled-delegate-dry-run.json','09-owner-close-recover.json','11-late-deposit.json','13-owner-closed-sweep.json'];
assert.deepEqual(entries.filter(x=>x.file!=='01-deploy-dependencies.json').map(x=>x.file).sort(),required.sort());
console.log(JSON.stringify({scope:'Offline exact reconstruction of fresh signed transaction evidence; no new node execution',entries},null,2));
