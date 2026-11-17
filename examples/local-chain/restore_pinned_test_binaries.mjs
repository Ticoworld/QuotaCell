import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const primary=process.env.QUOTACELL_PUDGE_RPC||'https://testnet.ckb.dev/';
const endpoints=[primary,'https://testnet.ckbapp.dev/'];
const deployment=JSON.parse(await fs.readFile(path.join(repo,'evidence/wo15/pudge-deployment.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(repo,'test-support/manifest.json'),'utf8'));
const deploymentTx='0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93';
const records={
 'always-success':{...manifest.binaries['always-success'],outPoint:deployment.deployed.A},
 proxy:{...manifest.binaries.proxy,outPoint:deployment.deployed.F},
};

assert.equal(deployment.network,'pudge');
assert.equal(deployment.genesis,'0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606');
assert.equal(deployment.deployed.A.txHash,deploymentTx);
assert.equal(deployment.deployed.F.txHash,deploymentTx);
assert.equal(deployment.deployed.A.index,0);
assert.equal(deployment.deployed.F.index,1);

async function rpc(url,method,params=[]){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
 assert(response.ok,`${url} returned HTTP ${response.status} for ${method}`);
 const body=await response.json();assert(!body.error,`${url} ${method}: ${JSON.stringify(body.error)}`);return body.result;
}

async function fetchVerifiedEndpoint(url){
 const [consensus,genesis]=await Promise.all([rpc(url,'get_consensus'),rpc(url,'get_block_hash',['0x0'])]);
 assert.equal(consensus.id,'ckb_testnet',`${url} is not CKB testnet`);
 assert.equal(genesis,deployment.genesis,`${url} has the wrong genesis`);
 const output={};
 for(const [name,record] of Object.entries(records)){
  const txInfo=await rpc(url,'get_transaction',[record.outPoint.txHash]);
  assert.equal(txInfo?.tx_status?.status,'committed',`${name} deployment transaction is not committed on ${url}`);
  const blockHash=txInfo.tx_status.block_hash;
  const header=await rpc(url,'get_header',[blockHash]);
  assert.equal(header?.hash,blockHash,`${name} block header mismatch on ${url}`);
  assert.equal(await rpc(url,'get_block_hash',[header.number]),blockHash,`${name} deployment is not canonical on ${url}`);
  const index=record.outPoint.index;
  assert(txInfo.transaction?.outputs?.[index],`${name} deployment output is missing on ${url}`);
  const dataInTransaction=txInfo.transaction.outputs_data?.[index]?.toLowerCase();
  assert(dataInTransaction,`${name} transaction data is missing on ${url}`);
  const live=await rpc(url,'get_live_cell',[{tx_hash:record.outPoint.txHash,index:`0x${index.toString(16)}`},true]);
  assert.equal(live.status,'live',`${name} code Cell is not live on ${url}`);
  assert.deepEqual(live.cell.output,txInfo.transaction.outputs[index],`${name} live output does not match its canonical transaction on ${url}`);
  assert.equal(live.cell.data?.content?.toLowerCase(),dataInTransaction,`${name} live data does not match its canonical transaction on ${url}`);
  const bytes=c.bytesFrom(dataInTransaction),sha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length,record.bytes,`${name} has the wrong byte length on ${url}`);
  assert.equal(sha256,record.sha256,`${name} has the wrong SHA-256 on ${url}`);
  assert.equal(c.hashCkb(bytes),record.ckb_blake2b256,`${name} has the wrong CKB data hash on ${url}`);
  output[name]={bytes:Buffer.from(bytes),blockHash,byteLength:bytes.length,sha256,ckbDataHash:record.ckb_blake2b256};
 }
 return output;
}

const [primaryResult,independentResult]=await Promise.all(endpoints.map(fetchVerifiedEndpoint));
for(const name of Object.keys(records)){
 assert.equal(primaryResult[name].sha256,independentResult[name].sha256,`${name} differs across Pudge RPCs`);
 assert.equal(primaryResult[name].blockHash,independentResult[name].blockHash,`${name} canonical block differs across Pudge RPCs`);
}

const qPath=path.join(repo,'policy/build/allowance-native-v2');
const qBytes=await fs.readFile(qPath);
assert.equal(createHash('sha256').update(qBytes).digest('hex'),deployment.verification.qSha256,'Local QCN4 SHA-256 differs from the pinned Pudge deployment');
assert.equal(c.hashCkb(qBytes),deployment.verification.qDataHash,'Local QCN4 CKB hash differs from the pinned Pudge deployment');

const binaryDirectory=path.join(repo,'test-support/binaries');
await fs.mkdir(binaryDirectory,{recursive:true});
for(const [name,record] of Object.entries(records)){
 const target=path.join(binaryDirectory,record.file.split('/').at(-1));
 try{
  const existing=await fs.readFile(target);
  assert.equal(createHash('sha256').update(existing).digest('hex'),record.sha256,`${target} exists with unexpected contents; refusing to replace it`);
  continue;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=`${target}.verified-${process.pid}`;
 await fs.writeFile(temporary,primaryResult[name].bytes,{flag:'wx'});
 await fs.rename(temporary,target);
}

console.log(JSON.stringify({
 source:'canonical live Pudge A/F Cells verified through two RPC endpoints',
 endpointChecks:endpoints,
 binaries:Object.fromEntries(Object.entries(records).map(([name,record])=>[name,{outPoint:record.outPoint,byteLength:record.bytes,sha256:record.sha256,ckbDataHash:record.ckb_blake2b256}])),
 qcn4:{path:path.relative(repo,qPath),byteLength:qBytes.length,sha256:createHash('sha256').update(qBytes).digest('hex'),ckbDataHash:c.hashCkb(qBytes)},
},null,2));
