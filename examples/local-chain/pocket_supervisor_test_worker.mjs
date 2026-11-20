import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const directory=path.resolve(process.argv[2]),port=Number(process.argv[3]),origin=`http://127.0.0.1:${port}`;
const genesis='0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const Q='0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const A='0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const token=process.env.QUOTACELL_SUPERVISOR_TOKEN;
const requests=new Map(),journalPath=path.join(directory,'intents.json');
let intents=[];
try{intents=JSON.parse(await fs.readFile(journalPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const policyFromDescriptor=()=>{try{return c.Script.from(JSON.parse(readFileSync(path.join(directory,'pocket.json'),'utf8')).initial.Q).hash();}catch{return null;}};
function write(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
async function body(req){let value='';for await(const chunk of req)value+=chunk;return value?JSON.parse(value):{};}
function fixtureTransaction(draftId,distinct){
 const args=`0x${draftId.replaceAll('-','').padEnd(64,'0').slice(0,64)}`;
 const txHash=distinct?'0x'+'22'.repeat(32):'0x'+'11'.repeat(32);
 return c.Transaction.from({inputs:[{previousOutput:{txHash,index:0},since:0}],outputs:[
  {capacity:60000000000n,lock:{codeHash:A,hashType:'data1',args:'0x'},type:{codeHash:Q,hashType:'data2',args}},
  {capacity:6100000000n,lock:{codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:'0x'+'33'.repeat(20)}}
 ],outputsData:['0x'+'00'.repeat(466),'0x'],cellDeps:[],headerDeps:[],witnesses:['0x','0x']});
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers['x-quotacell-supervisor-token']!==token)throw new Error('Supervisor authorization required');
  if(req.headers.host!==`127.0.0.1:${port}`)throw new Error('Invalid host');
  if(req.method==='GET'&&req.url.startsWith('/api/internal/health')){write(res,200,{genesis,networkMode:'pudge',pocket:policyFromDescriptor()});return;}
  if(req.method==='GET'&&req.url.startsWith('/api/internal/intent?')){const id=new URL(req.url,origin).searchParams.get('id');write(res,200,{intent:intents.find(item=>item.id===id)||null});return;}
  if(req.method==='GET'&&req.url.startsWith('/api/internal/intents')){write(res,200,{intents:intents.filter(item=>item.state!=='committed')});return;}
  if(req.method==='GET'&&req.url.startsWith('/api/internal/resolve?')){write(res,400,{error:'No public fixture Pocket'});return;}
  if(req.method==='POST'&&req.url==='/api/internal/cancel'){const value=await body(req);requests.delete(value.id);write(res,200,{canceled:true});return;}
  if(req.method==='POST'&&req.url==='/api/external/genesis'){
   const value=await body(req),transaction=fixtureTransaction(value.draftId,value.sharedLimit==='distinct');
   const type=transaction.outputs.find(output=>output.type).type,pocket=c.Script.from(type).hash();
   requests.set(value.id,{transaction:transaction.toHex(),pocket,owner:value.publicKey,policy:{codeHash:type.codeHash,hashType:type.hashType,args:type.args}});
   write(res,200,{id:value.id,transaction:transaction.toHex(),publicKey:value.publicKey,genesis,pocket,fee:'2000'});return;
  }
  if(req.method==='POST'&&req.url==='/api/external/submit'){
   const value=await body(req),request=requests.get(value.id);if(!request)throw new Error('Unknown signing request');requests.delete(value.id);
   const submitted=c.Transaction.fromBytes(value.transaction),prepared=c.Transaction.fromBytes(request.transaction);
   const inputShape=tx=>tx.inputs.map(item=>[item.previousOutput.txHash,item.previousOutput.index.toString()]);
   const outputShape=tx=>tx.outputs.map(item=>[item.capacity.toString(),item.lock.codeHash,item.lock.hashType,item.lock.args,item.type?.codeHash||null,item.type?.hashType||null,item.type?.args||null]);
   if(JSON.stringify(inputShape(submitted))!==JSON.stringify(inputShape(prepared))||JSON.stringify(outputShape(submitted))!==JSON.stringify(outputShape(prepared))||JSON.stringify(submitted.outputsData)!==JSON.stringify(prepared.outputsData))throw new Error('Signed transaction does not match this Pocket request');
   const item={id:value.id,genesis,pocket:request.pocket,txHash:`0x${'77'.repeat(32)}`,state:'uncertain',phase:'after-submit',operation:'genesis',owner:request.owner,policy:request.policy,inputs:[{txHash:request.transaction.includes('22'.repeat(32))?'0x'+'22'.repeat(32):'0x'+'11'.repeat(32),index:0}]};
   intents=intents.filter(old=>old.id!==item.id);intents.push(item);await fs.writeFile(journalPath,JSON.stringify(intents));
   write(res,200,{txHash:item.txHash,state:'uncertain',phase:'submit'});return;
  }
  if(req.method==='POST'&&req.url==='/api/reconcile'){write(res,200,{outcomes:[]});return;}
  if(req.method==='GET'&&req.url.startsWith('/api/state')){
   const url=new URL(req.url,origin);
   if(url.searchParams.has('selected')){
    const item=intents.find(value=>value.operation==='genesis');
    if(item&&item.state==='uncertain'){
     item.state='committed';item.phase='confirmed';
     await fs.writeFile(journalPath,JSON.stringify(intents));
     await fs.writeFile(path.join(directory,'pocket.json'),JSON.stringify({initial:{Q:item.policy,expected:{ownerPublicKey:item.owner}},actors:{owner:{publicKey:item.owner}}}));
    }
    const descriptor=JSON.parse(await fs.readFile(path.join(directory,'pocket.json'),'utf8'));
    write(res,200,{empty:false,genesis,networkMode:'pudge',pocket:c.Script.from(descriptor.initial.Q).hash(),owner:descriptor.actors.owner.publicKey});return;
   }
   write(res,200,{empty:true,genesis,networkMode:'pudge'});return;
  }
  write(res,404,{error:'Not found'});
 }catch(error){write(res,400,{error:error.message});}
});
server.listen(port,'127.0.0.1');
