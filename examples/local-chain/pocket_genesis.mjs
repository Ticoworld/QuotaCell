// QCN4 genesis construction. The caller must resolve and verify live cells and
// exact dependency bytes against a trusted chain before using this builder.
import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import {ECDH} from 'node:crypto';
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const A='0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const CKB=100000000n;
const bytes=x=>Buffer.from(x.slice(2),'hex');
const key=x=>{assert.match(x,/^0x0[23][0-9a-f]{64}$/i,'Invalid compressed public key');assert.equal(ECDH.convertKey(bytes(x),'secp256k1',undefined,undefined,'compressed').toString('hex'),x.slice(2).toLowerCase(),'Invalid public key');return bytes(x);};
const lockFor=pub=>c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(key(pub)).slice(0,42)});
const readScript=s=>c.Script.from({codeHash:s.code_hash??s.codeHash,hashType:s.hash_type??s.hashType,args:s.args});
function put128(b,offset,value){const n=BigInt(value);assert(n>=0n&&n<(1n<<128n),'Limit out of range');b.writeBigUInt64LE(n&((1n<<64n)-1n),offset);b.writeBigUInt64LE(n>>64n,offset+8);}
export function buildGenesis({ownerPublicKey,delegates,sharedLimit,ownerInput,deps,policyCapacity=600n*CKB,fee=2000n}){
 assert.equal(delegates.length,2,'Two delegates are required');
 const keys=[ownerPublicKey,...delegates.map(d=>d.publicKey)],locks=keys.map(lockFor);
 assert.equal(new Set(locks.map(l=>l.hash())).size,3,'Actor identities must be distinct');
 const shared=BigInt(sharedLimit),state=Buffer.alloc(466);state.write('QCN4');state.writeUInt16LE(4,4);state[7]=3;put128(state,8,shared);key(ownerPublicKey).copy(state,125);
 const recipients=[];
 for(const [i,d] of delegates.entries()){
  const o=158+154*i,recipient=readScript(d.recipient),limit=BigInt(d.limit),per=BigInt(d.perPayment);
  assert(recipient.codeHash===K&&recipient.hashType==='type'&&/^0x[0-9a-f]{40}$/i.test(recipient.args),'Invalid recipient lock');
  assert(!locks.some(l=>l.eq(recipient))&&!recipients.some(l=>l.eq(recipient)),'Recipient identity must be distinct');recipients.push(recipient);
  assert(limit<=shared&&per>0n&&per<=limit,'Invalid delegate limits');key(d.publicKey).copy(state,o);Buffer.from(recipient.toBytes()).copy(state,o+33);put128(state,o+106,limit);put128(state,o+138,per);
 }
 assert(ownerInput.status==='live'&&!ownerInput.cell.output.type&&ownerInput.cell.data.content==='0x','Owner input must be an empty live cell');
 assert(readScript(ownerInput.cell.output.lock).eq(locks[0]),'Owner input lock mismatch');
 const capacity=BigInt(policyCapacity),networkFee=BigInt(fee),change=BigInt(ownerInput.cell.output.capacity)-capacity-networkFee;
 assert(capacity>=600n*CKB&&change>=61n*CKB&&networkFee>=0n&&networkFee<=1000000n,'Invalid capacity or fee');
 assert(Array.isArray(deps)&&deps.length===4&&deps[0].depType==='depGroup'&&deps.slice(1).every(d=>d.depType==='code'),'Expected verified K, A, F and Q dependencies');
 const input=c.CellInput.from({previousOutput:ownerInput.outPoint,since:0});
 const typeId=c.hashCkb(Buffer.concat([Buffer.from(input.toBytes()),Buffer.alloc(8)]));
 const policy=c.Script.from({codeHash:Q,hashType:'data2',args:typeId});
 const tx=c.Transaction.from({inputs:[input],outputs:[{capacity,lock:{codeHash:A,hashType:'data1',args:'0x'},type:policy},{capacity:change,lock:locks[0]}],outputsData:['0x'+state.toString('hex'),'0x'],cellDeps:deps,headerDeps:[],witnesses:['0x']});
 tx.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65),inputType:'0x5143413100ff0000'});
 return {transaction:tx,policy,typeId};
}
