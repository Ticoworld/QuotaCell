import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {signWithCkbWallet,verifyWalletTransaction} from './pocket_signing.mjs';

const evidence=JSON.parse(await fs.readFile(new URL('../../evidence/working-pocket-local/transactions.json',import.meta.url),'utf8'));
const bytes=x=>Buffer.from(x.slice(2),'hex');
const script=s=>({codeHash:s.code_hash,hashType:s.hash_type,args:s.args});
const point=p=>({txHash:p.tx_hash,index:BigInt(p.index)});
function transaction(r){return c.Transaction.from({version:BigInt(r.version),cellDeps:r.cell_deps.map(x=>({outPoint:point(x.out_point),depType:x.dep_type==='dep_group'?'depGroup':'code'})),headerDeps:r.header_deps,inputs:r.inputs.map(x=>({previousOutput:point(x.previous_output),since:BigInt(x.since)})),outputs:r.outputs.map(x=>({capacity:BigInt(x.capacity),lock:script(x.lock),type:x.type?script(x.type):undefined})),outputsData:r.outputs_data,witnesses:r.witnesses});}
function preparedFrom(signed,position){const tx=c.Transaction.fromBytes(signed.toBytes());const witness=tx.getWitnessArgs(position);witness.lock='0x'+'00'.repeat(65);tx.witnesses[position]=witness.toHex();return tx;}
function digest(tx,position){const w=bytes(tx.witnesses[position]),len=Buffer.alloc(8);len.writeBigUInt64LE(BigInt(w.length));return c.hashCkb(Buffer.concat([bytes(tx.hash()),len,w]));}
for(const row of evidence.records){
 const signed=transaction(row.signed),position=row.operation==='deposit'?0:1,prepared=preparedFrom(signed,position),message=digest(prepared,position);
 verifyWalletTransaction({prepared,signed,message,publicKey:row.actor,position});
 const lock=c.Script.from({codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:c.hashCkb(bytes(row.actor)).slice(0,42)});
 const signer={getRecommendedAddressObj:async()=>({script:lock}),signOnlyTransaction:async()=>signed};
 await signWithCkbWallet({signer,prepared,actorLock:lock,publicKey:row.actor,message,position});
 const mutatingSigner={...signer,signOnlyTransaction:async tx=>{tx.outputs[0].capacity+=1n;return tx;}};
 await assert.rejects(()=>signWithCkbWallet({signer:mutatingSigner,prepared,actorLock:lock,publicKey:row.actor,message,position}),/transaction fields/);
 let addressCalls=0;
 const changingSigner={...signer,getRecommendedAddressObj:async()=>++addressCalls===1?{script:lock}:undefined};
 await assert.rejects(()=>signWithCkbWallet({signer:changingSigner,prepared,actorLock:lock,publicKey:row.actor,message,position}),/account changed/);
 await assert.rejects(()=>signWithCkbWallet({signer:{...signer,getRecommendedAddressObj:async()=>undefined},prepared,actorLock:lock,publicKey:row.actor,message,position}),/does not control/);
 const wrong=c.Script.from({codeHash:lock.codeHash,hashType:'type',args:'0x'+'00'.repeat(20)});
 await assert.rejects(()=>signWithCkbWallet({signer,prepared,actorLock:wrong,publicKey:row.actor,message,position}),/does not match/);
 const badWitness=c.Transaction.fromBytes(signed.toBytes()),w=badWitness.getWitnessArgs(position);w.inputType='0x00';badWitness.witnesses[position]=w.toHex();
 assert.throws(()=>verifyWalletTransaction({prepared,signed:badWitness,message,publicKey:row.actor,position}),/action witness/);
 const badOutput=c.Transaction.fromBytes(signed.toBytes());badOutput.outputs[0].capacity+=1n;
 assert.throws(()=>verifyWalletTransaction({prepared,signed:badOutput,message,publicKey:row.actor,position}),/transaction fields/);
 const badSignature=c.Transaction.fromBytes(signed.toBytes()),sw=badSignature.getWitnessArgs(position);sw.lock='0x'+'00'.repeat(65);badSignature.witnesses[position]=sw.toHex();
 assert.throws(()=>verifyWalletTransaction({prepared,signed:badSignature,message,publicKey:row.actor,position}));
 if(signed.witnesses.length>1){const otherWitness=c.Transaction.fromBytes(signed.toBytes());otherWitness.witnesses[position===0?1:0]='0x01';
 assert.throws(()=>verifyWalletTransaction({prepared,signed:otherWitness,message,publicKey:row.actor,position}),/another witness/);}
 const extraWitness=c.Transaction.fromBytes(signed.toBytes());extraWitness.witnesses.push('0x');
 assert.throws(()=>verifyWalletTransaction({prepared,signed:extraWitness,message,publicKey:row.actor,position}),/witness count/);
}
// The disposable private key exists only in the child process. This checks the
// adapter boundary offline; the recorded transaction belongs to another key.
const sample=transaction(evidence.records[0].signed),prepared=preparedFrom(sample,1),message=digest(prepared,1);
const child=spawnSync(process.execPath,['-e',`const c=require('@ckb-ccc/core'),crypto=require('node:crypto');const key='0x'+crypto.randomBytes(32).toString('hex');const signer=new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}),key);console.log(JSON.stringify({publicKey:signer.publicKey,signature:c.signMessageSecp256k1(process.argv[1],key)}));`,message],{cwd:new URL('.',import.meta.url),encoding:'utf8'});
assert.equal(child.status,0,child.stderr);const external=JSON.parse(child.stdout),externalLock=c.Script.from({codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:c.hashCkb(bytes(external.publicKey)).slice(0,42)});
const externallySigned=c.Transaction.fromBytes(prepared.toBytes()),externalWitness=externallySigned.getWitnessArgs(1);externalWitness.lock=external.signature;externallySigned.witnesses[1]=externalWitness.toHex();
const externalSigner={getRecommendedAddressObj:async()=>({script:externalLock}),signOnlyTransaction:async()=>externallySigned};
await signWithCkbWallet({signer:externalSigner,prepared,actorLock:externalLock,publicKey:external.publicKey,message,position:1});
console.log('PASS: six actor signatures; changed outputs, action witnesses and signatures rejected');
