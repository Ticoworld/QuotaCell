// Fresh isolated-node independent QCN4 genesis integration test, Windows only.
import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import readline from 'node:readline';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildGenesis} from './pocket_genesis.mjs';
import {verifyWalletTransaction} from './pocket_signing.mjs';
import {discoverPolicy} from './pocket_discovery.mjs';
import {discoverPlainCells} from './pocket_cell_discovery.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),run=process.argv[2];assert(run,'Specify a new disposable directory');
const exe=process.argv[3]||path.join(process.env.TEMP,'quotacell-wo07-tools/ckb_v0.210.0_x86_64-pc-windows-msvc/ckb.exe');
assert.equal(crypto.createHash('sha256').update(await fs.readFile(exe)).digest('hex'),'77ff953e9dc3a03b36e38a3cab2b9b06f17be8254a15a23afa826c2d4aea98b0');
await fs.mkdir(run,{recursive:false});
const owner=spawn(process.execPath,[path.join(here,'wo14a_owner_signer.mjs')],{stdio:['pipe','pipe','inherit']});const it=readline.createInterface({input:owner.stdout})[Symbol.asyncIterator]();const publicKey=JSON.parse((await it.next()).value).publicKey;
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',CKB=100000000n;
const key=()=>new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}), '0x'+crypto.randomBytes(32).toString('hex'));
const bootstrap=key(),other=[key(),key(),key(),key()];const lock=p=>c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(Buffer.from(p.slice(2),'hex')).slice(0,42)});
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n};const rpcPort=await port(),p2pPort=await port();
const cmd=(args)=>{const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};
cmd(['-C',run,'init','--chain','dev','--ba-arg',lock(bootstrap.publicKey).args,'--rpc-port',String(rpcPort),'--p2p-port',String(p2pPort)]);
const spec=path.join(run,'specs/dev.toml');let text=await fs.readFile(spec,'utf8');const issued=`[[genesis.issued_cells]]\ncapacity = ${1000000n*CKB}\nlock.code_hash = "${K}"\nlock.args = "${lock(bootstrap.publicKey).args}"\nlock.hash_type = "type"\n`;text=text.slice(0,text.indexOf('# Burn'))+issued+'\n'+text.slice(text.indexOf('[params]'));await fs.writeFile(spec,text);
const config=path.join(run,'ckb.toml');text=await fs.readFile(config,'utf8');text=text.replace(/^listen_addresses = .*$/m,`listen_addresses = ["/ip4/127.0.0.1/tcp/${p2pPort}"]`).replace(/^max_outbound_peers = .*$/m,'max_outbound_peers = 0').replace(/^discovery_local_address = .*$/m,'discovery_local_address = false').replace(/^modules = .*$/m,'modules = ["Net", "Pool", "Miner", "Chain", "Stats", "Experiment", "IntegrationTest"]');assert.match(text,/^bootnodes = \[\]/m);await fs.writeFile(config,text);
const node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});const url=`http://127.0.0.1:${rpcPort}`;let id=0;
async function rpc(method,params=[]){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(10000)});const x=await r.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const n=x=>'0x'+BigInt(x).toString(16),pt=p=>({tx_hash:p.txHash,index:n(p.index)}),sc=s=>({code_hash:s.codeHash,hash_type:s.hashType,args:s.args});
const raw=t=>({version:n(t.version),cell_deps:t.cellDeps.map(d=>({out_point:pt(d.outPoint),dep_type:d.depType==='depGroup'?'dep_group':'code'})),header_deps:[],inputs:t.inputs.map(i=>({previous_output:pt(i.previousOutput),since:n(i.since)})),outputs:t.outputs.map(o=>({capacity:n(o.capacity),lock:sc(o.lock),type:o.type?sc(o.type):null})),outputs_data:t.outputsData,witnesses:t.witnesses});
const point=(txHash,index)=>({txHash,index});
async function live(p){const x=await rpc('get_live_cell',[pt(p),true]);assert.equal(x.status,'live');return {...x,outPoint:p};}
async function commit(t){const hash=t.hash();await rpc('dry_run_transaction',[raw(t)]);assert.equal(await rpc('send_transaction',[raw(t),'passthrough']),hash);for(let i=0;i<30;i++){await sleep(150);await rpc('generate_block');await sleep(100);const x=await rpc('get_transaction',[hash]);if(x?.tx_status.status==='committed'){const h=await rpc('get_header',[x.tx_status.block_hash]);assert.equal(await rpc('get_block_hash',[h.number]),h.hash);return x;}}throw Error('Commit timeout: '+hash);}
try{
 for(let i=0;i<80;i++){try{await rpc('get_tip_header');break}catch{if(i===79)throw Error('Node startup timeout');await sleep(250)}}
 assert.equal((await rpc('get_consensus')).id,'ckb_dev');await rpc('set_network_active',[false]);assert.equal((await rpc('get_peers')).length,0);
 const genesis=await rpc('get_block_by_number',['0x0']),system=genesis.transactions[0],group=genesis.transactions[1];
 const kh=['0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4','0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649'];
 const members=kh.map(h=>{const i=system.outputs_data.findIndex(d=>c.hashCkb(Buffer.from(d.slice(2),'hex'))===h);assert(i>=0);return point(system.hash,i)});
 const codeType=system.outputs[members[1].index].type;assert(codeType);assert.equal(c.Script.from({codeHash:codeType.code_hash,hashType:codeType.hash_type,args:codeType.args}).hash(),K);
 const groupIndex=group.outputs_data.findIndex(d=>{const b=Buffer.from(d.slice(2),'hex');return b.length===76&&members.every((p,i)=>'0x'+b.subarray(4+i*36,36+i*36).toString('hex')===p.txHash&&b.readUInt32LE(36+i*36)===p.index)});assert(groupIndex>=0);
 const kdep={outPoint:point(group.hash,groupIndex),depType:'depGroup'};await live(kdep.outPoint);for(const p of members)await live(p);
 const idx=system.outputs.findIndex(o=>o.lock.args===lock(bootstrap.publicKey).args&&!o.type);assert(idx>=0);const bootstrapCell=await live(point(system.hash,idx));
 const hashes=['0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1','0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a','0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e'];
 const files=['../../test-support/binaries/always-success','../../test-support/binaries/proxy','../../policy/build/allowance-native-v2'],data=await Promise.all(files.map(f=>fs.readFile(path.resolve(here,f))));data.forEach((b,i)=>assert.equal(c.hashCkb(b),hashes[i]));
 const outputs=data.map(b=>({capacity:BigInt(b.length+61)*CKB,lock:lock(bootstrap.publicKey)}));outputs.push({capacity:1000n*CKB,lock:lock(publicKey)});const sum=outputs.reduce((a,x)=>a+x.capacity,0n);outputs.push({capacity:BigInt(bootstrapCell.cell.output.capacity)-sum-200000n,lock:lock(bootstrap.publicKey)});
 const deploy=c.Transaction.from({inputs:[{previousOutput:bootstrapCell.outPoint,since:0}],outputs,outputsData:[...data.map(b=>'0x'+b.toString('hex')),'0x','0x'],cellDeps:[kdep],headerDeps:[],witnesses:['0x']});deploy.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});
 const acp=await new c.ClientPublicTestnet({url,fallbacks:[]}).getKnownScript(c.KnownScript.AnyoneCanPay);
 const client=new c.ClientPublicTestnet({url,fallbacks:[],scripts:{[c.KnownScript.AnyoneCanPay]:acp,[c.KnownScript.Secp256k1Blake160]:{codeHash:K,hashType:'type',cellDeps:[{cellDep:kdep}]}}});const bs=new c.SignerCkbPrivateKey(client,bootstrap.privateKey);const deployed=await bs.signOnlyTransaction(deploy);await commit(deployed);
 const deps=[kdep,...hashes.map((_,i)=>({outPoint:point(deployed.hash(),i),depType:'code'}))];for(const [i,h] of hashes.entries())assert.equal(c.hashCkb(Buffer.from((await live(deps[i+1].outPoint)).cell.data.content.slice(2),'hex')),h);
 const foundOwner=await discoverPlainCells({rpc,lock:lock(publicKey)});assert.equal(foundOwner.cells.length,1);assert.equal(foundOwner.cells[0].outPoint.tx_hash,deployed.hash());assert.equal(foundOwner.cells[0].outPoint.index,'0x3');
 const ownerInput=await live(point(deployed.hash(),3)),delegates=[0,1].map((_,i)=>({publicKey:other[i].publicKey,recipient:lock(other[i+2].publicKey),limit:200n*CKB,perPayment:100n*CKB}));
 const built=buildGenesis({ownerPublicKey:publicKey,delegates,sharedLimit:250n*CKB,ownerInput,deps});const prepared=c.Transaction.fromBytes(built.transaction.toBytes()),info=await prepared.getSignHashInfo(lock(publicKey),client);assert.equal(info.position,0);
 owner.stdin.write(JSON.stringify({transaction:prepared.toHex(),message:info.message})+'\n');const signed=c.Transaction.fromBytes(JSON.parse((await it.next()).value).transaction);verifyWalletTransaction({prepared,signed,message:info.message,publicKey,position:0});await live(ownerInput.outPoint);
 const result=await commit(signed),remainingOwnerCells=await discoverPlainCells({rpc,lock:lock(publicKey)});assert.equal(remainingOwnerCells.cells.length,1);assert.equal(remainingOwnerCells.cells[0].outPoint.tx_hash,signed.hash());assert.equal(remainingOwnerCells.cells[0].outPoint.index,'0x1');const cell=await live(point(signed.hash(),0));assert.equal(cell.cell.output.type.args,built.typeId);assert.equal(cell.cell.output.type.code_hash,hashes[2]);assert.equal(cell.cell.data.content,prepared.outputsData[0]);const b=Buffer.from(cell.cell.data.content.slice(2),'hex');assert.equal('0x'+b.subarray(125,158).toString('hex'),publicKey);for(const [i,d] of delegates.entries()){const off=158+154*i;assert.equal('0x'+b.subarray(off,off+33).toString('hex'),d.publicKey);assert.equal(b.readBigUInt64LE(off+106),d.limit);assert.equal(b.readBigUInt64LE(off+138),d.perPayment)}assert.equal(b.readBigUInt64LE(8),250n*CKB);
 const expected={ownerPublicKey:publicKey,sharedLimit:String(250n*CKB),delegates:delegates.map(d=>({publicKey:d.publicKey,recipient:{codeHash:d.recipient.codeHash,hashType:d.recipient.hashType,args:d.recipient.args},limit:String(d.limit),perPayment:String(d.perPayment)}))};
 const policy={codeHash:built.policy.codeHash,hashType:built.policy.hashType,args:built.typeId};
 const request=JSON.stringify({url,policy,expected})+'\n';
 function fresh(){const x=spawnSync(process.execPath,[path.join(here,'wo14a_discovery_client.mjs')],{input:request,encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(x.status,0,x.stderr||x.stdout);return JSON.parse(x.stdout).result;}
 const first=fresh(),second=fresh();assert.deepEqual(second,first);assert.equal(second.outPoint.tx_hash,signed.hash());assert.equal(second.outPoint.index,'0x0');assert.equal(second.blockHash,result.tx_status.block_hash);
 await assert.rejects(()=>discoverPolicy({rpc,policy:{...policy,args:'0x'+'00'.repeat(32)},expected}),/Policy not found/);
 await assert.rejects(()=>discoverPolicy({rpc,policy:{...policy,codeHash:'0x'+'00'.repeat(32)},expected}),/Invalid QCN4 policy identity/);
 await assert.rejects(()=>discoverPolicy({rpc,policy,expected:{...expected,sharedLimit:'1'}}),/Shared limit mismatch/);
 const badRpc=async(method,params)=>{const x=await rpc(method,params);if(method==='get_live_cell'&&params[0].tx_hash===signed.hash()){x.cell.data.content='0x00';}return x;};
 await assert.rejects(()=>discoverPolicy({rpc:badRpc,policy,expected}),/Live data differs/);
 const malformedRpc=async(method,params)=>{const x=await rpc(method,params);if(method==='get_block_by_number'){const t=x.transactions.find(t=>t.hash===signed.hash());if(t)t.outputs_data[0]='0x00';}if(method==='get_live_cell'&&params[0].tx_hash===signed.hash())x.cell.data.content='0x00';return x;};
 await assert.rejects(()=>discoverPolicy({rpc:malformedRpc,policy,expected}),/Malformed policy state/);
 const duplicateRpc=async(method,params)=>{const x=await rpc(method,params);if(method==='get_block_by_number'&&x.transactions.some(t=>t.hash===signed.hash())){const t=x.transactions.find(t=>t.hash===signed.hash());x.transactions.push(structuredClone(t));}return x;};
 await assert.rejects(()=>discoverPolicy({rpc:duplicateRpc,policy,expected}),/Ambiguous live policy/);
 console.log(JSON.stringify({result:'PASS',genesisHash:genesis.header.hash,transaction:signed.hash(),block:result.tx_status.block_hash,typeId:built.typeId,discovery:second,negativeChecks:['missing','incorrect identity','wrong limits','malformed response','ambiguous']},null,2));
}finally{owner.stdin.end();owner.kill();node.kill();}
