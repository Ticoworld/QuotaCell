import * as c from '../examples/local-chain/node_modules/@ckb-ccc/core/dist/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), run=new URL('evidence/local-node/',root);
const load=n=>JSON.parse(fs.readFileSync(new URL(n+'.json',run),'utf8'));
const results=[];
for(const name of ['02-policy-genesis','03-fund-protected-treasury','04-alice60','05-ben50-rejected','06-ben40']){
 const e=load(name),t=e.transaction;
 const tx=c.Transaction.from({version:t.version,cellDeps:t.cell_deps.map(d=>({outPoint:{txHash:d.out_point.tx_hash,index:d.out_point.index},depType:d.dep_type==='dep_group'?'depGroup':d.dep_type})),headerDeps:t.header_deps,inputs:t.inputs.map(i=>({since:i.since,previousOutput:{txHash:i.previous_output.tx_hash,index:i.previous_output.index}})),outputs:t.outputs.map(o=>({capacity:o.capacity,lock:{codeHash:o.lock.code_hash,hashType:o.lock.hash_type,args:o.lock.args},type:o.type?{codeHash:o.type.code_hash,hashType:o.type.hash_type,args:o.type.args}:undefined})),outputsData:t.outputs_data,witnesses:t.witnesses});
 assert.equal(tx.hash(),e.txHash);assert.equal(c.hexFrom(tx.toBytes()),e.serialized);assert.equal(tx.toBytes().length,e.bytes);
 const s=e.signing, pre=Buffer.from(s.digestPreimage.slice(2),'hex');
 const rebuilt=[Buffer.from(tx.hash().slice(2),'hex')];
 const group=[];
 for(let i=0;i<e.resolvedInputs.length;i++){
  const actual=e.resolvedInputs[i].cell.output.lock;
  if(!['code_hash','hash_type','args'].every(k=>actual[k]===s.actorLock[k]))continue;
  group.push(i);let w=tx.witnesses[i];
  if(i===s.position){const a=c.WitnessArgs.fromBytes(w);a.lock='0x'+'00'.repeat(65);w=a.toHex();}
  const wb=Buffer.from(w.slice(2),'hex'),len=Buffer.alloc(8);len.writeBigUInt64LE(BigInt(wb.length));rebuilt.push(len,wb);
 }
 assert.deepEqual(group,s.signedWitnessIndexes);assert.equal(Buffer.concat(rebuilt).toString('hex'),pre.toString('hex'));
 assert.equal(c.hashCkb(pre),s.message);assert(c.verifyMessageSecp256k1(s.message,s.signature,s.publicKey));assert.equal(c.recoverMessageSecp256k1(s.message,s.signature),s.publicKey);
 assert.equal(tx.getWitnessArgs(s.position).lock,s.signature);
 const ins=e.resolvedInputs.reduce((a,r)=>a+BigInt(r.cell.output.capacity),0n);assert.equal((ins-tx.outputs.reduce((a,o)=>a+o.capacity,0n)).toString(),e.feeShannon);
 if(name==='05-ben50-rejected'){assert.equal(e.submit.error.code,-302);assert.match(e.submit.error.message,/Inputs\[0\]\.Type/);assert.match(e.submit.error.message,/#20/);}
 else {assert.equal(e.inclusion.status.status,'committed');assert.equal(e.inclusion.header.hash,e.inclusion.status.block_hash);assert.equal(e.nodeTransaction.tx_status.block_hash,e.inclusion.header.hash);}
 results.push({name,txHash:e.txHash,signature:s.role,publicKey:s.publicKey,status:name==='05-ben50-rejected'?'Q20 rejected':'committed'});
}
assert.notEqual(results[2].publicKey,results[3].publicKey);assert.equal(results[3].publicKey,results[4].publicKey);
const final=load('final-chain-state'),b=Buffer.from(final.policyCell.cell.data.content.slice(2),'hex');
const alice=load('04-alice60'),excess=load('05-ben50-rejected'),ben=load('06-ben40');
assert.equal(excess.transaction.inputs[0].previous_output.tx_hash,alice.txHash);
assert.equal(ben.transaction.inputs[0].previous_output.tx_hash,alice.txHash);
assert.equal(excess.policyAfterRejection.cell.data.content,alice.transaction.outputs_data[0]);
assert.equal(final.policyOutPoint.txHash,ben.txHash);
assert.equal(final.policyCell.cell.data.content,ben.transaction.outputs_data[0]);
assert.equal(final.protectedFund.cell.data.content,ben.transaction.outputs_data[1]);
assert.equal(final.policyCell.cell.output.lock.code_hash,ben.transaction.outputs[0].lock.code_hash);
assert.equal(final.protectedFund.cell.output.lock.args,ben.transaction.outputs[1].lock.args);
const u=(o)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n);
assert.equal(b.length,466);assert.equal(u(24),100n);assert.equal(u(280),60n);assert.equal(u(434),40n);assert.equal(BigInt(final.protectedFund.cell.data.content.match(/^0x/) ? '0x'+Buffer.from(final.protectedFund.cell.data.content.slice(2),'hex').reverse().toString('hex') : 0),100n);
// Historical fixture key(3): explicit test-only issuer, never a secure credential.
const sk='0x'+'00'.repeat(31)+'03';
const signer=new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}),sk);
const issuer=c.Script.from({codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:c.hashCkb(c.bytesFrom(signer.publicKey)).slice(0,42)});
assert.equal(issuer.hash(),'0x59297894bff4b8f7e1427bf4943b467ba168565d25fe75de207c146debaec14b');
const out={scope:'Offline historical transaction checks; no RPC, VM, signing or submission',results,final:{used:100,alice:60,ben:40,protectedTokens:100},issuerFixtureKey3MatchesPinnedToken:true};
console.log(JSON.stringify(out,null,2));
