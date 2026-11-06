import * as c from '@ckb-ccc/core';
const key=window.__testKey||c.hexFrom(crypto.getRandomValues(new Uint8Array(32)));
const client=new c.ClientPublicTestnet();
const signer=new c.SignerCkbPrivateKey(client,key);
const other=new c.SignerCkbPrivateKey(client,window.__otherTestKey||key);
const lock=c.Script.from({codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:c.hashCkb(c.bytesFrom(signer.publicKey)).slice(0,42)});
const address=c.Address.fromScript(lock,client).toString();
const otherLock=c.Script.from({codeHash:lock.codeHash,hashType:'type',args:c.hashCkb(c.bytesFrom(other.publicKey)).slice(0,42)});
const otherAddress=c.Address.fromScript(otherLock,client).toString();
const listeners={};
window.testWallet={publicKey:signer.publicKey,mode:'ok',network:'nervos_testnet',connected:false,switched:false};
const p={getAccount:async()=>[window.testWallet.switched?otherAddress:address],getPublicKey:async()=>[{address,publicKey:signer.publicKey},{address:otherAddress,publicKey:other.publicKey}],connect:async()=>{window.testWallet.connected=true},isConnected:async()=>window.testWallet.connected,getNetwork:async()=>window.testWallet.network,switchNetwork:async n=>{if(window.testWallet.mode!=='wrong-network')window.testWallet.network=n},on:(n,f)=>{(listeners[n]??=[]).push(f);return p},removeListener:()=>p,signMessage:async()=>{throw Error('unused')},signTransaction:async tx=>{
 const mode=window.testWallet.mode;if(mode==='reject')throw Error('Authorization rejected');
 if(mode==='disconnect'){window.testWallet.connected=false;return tx}
 const t=c.Transaction.from(tx),pos=t.witnesses.findIndex(w=>w!=='0x');if(pos<0)throw Error('Missing signing witness');const w=t.getWitnessArgs(pos);const b=c.bytesFrom(w.toHex()),len=new Uint8Array(8);new DataView(len.buffer).setBigUint64(0,BigInt(b.length),true);
 const message=c.hashCkb(c.bytesConcat(c.bytesFrom(t.hash()),len,b));w.lock=c.signMessageSecp256k1(message,key);t.witnesses[pos]=w.toHex();
 if(mode==='mutate')t.outputs[0].capacity+=1n;
 if(mode==='switch'){window.testWallet.switched=true;(listeners.accountsChanged||[]).forEach(f=>f());}
 return t;
}};
window.utxoGlobal={ckbSigner:p,bitcoinSigner:p,dogeSigner:p};
