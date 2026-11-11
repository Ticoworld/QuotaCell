import * as c from '@ckb-ccc/core';
let key=window.__testKey||c.hexFrom(crypto.getRandomValues(new Uint8Array(32)));
const client=new c.ClientPublicTestnet();
const signerFor=privateKey=>new c.SignerCkbPrivateKey(client,privateKey);
const addressFor=privateKey=>c.Address.fromScript(c.Script.from({codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:c.hashCkb(c.bytesFrom(signerFor(privateKey).publicKey)).slice(0,42)}),client).toString();
const otherKey=window.__otherTestKey||key;
const other=signerFor(otherKey);
const otherAddress=addressFor(otherKey);
const active=()=>signerFor(key);
const address=()=>addressFor(key);
const listeners={};
window.testWallet={publicKey:active().publicKey,address:address(),otherAddress,mode:'ok',network:'nervos_testnet',connected:false,switched:false};
window.switchTestWallet=privateKey=>{key=privateKey.startsWith('0x')?privateKey:'0x'+privateKey;window.testWallet.publicKey=active().publicKey;window.testWallet.address=address();window.testWallet.connected=false;window.testWallet.switched=false;window.testWallet.network='nervos_testnet';};
const p={getAccount:async()=>[window.testWallet.switched?otherAddress:address()],getPublicKey:async()=>[{address:window.testWallet.switched?otherAddress:address(),publicKey:window.testWallet.switched?other.publicKey:active().publicKey},{address:otherAddress,publicKey:other.publicKey}],connect:async()=>{window.testWallet.connected=true},isConnected:async()=>window.testWallet.connected,getNetwork:async()=>window.testWallet.network,switchNetwork:async n=>{if(window.testWallet.mode!=='wrong-network')window.testWallet.network=n},on:(n,f)=>{(listeners[n]??=[]).push(f);return p},removeListener:()=>p,signMessage:async()=>{throw Error('unused')},signTransaction:async tx=>{
 const mode=window.testWallet.mode;if(mode==='reject')throw Error('Authorization rejected');
 if(mode==='disconnect'){window.testWallet.connected=false;return tx}
 const t=c.Transaction.from(tx),pos=t.witnesses.findIndex(w=>w!=='0x');if(pos<0)throw Error('Missing signing witness');const w=t.getWitnessArgs(pos);const b=c.bytesFrom(w.toHex()),len=new Uint8Array(8);new DataView(len.buffer).setBigUint64(0,BigInt(b.length),true);
 const message=c.hashCkb(c.bytesConcat(c.bytesFrom(t.hash()),len,b));w.lock=c.signMessageSecp256k1(message,key);t.witnesses[pos]=w.toHex();
 if(mode==='mutate')t.outputs[0].capacity+=1n;
 if(mode==='switch'){window.testWallet.switched=true;(listeners.accountsChanged||[]).forEach(f=>f());}
 return t;
}};
window.utxoGlobal={ckbSigner:p,bitcoinSigner:p,dogeSigner:p};
