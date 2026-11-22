// Run against vite preview on port 5195 with a recorded read-only RPC trace and an output directory.
const {chromium}=require('playwright'), assert=require('node:assert/strict'),fs=require('fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = path.resolve(__dirname, '../../frontend');
const requireFrontend = createRequire(path.join(frontend, 'package.json'));
const output = process.argv[3] || require('node:os').tmpdir();
const rows=JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter(r=>r.response?.result!=null);
const baseTip=rows.find(r=>r.method==='get_indexer_tip').response.result;
const canonical=rows.find(r=>r.method==='get_block_hash'&&r.params[0]===baseTip.block_number)?.response.result;
assert.equal(canonical,baseTip.block_hash);
const pocket='0x7b3d89c22431e061814fbe61cc09e6c888b44a7076b782a75c3f1612d1597cc0';
(async()=>{const b=await chromium.launch({channel:'chrome'});try{for(const width of [1250]){
const p=await b.newPage({viewport:{width,height:950}}),calls=[], errors=[];let failure=false,first,historyStart;
let outage = false;
let hold;
let entered;
const provider = await requireFrontend('esbuild').build({
  entryPoints: [path.join(__dirname, 'wallet_sim_provider.mjs')], bundle: true,
  platform: 'browser', format: 'iife', write: false, nodePaths: [path.join(frontend, 'node_modules')],
});
await p.addInitScript({ content: provider.outputFiles[0].text });
await p.addInitScript(() => {
  const schedule = window.setTimeout;
  window.__refreshTimers = [];
  window.setTimeout = (callback, delay, ...args) => {
    if (delay === 60000) {
      window.__refreshTimers.push(() => callback(...args));
      return 0;
    }
    return schedule(callback, delay, ...args);
  };
});
let tip = baseTip;
let relevant = false;
let nodeLag = 0n;
p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',async r=>{
if(r.request().url().startsWith('http://127.0.0.1:'))return r.continue();
if(!r.request().url().startsWith('https://testnet.ckb.dev/'))return r.abort();
let q;try{q=r.request().postDataJSON()}catch{return r.abort()}
if(!q?.method?.startsWith('get_'))return r.abort();
if (hold) { entered(); await hold; }
if(outage)return r.abort();
first??=Date.now(); const at=Date.now()-first;calls.push({at,method:q.method,params:q.params});
if(q.method==='get_transactions')historyStart??=at;
await new Promise(x=>setTimeout(x,400));
const lookup=fn=>rows.find(x=>x.method===q.method&&fn(x))?.response.result;
let result;
if(q.method==='get_indexer_tip')result=tip;
else if(q.method==='get_tip_header')result=nodeLag ? {number:'0x'+(BigInt(tip.block_number)+nodeLag).toString(16),hash:'0x'+'e'.repeat(64)} : {number:tip.block_number,hash:tip.block_hash};
else if(q.method==='get_transactions' && q.params[2]==='0x1') {
  result = { objects: relevant && q.params[0].script_type==='lock' ? [{io_type:'input'}] : [], last_cursor:'0x' };
}
else if(q.method==='get_block_hash' && nodeLag && BigInt(q.params[0])===BigInt(tip.block_number)+nodeLag) result='0x'+'e'.repeat(64);
else if(q.method==='get_block_hash' && q.params[0]===tip.block_number) result=tip.block_hash;
else if(q.method==='get_transactions' && q.params[0].filter.block_range[0]!=='0x0') result={objects:[],last_cursor:'0x'};
else if(q.method==='get_cells'||q.method==='get_transactions')result=lookup(x=>x.params[0].script_type===q.params[0].script_type);
else if(q.method==='get_live_cell')result=lookup(x=>x.params[0].tx_hash===q.params[0].tx_hash&&x.params[0].index===q.params[0].index);
else result=lookup(x=>JSON.stringify(x.params)===JSON.stringify(q.params));
if(failure&&q.method==='get_cells'&&q.params[0].script_type==='lock')return r.fulfill({status:503,json:{}});
await r.fulfill({json:{id:q.id,jsonrpc:'2.0',result}});
});
await p.goto('http://127.0.0.1:5196/app?pocket='+pocket);
await p.locator('.public-permissions').waitFor({timeout:22000});const policy=Date.now()-first;
await p.getByText('739 CKB',{exact:true}).first().waitFor({timeout:22000});const funds=Date.now()-first;
await p.getByText(/Payment \u00b7 61 CKB/).first().waitFor({timeout:22000});const history=Date.now()-first;
assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await p.screenshot({path:output+'/04-'+width+'.png',fullPage:true});
const refreshRuns = {};
const refresh = p.getByRole('button', {name:'Refresh', exact:true}).first();
const policyDetails = async () => (await p.locator('.public-permissions').innerText())
  .split('\n').filter(line => !/Potential payment upper bound|A payment needs/.test(line)).join('\n').trim();
const details = await policyDetails();
const historyRows = await p.locator('.history-list').innerText();
async function stale() {
  await p.getByText(/Pudge is temporarily unavailable/).waitFor();
  const balance = p.getByRole('heading', {name:'Last verified protected balance'}).locator('..');
  assert.match(await balance.innerText(), /739 CKB/);
  assert((await balance.innerText()).includes(BigInt(baseTip.block_number).toString()));
  assert.equal(await policyDetails(), details);
  assert(await p.getByText('261 used of 600 CKB', {exact:true}).isVisible());
  assert.equal(await p.locator('.history-list').innerText(), historyRows);
  assert.equal(await p.locator('.pay-button, .owner-actions button:enabled').count(), 0);
  assert(await refresh.isEnabled());
}
outage = true;
await refresh.click();
await stale();
console.log('PASS manual outage');
outage = false;
await refresh.click();
await p.getByRole('heading', {name:'Protected balance', exact:true}).waitFor();
assert.equal(await p.getByText(/showing the last verified state/i).count(), 0);
console.log('PASS successful recovery');
outage = true;
await p.evaluate(() => window.__refreshTimers.shift()());
await stale();
console.log('PASS scheduled outage');
await p.evaluate(() => {
  history.pushState(null, '', '/app?pocket=0x' + 'ef'.repeat(32));
  dispatchEvent(new PopStateEvent('popstate'));
});
await p.getByRole('button', {name:'Try again', exact:true}).waitFor();
assert.equal(await p.locator('.public-permissions, .history-list').count(), 0);
assert.equal(await p.getByText('739 CKB', {exact:true}).count(), 0);
console.log('PASS switch during outage');
await p.reload();
await p.getByRole('button', {name:'Try again', exact:true}).waitFor();
assert.equal(await p.getByRole('heading', {name:'Last verified protected balance'}).count(), 0);
assert.equal(await p.locator('.public-permissions').count(), 0);
console.log('PASS cold outage');
outage = false;
await p.goto('http://127.0.0.1:5196/app?pocket=' + pocket);
await p.getByText('739 CKB', {exact:true}).first().waitFor();
let release;
const started = new Promise(resolve => { entered = resolve; });
hold = new Promise(resolve => { release = resolve; });
await refresh.click();
await started;
await p.locator('.connect-button').click();
await p.locator('ccc-connector').getByText('UTXO Global Wallet', {exact:true}).first().click();
await p.locator('ccc-connector').getByText('CKB', {exact:true}).first().click();
await p.locator('.connected-account').waitFor();
assert.equal(await p.locator('.public-permissions, .history-list').count(), 0);
outage = true;
hold = undefined;
release();
await p.getByRole('button', {name:'Try again', exact:true}).waitFor();
assert.equal(await p.getByText('739 CKB', {exact:true}).count(), 0);
assert.equal(await p.locator('.public-permissions, .history-list, .pay-button, .owner-actions button:enabled').count(), 0);
console.log('PASS actor change during read');
fs.writeFileSync(output+'/04-'+width+'.json',JSON.stringify({policy,funds,history,historyStart,calls,errors,refreshRuns,queue:await p.evaluate(()=>performance.getEntriesByType('measure').filter(x=>x.name.startsWith('quotacell.queue.')).map(x=>[x.name,x.duration]))},null,2));console.log({width,policy,funds,history,historyStart,count:calls.length,errors});await p.close();
}}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
