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
import {buildPayment} from './pocket_payment.ts';
const here=path.dirname(fileURLToPath(import.meta.url)),run=process.argv[2];assert(run,'Specify a new disposable directory');
const exe=process.argv[3]||path.join(process.env.TEMP,'quotacell-wo07-tools/ckb_v0.210.0_x86_64-pc-windows-msvc/ckb.exe');
assert.equal(crypto.createHash('sha256').update(await fs.readFile(exe)).digest('hex'),'77ff953e9dc3a03b36e38a3cab2b9b06f17be8254a15a23afa826c2d4aea98b0');
await fs.mkdir(run,{recursive:false});
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const provider=(await build({entryPoints:[path.join(here,'wallet_sim_provider.mjs')],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
const pages=[];const publicKeys=[];const privateKeys=[];
for(let i=0;i<3;i++){const page=await browser.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto('about:blank');await page.evaluate(()=>window.name=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''));const seeded="window.__testKey='0x'+window.name;"+provider;await page.evaluate(seeded);privateKeys.push(await page.evaluate(()=>window.name));publicKeys.push(await page.evaluate(()=>window.testWallet.publicKey));await page.addInitScript({content:seeded});pages.push(page);}
const publicKey=publicKeys[0];
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',CKB=100000000n;
const key=()=>new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]}), '0x'+crypto.randomBytes(32).toString('hex'));
const bootstrap=key(),other=[key(),key(),key(),key()];const lock=p=>c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(Buffer.from(p.slice(2),'hex')).slice(0,42)});
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n};const rpcPort=await port(),p2pPort=await port();
const cmd=(args)=>{const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};
cmd(['-C',run,'init','--chain','dev','--ba-arg',lock(bootstrap.publicKey).args,'--rpc-port',String(rpcPort),'--p2p-port',String(p2pPort)]);
const spec=path.join(run,'specs/dev.toml');let text=await fs.readFile(spec,'utf8');const issued=`[[genesis.issued_cells]]\ncapacity = ${1000000n*CKB}\nlock.code_hash = "${K}"\nlock.args = "${lock(bootstrap.publicKey).args}"\nlock.hash_type = "type"\n`;text=text.slice(0,text.indexOf('# Burn'))+issued+'\n'+text.slice(text.indexOf('[params]'));await fs.writeFile(spec,text);
const config=path.join(run,'ckb.toml');text=await fs.readFile(config,'utf8');text=text.replace(/^listen_addresses = .*$/m,`listen_addresses = ["/ip4/127.0.0.1/tcp/${p2pPort}"]`).replace(/^max_outbound_peers = .*$/m,'max_outbound_peers = 0').replace(/^discovery_local_address = .*$/m,'discovery_local_address = false').replace(/^modules = .*$/m,'modules = ["Net", "Pool", "Miner", "Chain", "Stats", "Experiment", "IntegrationTest", "Indexer"]');assert.match(text,/^bootnodes = \[\]/m);await fs.writeFile(config,text);
 let frontend,remoteFrontend,remoteApp;let node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});const url=`http://127.0.0.1:${rpcPort}`;let id=0;
 async function rpc(method,params=[]){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(10000)});const x=await r.json();if(x.error)throw Object.assign(new Error(JSON.stringify(x.error)),{rpc:x.error});return x.result;}
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

 if (process.env.QUOTACELL_BROWSER_VM_ONLY === '1') {
   const { qualifyBrowserBuilders } = await import('./browser_owner_vm.mjs');
   await qualifyBrowserBuilders({ rpc, live, commit, raw, deps, client, deployed, privateKeys, other, CKB, url, genesis: genesis.header.hash, browser, provider });
 } else {
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
   const frontendPort=await port(),frontendURL=`http://127.0.0.1:${frontendPort}`;
   let frontendOutput='';
   frontend=spawn(process.execPath,[path.resolve(here,'../../frontend/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(frontendPort),'--strictPort'],{cwd:path.resolve(here,'../../frontend'),stdio:['ignore','pipe','pipe'],env:{...process.env,QUOTACELL_BACKEND_URL:appURL},windowsHide:true});
   frontend.stdout.on('data',b=>frontendOutput+=b);frontend.stderr.on('data',b=>frontendOutput+=b);
   const reactPage=await browser.newPage();
   for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw Error(frontendOutput);try{const response=await fetch(frontendURL+'/api/state');if(response.ok)break;}catch{}await sleep(100);}
   await reactPage.goto(frontendURL+'/app');await reactPage.getByRole('heading',{name:'Create a shared Pocket'}).waitFor();
   const liveEmpty=await (await reactPage.request.get(frontendURL+'/api/state')).json();assert.equal(liveEmpty.empty,true,'React must use the live backend state');
   assert.equal(await reactPage.locator('iframe').count(),0,'React must not embed the legacy interface');
   assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'React empty page overflows its viewport');
   await reactPage.screenshot({path:path.join(run,'react-empty.png'),fullPage:true});
   await reactPage.setViewportSize({width:320,height:760});assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'React empty page overflows at 320px');await reactPage.screenshot({path:path.join(run,'react-empty-320.png'),fullPage:true});
   await reactPage.locator('.language-control select').selectOption('zh-Hans');await reactPage.getByRole('heading',{name:'创建共享 Pocket'}).waitFor();assert.equal(await reactPage.evaluate(()=>document.documentElement.lang),'zh-CN');assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Chinese React empty page overflows at 320px');await reactPage.screenshot({path:path.join(run,'react-empty-zh-320.png'),fullPage:true});
   await reactPage.locator('.language-control select').selectOption('en');await reactPage.setViewportSize({width:1280,height:840});await reactPage.getByRole('button',{name:/Create Pocket/}).click();await reactPage.getByRole('heading',{name:'Connect the three people'}).waitFor();
   assert.equal(await reactPage.locator('iframe').count(),0,'The native onboarding must not embed the legacy page');
   await reactPage.screenshot({path:path.join(run,'react-onboarding.png'),fullPage:true});
   await reactPage.locator('.language-control select').selectOption('zh-Hans');await reactPage.getByRole('heading',{name:'连接三位参与者'}).waitFor();await reactPage.screenshot({path:path.join(run,'react-onboarding-zh.png'),fullPage:true});for(const width of [320,390]){await reactPage.setViewportSize({width,height:844});assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Chinese onboarding overflows at ${width}px`);await reactPage.screenshot({path:path.join(run,`react-onboarding-zh-${width}.png`),fullPage:true});}await reactPage.setViewportSize({width:1280,height:840});await reactPage.locator('.language-control select').selectOption('en');
   const fallbackPage=await browser.newPage();await fallbackPage.goto(frontendURL+'/legacy');assert.equal(await fallbackPage.title(),'Working Pocket','Legacy HTML must remain directly available through Vite');
    const ownerSecret=privateKeys[0];
   await reactPage.addInitScript({content:`window.__testKey='0x${ownerSecret}';window.__otherTestKey=${JSON.stringify(other[0].privateKey)};${provider}`});
   await reactPage.reload();await reactPage.getByRole('button',{name:/Create Pocket/}).waitFor();await reactPage.getByRole('button',{name:/Create Pocket/}).click();
   const connectReactParticipant=async(index,privateKey)=>{await reactPage.evaluate(key=>window.switchTestWallet(key),privateKey);const row=reactPage.locator('.person-row').nth(index);await row.locator('.connect-participant').click();const picker=reactPage.locator('ccc-connector');await picker.getByText('UTXO Global Wallet',{exact:true}).click();await picker.getByText('CKB',{exact:true}).click();try{await row.locator('.registered-address').waitFor({timeout:15000});}catch(error){console.log('React wallet registration diagnostic:',await reactPage.locator('body').innerText());await reactPage.screenshot({path:path.join(run,`react-wallet-error-${index}.png`),fullPage:true});throw error;}};
    await connectReactParticipant(0,privateKeys[0]);assert.equal(await reactPage.locator('.person-row').nth(0).locator('.participant-inspector code').textContent(),publicKeys[0],'Creator owner registration must match the owner browser context');
   const exportedProfiles=[];
   for(const page of pages.slice(1)){
    await page.goto(frontendURL+'/app');await page.getByRole('button',{name:'Connect wallet'}).click();const picker=page.locator('ccc-connector');await picker.getByText('UTXO Global Wallet',{exact:true}).click();await picker.getByText('CKB',{exact:true}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export profile'}).click()]);
    const profile=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(profile.format,'quotacell-registration');assert.equal(profile.version,1);assert.equal(profile.network,'ckb_testnet');assert.equal(profile.publicKey,await page.evaluate(()=>window.testWallet.publicKey));assert(!JSON.stringify(profile).match(/privateKey|seedPhrase|mnemonic/i));exportedProfiles.push(profile);
   }
   for(const [index,slot] of ['alice','ben'].entries()){
    const selector=reactPage.getByLabel('Register profile for');await selector.selectOption(slot);const field=reactPage.locator('textarea');
    if(index===0){await field.fill(JSON.stringify({...exportedProfiles[index],network:'ckb_mainnet'}));await reactPage.getByRole('button',{name:'Validate and import'}).click();await reactPage.getByRole('alert').waitFor();assert.equal(await reactPage.locator('.person-row').nth(1).locator('.registered-address').count(),0,'Wrong-network profile must not register');}
    await field.fill(JSON.stringify(exportedProfiles[index]));await reactPage.getByRole('button',{name:'Validate and import'}).click();await reactPage.locator('.person-row').nth(index+1).locator('.registered-address').waitFor();
    assert.equal(await reactPage.locator('.person-row').nth(index+1).locator('.participant-inspector code').textContent(),exportedProfiles[index].publicKey);
   }
   for(const [index,name] of ['Timo','Operations','Research'].entries())await reactPage.locator('.person-row').nth(index).locator('input').first().fill(name);
   await reactPage.getByRole('button',{name:'Continue'}).click();await reactPage.getByRole('heading',{name:'Choose shared spending rules'}).waitFor();await reactPage.locator('.language-control select').selectOption('zh-Hans');await reactPage.getByRole('button',{name:'继续'}).click();assert.match(await reactPage.getByRole('alert').innerText(),/请输入有效的 CKB 金额/,'Invalid CKB amounts must be explained in Simplified Chinese');await reactPage.locator('.language-control select').selectOption('en');
   const recipients=[0,1].map(i=>c.Address.fromScript(lock(other[i].publicKey),new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]})).toString());
   await reactPage.locator('.shared-field input').fill('122');
   for(let i=0;i<2;i++){const fields=reactPage.locator('.rule-section').nth(i).locator('input');await fields.nth(0).fill('122');await fields.nth(1).fill('61');await fields.nth(2).fill(recipients[i]);}
   await reactPage.getByRole('button',{name:'Continue'}).click();await reactPage.getByRole('heading',{name:'Review Pocket rules'}).waitFor();
   await reactPage.screenshot({path:path.join(run,'react-create-review.png'),fullPage:true});
   await reactPage.getByRole('button',{name:/Create and review in wallet/}).click();try{await reactPage.getByRole('heading',{name:'Review transaction'}).waitFor({timeout:30000});}catch(error){console.log('React genesis prepare diagnostic:',await reactPage.locator('body').innerText());await reactPage.screenshot({path:path.join(run,'react-create-error.png'),fullPage:true});throw error;}
   assert(await reactPage.getByText('Network fee').count(),'Creation review must display the backend fee');await reactPage.screenshot({path:path.join(run,'react-transaction-review.png'),fullPage:true});for(const width of [320,390]){await reactPage.setViewportSize({width,height:844});assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`React creation transaction review overflows at ${width}px`);await reactPage.screenshot({path:path.join(run,`react-transaction-review-${width}.png`),fullPage:true});}await reactPage.setViewportSize({width:1280,height:840});
   assert.equal(await reactPage.evaluate(()=>window.testWallet.publicKey),publicKeys[0]);
   const signButton=reactPage.getByRole('button',{name:/Continue to wallet/});await signButton.waitFor({state:'visible'});await signButton.click();
    let createdState;for(let i=0;i<450;i++){try{const response=await fetch(appURL+'/api/state',{headers:{'cache-control':'no-cache'}});createdState=await response.json();if(response.ok&&createdState.owner===publicKeys[0]&&createdState.pocket)break;}catch{}await sleep(100);}assert.equal(createdState?.owner,publicKeys[0],JSON.stringify(createdState));
    const actorResponse=await fetch(`${appURL}/api/state?actor=${publicKeys[0]}`,{headers:{'cache-control':'no-cache'}}),actorView=await actorResponse.json();assert.equal(actorResponse.status,200,JSON.stringify(actorView));assert.equal(actorView.owner,publicKeys[0],'An initialized runtime must resolve the connected owner to its verified Pocket role');assert.equal(actorView.pocket,createdState.pocket,'The actor role must remain bound to the exact current Pocket');
   if(await reactPage.locator('.connected-account strong').innerText()!=='Pocket owner'){await reactPage.locator('.disconnect-button').click();await reactPage.getByRole('button',{name:'Connect wallet'}).click();const ownerPicker=reactPage.locator('ccc-connector');await ownerPicker.getByText('UTXO Global Wallet',{exact:true}).click();await ownerPicker.getByText('CKB',{exact:true}).click();await reactPage.locator('.connected-account strong').filter({hasText:'Pocket owner'}).waitFor();}
   await reactPage.locator('.permission-row').nth(1).waitFor({timeout:10000}).catch(async error=>{const diagnostic=await reactPage.evaluate(async()=>({wallet:window.testWallet?.publicKey,body:document.body.innerText,connected:document.querySelector('.connected-account strong')?.textContent,state:await (await fetch('/api/state')).json()}));console.log('React owner rendering diagnostic:',JSON.stringify(diagnostic));await reactPage.screenshot({path:path.join(run,'react-owner-render-error.png'),fullPage:true});throw error;});assert.equal(await reactPage.locator('.permission-row').count(),2,'Owner must see both independent delegate permissions');assert.equal(await reactPage.locator('iframe').count(),0);
   await reactPage.getByText('Operations',{exact:true}).first().waitFor();await reactPage.screenshot({path:path.join(run,'react-owner-created.png'),fullPage:true});console.log('React native onboarding, 3 wallet registrations, server-built creation, wallet signing, and live owner state PASS');
   await reactPage.locator('.revoke-button').first().click();await reactPage.locator('.dialog-content').waitFor();
    await reactPage.route('**/api/state*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Stale indexed cell'})}));
   await reactPage.evaluate(()=>document.querySelector('.refresh-button').click());
   await reactPage.getByText('Live Pocket status could not be refreshed.',{exact:false}).waitFor();
   assert.equal(await reactPage.locator('.dialog-content').count(),1,'A transient state refresh must not replace the open transaction dialog');
   assert.equal(await reactPage.locator('.metrics').count(),1,'The last validated Pocket view must remain visible during a refresh failure');
   assert.equal(await reactPage.locator('.load-error').count(),0,'A transient refresh failure must not show a false full-page Cell error');
   assert.equal(await reactPage.locator('.revoke-button:not(:disabled)').count(),0,'Owner actions must pause while the displayed Pocket state is stale');
    await reactPage.unroute('**/api/state*');await reactPage.evaluate(()=>document.querySelector('.refresh-button').click());
   await reactPage.getByText('Live Pocket status could not be refreshed.',{exact:false}).waitFor({state:'detached'});
   await reactPage.keyboard.press('Escape');
   console.log('React retains the last verified Pocket during transient refresh errors and pauses new actions PASS');
  for(const p of pages){await p.goto(appURL);await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();await p.waitForFunction(()=>document.querySelector('#walletStatus').textContent.includes('Connected:'));}
  const terms={sharedLimit:String(122n*CKB),delegates:publicKeys.slice(1).map((publicKey,i)=>({publicKey,recipient:JSON.parse(JSON.stringify(lock(other[i].publicKey))),limit:String(122n*CKB),perPayment:String(61n*CKB)}))};
  const ownerPage=pages[0];await ownerPage.screenshot({path:path.join(run,'empty.png'),fullPage:true});
  const committed=async p=>{await p.waitForFunction(()=>/^committed:/.test(document.querySelector('#status').textContent),null,{timeout:45000}).catch(async e=>{throw Error(await p.locator('#status').innerText());});console.log(await p.locator('#status').innerText());};
  const reactScreenshot=async(name,width=1280)=>{await reactPage.setViewportSize({width,height:840});await reactPage.locator('.refresh-button').click();await reactPage.waitForSelector('.metrics');await reactPage.waitForTimeout(150);assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`React ${name} page overflows at ${width}px`);await reactPage.screenshot({path:path.join(run,`react-${name}${width<600?`-${width}`:''}.png`),fullPage:true});};
  const revokedVmCheck=async(role,delegate)=>{
   const descriptor=JSON.parse(await fs.readFile(path.join(run,'pocket.json')));
   const discovered=await discoverPolicy({rpc,policy:descriptor.initial.Q,expected:descriptor.initial.expected});
   const policy=await live(point(discovered.outPoint.tx_hash,Number(BigInt(discovered.outPoint.index))));
   const spoofed=structuredClone(policy),stateBytes=Buffer.from(spoofed.cell.data.content.slice(2),'hex');
   stateBytes[7]|=1<<delegate;stateBytes.fill(0,24,40);stateBytes.fill(0,280,296);stateBytes.fill(0,434,450);spoofed.cell.data.content='0x'+stateBytes.toString('hex');
   const actorMatches=await discoverPlainCells({rpc,lock:descriptor.actors[role].lock,includeUnsupported:true});assert(actorMatches.cells.length>0,`${role} seed cell missing`);
   const actorCandidate=actorMatches.cells.find(x=>BigInt(x.cell.output.capacity)>=6100000000n);assert(actorCandidate,`${role} seed cell too small`);
   const actor=await live(point(actorCandidate.outPoint.tx_hash,Number(BigInt(actorCandidate.outPoint.index))));
   const fundMatches=await discoverPlainCells({rpc,lock:descriptor.initial.F,includeUnsupported:true});assert(fundMatches.cells.length>0,'Supported Pocket fund missing');
   const funds=await Promise.all(fundMatches.cells.map(x=>live(point(x.outPoint.tx_hash,Number(BigInt(x.outPoint.index))))));
   const transaction=buildPayment({policy:spoofed,actor,funds,deps,delegate,amount:61n*CKB,fee:2000n});
   const browserKey=privateKeys[delegate+1],signer=new c.SignerCkbPrivateKey(client,'0x'+browserKey),signed=await signer.signOnlyTransaction(transaction);
   let failure;try{await rpc('dry_run_transaction',[raw(signed)]);}catch(error){failure=error;}
   assert(failure?.rpc,`${role} revoked payment unexpectedly passed CKB VM dry-run`);
   const detail=JSON.stringify(failure.rpc);assert.match(detail,/TransactionFailedToVerify.*TransactionScriptError.*Inputs\[0\]\.Type.*ValidationFailure.*error code 17/i,`${role} rejection did not come from the Q type-script validation path: ${detail}`);assert.match(detail,/d03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e\.html#17/i,`${role} rejection did not name the deployed Q program error code: ${detail}`);
   console.log(`CKB-VM revoked ${role} payment rejected: ${detail}`);return {role,result:'REJECTED_BY_CKB_VM',rpcError:failure.rpc};
  };
  await ownerPage.waitForFunction(()=>document.querySelector('#creation').hidden,null,{timeout:20000});console.log('Legacy HTML observes Pocket created through React PASS');
  await reactPage.locator('.refresh-button').click();await reactPage.getByRole('button',{name:'Add funds'}).click();await reactPage.getByLabel('Amount to add (CKB)').fill('500');await reactPage.getByRole('button',{name:'Prepare transaction'}).click();await reactPage.getByRole('heading',{name:'Review transaction'}).waitFor();assert(await reactPage.getByText('Network fee').count(),'Owner funding review must show actual backend fee');await reactPage.keyboard.press('Escape');await reactPage.getByRole('button',{name:'Add funds'}).waitFor();console.log('React owner funding builder and safe review cancel PASS');
  for(let i=0;i<2;i++){await reactPage.locator('.permission-row').nth(i).getByRole('button',{name:'Revoke permission'}).click();await reactPage.getByRole('button',{name:'Prepare transaction'}).click();await reactPage.getByRole('heading',{name:'Review transaction'}).waitFor();assert(await reactPage.getByText('Network fee').count(),'Revocation review must show actual backend fee');assert(await reactPage.getByText(['Operations','Research'][i],{exact:true}).count(),`Revocation review must identify ${['Operations','Research'][i]} by local display name`);assert(await reactPage.getByText('Past payments cannot be reversed.',{exact:false}).count(),'Revocation review must explain the effect');await reactPage.keyboard.press('Escape');}console.log('React independent owner revocation builders PASS');
  await ownerPage.locator('#depositAmount').fill('500');
  await ownerPage.locator('#status').evaluate(e=>e.textContent='');await ownerPage.locator('#deposit').click();await committed(ownerPage);
  await ownerPage.locator('#depositAmount').fill('73');await ownerPage.locator('#status').evaluate(e=>e.textContent='');await ownerPage.locator('#deposit').click();await committed(ownerPage);console.log('additional owner deposit PASS');
  const firstDescriptor=JSON.parse(await fs.readFile(path.join(run,'pocket.json'))),ownerInputCell=(await discoverPlainCells({rpc,lock:firstDescriptor.actors.owner.lock})).cells.find(x=>BigInt(x.cell.output.capacity)>=661n*CKB+2000n);assert(ownerInputCell,'Second disposable Pocket owner input missing');
  const secondPocket=buildGenesis({ownerPublicKey:firstDescriptor.actors.owner.publicKey,delegates:firstDescriptor.initial.expected.delegates,sharedLimit:firstDescriptor.initial.expected.sharedLimit,ownerInput:await live(point(ownerInputCell.outPoint.tx_hash,Number(BigInt(ownerInputCell.outPoint.index)))),deps,fee:2000n});
   const ownerPrivateKey='0x'+privateKeys[0],ownerSigner=new c.SignerCkbPrivateKey(client,ownerPrivateKey);assert.equal(ownerSigner.publicKey,firstDescriptor.actors.owner.publicKey,'Captured owner key must match the creation profile');const secondGenesisSigned=await ownerSigner.signOnlyTransaction(secondPocket.transaction);await commit(secondGenesisSigned);
  const secondFundLock=c.Script.from({codeHash:hashes[1],hashType:'data1',args:secondPocket.policy.hash()}),aliceInputCell=(await discoverPlainCells({rpc,lock:firstDescriptor.actors.alice.lock})).cells.find(x=>BigInt(x.cell.output.capacity)>=561n*CKB+2000n);assert(aliceInputCell,'Second Pocket contributor input missing');
   const aliceInput=await live(point(aliceInputCell.outPoint.tx_hash,Number(BigInt(aliceInputCell.outPoint.index)))),alicePrivateKey='0x'+privateKeys[1],aliceSigner=new c.SignerCkbPrivateKey(client,alicePrivateKey);assert.equal(aliceSigner.publicKey,firstDescriptor.actors.alice.publicKey,'Captured delegate key must match the imported registration profile');assert.equal(aliceInput.cell.output.lock.args,firstDescriptor.actors.alice.lock.args,'Selected seed input must belong to the registered delegate');
   const seedDeposit=c.Transaction.from({inputs:[{previousOutput:aliceInput.outPoint,since:0}],outputs:[{capacity:500n*CKB,lock:secondFundLock},{capacity:BigInt(aliceInput.cell.output.capacity)-500n*CKB-2000n,lock:c.Script.from(firstDescriptor.actors.alice.lock)}],outputsData:['0x','0x'],cellDeps:[kdep],headerDeps:[],witnesses:['0x']});seedDeposit.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});
  const secondFundSigned=await aliceSigner.signOnlyTransaction(seedDeposit);await commit(secondFundSigned);const secondPocketId=secondPocket.policy.hash();
  console.log(`Two active disposable Pockets available for ${publicKeys.length} distinct wallet identities: ${firstDescriptor.initial.Q.args} and ${secondPocket.policy.args}`);

  const remoteRun=path.join(run,'independent-clean-runtime');await fs.mkdir(remoteRun);await fs.mkdir(path.join(remoteRun,'evidence'));
  await fs.copyFile(path.join(run,'runtime.json'),path.join(remoteRun,'runtime.json'));await fs.copyFile(path.join(run,'deployment.json'),path.join(remoteRun,'deployment.json'));await fs.copyFile(path.join(run,'evidence/node-profile.json'),path.join(remoteRun,'evidence/node-profile.json'));
  assert.deepEqual((await fs.readdir(remoteRun)).sort(),['deployment.json','evidence','runtime.json']);
  for(const name of ['pocket.json','working-pocket.sqlite','keys','actors.json','context.json'])await assert.rejects(fs.access(path.join(remoteRun,name)),{code:'ENOENT'});
  const remotePort=await port(),remoteURL=`http://127.0.0.1:${remotePort}`;let remoteOutput='';
  remoteApp=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),remoteRun,String(remotePort)],{stdio:['ignore','pipe','pipe'],env:{...process.env,QUOTACELL_NETWORK:'isolated',QUOTACELL_DEV_SIGNER:'0',QUOTACELL_TEST_RPC_PROXY:''},windowsHide:true});remoteApp.stdout.on('data',b=>remoteOutput+=b);remoteApp.stderr.on('data',b=>remoteOutput+=b);
  let remoteEmpty;for(let i=0;i<100;i++){if(remoteApp.exitCode!==null)throw Error(remoteOutput);try{const response=await fetch(remoteURL+'/api/state');remoteEmpty=await response.json();if(response.ok)break;}catch{}await sleep(100);}
  assert.equal(remoteEmpty?.empty,true,remoteOutput);assert.equal(remoteEmpty.genesis,genesis.header.hash);assert.equal(remoteEmpty.developmentSigner,false);
  for(const name of ['pocket.json','keys','actors.json','context.json'])await assert.rejects(fs.access(path.join(remoteRun,name)),{code:'ENOENT'});
  console.log('Independent backend started from deployment identity only, with a new empty journal and no Pocket descriptor or owner files PASS');
  const remoteFrontendPort=await port(),remoteFrontendURL=`http://127.0.0.1:${remoteFrontendPort}`;let remoteFrontendOutput='';
  remoteFrontend=spawn(process.execPath,[path.resolve(here,'../../frontend/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(remoteFrontendPort),'--strictPort'],{cwd:path.resolve(here,'../../frontend'),stdio:['ignore','pipe','pipe'],env:{...process.env,QUOTACELL_BACKEND_URL:remoteURL},windowsHide:true});remoteFrontend.stdout.on('data',b=>remoteFrontendOutput+=b);remoteFrontend.stderr.on('data',b=>remoteFrontendOutput+=b);
  for(let i=0;i<100;i++){if(remoteFrontend.exitCode!==null)throw Error(remoteFrontendOutput);try{const response=await fetch(remoteFrontendURL);if(response.ok)break;}catch{}await sleep(100);}
  const remotePage=async(privateKey,link)=>{const page=await browser.newPage();page.on('dialog',dialog=>dialog.accept());await page.addInitScript({content:`window.__testKey=${JSON.stringify(privateKey)};${provider}`});await page.goto(remoteFrontendURL+(link?`/?pocket=${secondPocketId}`:''));await page.getByRole('banner').getByRole('button',{name:'Connect wallet'}).click();const picker=page.locator('ccc-connector');await picker.getByText('UTXO Global Wallet',{exact:true}).click();await picker.getByText('CKB',{exact:true}).click();await page.locator('.connected-account strong').waitFor();return page;};
  const chooser=await remotePage(ownerPrivateKey,false);await chooser.getByRole('heading',{name:'Pockets linked to this wallet'}).waitFor();assert.equal(await chooser.getByRole('button',{name:'Open Pocket'}).count(),2,'The owner must see both matching active Pockets');
   const remoteRoles=[],remotePrivateKeys=[ownerPrivateKey,alicePrivateKey,'0x'+privateKeys[2]];
  for(const [index,privateKey] of remotePrivateKeys.entries()){
    const page=await remotePage(privateKey,true),expectedRole=['Pocket owner','Delegate 1','Delegate 2'][index],publicKey=publicKeys[index];assert.equal(await page.evaluate(()=>window.testWallet.publicKey),publicKey,'The isolated browser must connect the intended actor identity');await page.waitForFunction(role=>document.querySelector('.connected-account strong')?.textContent===role,expectedRole,{timeout:10000});assert.equal(await page.locator('.connected-account strong').innerText(),expectedRole);
   const roleName=['owner','alice','ben'][index],state=await page.evaluate(async({pocket})=>{const key=window.testWallet.publicKey,response=await fetch(`/api/state?pocket=${pocket}&actor=${key}`);return {status:response.status,state:await response.json()};},{pocket:secondPocketId});
    assert.equal(state.status,200,JSON.stringify(state.state));assert.equal(state.state.pocket,secondPocketId);assert.equal(state.state.policyOutpoint.txHash,secondGenesisSigned.hash());assert.equal(BigInt(state.state.policyCapacity),600n*CKB);assert.equal(state.state.fundShannons,String(500n*CKB));assert.equal(state.state.sharedLimit,String(122n*CKB));assert.equal(state.state.sharedUsed,'0');assert.equal(state.state.history.length,0,'Fresh runtime must not invent an owner journal');
    if(index===0){assert.equal(state.state.owner,publicKey);assert(await page.getByRole('button',{name:'Add funds'}).count(),'Owner link must expose the owner workflow');const wrongOwner=await page.evaluate(async({pocket,actor})=>{const response=await fetch(`/api/state?pocket=${pocket}&actor=${actor}`);return {status:response.status,body:await response.json()};},{pocket:secondPocketId,actor:other[0].publicKey});assert.equal(wrongOwner.status,400);assert.match(wrongOwner.body.error,/not authorized/);}
   else {assert.equal(state.state.delegates[index-1].publicKey,publicKey);await page.locator('.delegate-focus').waitFor();assert.equal(await page.locator('.delegate-focus h2').innerText(),`Delegate ${index}`);assert(await page.getByRole('button',{name:'Pay'}).count(),'Delegate link must expose the payment workflow');}
   remoteRoles.push({page,role:roleName,state:state.state});
  }
  const noMatch=await fetch(`${remoteURL}/api/state?actor=${other[0].publicKey}`);assert.equal(noMatch.status,200);assert.equal((await noMatch.json()).empty,true,'Unrelated wallet must find no authorized Pocket');
  const unknownLink=await fetch(`${remoteURL}/api/state?pocket=${secondPocketId}&actor=${other[0].publicKey}`);assert.equal(unknownLink.status,400);assert.match((await unknownLink.json()).error,/not authorized/);
  for(const index of [1,2]){
   const role=['alice','ben'][index-1],recipient=firstDescriptor.initial.expected.delegates[index-1].recipient.args;
   const prepared=await remoteRoles[index].page.evaluate(async({role,recipient})=>{const publicKey=window.testWallet.publicKey,response=await fetch('/api/external/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),publicKey,role,amount:'61',recipient})});return {status:response.status,body:await response.json()};},{role,recipient});
   assert.equal(prepared.status,200,JSON.stringify(prepared.body));const tx=c.Transaction.fromBytes(prepared.body.transaction);assert.equal(tx.inputs[0].previousOutput.txHash,secondGenesisSigned.hash());assert.equal(tx.outputs[0].type.args,secondPocket.policy.args);assert.equal(BigInt(tx.outputs[2].capacity),61n*CKB);assert(BigInt(prepared.body.fee)>0n&&BigInt(prepared.body.fee)<=1000000n);
   const roleLock=firstDescriptor.actors[role].lock,actorCell=(await discoverPlainCells({rpc,lock:roleLock})).cells.find(x=>BigInt(x.cell.output.capacity)>=61n*CKB);assert(actorCell);assert.equal(tx.inputs[1].previousOutput.txHash,actorCell.outPoint.tx_hash);assert.equal(Number(tx.inputs[1].previousOutput.index),Number(BigInt(actorCell.outPoint.index)));
    const currentFunds=(await discoverPlainCells({rpc,lock:secondFundLock})).cells;assert.equal(tx.inputs.length,2+currentFunds.length);for(const input of tx.inputs.slice(2))assert(currentFunds.some(cell=>cell.outPoint.tx_hash===input.previousOutput.txHash&&Number(BigInt(cell.outPoint.index))===Number(input.previousOutput.index)),`Prepared payment must use current policy-bound fund Cells: ${JSON.stringify({input:input.previousOutput,currentFunds:currentFunds.map(cell=>cell.outPoint)},(_,value)=>typeof value==='bigint'?value.toString():value)}`);
   assert.equal(BigInt(tx.outputs[1].capacity),439n*CKB);assert.equal(Buffer.from(tx.outputsData[0].slice(2),'hex').length,466);remoteRoles[index].prepared={...prepared.body,transactionObject:tx};
    const wrong=await remoteRoles[index].page.evaluate(async({recipient,role,publicKey})=>{const response=await fetch('/api/external/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),publicKey,role,amount:'61',recipient})});return {status:response.status,body:await response.json()};},{recipient,role,publicKey:other[0].publicKey});assert.equal(wrong.status,400);assert.match(wrong.body.error,/selected delegate/);
  }
  const ownerPrepare=await remoteRoles[0].page.evaluate(async({publicKey})=>{const response=await fetch('/api/external/owner',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),publicKey,operation:'deposit',amount:'73'})});return {status:response.status,body:await response.json()};},{publicKey:publicKeys[0]});assert.equal(ownerPrepare.status,200,JSON.stringify(ownerPrepare.body));assert(BigInt(ownerPrepare.body.fee)>0n);
   const alicePrepared=remoteRoles[1].prepared,wrongSigner=new c.SignerCkbPrivateKey(client,'0x'+privateKeys[2]),wrongSigned=await wrongSigner.signOnlyTransaction(alicePrepared.transactionObject);
  const invalidSignature=await remoteRoles[1].page.evaluate(async({id,transaction})=>{const response=await fetch('/api/external/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,transaction})});return {status:response.status,body:await response.json()};},{id:alicePrepared.id,transaction:wrongSigned.toHex()});assert.equal(invalidSignature.status,400);assert.match(invalidSignature.body.error,/signature|public key|signer/i);
  const alicePage=remoteRoles[1].page;await alicePage.getByRole('button',{name:'Pay'}).click();await alicePage.getByLabel('Payment amount (CKB)').fill('61');await alicePage.getByRole('button',{name:'Review payment'}).click();await alicePage.getByRole('heading',{name:'Review transaction'}).waitFor();assert(await alicePage.getByText('Network fee').count());await alicePage.getByRole('button',{name:'Continue to wallet'}).click();
  let remoteCommitted;for(let i=0;i<80;i++){const response=await fetch(`${remoteURL}/api/state?pocket=${secondPocketId}&actor=${publicKeys[1]}`);if(response.ok){remoteCommitted=await response.json();if(remoteCommitted.sharedUsed===String(61n*CKB))break;}await sleep(100);}
  assert.equal(remoteCommitted.sharedUsed,String(61n*CKB));assert.equal(remoteCommitted.history.length,1);assert.equal(remoteCommitted.history[0].actor,publicKeys[1]);assert.equal(remoteCommitted.history[0].state,'committed');
  assert(await fs.access(path.join(remoteRun,'working-pocket.sqlite')).then(()=>true));console.log('Clean independent runtime discovered exact active identity by owner and both delegates, reconstructed current Cells and terms, rejected unrelated and wrong signers, and accepted one delegate-signed isolated payment PASS');
   const reactDelegatePage=await browser.newPage();await reactDelegatePage.addInitScript({content:`window.__testKey=${JSON.stringify(privateKeys[1])};window.__otherTestKey=${JSON.stringify(other[0].privateKey)};${provider}`});await reactDelegatePage.goto(frontendURL+'/app');await reactDelegatePage.getByRole('button',{name:'Connect wallet'}).click();const delegatePicker=reactDelegatePage.locator('ccc-connector');await delegatePicker.getByText('UTXO Global Wallet',{exact:true}).click();await delegatePicker.getByText('CKB',{exact:true}).click();await reactDelegatePage.locator('.delegate-focus').waitFor({timeout:15000});assert.equal(await reactDelegatePage.locator('.delegate-focus h2').innerText(),'Delegate 1');assert.equal(await reactDelegatePage.locator('iframe').count(),0);await reactDelegatePage.screenshot({path:path.join(run,'react-delegate-active.png'),fullPage:true});for(const width of [320,390]){await reactDelegatePage.setViewportSize({width,height:844});assert.equal(await reactDelegatePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`React delegate page overflows at ${width}px`);await reactDelegatePage.screenshot({path:path.join(run,`react-delegate-active-${width}.png`),fullPage:true});}await reactDelegatePage.setViewportSize({width:1280,height:840});
  await reactDelegatePage.getByRole('button',{name:'Pay'}).click();const paymentDialog=reactDelegatePage.getByRole('dialog');assert.equal(await paymentDialog.getAttribute('aria-modal'),'true','Payment action must be a modal dialog');for(let tab=0;tab<8;tab++){await reactDelegatePage.keyboard.press('Tab');assert(await paymentDialog.evaluate((dialog)=>dialog.contains(document.activeElement)),'Keyboard focus must remain inside the payment dialog');}await reactDelegatePage.getByLabel('Payment amount (CKB)').fill('61');await reactDelegatePage.getByRole('button',{name:'Review payment'}).click();await reactDelegatePage.getByRole('heading',{name:'Review transaction'}).waitFor();assert(await reactDelegatePage.getByText('Network fee').count(),'Delegate payment review must show actual backend fee');assert(await reactDelegatePage.getByText(recipients[0],{exact:true}).count(),'Delegate review must show the approved recipient address');assert(await reactDelegatePage.getByText('This payment reduces the delegate’s remaining limit and the shared allowance.',{exact:true}).count(),'Delegate review must explain the allowance impact');await reactDelegatePage.screenshot({path:path.join(run,'react-delegate-payment-review.png'),fullPage:true});for(const width of [320,390]){await reactDelegatePage.setViewportSize({width,height:844});assert.equal(await reactDelegatePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`React delegate payment review overflows at ${width}px`);await reactDelegatePage.screenshot({path:path.join(run,`react-delegate-payment-review-${width}.png`),fullPage:true});}await reactDelegatePage.keyboard.press('Escape');console.log('React delegate identity, payment preparation, recipient and fee review PASS');
  // Independent third-party deposit adds a second policy-bound fund Cell.
  const descriptorForExtra=JSON.parse(await fs.readFile(path.join(run,'pocket.json')));
  const thirdPartyInput=await live(point(deployed.hash(),6));
  const extra=c.Transaction.from({inputs:[{previousOutput:thirdPartyInput.outPoint,since:0}],outputs:[{capacity:100n*CKB,lock:c.Script.from(descriptorForExtra.initial.F)},{capacity:BigInt(thirdPartyInput.cell.output.capacity)-201n*CKB-200000n,lock:lock(bootstrap.publicKey)},{capacity:101n*CKB,lock:c.Script.from(descriptorForExtra.initial.F)}],outputsData:['0x','0x','0x01'],cellDeps:[kdep],headerDeps:[],witnesses:['0x']});
  extra.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});let extraSigned=await bs.signOnlyTransaction(extra);await commit(extraSigned);
  const twoFunds=await discoverPlainCells({rpc,lock:descriptorForExtra.initial.F,includeUnsupported:true});assert.equal(twoFunds.cells.length,3);assert.equal(twoFunds.unsupported.length,1);console.log('third-party extra fund PASS');

   const vmResults=[];
   for(const [i,p] of pages.slice(1).entries()){
   await p.reload();await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();
   await p.waitForFunction(role=>document.querySelector('#role').value===role,i?'ben':'alice');await p.locator('#amount').fill('61');
   const address=c.Address.fromScript(lock(other[i].publicKey),new c.ClientPublicTestnet({url:'http://127.0.0.1:1',fallbacks:[]})).toString();await p.locator('#to').fill(address);
   if(i===0){
    const rejected=async(mode,pattern)=>{await p.locator('#status').evaluate(e=>e.textContent='');await p.evaluate(mode=>window.testWallet.mode=mode,mode);await p.locator('#pay').click();await p.waitForFunction(pattern=>new RegExp(pattern).test(document.querySelector('#status').textContent),pattern,{timeout:20000});};
    await rejected('reject','Authorization rejected');await rejected('mutate','Wallet altered transaction fields');
    await p.evaluate(()=>{window.testWallet.mode='ok';window.testWallet.network='nervos'});await p.locator('#status').evaluate(e=>e.textContent='');await p.locator('#pay').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('wrong network'));
    await p.evaluate(()=>window.testWallet.network='nervos_testnet');await rejected('switch','Wallet.*changed|not the selected delegate');
    await p.reload();await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();await p.locator('#amount').fill('61');await p.locator('#to').fill(address);
    await rejected('disconnect','disconnected|changed');
    await p.reload();await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();await p.locator('#amount').fill('61');await p.locator('#to').fill(address);console.log('simulated wallet negative checks PASS');
   }
   await p.locator('#pay').click();await committed(p);
  }
  const sharedLimitVmCheck=async()=>{
   const descriptor=JSON.parse(await fs.readFile(path.join(run,'pocket.json')));
   const discovered=await discoverPolicy({rpc,policy:descriptor.initial.Q,expected:descriptor.initial.expected});
   const policy=await live(point(discovered.outPoint.tx_hash,Number(BigInt(discovered.outPoint.index))));
   const actual=Buffer.from(policy.cell.data.content.slice(2),'hex');
   const read128=(buffer,offset)=>buffer.readBigUInt64LE(offset)+(buffer.readBigUInt64LE(offset+8)<<64n);
   const write128=(buffer,offset,value)=>{buffer.writeBigUInt64LE(value&((1n<<64n)-1n),offset);buffer.writeBigUInt64LE(value>>64n,offset+8);};
   const amount=61n*CKB,sharedLimit=read128(actual,8),sharedUsed=read128(actual,24),aliceLimit=read128(actual,264),aliceUsed=read128(actual,280),benUsed=read128(actual,434);
   assert.equal(sharedLimit,122n*CKB,'The negative payment must use the public shared limit');
   assert.equal(sharedUsed,sharedLimit,'The negative payment must start with the shared allowance exhausted');
   assert.equal(aliceLimit,122n*CKB,'The negative payment must use the public personal limit');
   assert.equal(aliceUsed,61n*CKB,'Delegate 1 must retain one maximum payment personally');
   assert.equal(benUsed,61n*CKB,'Delegate 2 must retain one maximum payment personally');
   assert(aliceUsed+amount<=aliceLimit,'The negative payment must remain within Alice personal allowance');
   assert.equal(aliceUsed+amount,aliceLimit,'The negative payment must consume only Alice personal remainder');
   const actorMatches=await discoverPlainCells({rpc,lock:descriptor.actors.alice.lock,includeUnsupported:true});
   const actorCandidate=actorMatches.cells.find(cell=>BigInt(cell.cell.output.capacity)>=6100000000n);assert(actorCandidate,'Alice seed cell missing');
   const actor=await live(point(actorCandidate.outPoint.tx_hash,Number(BigInt(actorCandidate.outPoint.index))));
   const fundMatches=await discoverPlainCells({rpc,lock:descriptor.initial.F,includeUnsupported:true});
   const funds=await Promise.all(fundMatches.cells.map(cell=>live(point(cell.outPoint.tx_hash,Number(BigInt(cell.outPoint.index))))));
   const spoofed=structuredClone(policy),builderState=Buffer.from(actual);
   builderState.fill(0,24,40);builderState.fill(0,280,296);builderState.fill(0,434,450);spoofed.cell.data.content='0x'+builderState.toString('hex');
   const unsigned=buildPayment({policy:spoofed,actor,funds,deps,delegate:0,amount,fee:2000n});
   const overLimitState=Buffer.from(unsigned.outputsData[0].slice(2),'hex');
   write128(overLimitState,24,sharedUsed+amount);write128(overLimitState,280,aliceUsed+amount);write128(overLimitState,434,benUsed);
   unsigned.outputsData[0]='0x'+overLimitState.toString('hex');
   assert.equal(read128(overLimitState,280)+read128(overLimitState,434),read128(overLimitState,24));
   assert.equal(read128(overLimitState,24),sharedLimit+amount,'The signed output must exceed only the exhausted shared limit');
    const privateKey=privateKeys[1],signer=new c.SignerCkbPrivateKey(client,'0x'+privateKey),signed=await signer.signOnlyTransaction(unsigned);
   let failure;try{await rpc('dry_run_transaction',[raw(signed)]);}catch(error){failure=error;}
   assert(failure?.rpc,'Over-limit payment unexpectedly passed CKB-VM dry-run');
   const detail=JSON.stringify(failure.rpc);
   assert.match(detail,/TransactionFailedToVerify.*TransactionScriptError.*Inputs\[0\]\.Type.*ValidationFailure/i,`Shared-limit rejection did not come from Q type-script validation: ${detail}`);
   console.log(`CKB-VM shared allowance payment rejected without broadcast: ${detail}`);
   return {result:'REJECTED_BY_CKB_VM',rpcError:failure.rpc,sharedUsed:sharedUsed.toString(),sharedLimit:sharedLimit.toString(),aliceUsed:aliceUsed.toString(),aliceLimit:aliceLimit.toString(),benUsed:benUsed.toString(),attemptedAmount:amount.toString()};
  };
  const sharedLimitVmResult=await sharedLimitVmCheck();
const current=JSON.parse(await fs.readFile(path.join(run,'pocket.json')));const localIndexerRpc=async(method,params=[])=>method==='get_consensus'?{id:'ckb_testnet'}:method==='get_block_hash'&&params[0]==='0x0'?PUDGE_GENESIS:rpc(method,params);
  let indexed;for(let i=0;i<100;i++){try{indexed=await discoverIndexed({rpc:localIndexerRpc,policy:current.initial.Q,expected:current.initial.expected});break;}catch(e){if(!/lag or chain-tip mismatch/.test(e.message))throw e;await sleep(100);}}
  assert.equal(indexed?.cells.length,1);const indexFunds=await discoverIndexed({rpc:localIndexerRpc,lock:current.initial.F});assert.equal(indexFunds.cells.length,1);const indexOwner=await discoverIndexed({rpc:localIndexerRpc,lock:current.actors.owner.lock});assert(indexOwner.cells.length>=1);console.log('isolated node indexer discovery PASS');
  app.kill();await new Promise(r=>app.once('exit',r));node.kill();await new Promise(r=>node.once('exit',r));
  node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});
  for(let i=0;i<100;i++){try{await rpc('get_tip_header');break;}catch{}await sleep(100);}
  app=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(appPort)],{stdio:'ignore',env:{...process.env,QUOTACELL_DEV_SIGNER:'0'},windowsHide:true});
  let reopened;
  for(let i=0;i<100;i++){try{const response=await fetch(appURL+'/api/state');reopened=await response.json();if(response.ok)break;}catch{}await sleep(100);}
   assert.equal(reopened.closed,false);assert.equal(reopened.sharedUsed,String(122n*CKB));assert.equal(reopened.fundShannons,String(551n*CKB));console.log('active node/server restart PASS');await ownerPage.reload();await ownerPage.waitForFunction(()=>document.querySelector('#creation').hidden);await ownerPage.screenshot({path:path.join(run,'active.png'),fullPage:true});await ownerPage.setViewportSize({width:390,height:844});await ownerPage.screenshot({path:path.join(run,'narrow.png'),fullPage:true});await ownerPage.setViewportSize({width:1280,height:720});await reactScreenshot('active');await reactScreenshot('active',390);await reactScreenshot('active',320);
  await ownerPage.reload();await ownerPage.locator('#connectWallet').click();await ownerPage.getByText('UTXO Global Wallet',{exact:true}).first().click();await ownerPage.getByText('CKB',{exact:true}).first().click();
  for(const op of ['revoke','close','deposit','sweep']){ if(op==='close'||op==='sweep'){
    const input=await live(point(extraSigned.hash(),1));const additional=c.Transaction.from({inputs:[{previousOutput:input.outPoint,since:0}],outputs:[{capacity:100n*CKB,lock:c.Script.from(descriptorForExtra.initial.F)},{capacity:BigInt(input.cell.output.capacity)-100n*CKB-200000n,lock:lock(bootstrap.publicKey)}],outputsData:['0x','0x'],cellDeps:[kdep],headerDeps:[],witnesses:['0x']});additional.setWitnessArgs(0,{lock:'0x'+'00'.repeat(65)});extraSigned=await bs.signOnlyTransaction(additional);await commit(extraSigned);assert.equal((await discoverPlainCells({rpc,lock:descriptorForExtra.initial.F,includeUnsupported:true})).cells.length,2);
   } if(op==='close'||op==='sweep'){await reactPage.locator('.refresh-button').click();const actionName=op==='close'?'Close and recover':'Recover late deposit';await reactPage.getByRole('button',{name:actionName}).click();await reactPage.getByRole('button',{name:'Prepare transaction'}).click();await reactPage.getByRole('heading',{name:'Review transaction'}).waitFor();assert(await reactPage.getByText('Network fee').count(),`React ${op} review must display actual backend fee`);if(op==='close')assert(await reactPage.getByText('Closing sends the supported fund Cells to the owner.',{exact:false}).count(),'React close review must explain recovery consequences');for(const width of [320,390]){await reactPage.setViewportSize({width,height:844});assert.equal(await reactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`React ${op} review overflows at ${width}px`);await reactPage.screenshot({path:path.join(run,`react-${op}-review-${width}.png`),fullPage:true});}await reactPage.keyboard.press('Escape');await reactPage.setViewportSize({width:1280,height:840});console.log(`React ${op} review builder PASS`);}await ownerPage.locator('#status').evaluate(e=>e.textContent='');await ownerPage.evaluate(()=>window.refresh());await ownerPage.waitForFunction(id=>!document.querySelector('#'+id).disabled,op,{timeout:10000});await ownerPage.locator('#'+op).click();await committed(ownerPage);
   if(op==='revoke'){
    const denied=await pages[1].evaluate(async terms=>{const r=await fetch('/api/external/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),publicKey:terms.publicKey,role:'alice',amount:'61',recipient:terms.recipient.args})});return {status:r.status,body:await r.json()};},terms.delegates[0]);
     assert.equal(denied.status,400);assert.match(denied.body.error,/delegate disabled/);console.log('revoked delegate rejected by application PASS');vmResults.push(await revokedVmCheck('alice',0));
    await ownerPage.locator('#status').evaluate(e=>e.textContent='');await ownerPage.evaluate(()=>window.refresh());await ownerPage.waitForFunction(()=>!document.querySelector('#revokeBen').disabled,null,{timeout:10000}).catch(async error=>{console.log('Second revoke readiness diagnostic:',JSON.stringify(await (await fetch(appURL+'/api/state')).json()),JSON.stringify(await ownerPage.evaluate(()=>({role:window.quotaWalletRole,mode:document.querySelector('#signingMode').value,revoke:document.querySelector('#revoke').disabled,revokeBen:document.querySelector('#revokeBen').disabled,status:document.querySelector('#status').textContent}))),await ownerPage.locator('#status').innerText());throw error;});await ownerPage.locator('#revokeBen').click();await committed(ownerPage);
     const deniedBen=await pages[2].evaluate(async terms=>{const r=await fetch('/api/external/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),publicKey:terms.publicKey,role:'ben',amount:'61',recipient:terms.recipient.args})});return {status:r.status,body:await r.json()};},terms.delegates[1]);assert.equal(deniedBen.status,400);assert.match(deniedBen.body.error,/delegate disabled/);console.log('revoked Ben rejected by application PASS');vmResults.push(await revokedVmCheck('ben',1));
   }
  }
  app.kill();await new Promise(r=>app.once('exit',r));node.kill();await new Promise(r=>node.once('exit',r));
  node=spawn(exe,['-C',run,'run'],{stdio:'ignore',windowsHide:true});
  for(let i=0;i<100;i++){try{await rpc('get_tip_header');break;}catch{}await sleep(100);}
  app=spawn(process.execPath,['--experimental-strip-types',path.join(here,'working_pocket_server.mjs'),run,String(appPort)],{stdio:'ignore',env:{...process.env,QUOTACELL_DEV_SIGNER:'0'},windowsHide:true});
  reopened=undefined;
  for(let i=0;i<100;i++){try{const response=await fetch(appURL+'/api/state');reopened=await response.json();if(response.ok)break;}catch{}await sleep(100);}
  assert.equal(reopened.closed,true,JSON.stringify(reopened));assert.equal(reopened.hasFund,false);assert.equal(reopened.sharedUsed,'0');assert.equal(reopened.history.length,10);
   await ownerPage.reload();await ownerPage.waitForFunction(()=>document.querySelector('#availability').textContent==='Closed');await ownerPage.screenshot({path:path.join(run,'closed.png'),fullPage:true});await reactScreenshot('closed');await reactScreenshot('closed',390);await reactScreenshot('closed',320);assert(await reactPage.locator('.allowance-metric').getByText('134 CKB',{exact:true}).count(),'Closed Pocket view must show retained terminal capacity as CKB, not a duplicate Closed card');assert.equal(await reactPage.locator('a[href="/legacy"]').count(),0,'The React UI must not expose the legacy fallback link');await reactPage.getByRole('button',{name:'Add late funds'}).click();await reactPage.getByRole('heading',{name:'Add late funds'}).waitFor();assert(await reactPage.getByText('This Pocket remains closed.',{exact:false}).count(),'Late-deposit review must explain that the Pocket stays closed');await reactPage.keyboard.press('Escape');
  for(const name of ['actors.json','context.json','keys'])await assert.rejects(fs.access(path.join(run,name)),{code:'ENOENT'});
   const evidence={result:'PASS',lifecycle:['creation','funding','alice payment','ben payment','shared-limit CKB-VM rejection','separate delegate revocations','application and CKB-VM negative tests','recovery','late deposit','sweep','node and server restart/reopen'],react:['empty onboarding','active role-aware view','closed recovery view','mobile overflow checks'],sharedAllowanceVm:sharedLimitVmResult,revokedPaymentVm:vmResults,genesis:state.genesis,pocket:reopened.pocket};await fs.writeFile(path.join(run,'evidence/wo14b-lifecycle.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));

 }finally{app.kill();}
 }
 }finally{await browser.close();remoteFrontend?.kill();remoteApp?.kill();frontend?.kill();node.kill();}
