import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';
import {PUDGE_GENESIS} from './pocket_network.mjs';
import {K_DEP,ownerLock} from './wo15e_acceptance_builder.mjs';
import {verifyWalletTransaction} from './pocket_signing.mjs';

export const ORIGINAL='0x21bffcfec131070fa7de3158543e30d05bdb6cc9885144b4124da6dc1a2a29f4';
export const INPUT={tx_hash:'0x3fa9dd0155936e0dacc9bf5e57a4785c3d6d66191a7560f1ff5ec6a6b04954f3',index:'0x2'};
export const HASH='0xdc637fbc50ab016179c6b82517f8c1c37dd44646a44de79aa9dd0a2d14a496bf';

// Check both independent nodes before signing and again before any send.
export async function validateCancellation({transaction,publicKey,rpcs}) {
 assert.equal(rpcs.length,2,'Two Pudge RPCs required');
 const tx=c.Transaction.fromBytes(transaction),owner=ownerLock(publicKey);
 assert.equal(tx.hash(),HASH); assert.equal(tx.inputs.length,1); assert.equal(tx.outputs.length,1);
 assert.equal(tx.inputs[0].previousOutput.txHash,INPUT.tx_hash); assert.equal(BigInt(tx.inputs[0].previousOutput.index),2n); assert.equal(BigInt(tx.inputs[0].since),0n);
 assert.equal(tx.cellDeps.length,1); assert.equal(tx.cellDeps[0].outPoint.txHash,K_DEP.outPoint.txHash); assert.equal(BigInt(tx.cellDeps[0].outPoint.index),0n); assert.equal(tx.cellDeps[0].depType,'depGroup'); assert.equal(tx.headerDeps.length,0);
 assert(tx.outputs[0].lock.eq(owner)); assert(!tx.outputs[0].type); assert.equal(tx.outputsData[0],'0x'); assert.equal(tx.outputs[0].capacity,9999986033556n);
 assert.equal(tx.witnesses.length,1); const w=tx.getWitnessArgs(0); assert.equal(w.lock,'0x'+'00'.repeat(65)); assert(!w.inputType&&!w.outputType);
 for(const rpc of rpcs){assert.equal((await rpc('get_consensus')).id,'ckb_testnet'); assert.equal(await rpc('get_block_hash',['0x0']),PUDGE_GENESIS); assert.equal((await rpc('get_transaction',[ORIGINAL]))?.tx_status?.status,'unknown','Original deployment is not unknown'); const live=await rpc('get_live_cell',[INPUT,true]); assert.equal(live.status,'live'); assert.equal(BigInt(live.cell.output.capacity),9999986100000n); assert(!live.cell.output.type); assert.equal(live.cell.data.content,'0x'); const l=live.cell.output.lock; assert(c.Script.from({codeHash:l.code_hash,hashType:l.hash_type,args:l.args}).eq(owner));}
 const wb=Buffer.from(tx.witnesses[0].slice(2),'hex'),len=Buffer.alloc(8); len.writeBigUInt64LE(BigInt(wb.length)); const message=c.hashCkb(Buffer.concat([Buffer.from(tx.hash().slice(2),'hex'),len,wb]));
 return {tx,message,fee:66444n};
}
export function verifyCancellationSignature({prepared,signed,message,publicKey}) {return verifyWalletTransaction({prepared,signed,message,publicKey,position:0});}
