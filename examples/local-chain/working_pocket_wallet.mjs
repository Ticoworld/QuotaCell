// Browser wallet access only. This module never requests or exports private keys.
import * as c from '@ckb-ccc/connector';
import {parseCkb,recipientArgs} from './pocket_input.mjs';
import {guidedAmounts} from './pocket_guided_terms.mjs';
const $=id=>document.getElementById(id);
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
// CCC's client must not fall back to a public testnet endpoint for this app.
const client=new c.ClientPublicTestnet({url:location.origin+'/api/ckb',fallbacks:[]});
let connector, signer, walletName, generation=0, networkLabel='isolated dev chain';
const status=s=>{$('walletStatus').textContent=s;};
async function account(){
 if(!signer || !await signer.isConnected())throw Error('Wallet disconnected or wrong network. Select CKB testnet in the wallet.');
 if(signer.signType!==c.SignerSignType.CkbSecp256k1)throw Error('Incompatible signing scheme: QCN4 requires CKB secp256k1.');
 if(walletName!=='UTXO Global Wallet' || typeof signer.provider?.getNetwork!=='function')throw Error('Unsupported wallet: only the UTXO Global CKB adapter is enabled for this experiment.');
 if(await signer.provider.getNetwork()!=='nervos_testnet')throw Error('Wrong wallet network: CKB testnet is required.');
 const publicKey=await signer.getPublicKey();
 if(!/^0x0[23][0-9a-f]{64}$/i.test(publicKey))throw Error('Wallet must expose a compressed secp256k1 public key.');
 const address=await signer.getRecommendedAddressObj(),lock=address?.script;
 const args=c.hashCkb(c.bytesFrom(publicKey)).slice(0,42);
 if(!lock || lock.codeHash!==K || lock.hashType!=='type' || lock.args!==args)throw Error('Incompatible wallet lock: standard CKB secp256k1 is required.');
 return {publicKey,address:await address.toString()};
}
async function update(){
 const current=++generation;
 try{const a=await account();if(current!==generation)return;const response=await fetch('/api/state');const state=await response.json();networkLabel=state.networkMode?.startsWith('pudge')?'Pudge testnet':'isolated dev chain';const role=a.publicKey===state.owner?'owner':state.delegates?.find(d=>d.publicKey===a.publicKey)?.role||'unrecognized';window.quotaWalletRole=role;window.parent.postMessage({type:'quotacell-wallet-identity',role,address:a.address},location.origin);if(role==='alice'||role==='ben')$('role').value=role;await refresh();status(`Connected: ${a.address} · ${role} · wallet testnet; application ${networkLabel}. Signing compatibility is verified per transaction.`);}catch(e){if(current===generation)status(e.message);}
}
$('connectWallet').onclick=()=>{
 if(connector){connector.hidden=false;return;}connector=document.createElement('ccc-connector');connector.client=client;connector.name='QuotaCell local experiment';connector.hideKhie=true;
 connector.addEventListener('connection',e=>{signer=e.connectionOwner?.value?.signerInfo?.signer;walletName=e.connectionOwner?.value?.wallet?.name;void update();});
 connector.addEventListener('close',()=>{connector.hidden=true;});document.body.append(connector);
};
$('disconnectWallet').onclick=()=>{generation++;window.quotaWalletRole=null;connector?.disconnect();connector?.remove();connector=undefined;signer=undefined;walletName=undefined;status('No wallet connected.');void refresh();};
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
async function authorize(endpoint,terms){
 const selected=signer,version=generation,a=await account();$('status').textContent='Preparing transaction for wallet approval�';
 const request=await post(endpoint,{id:crypto.randomUUID(),...terms,publicKey:a.publicKey});
 if(selected!==signer||version!==generation)throw Error('Wallet changed before signing.');
 const tx=c.Transaction.fromBytes(request.transaction);
 const showCKB=n=>{n=BigInt(n);const f=(n%100000000n).toString().padStart(8,'0').replace(/0+$/,'');return (n/100000000n).toString()+(f?'.'+f:'');};
 const inputs=tx.inputs.map((i,n)=>`Input ${n+1}: ${i.previousOutput.txHash}:${i.previousOutput.index}`).join('\n');
 const details=tx.outputs.map((o,i)=>`Output ${i+1}: ${showCKB(o.capacity)} CKB to ${o.lock.codeHash} / ${o.lock.hashType} / ${o.lock.args}`).join('\n');
 if(!window.confirm(`Review ${endpoint.split('/').pop()} transaction on ${networkLabel}\nSigner: ${a.address}\nFee: ${showCKB(request.fee)} CKB\n${inputs}\n${details}\n\nContinue to wallet approval?`))throw Error('Rejected before wallet approval');
 $('status').textContent='Approve the transaction in your wallet.';
 const signed=await selected.signOnlyTransaction(c.Transaction.fromBytes(request.transaction));
 const after=await account();if(selected!==signer||version!==generation||after.publicKey!==a.publicKey||$('signingMode').value!=='external')throw Error('Wallet or signing mode changed during signing.');
 if(networkLabel==='Pudge testnet'&&!window.confirm(`Broadcast signed transaction ${signed.hash()} to Pudge? The RPC receives signed bytes for a dry run and could relay them.`))throw Error('Broadcast canceled; no signed transaction was sent by this page.');
 return post('/api/external/submit',{id:request.id,transaction:signed.toHex()});
}
async function run(action,endpoint,terms){
 for(const id of ['pay','revoke','close','deposit','sweep'])$(id).disabled=true;
 try{const result=await authorize(endpoint,terms);$('status').textContent=`${result.state}: ${result.txHash}`;}catch(e){$('status').textContent=e.message;}finally{await update();await refresh();}
}
window.quotaWallet={
 pay:()=>run('pay','/api/external/prepare',{role:$('role').value,amount:$('amount').value,recipient:$('to').value.trim()}),
 owner:(operation,role='alice')=>run(operation,'/api/external/owner',{operation,role,amount:$('depositAmount').value})
};

const registered={};
for(const role of ['Owner','Alice','Ben'])$('register'+role).onclick=async()=>{try{const a=await account();if(Object.entries(registered).some(([name,value])=>name!==role&&value.publicKey===a.publicKey))throw Error('Each person must use a different wallet.');registered[role]=a;$('registrationStatus').textContent=['Owner','Alice','Ben'].map(name=>name+': '+(registered[name]?.address||'not registered')).join(' | ');}catch(e){$('registrationStatus').textContent=e.message;}};
$('createPocket').onclick=async()=>{try{let terms;if($('genesisTerms').value.trim())terms=JSON.parse($('genesisTerms').value);else{const owner=await account();if(!registered.Owner||!registered.Alice||!registered.Ben)throw Error('Register owner, Alice and Ben first.');if(owner.publicKey!==registered.Owner.publicKey)throw Error('Reconnect the registered owner wallet.');const alice=$('aliceRecipient').value.trim(),ben=$('benRecipient').value.trim();if(!alice||!ben)throw Error('Enter both approved recipient addresses.');const [a,b]=await Promise.all([recipientArgs(alice,client),recipientArgs(ben,client)]);if(a===b)throw Error('The approved recipients must be different.');guidedAmounts($('sharedLimit').value,$('aliceLimit').value,$('aliceMax').value,$('benLimit').value,$('benMax').value);terms={sharedLimit:$('sharedLimit').value,delegates:[{publicKey:registered.Alice.publicKey,recipient:alice,limit:$('aliceLimit').value,perPayment:$('aliceMax').value},{publicKey:registered.Ben.publicKey,recipient:ben,limit:$('benLimit').value,perPayment:$('benMax').value}]};}terms.sharedLimit=parseCkb(terms.sharedLimit).toString();for(const d of terms.delegates){const args=await recipientArgs(d.recipient,client);d.recipient={codeHash:K,hashType:'type',args};d.limit=parseCkb(d.limit).toString();d.perPayment=parseCkb(d.perPayment).toString();}await run('genesis','/api/external/genesis',terms);}catch(e){$('status').textContent=e.message;}};

$('exportProfile').onclick=async()=>{try{const a=await account();$('profileOutput').textContent=JSON.stringify({network:'pudge',address:a.address,publicKey:a.publicKey},null,2);}catch(e){$('registrationStatus').textContent=e.message;}};
$('importProfile').onclick=async()=>{try{const p=JSON.parse($('publicProfile').value),role=$('profileRole').value;if(p.network!=='pudge'||!/^0x0[23][0-9a-f]{64}$/i.test(p.publicKey))throw Error('Invalid Pudge public profile');const args=await recipientArgs(p.address,client);if(args!==c.hashCkb(c.bytesFrom(p.publicKey)).slice(0,42))throw Error('Address and public key do not match');if(Object.entries(registered).some(([n,v])=>n!==role&&v.publicKey===p.publicKey))throw Error('Each participant must have a different key');registered[role]={publicKey:p.publicKey,address:p.address};$('registrationStatus').textContent=role+' imported; possession not verified until wallet signing.';}catch(e){$('registrationStatus').textContent=e.message;}};

window.addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.type!=='quotacell-prefill-role')return;if(event.data.role==='alice'||event.data.role==='ben'){$('role').value=event.data.role;void refresh();}});
