import assert from 'node:assert/strict';
import * as c from '@ckb-ccc/core';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';

const run=path.resolve(process.argv[2]||'');
assert(run!==path.parse(run).root&&process.argv[2],'Pass the existing runtime directory');
const [runtime,pocket]=await Promise.all([
  fs.readFile(path.join(run,'runtime.json'),'utf8').then(JSON.parse),
  fs.readFile(path.join(run,'pocket.json'),'utf8').then(JSON.parse),
]);
const db=new DatabaseSync(path.join(run,'working-pocket.sqlite'),{readOnly:true});
const rows=db.prepare('SELECT operation,amount,tx_hash,signed,state FROM intents ORDER BY created').all();
db.close();
assert.equal(rows.length,9,'Expected the nine public WO18 transactions');
assert(rows.every(row=>row.state==='committed'),'Journal contains a non-committed public intent');

let id=0;
async function rpc(method,params=[]){
  const response=await fetch(runtime.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(body.error)throw Object.assign(new Error(`${method}: ${body.error.message}`),{rpc:body.error});
  return body.result;
}
const scriptHash=script=>c.Script.from({codeHash:script.codeHash??script.code_hash,hashType:script.hashType??script.hash_type,args:script.args}).hash();
const scriptBytes=script=>script?33+Buffer.from(script.args.slice(2),'hex').length:0;
function txFromRaw(raw){
  return c.Transaction.from({
    version:BigInt(raw.version),
    cellDeps:raw.cell_deps.map(d=>({outPoint:{txHash:d.out_point.tx_hash,index:Number(BigInt(d.out_point.index))},depType:d.dep_type==='dep_group'?'depGroup':d.dep_type})),
    headerDeps:raw.header_deps,
    inputs:raw.inputs.map(i=>({since:BigInt(i.since),previousOutput:{txHash:i.previous_output.tx_hash,index:Number(BigInt(i.previous_output.index))}})),
    outputs:raw.outputs.map(o=>({capacity:BigInt(o.capacity),lock:{codeHash:o.lock.code_hash,hashType:o.lock.hash_type,args:o.lock.args},type:o.type?{codeHash:o.type.code_hash,hashType:o.type.hash_type,args:o.type.args}:null})),
    outputsData:raw.outputs_data,
    witnesses:raw.witnesses,
  });
}
const qHash=scriptHash(pocket.initial.Q),fHash=scriptHash(pocket.initial.F),ownerHash=scriptHash(pocket.actors.owner.lock);
const ckb=value=>`${(BigInt(value)/100000000n).toString()}.${(BigInt(value)%100000000n).toString().padStart(8,'0')}`;
const roleOf=output=>output.type&&scriptHash(output.type)===qHash?'policy':
  scriptHash(output.lock)===fHash?'fund':scriptHash(output.lock)===ownerHash?'owner':'other';
const transactions=await Promise.all(rows.map(async row=>{
  const signed=JSON.parse(row.signed);
  const signedHash=txFromRaw(signed).hash();
  assert.equal(signedHash,row.tx_hash,`Journal hash mismatch for ${row.operation}`);
  const result=await rpc('get_transaction',[row.tx_hash]);
  assert(result?.transaction,`Pudge does not know ${row.tx_hash}`);
  assert.equal(result.tx_status?.status,'committed',`Pudge does not report ${row.tx_hash} committed`);
  const header=await rpc('get_header',[result.tx_status.block_hash]);
  assert(header,`Missing block header for ${row.tx_hash}`);
  assert.equal(await rpc('get_block_hash',[header.number]),header.hash,`Non-canonical block for ${row.tx_hash}`);
  const tx=result.transaction;
  return {row,signed,tx,block:{number:header.number,hash:header.hash}};
}));

const parentHashes=[...new Set(transactions.flatMap(item=>item.tx.inputs.map(input=>input.previous_output.tx_hash)))];
const parents=new Map(await Promise.all(parentHashes.map(async hash=>{
  const result=await rpc('get_transaction',[hash]);
  assert(result?.transaction,`Missing parent transaction ${hash}`);
  return [hash,result.transaction];
})));
const audit=transactions.map(({row,tx,block})=>{
  const inputCapacity=tx.inputs.reduce((sum,input)=>{
    const parent=parents.get(input.previous_output.tx_hash),index=Number(BigInt(input.previous_output.index));
    assert(parent.outputs[index],`Missing input output for ${row.tx_hash}`);
    return sum+BigInt(parent.outputs[index].capacity);
  },0n);
  const outputCapacity=tx.outputs.reduce((sum,output)=>sum+BigInt(output.capacity),0n);
  const fee=inputCapacity-outputCapacity;
  assert(fee>=0n,`Negative fee for ${row.tx_hash}`);
  const inputs=tx.inputs.map(input=>{
    const parent=parents.get(input.previous_output.tx_hash),previous=parent.outputs[Number(BigInt(input.previous_output.index))];
    return {role:roleOf(previous),capacity:String(previous.capacity),capacityCkb:ckb(previous.capacity),outPoint:input.previous_output};
  });
  const outputs=tx.outputs.map((output,index)=>{
    const role=roleOf(output);
    const data=Buffer.from(tx.outputs_data[index].slice(2),'hex');
    const occupiedBytes=8+scriptBytes(output.lock)+scriptBytes(output.type)+data.length;
    const occupiedCapacity=BigInt(occupiedBytes)*100000000n;
    assert(BigInt(output.capacity)>=occupiedCapacity,`Output ${index} of ${row.tx_hash} is below occupied capacity`);
    const item={index,role,capacity:String(output.capacity),capacityCkb:ckb(output.capacity),lockHash:scriptHash(output.lock),typeHash:output.type?scriptHash(output.type):null,dataBytes:data.length,occupiedCapacityShannons:String(occupiedCapacity),occupiedCapacityCkb:ckb(occupiedCapacity),capacityAboveOccupiedShannons:String(BigInt(output.capacity)-occupiedCapacity)};
    if(role==='policy'){
      if(data.length===28&&data.toString('ascii',0,4)==='QCT4'){
        item.policyState={format:'QCT4',closed:true};
      }else if(data.length>=466&&data.toString('ascii',0,4)==='QCN4'){
        const u128=offset=>data.readBigUInt64LE(offset)+(data.readBigUInt64LE(offset+8)<<64n);
        item.policyState={format:'QCN4',closed:false,delegate1Enabled:Boolean(data[7]&1),delegate2Enabled:Boolean(data[7]&2),sharedLimit:String(u128(8)),sharedUsed:String(u128(24)),delegate1Limit:String(u128(264)),delegate1Used:String(u128(280)),delegate2Limit:String(u128(418)),delegate2Used:String(u128(434))};
      }
    }
    return item;
  });
  const cellDeps=tx.cell_deps.map(dependency=>({outPoint:dependency.out_point,depType:dependency.dep_type}));
  return {operation:row.operation,amount:row.amount,txHash:row.tx_hash,block,feeShannons:String(fee),feeCkb:ckb(fee),inputShannons:String(inputCapacity),outputShannons:String(outputCapacity),inputs,cellDeps,outputs};
});
const funding=transactions.find(item=>item.row.operation==='deposit'&&item.row.amount==='25600000000');
const totalFees=audit.reduce((sum,item)=>sum+BigInt(item.feeShannons),0n);
assert.equal(totalFees,1642656n,'Unexpected fee total for the nine public lifecycle transactions');
const closing=audit.find(item=>item.operation==='close');
assert(closing.outputs.some(output=>output.role==='policy'&&output.capacityCkb==='134.00000000'&&output.policyState?.format==='QCT4'&&output.policyState.closed&&output.capacityAboveOccupiedShannons==='0'),'Missing exactly occupied 134 CKB terminal QCT4 output');
const revoking=transactions.filter(item=>item.row.operation==='revoke');
assert.equal(revoking.length,2);
assert.equal(revoking[0].tx.outputs_data[0].slice(16,18),'02','Delegate 1 must be disabled after its revocation');
assert.equal(revoking[1].tx.outputs_data[0].slice(16,18),'00','Both delegates must be disabled after revocations');
const fundingInputStatus=await Promise.all(funding.tx.inputs.map(async input=>{
  const outPoint=input.previous_output;
  const result=await rpc('get_live_cell',[outPoint,false]);
  return {outPoint,status:result.status};
}));
console.log(JSON.stringify({result:'PASS',endpoint:new URL(runtime.url).host,transactionCount:audit.length,totalFeesShannons:String(totalFees),totalFeesCkb:ckb(totalFees),audit,fundingInputs:fundingInputStatus},null,2));
