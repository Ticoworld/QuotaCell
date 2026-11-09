// Fresh isolated-node independent QCN4 genesis integration test, Windows only.
import {discoverIndexed} from './pocket_indexed_discovery.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
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
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const provider=(await build({entryPoints:[path.join(here,'wallet_sim_provider.mjs')],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
const pages=[];const publicKeys=[];
for(let i=0;i<3;i++){const page=await browser.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto('about:blank');await page.evaluate(()=>window.name=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''));const seeded="window.__testKey='0x'+window.name;"+provider;await page.evaluate(seeded);publicKeys.push(await page.evaluate(()=>window.testWallet.publicKey));await page.addInitScript({content:seeded});pages.push(page);}
const publicKey=publicKeys[0];
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',CKB=100000000n;
const key=()=>new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}), '0x'+crypto.randomBytes(32).toString('hex'));
const bootstrap=key(),other=[key(),key(),key(),key()];const lock=p=>c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(Buffer.from(p.slice(2),'hex')).slice(0,42)});
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n};const rpcPort=await port(),p2pPort=await port();
const cmd=(args)=>{const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};
cmd(['-C',run,'init','--chain','dev','--ba-arg',lock(bootstrap.publicKey).args,'--rpc-port',String(rpcPort),'--p2p-port',String(p2pPort)]);
const spec=path.join(run,'specs/dev.toml');let text=await fs.readFile(spec,'utf8');const issued=`[[genesis.issued_cells]]\ncapacity = ${1000000n*CKB}\nlock.code_hash = "${K}"\nlock.args = "${lock(bootstrap.publicKey).args}"\nlock.hash_type = "type"\n`;text=text.slice(0,text.indexOf('# Burn'))+issued+'\n'+text.slice(text.indexOf('[params]'));await fs.writeFile(spec,text);
const config=path.join(run,'ckb.toml');text=await fs.readFile(config,'utf8');text=text.replace(/^listen_addresses = .*$/m,`listen_addresses = ["/ip4/127.0.0.1/tcp/${p2pPort}"]`).replace(/^max_outbound_peers = .*$/m,'max_outbound_peers = 0').replace(/^discovery_local_address = .*$/m,'discovery_local_address = false').replace(/^modules = .*$/m,'modules = ["Net", "Pool", "Miner", "Chain", "Stats", "Experiment", "IntegrationTest", "Indexer"]');assert.match(text,/^bootnodes = \[\]/m);await fs.writeFile(config,text);
let node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});const url=`http://127.0.0.1:${rpcPort}`;let id=0;
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
 const outputs=data.map(b=>({capacity:BigInt(b.length+61)*CKB,lock:lock(bootstrap.publicKey)}));outputs.push({capacity:5000n*CKB,lock:lock(publicKey)});outputs.push(...publicKeys.slice(1).map(p=>({capacity:1000n*CKB,lock:lock(p)})));const sum=outputs.reduce((a,x)=>a+x.capacity,0n);outputs.push({capacity:BigInt(bootstrapCell.cell.output.capacity)-sum-200000n,lock:lock(bootstrap.publicKey)});
 const deploy=c.Transaction.from({inputs:[{previousOutput:bootstrapCell.outPoint,since:0}],outputs,outputsData:[...data.map(b=>'0x'+b.toString('hex')),...outputs.slice(3).map(()=>'0x')],cellDeps:[kdep],headerDeps:[],witnesses:['0x']});deploy.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});
 const acp=await new c.ClientPublicTestnet({url,fallbacks:[]}).getKnownScript(c.KnownScript.AnyoneCanPay);
 const client=new c.ClientPublicTestnet({url,fallbacks:[],scripts:{[c.KnownScript.AnyoneCanPay]:acp,[c.KnownScript.Secp256k1Blake160]:{codeHash:K,hashType:'type',cellDeps:[{cellDep:kdep}]}}});const bs=new c.SignerCkbPrivateKey(client,bootstrap.privateKey);const deployed=await bs.signOnlyTransaction(deploy);await commit(deployed);
 const deps=[kdep,...hashes.map((_,i)=>({outPoint:point(deployed.hash(),i),depType:'code'}))];for(const [i,h] of hashes.entries())assert.equal(c.hashCkb(Buffer.from((await live(deps[i+1].outPoint)).cell.data.content.slice(2),'hex')),h);

 await fs.mkdir(path.join(run,'evidence'));
 await fs.writeFile(path.join(run,'runtime.json'),JSON.stringify({url}));
 await fs.writeFile(path.join(run,'evidence/node-profile.json'),JSON.stringify({genesisHeader:genesis.header}));
 await fs.writeFile(path.join(run,'deployment.json'),JSON.stringify({deployed:Object.fromEntries(['A','F','Q'].map((n,i)=>[n,point(deployed.hash(),i)])),kdep,allDeps:deps}));
 const appPort=await port();
 let app=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(appPort)],{stdio:['ignore','pipe','pipe'],env:{...process.env,QUOTACELL_DEV_SIGNER:'0'},windowsHide:true});
 let output='';app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);
 try{
  let state;
  for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(output);try{const response=await fetch(`http://127.0.0.1:${appPort}/api/state`);state=await response.json();if(response.ok)break;}catch{}await sleep(100);}
  assert.equal(state?.empty,true,output);assert.equal(state.developmentSigner,false);assert.equal(state.genesis,genesis.header.hash);
  for(const name of ['actors.json','context.json'])await assert.rejects(fs.access(path.join(run,name)),{code:'ENOENT'});
  console.log('empty-server-start PASS');
  const appURL=`http://127.0.0.1:${appPort}`;
  for(const p of pages){await p.goto(appURL);await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();await p.waitForFunction(()=>document.querySelector('#walletStatus').textContent.includes('Connected:'));}
  const terms={sharedLimit:String(250n*CKB),delegates:publicKeys.slice(1).map((publicKey,i)=>({publicKey,recipient:JSON.parse(JSON.stringify(lock(other[i].publicKey))),limit:String(200n*CKB),perPayment:String(100n*CKB)}))};
  const ownerPage=pages[0];await ownerPage.locator('#genesisTerms').fill(JSON.stringify({sharedLimit:'250',delegates:terms.delegates.map(d=>({publicKey:d.publicKey,recipient:d.recipient.args,limit:'200',perPayment:'100'}))}));await ownerPage.locator('#createPocket').click();
  const committed=async p=>{await p.waitForFunction(()=>/^committed:/.test(document.querySelector('#status').textContent),null,{timeout:45000}).catch(async e=>{throw Error(await p.locator('#status').innerText());});console.log(await p.locator('#status').innerText());};
  await committed(ownerPage);
  await ownerPage.locator('#depositAmount').fill('500');
  await ownerPage.locator('#status').evaluate(e=>e.textContent='');await ownerPage.locator('#deposit').click();await committed(ownerPage);
  for(const [i,p] of pages.slice(1).entries()){
   await p.reload();await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();
   await p.locator('#role').selectOption(i?'ben':'alice');await p.locator('#amount').fill(i?'100':'99.00000001');
   const address=c.Address.fromScript(lock(other[i].publicKey),new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]})).toString();await p.locator('#to').fill(address);
   if(i===0){
    const rejected=async(mode,pattern)=>{await p.locator('#status').evaluate(e=>e.textContent='');await p.evaluate(mode=>window.testWallet.mode=mode,mode);await p.locator('#pay').click();await p.waitForFunction(pattern=>new RegExp(pattern).test(document.querySelector('#status').textContent),pattern,{timeout:20000});};
    await rejected('reject','Authorization rejected');await rejected('mutate','Wallet altered transaction fields');
    await p.evaluate(()=>{window.testWallet.mode='ok';window.testWallet.network='nervos'});await p.locator('#status').evaluate(e=>e.textContent='');await p.locator('#pay').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('wrong network'));
    await p.evaluate(()=>window.testWallet.network='nervos_testnet');await rejected('switch','Wallet.*changed|not the selected delegate');
    await p.reload();await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();await p.locator('#amount').fill('99.00000001');await p.locator('#to').fill(address);
    await rejected('disconnect','disconnected|changed');
    await p.reload();await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();await p.locator('#amount').fill('99.00000001');await p.locator('#to').fill(address);console.log('simulated wallet negative checks PASS');
   }
   await p.locator('#pay').click();await committed(p);
  }
const current=JSON.parse(await fs.readFile(path.join(run,'pocket.json')));const localIndexerRpc=async(method,params=[])=>method==='get_consensus'?{id:'ckb_testnet'}:method==='get_block_hash'&&params[0]==='0x0'?PUDGE_GENESIS:rpc(method,params);
  let indexed;for(let i=0;i<100;i++){try{indexed=await discoverIndexed({rpc:localIndexerRpc,policy:current.initial.Q,expected:current.initial.expected});break;}catch(e){if(!/lag or chain-tip mismatch/.test(e.message))throw e;await sleep(100);}}
  assert.equal(indexed?.cells.length,1);const indexFunds=await discoverIndexed({rpc:localIndexerRpc,lock:current.initial.F});assert.equal(indexFunds.cells.length,1);const indexOwner=await discoverIndexed({rpc:localIndexerRpc,lock:current.actors.owner.lock});assert(indexOwner.cells.length>=1);console.log('isolated node indexer discovery PASS');
  app.kill();await new Promise(r=>app.once('exit',r));node.kill();await new Promise(r=>node.once('exit',r));
  node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});
  for(let i=0;i<100;i++){try{await rpc('get_tip_header');break;}catch{}await sleep(100);}
  app=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(appPort)],{stdio:'ignore',env:{...process.env,QUOTACELL_DEV_SIGNER:'0'},windowsHide:true});
  let reopened;
  for(let i=0;i<100;i++){try{const response=await fetch(appURL+'/api/state');reopened=await response.json();if(response.ok)break;}catch{}await sleep(100);}
  assert.equal(reopened.closed,false);assert.equal(reopened.sharedUsed,String(199n*CKB+1n));assert.equal(reopened.fundShannons,String(301n*CKB-1n));console.log('active node/server restart PASS');
  await ownerPage.reload();await ownerPage.locator('#connectWallet').click();await ownerPage.getByText('UTXO Global Wallet',{exact:true}).first().click();await ownerPage.getByText('CKB',{exact:true}).first().click();
  for(const op of ['revoke','close','deposit','sweep']){ await ownerPage.locator('#status').evaluate(e=>e.textContent='');await ownerPage.locator('#'+op).click();await committed(ownerPage);
   if(op==='revoke'){
    const denied=await pages[1].evaluate(async terms=>{const r=await fetch('/api/external/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),publicKey:terms.publicKey,role:'alice',amount:'61',recipient:terms.recipient.args})});return {status:r.status,body:await r.json()};},terms.delegates[0]);
    assert.equal(denied.status,400);assert.match(denied.body.error,/delegate disabled/);console.log('revoked delegate rejected PASS');
   }
  }
  app.kill();await new Promise(r=>app.once('exit',r));node.kill();await new Promise(r=>node.once('exit',r));
  node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});
  for(let i=0;i<100;i++){try{await rpc('get_tip_header');break;}catch{}await sleep(100);}
  app=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(appPort)],{stdio:'ignore',env:{...process.env,QUOTACELL_DEV_SIGNER:'0'},windowsHide:true});
  reopened=undefined;
  for(let i=0;i<100;i++){try{const response=await fetch(appURL+'/api/state');reopened=await response.json();if(response.ok)break;}catch{}await sleep(100);}
  assert.equal(reopened.closed,true,JSON.stringify(reopened));assert.equal(reopened.hasFund,false);assert.equal(reopened.sharedUsed,'0');assert.equal(reopened.history.length,8);
  for(const name of ['actors.json','context.json','keys'])await assert.rejects(fs.access(path.join(run,name)),{code:'ENOENT'});
  const evidence={result:'PASS',lifecycle:['creation','funding','alice payment','ben payment','revocation','recovery','late deposit','sweep','node and server restart/reopen'],genesis:state.genesis,pocket:reopened.pocket};await fs.writeFile(path.join(run,'evidence/wo14b-lifecycle.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));

 }finally{app.kill();}
}finally{await browser.close();node.kill();}
