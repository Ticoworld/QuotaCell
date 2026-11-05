// Disposable owner signer: private key stays in this child process.
import * as c from '@ckb-ccc/core';
import crypto from 'node:crypto';
import readline from 'node:readline';
const privateKey='0x'+crypto.randomBytes(32).toString('hex');
const signer=new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}),privateKey);
process.stdout.write(JSON.stringify({publicKey:signer.publicKey})+'\n');
for await(const line of readline.createInterface({input:process.stdin})){
 const {transaction,message}=JSON.parse(line);const tx=c.Transaction.fromBytes(transaction),w=tx.getWitnessArgs(0);
 w.lock=c.signMessageSecp256k1(message,privateKey);tx.witnesses[0]=w.toHex();
 process.stdout.write(JSON.stringify({transaction:tx.toHex()})+'\n');
}
