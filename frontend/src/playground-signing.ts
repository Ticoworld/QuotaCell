import * as c from '@ckb-ccc/core';

/** Sign a reviewed transaction with the testnet identity without changing its
 * QCN4 action witness. The caller must perform the normal live-input and role
 * checks before signing and again before submission. */
export async function signPreparedPlaygroundTransaction(signer:c.SignerCkbPrivateKey, transactionHex:string, expectedPublicKey:string) {
  const genesis=await signer.client.getBlockByNumber(0);
  if(genesis?.header.hash?.toLowerCase()!=='0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606') throw new Error('Playground signing requires Pudge.');
  if(signer.publicKey.toLowerCase()!==expectedPublicKey.toLowerCase()) throw new Error('Prepared identity does not match the required role.');
  const prepared=c.Transaction.fromBytes(transactionHex);
  const address=await signer.getRecommendedAddressObj();
  const info=await prepared.getSignHashInfo(address.script,signer.client);
  if(!info) throw new Error('The prepared transaction does not contain the expected signer.');
  const signed=await signer.signOnlyTransaction(c.Transaction.fromBytes(prepared.toBytes()));
  const expected=c.Transaction.fromBytes(prepared.toBytes());
  const witness=signed.getWitnessArgs(info.position);
  if(!witness?.lock || !/^0x[0-9a-f]{130}$/i.test(witness.lock)) throw new Error('Invalid signer witness.');
  const expectedWitness=expected.getWitnessArgs(info.position);
  if(!expectedWitness)throw new Error('Missing prepared witness.');
  expectedWitness.lock=witness.lock;
  expected.witnesses[info.position]=expectedWitness.toHex();
  if(expected.toHex()!==signed.toHex() || signed.hash()!==prepared.hash() || !c.verifyMessageSecp256k1(info.message,witness.lock,expectedPublicKey) || c.recoverMessageSecp256k1(info.message,witness.lock).toLowerCase()!==expectedPublicKey.toLowerCase()) throw new Error('Signed transaction does not match the approved transaction.');
  return signed.toHex();
}
