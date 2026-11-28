import {existsSync,mkdtempSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,linkSync,renameSync,unlinkSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as c from '@ckb-ccc/core';
import {lock} from 'proper-lockfile';
import {signPreparedPlaygroundTransaction} from './src/playground-signing';

const CKB=100_000_000n;
const PUDGE_GENESIS='0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const client=new c.ClientPublicTestnet({url:'https://testnet.ckb.dev/',fallbacks:[]});
type PublicScenario={resourceId:string;owner:string;delegate:string;secondDelegate:string;recipientA:Record<string,unknown>;recipientB:Record<string,unknown>;recipientAddress:string;requestId:string;depositId:string};
type PrivateScenario={owner:{key:string};delegate:{key:string};secondDelegate?:{key:string};recipientA?:{key:string};recipientB?:{key:string}};
type PrivateStore={provisioner:{key:string};scenarios:PrivateScenario[]};
const json=(path:string,value:unknown,flag?:'wx')=>{
 const temporary=`${path}.${randomUUID()}.tmp`;
 const fd=openSync(temporary,'wx',0o600);
 try {writeFileSync(fd,JSON.stringify(value),'utf8');fsyncSync(fd);} finally {closeSync(fd);}
 try {if(flag==='wx')linkSync(temporary,path);else renameSync(temporary,path);} finally {if(existsSync(temporary))unlinkSync(temporary);}
};
const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function initialize(){
 const quantity=Number(process.env.PG04A_QUANTITY??'3');
 if(!Number.isInteger(quantity)||quantity<1||quantity>20)throw new Error('PG04A_QUANTITY must be between 1 and 20.');
 const payment=Number(process.env.PG04A_PAYMENT_CKB??'61');
 if(!Number.isInteger(payment)||payment<61||payment>122)throw new Error('PG04A_PAYMENT_CKB must be between 61 and 122.');
 const dir=mkdtempSync(join(tmpdir(),'quotacell-pg03b-'));
 const makeKey=()=>`0x${randomBytes(32).toString('hex')}`;
 const signer=(key:string)=>new c.SignerCkbPrivateKey(client,key);
 const provisionerKey=makeKey();
 const scenarios:PrivateScenario[]=[],publicScenarios:PublicScenario[]=[];
 for(let index=0;index<quantity;index++){
  const ownerKey=makeKey(),delegateKey=makeKey(),secondKey=makeKey(),recipientAKey=makeKey(),recipientBKey=makeKey();
  const owner=signer(ownerKey),delegate=signer(delegateKey),second=signer(secondKey),recipientA=signer(recipientAKey),recipientB=signer(recipientBKey);
  const recipientAAddress=await recipientA.getRecommendedAddressObj(),recipientBAddress=await recipientB.getRecommendedAddressObj();
  scenarios.push({owner:{key:ownerKey},delegate:{key:delegateKey},secondDelegate:{key:secondKey},recipientA:{key:recipientAKey},recipientB:{key:recipientBKey}});
  publicScenarios.push({resourceId:randomUUID(),owner:owner.publicKey.toLowerCase(),delegate:delegate.publicKey.toLowerCase(),secondDelegate:second.publicKey.toLowerCase(),recipientA:JSON.parse(JSON.stringify(recipientAAddress.script)),recipientB:JSON.parse(JSON.stringify(recipientBAddress.script)),recipientAddress:String(recipientAAddress),requestId:randomUUID(),depositId:randomUUID()});
 }
 const provisioner=signer(provisionerKey);
 json(join(dir,'private.json'),{provisioner:{key:provisionerKey},scenarios} satisfies PrivateStore,'wx');
 json(join(dir,'public.json'),publicScenarios,'wx');
 json(join(dir,'policy.json'),{paymentCkb:payment,sharedLimitCkb:payment*2,depositCkb:payment*4+12},'wx');
 json(join(dir,'progress.json'),{state:'awaiting-faucet',transactions:[]},'wx');
 console.log(JSON.stringify({directory:dir,provisionerAddress:String(await provisioner.getRecommendedAddressObj()),resourceIds:publicScenarios.map(item=>item.resourceId),scenarios:quantity,recipientAddresses:publicScenarios.map(item=>item.recipientAddress)}));
}

async function waitCommitted(hash:string){
 const transaction=await client.waitTransaction(hash,0,180_000,2_000);
 if(!transaction||transaction.status!=='committed')throw new Error('A Pudge transaction did not reach committed status.');
 return transaction;
}

async function reconcileRaw(intent:{hash:string;signed:string}){
 const signed=c.Transaction.fromBytes(intent.signed);
 if(signed.hash()!==intent.hash)throw new Error('Saved transaction identity is invalid.');
 const observed=await client.getTransaction(intent.hash);
 if(!observed){
  // Re-submit only the exact journaled transaction, never construct a replacement.
  try {if(await client.sendTransaction(signed)!==intent.hash)throw new Error('Transaction hash mismatch.');} catch { /* Reconcile the original hash below. */ }
 }
 return waitCommitted(intent.hash);
}

type BrowserPudgeModule=typeof import('./src/browserPudge');
async function submitPrepared(app:BrowserPudgeModule,scope:string,request:Record<string,unknown>,signer:c.SignerCkbPrivateKey,pocket:string,owner:string,label:string){
 const dir=process.env.PG03B_SCENARIO_DIR!;
 const intentPath=join(dir,`${label}-intent.json`);
 if(existsSync(intentPath)){
  const intent=JSON.parse(readFileSync(intentPath,'utf8')) as {hash:string;signed:string;feeShannons:string;pocket:string};
  if(c.Transaction.fromBytes(intent.signed).hash()!==intent.hash)throw new Error('Saved transaction identity is invalid.');
  await app.reconcileBrowser(scope,owner,intent.hash);
  try {await app.persistBrowserSignature(scope,String(request.id),intent.signed);} catch { /* Already signed or submitted; submission still verifies the journal. */ }
  const resumed=await app.submitBrowserPayment(scope,String(request.id),intent.signed,{hash:intent.hash,publicKey:owner,verifySigner:async()=>signer.publicKey});
  if(!['submitted','committed','uncertain','pending','proposed'].includes(resumed.state))throw new Error(`${label} requires transaction reconciliation.`);
  await waitCommitted(intent.hash);
  await app.reconcileBrowser(scope,owner,intent.hash);
  return {hash:intent.hash,feeShannons:intent.feeShannons,pocket:intent.pocket};
 }
 const prepared=await app.prepareBrowserOwner(scope,request as Parameters<typeof app.prepareBrowserOwner>[1]);
 await app.validateBeforeSigning(scope,prepared);
 const signed=await signPreparedPlaygroundTransaction(signer,prepared.transaction,owner);
 const hash=c.Transaction.fromBytes(signed).hash();
 json(intentPath,{hash,signed,feeShannons:prepared.fee,pocket:prepared.targetPocket},'wx');
 await app.persistBrowserSignature(scope,prepared.id,signed);
 const outcome=await app.submitBrowserPayment(scope,prepared.id,signed,{hash,publicKey:owner,verifySigner:async()=>signer.publicKey});
 if(!['submitted','committed'].includes(outcome.state))throw new Error(`${label} could not be submitted; reconcile its journal before retrying.`);
 await waitCommitted(hash);
 await app.reconcileBrowser(scope,owner,hash);
 console.log(JSON.stringify({step:label,hash,feeShannons:prepared.fee,pocket}));
 return {hash,feeShannons:prepared.fee,pocket:prepared.targetPocket};
}

async function feeOf(transaction:c.Transaction){
 let inputs=0n;
 for(const input of transaction.inputs){
  const cell=await client.getCellLive(input.previousOutput);
  if(!cell)throw new Error('A funding transaction input is no longer live.');
  inputs+=BigInt(cell.cellOutput.capacity);
 }
 const outputs=transaction.outputs.reduce((sum,output)=>sum+BigInt(output.capacity),0n);
 const fee=inputs-outputs;
 if(fee<=0n)throw new Error('The funding transaction fee is invalid.');
 return fee.toString();
}

async function prepare(){
 const dir=process.env.PG03B_SCENARIO_DIR;
 if(!dir)throw new Error('Set PG03B_SCENARIO_DIR to the new local inventory directory.');
 const privatePath=join(dir,'private.json'),publicPath=join(dir,'public.json'),progressPath=join(dir,'progress.json');
 const privateStore=JSON.parse(readFileSync(privatePath,'utf8')) as PrivateStore;
 const scenarios=JSON.parse(readFileSync(publicPath,'utf8')) as PublicScenario[];
 if(existsSync(join(dir,'inventory.json'))){console.log(JSON.stringify({state:'ready',directory:dir,available:scenarios.length}));return;}
 if(!scenarios.length||scenarios.length>20||privateStore.scenarios.length!==scenarios.length||new Set(scenarios.map(item=>item.resourceId)).size!==scenarios.length)throw new Error('The inventory must contain between one and twenty unique identities.');
 const policy=existsSync(join(dir,'policy.json'))?JSON.parse(readFileSync(join(dir,'policy.json'),'utf8')):{paymentCkb:61,sharedLimitCkb:122,depositCkb:256};
 if(!Number.isInteger(policy.paymentCkb)||policy.paymentCkb<61||policy.paymentCkb>122||policy.sharedLimitCkb!==policy.paymentCkb*2||policy.depositCkb!==policy.paymentCkb*4+12)throw new Error('Invalid saved scenario policy.');
 const budget=Number(process.env.PG04A_FUNDING_BUDGET_CKB);
 if(!Number.isSafeInteger(budget)||budget<scenarios.length*1000)throw new Error('Set an authorized PG04A_FUNDING_BUDGET_CKB covering owner funding.');
 const genesis=await client.getBlockByNumber(0);
 if(genesis.header.hash.toLowerCase()!==PUDGE_GENESIS)throw new Error('The funding client is not the verified Pudge testnet.');
 const progress=JSON.parse(readFileSync(progressPath,'utf8')) as {state:string;transactions:Array<Record<string,string>>};
 if(!existsSync(join(dir,'preparation-started.json')))json(join(dir,'preparation-started.json'),{startedAt:new Date().toISOString()},'wx');
 const localJournalPath=join(dir,'browser-journal.json');
 const journal:Record<string,string>=existsSync(localJournalPath)?JSON.parse(readFileSync(localJournalPath,'utf8')):{};
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>journal[key]??null,setItem:(key:string,value:string)=>{journal[key]=value;json(localJournalPath,journal);}}});
 Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async (_key:string,fn:()=>Promise<unknown>)=>fn()}}});

 const provisioner=new c.SignerCkbPrivateKey(client,privateStore.provisioner.key);
 const ownerSigners=scenarios.map((_,index)=>new c.SignerCkbPrivateKey(client,privateStore.scenarios[index].owner.key));
 const ownerIntentPath=join(dir,'owner-funding-intent.json');
 let ownerFunding=progress.transactions.find(item=>item.step==='owner-funding');
 if(!ownerFunding && existsSync(ownerIntentPath)){
  const intent=JSON.parse(readFileSync(ownerIntentPath,'utf8')) as {hash:string;signed:string;feeShannons:string};
  await reconcileRaw(intent);
  ownerFunding={step:'owner-funding',hash:intent.hash,feeShannons:intent.feeShannons};progress.transactions.push(ownerFunding);json(progressPath,progress);
 }
 if(ownerFunding){
  const confirmed=await waitCommitted(ownerFunding.hash);
  const outputs=confirmed.transaction.outputs;
  for(const owner of ownerSigners){
   const lock=(await owner.getRecommendedAddressObj()).script;
   if(!outputs.some(output=>output.lock.eq(lock)&&BigInt(output.capacity)>=1000n*CKB))throw new Error('The recorded owner funding does not match the new identities.');
  }
 }else{
  const ownerOutputs=await Promise.all(ownerSigners.map(async owner=>({capacity:1000n*CKB,lock:(await owner.getRecommendedAddressObj()).script})));
  const distribution=c.Transaction.from({outputs:ownerOutputs,outputsData:ownerOutputs.map(()=> '0x')});
  await distribution.completeInputsByCapacity(provisioner);
  await distribution.completeFeeBy(provisioner,1000n);
  const distributionFee=await feeOf(distribution);
  if(BigInt(distributionFee)+BigInt(scenarios.length)*1000n*CKB>BigInt(budget)*CKB)throw new Error('The transaction exceeds the authorized funding budget.');
  const signedDistribution=await provisioner.signTransaction(distribution);
  const distributionHash=signedDistribution.hash();
  const intentPath=join(dir,'owner-funding-intent.json');
  if(existsSync(intentPath))throw new Error('Funding intent already exists; reconcile its exact transaction before continuing.');
  json(intentPath,{hash:distributionHash,signed:signedDistribution.toHex(),feeShannons:distributionFee},'wx');
  if(await client.sendTransaction(signedDistribution)!==distributionHash)throw new Error('The scenario-funding hash did not match.');
  await waitCommitted(distributionHash);
  progress.transactions.push({step:'owner-funding',hash:distributionHash,feeShannons:distributionFee});
  json(progressPath,progress);
  console.log(JSON.stringify({step:'owner-funding',hash:distributionHash,feeShannons:distributionFee,ownerCapacityShannons:(1000n*CKB).toString()}));
 }

 const app=await import('./src/browserPudge') as BrowserPudgeModule;
 for(let index=0;index<scenarios.length;index++){
  const scenario=scenarios[index],privateScenario=privateStore.scenarios[index],ownerSigner=ownerSigners[index];
  const owner=ownerSigner.publicKey.toLowerCase(),delegateSigner=new c.SignerCkbPrivateKey(client,privateScenario.delegate.key);
  const scope=app.actorCreationScope(owner);
  const createdProgress=progress.transactions.find(item=>item.step===`scenario-${index+1}-pocket-create`);
  let pocket=createdProgress?.pocket;
  if(createdProgress){await waitCommitted(createdProgress.hash);}
  else{
  const shared=(BigInt(policy.sharedLimitCkb)*CKB).toString(),payment=(BigInt(policy.paymentCkb)*CKB).toString();
  const created=await submitPrepared(app,scope,{id:scenario.requestId,publicKey:owner,operation:'genesis',sharedLimit:shared,delegates:[
   {publicKey:scenario.delegate,recipient:scenario.recipientA,limit:shared,perPayment:payment},
   {publicKey:scenario.secondDelegate,recipient:scenario.recipientB,limit:shared,perPayment:payment},
  ]},ownerSigner,'',owner,`scenario-${index+1}-pocket-create`);
  pocket=created.pocket;
  progress.transactions.push({step:`scenario-${index+1}-pocket-create`,hash:created.hash,feeShannons:created.feeShannons,pocket:pocket??''});json(progressPath,progress);
  }
  if(!pocket||!/^0x[0-9a-f]{64}$/i.test(pocket))throw new Error(`Pocket ${index+1} was not saved in the local Pudge journal.`);
  const depositProgress=progress.transactions.find(item=>item.step===`scenario-${index+1}-pocket-funding`);
  const deposit=depositProgress?{hash:depositProgress.hash,feeShannons:depositProgress.feeShannons}:await submitPrepared(app,pocket,{id:scenario.depositId,publicKey:owner,operation:'deposit',amount:String(policy.depositCkb)},ownerSigner,pocket,owner,`scenario-${index+1}-pocket-funding`);
  if(!depositProgress){progress.transactions.push({step:`scenario-${index+1}-pocket-funding`,hash:deposit.hash,feeShannons:deposit.feeShannons});json(progressPath,progress);}
  await waitCommitted(deposit.hash);

  let delegateFundingProgress=progress.transactions.find(item=>item.step===`scenario-${index+1}-delegate-fee-cell`);
  const savedFeeIntent=join(dir,`scenario-${index+1}-fee-intent.json`);
  if(!delegateFundingProgress && existsSync(savedFeeIntent)){
   const intent=JSON.parse(readFileSync(savedFeeIntent,'utf8')) as {hash:string;signed:string;feeShannons:string};
   await reconcileRaw(intent);
   delegateFundingProgress={step:`scenario-${index+1}-delegate-fee-cell`,hash:intent.hash,feeShannons:intent.feeShannons};progress.transactions.push(delegateFundingProgress);json(progressPath,progress);
  }
  if(delegateFundingProgress){await waitCommitted(delegateFundingProgress.hash);(scenario as PublicScenario & {pocket:string}).pocket=pocket;continue;}
  const delegateAddress=await delegateSigner.getRecommendedAddressObj();
  const feeCell=c.Transaction.from({outputs:[{capacity:62n*CKB,lock:delegateAddress.script}],outputsData:['0x']});
  await feeCell.completeInputsByCapacity(ownerSigner);
  await feeCell.completeFeeBy(ownerSigner,1000n);
  const delegateFee=await feeOf(feeCell);
  const signedFeeCell=await ownerSigner.signTransaction(feeCell),feeCellHash=signedFeeCell.hash();
  const feeIntentPath=join(dir,`scenario-${index+1}-fee-intent.json`);
  if(existsSync(feeIntentPath))throw new Error('Fee-cell intent already exists; reconcile its exact transaction before continuing.');
  json(feeIntentPath,{hash:feeCellHash,signed:signedFeeCell.toHex(),feeShannons:delegateFee},'wx');
  if(await client.sendTransaction(signedFeeCell)!==feeCellHash)throw new Error('The delegated fee-cell hash did not match.');
  await waitCommitted(feeCellHash);
  progress.transactions.push({step:`scenario-${index+1}-delegate-fee-cell`,hash:feeCellHash,feeShannons:delegateFee});json(progressPath,progress);
  (scenario as PublicScenario & {pocket:string}).pocket=pocket;
  console.log(JSON.stringify({step:`scenario-${index+1}-delegate-fee-cell`,hash:feeCellHash,feeShannons:delegateFee,delegateCapacityShannons:(62n*CKB).toString(),pocket}));
  await delay(1000);
 }

 const inventory=Object.fromEntries(scenarios.map((scenario,index)=>[scenario.resourceId,{key:privateStore.scenarios[index].delegate.key,pocket:(scenario as PublicScenario & {pocket:string}).pocket}]));
 json(join(dir,'inventory.json'),inventory,'wx');
 json(publicPath,scenarios);
 progress.state='ready';
 json(progressPath,progress);
 console.log(JSON.stringify({state:'ready',directory:dir,resourceIds:scenarios.map(item=>item.resourceId),pockets:scenarios.map(item=>(item as PublicScenario & {pocket:string}).pocket),available:scenarios.length,transactionCount:progress.transactions.length}));
}

const command=process.argv[2];
if(command==='initialize')await initialize();
else if(command==='prepare'){
 const dir=process.env.PG03B_SCENARIO_DIR;
 if(!dir)throw new Error('Set PG03B_SCENARIO_DIR to the local inventory directory.');
 const release=await lock(dir,{stale:30000,update:10000,retries:0});
 try{await prepare();}finally{await release();}
}
else throw new Error('Choose initialize or prepare.');
