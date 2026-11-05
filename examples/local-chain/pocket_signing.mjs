// Experimental QCN4 signing boundary. This module never receives private keys.
import * as c from '@ckb-ccc/core';
import assert from 'node:assert/strict';

/** Validate a wallet's signed transaction against the exact prepared CCC tx.
 * The caller must resolve live inputs and derive `message` from the prepared
 * transaction and admitted actor lock, never from the wallet response. */
export function verifyWalletTransaction({prepared, signed, message, publicKey, position}) {
  assert(Number.isInteger(position) && position >= 0 && position < prepared.inputs.length, 'Invalid signer position');
  assert.equal(signed.hash(),prepared.hash(),'Wallet altered transaction fields');
  assert.equal(signed.witnesses.length,prepared.witnesses.length,'Wallet changed witness count');
  const expected=c.WitnessArgs.fromBytes(prepared.witnesses[position]);
  const actual=signed.getWitnessArgs(position);
  assert(actual.lock && /^0x[0-9a-f]{130}$/i.test(actual.lock),'Expected 65-byte secp256k1 signature');
  expected.lock=actual.lock;
  assert.equal(expected.toHex(),signed.witnesses[position],'Wallet altered action witness');
  for(let i=0;i<prepared.witnesses.length;i++)if(i!==position)
    assert.equal(signed.witnesses[i],prepared.witnesses[i],'Wallet altered another witness');
  assert(c.verifyMessageSecp256k1(message,actual.lock,publicKey),'Invalid actor signature');
  assert.equal(c.recoverMessageSecp256k1(message,actual.lock).toLowerCase(),publicKey.toLowerCase(),'Signature belongs to another key');
  return signed;
}

/** Ask a CCC signer to sign without giving this adapter access to its key. */
export async function signWithCkbWallet({signer,prepared,actorLock,publicKey,message,position}) {
  assert(/^0x0[23][0-9a-f]{64}$/i.test(publicKey),'Expected compressed secp256k1 public key');
  const lock=c.Script.from(actorLock);
  assert.equal(lock.codeHash,'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8','Unsupported wallet lock');
  assert.equal(lock.hashType,'type','Unsupported wallet hash type');
  assert.equal(lock.args,c.hashCkb(Buffer.from(publicKey.slice(2),'hex')).slice(0,42),'Public key does not match actor lock');
  const address=await signer.getRecommendedAddressObj();
  assert(address?.script?.eq(lock),'Wallet does not control the required actor lock');
  const signed=await signer.signOnlyTransaction(prepared);
  return verifyWalletTransaction({prepared,signed,message,publicKey,position});
}
