import {existsSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as c from '@ckb-ccc/core';
import {createServer,type ViteDevServer} from 'vite';
import {signPreparedPlaygroundTransaction} from './src/playground-signing';

const CKB=100_000_000n;
const PUDGE_GENESIS='0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const client=new c.ClientPublicTestnet({url:'https://testnet.ckb.dev/',fallbacks:[]});
type PublicScenario={resourceId:string;owner:string;delegate:string;secondDelegate:string;recipientA:Record<string,unknown>;recipientB:Record<string,unknown>;recipientAddress:string;requestId:string;depositId:string};
type PrivateScenario={owner:{key:string};delegate:{key:string}};
type PrivateStore={provisioner:{key:string};scenarios:PrivateScenario[]};
const json=(path:string,value:unknown,flag?:'wx')=>writeFileSync(path,JSON.stringify(value),{encoding:'utf8',mode:0o600,flag});
const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function initialize(){
 const dir=mkdtempSync(join(tmpdir(),'quotacell-pg03b-'));
 const makeKey=()=>`0x${randomBytes(32).toString('hex')}`;
 const signer=(key:string)=>new c.SignerCkbPrivateKey(client,key);
 const provisionerKey=makeKey();
 const scenarios:PrivateScenario[]=[],publicScenarios:PublicScenario[]=[];
 for(let index=0;index<3;index++){
  const ownerKey=makeKey(),delegateKey=makeKey(),secondKey=makeKey(),recipientAKey=makeKey(),recipientBKey=makeKey();
  const owner=signer(ownerKey),delegate=signer(delegateKey),second=signer(secondKey),recipientA=signer(recipientAKey),recipientB=signer(recipientBKey);
  const recipientAAddress=await recipientA.getRecommendedAddressObj(),recipientBAddress=await recipientB.getRecommendedAddressObj();
  scenarios.push({owner:{key:ownerKey},delegate:{key:delegateKey}});
  publicScenarios.push({resourceId:randomUUID(),owner:owner.publicKey.toLowerCase(),delegate:delegate.publicKey.toLowerCase(),secondDelegate:second.publicKey.toLowerCase(),recipientA:JSON.parse(JSON.stringify(recipientAAddress.script)),recipientB:JSON.parse(JSON.stringify(recipientBAddress.script)),recipientAddress:String(recipientAAddress),requestId:randomUUID(),depositId:randomUUID()});
 }
 const provisioner=signer(provisionerKey);
 json(join(dir,'private.json'),{provisioner:{key:provisionerKey},scenarios} satisfies PrivateStore,'wx');
 json(join(dir,'public.json'),publicScenarios,'wx');
 json(join(dir,'progress.json'),{state:'awaiting-faucet',transactions:[]},'wx');
 console.log(JSON.stringify({directory:dir,provisionerAddress:String(await provisioner.getRecommendedAddressObj()),resourceIds:publicScenarios.map(item=>item.resourceId),scenarios:3,recipientAddresses:publicScenarios.map(item=>item.recipientAddress)}));
}

async function waitCommitted(hash:string){
 const transaction=await client.waitTransaction(hash,0,180_000,2_000);
 if(!transaction||transaction.status!=='committed')throw new Error('A Pudge transaction did not reach committed status.');
 return transaction;
}

type BrowserPudgeModule=typeof import('./src/browserPudge');
async function submitPrepared(app:BrowserPudgeModule,scope:string,request:Record<string,unknown>,signer:c.SignerCkbPrivateKey,pocket:string,owner:string,label:string){
 const prepared=await app.prepareBrowserOwner(scope,request as Parameters<typeof app.prepareBrowserOwner>[1]);
 await app.validateBeforeSigning(scope,prepared);
 const signed=await signPreparedPlaygroundTransaction(signer,prepared.transaction,owner);
 await app.persistBrowserSignature(scope,prepared.id,signed);
 const hash=c.Transaction.fromBytes(signed).hash();
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
 if(existsSync(join(dir,'inventory.json')))throw new Error('This inventory has already completed.');
 if(scenarios.length!==3||new Set(scenarios.map(item=>item.resourceId)).size!==3)throw new Error('The new inventory must contain exactly three unique identities.');
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
 const ownerFunding=progress.transactions.find(item=>item.step==='owner-funding');
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
  const signedDistribution=await provisioner.signTransaction(distribution);
  const distributionHash=signedDistribution.hash();
  if(await client.sendTransaction(signedDistribution)!==distributionHash)throw new Error('The scenario-funding hash did not match.');
  await waitCommitted(distributionHash);
  progress.transactions.push({step:'owner-funding',hash:distributionHash,feeShannons:distributionFee});
  json(progressPath,progress);
  console.log(JSON.stringify({step:'owner-funding',hash:distributionHash,feeShannons:distributionFee,ownerCapacityShannons:(1000n*CKB).toString()}));
 }

 process.env.VITE_QUOTACELL_PLAYGROUND='1';
 let vite:ViteDevServer|undefined;
 try{
 vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const app=await vite.ssrLoadModule('/src/browserPudge.ts') as BrowserPudgeModule;
 for(let index=0;index<3;index++){
  const scenario=scenarios[index],privateScenario=privateStore.scenarios[index],ownerSigner=ownerSigners[index];
  const owner=ownerSigner.publicKey.toLowerCase(),delegateSigner=new c.SignerCkbPrivateKey(client,privateScenario.delegate.key);
  const scope=app.actorCreationScope(owner);
  const createdProgress=progress.transactions.find(item=>item.step===`scenario-${index+1}-pocket-create`);
  let pocket=createdProgress?.pocket;
  if(createdProgress){await waitCommitted(createdProgress.hash);}
  else{
  const created=await submitPrepared(app,scope,{id:scenario.requestId,publicKey:owner,operation:'genesis',sharedLimit:'12200000000',delegates:[
   {publicKey:scenario.delegate,recipient:scenario.recipientA,limit:'12200000000',perPayment:'6100000000'},
   {publicKey:scenario.secondDelegate,recipient:scenario.recipientB,limit:'12200000000',perPayment:'6100000000'},
  ]},ownerSigner,'',owner,`scenario-${index+1}-pocket-create`);
  pocket=created.pocket;
  progress.transactions.push({step:`scenario-${index+1}-pocket-create`,hash:created.hash,feeShannons:created.feeShannons,pocket:pocket??''});json(progressPath,progress);
  }
  if(!pocket||!/^0x[0-9a-f]{64}$/i.test(pocket))throw new Error(`Pocket ${index+1} was not saved in the local Pudge journal.`);
  const depositProgress=progress.transactions.find(item=>item.step===`scenario-${index+1}-pocket-funding`);
  const deposit=depositProgress?{hash:depositProgress.hash,feeShannons:depositProgress.feeShannons}:await submitPrepared(app,pocket,{id:scenario.depositId,publicKey:owner,operation:'deposit',amount:'256'},ownerSigner,pocket,owner,`scenario-${index+1}-pocket-funding`);
  if(!depositProgress){progress.transactions.push({step:`scenario-${index+1}-pocket-funding`,hash:deposit.hash,feeShannons:deposit.feeShannons});json(progressPath,progress);}
  await waitCommitted(deposit.hash);

  const delegateFundingProgress=progress.transactions.find(item=>item.step===`scenario-${index+1}-delegate-fee-cell`);
  if(delegateFundingProgress){await waitCommitted(delegateFundingProgress.hash);(scenario as PublicScenario & {pocket:string}).pocket=pocket;continue;}
  const delegateAddress=await delegateSigner.getRecommendedAddressObj();
  const feeCell=c.Transaction.from({outputs:[{capacity:62n*CKB,lock:delegateAddress.script}],outputsData:['0x']});
  await feeCell.completeInputsByCapacity(ownerSigner);
  await feeCell.completeFeeBy(ownerSigner,1000n);
  const delegateFee=await feeOf(feeCell);
  const signedFeeCell=await ownerSigner.signTransaction(feeCell),feeCellHash=signedFeeCell.hash();
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
 console.log(JSON.stringify({state:'ready',directory:dir,resourceIds:scenarios.map(item=>item.resourceId),pockets:scenarios.map(item=>(item as PublicScenario & {pocket:string}).pocket),available:3,transactionCount:progress.transactions.length}));
 }finally{await vite?.close();}
}

const command=process.argv[2];
if(command==='initialize')await initialize();
else if(command==='prepare')await prepare();
else throw new Error('Choose initialize or prepare.');
