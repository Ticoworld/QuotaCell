import * as c from '@ckb-ccc/core';
import {ECDH,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const STANDARD_LOCK='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
export const Q_HASH='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
export const K_DEP={outPoint:{txHash:'0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37',index:0},depType:'depGroup'};
const CKB=100000000n;
export function ownerLock(publicKey){
 assert.match(publicKey||'',/^0x0[23][0-9a-f]{64}$/i,'Expected compressed public key');
 const key=Buffer.from(publicKey.slice(2),'hex');assert.equal(ECDH.convertKey(key,'secp256k1',undefined,undefined,'compressed').toString('hex'),key.toString('hex'),'Invalid public key');
 return c.Script.from({codeHash:STANDARD_LOCK,hashType:'type',args:c.hashCkb(key).slice(0,42)});
}
export function buildAcceptanceTransaction({operation,publicKey,cells,feeRate,code}){
 assert(['sign-only','deployment'].includes(operation),'Invalid operation');const owner=ownerLock(publicKey),rate=BigInt(feeRate);assert(rate>0n,'No fee estimate');
 if(operation==='deployment'){
  assert(Buffer.isBuffer(code)&&code.length===23600,'Exact Q executable required');assert.equal(c.hashCkb(code),Q_HASH,'Q data hash mismatch');assert.equal(createHash('sha256').update(code).digest('hex'),'f636bb5a9ddb7db41c73ab263a5b5483acae2e36c53afca2257a1cbc95d83997','Q SHA-256 mismatch');
 }else assert(code===undefined,'Sign-only must not include deployment code');
 const codeCapacity=code?23661n*CKB:0n,fee=(rate*(code?26000n:2000n)+999n)/1000n;
 assert(Array.isArray(cells),'Funding Cells required');
 for(const candidate of cells){
  const output=candidate.cell?.output,content=candidate.cell?.data?.content;if(!output||output.type||content!=='0x')continue;
  const lock=c.Script.from({codeHash:output.lock.code_hash,hashType:output.lock.hash_type,args:output.lock.args});if(!lock.eq(owner))continue;
  const input=BigInt(output.capacity),change=input-codeCapacity-fee;if(change<61n*CKB)continue;
  const prev={txHash:candidate.outPoint.tx_hash,index:BigInt(candidate.outPoint.index)};
  const outputs=code?[{capacity:codeCapacity,lock:owner},{capacity:change,lock:owner}]:[{capacity:change,lock:owner}];
  const tx=c.Transaction.from({inputs:[{previousOutput:prev,since:0}],outputs,outputsData:code?['0x'+code.toString('hex'),'0x']:['0x'],cellDeps:[K_DEP],headerDeps:[],witnesses:['0x']});tx.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});
  assert(fee*1000n>=BigInt(tx.toBytes().length)*rate,'Fee estimate is too low for transaction size');
  return {tx,owner,candidate,input,fee,feeRate:rate,codeCapacity,change};
 }
 throw Error(code?'Need one plain owner Cell with at least 23,722 CKB plus the current fee':'Need one plain owner Cell with at least 61 CKB plus the current fee');
}
