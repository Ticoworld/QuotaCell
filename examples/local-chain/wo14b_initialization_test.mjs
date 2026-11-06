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

 await fs.mkdir(path.join(run,'evidence'));
 await fs.writeFile(path.join(run,'runtime.json'),JSON.stringify({url}));
 await fs.writeFile(path.join(run,'evidence/node-profile.json'),JSON.stringify({genesisHeader:genesis.header}));
 await fs.writeFile(path.join(run,'deployment.json'),JSON.stringify({deployed:Object.fromEntries(['A','F','Q'].map((n,i)=>[n,point(deployed.hash(),i)])),kdep,allDeps:deps}));
 const appPort=await port();
 const app=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(appPort)],{stdio:['ignore','pipe','pipe'],env:{...process.env,QUOTACELL_DEV_SIGNER:'0'},windowsHide:true});
 let output='';app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);
 try{
  let state;
  for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(output);try{const response=await fetch(`http://127.0.0.1:${appPort}/api/state`);state=await response.json();if(response.ok)break;}catch{}await sleep(100);}
  assert.equal(state?.empty,true,output);assert.equal(state.developmentSigner,false);assert.equal(state.genesis,genesis.header.hash);
  for(const name of ['actors.json','context.json'])await assert.rejects(fs.access(path.join(run,name)),{code:'ENOENT'});
  console.log(JSON.stringify({checkpoint:'empty-server-start',result:'PASS',genesis:state.genesis}));
 }finally{app.kill();}
}finally{owner.stdin.end();owner.kill();node.kill();}
