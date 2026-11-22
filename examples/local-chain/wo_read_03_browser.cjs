// Run against vite preview on port 5195 with a recorded read-only RPC trace and an output directory.
const {chromium}=require('playwright'), assert=require('node:assert/strict'),fs=require('fs');
const output = process.argv[3] || require('node:os').tmpdir();
const rows=JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter(r=>r.response?.result!=null);
const baseTip=rows.find(r=>r.method==='get_indexer_tip').response.result;
const canonical=rows.find(r=>r.method==='get_block_hash'&&r.params[0]===baseTip.block_number)?.response.result;
assert.equal(canonical,baseTip.block_hash);
const pocket='0x7b3d89c22431e061814fbe61cc09e6c888b44a7076b782a75c3f1612d1597cc0';
(async()=>{const b=await chromium.launch({channel:'chrome'});try{for(const width of [1250,390]){
const p=await b.newPage({viewport:{width,height:950}}),calls=[], errors=[];let failure=false,first,historyStart;
let tip = baseTip;
let relevant = false;
let nodeLag = 0n;
p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',async r=>{
if(r.request().url().startsWith('http://127.0.0.1:'))return r.continue();
if(!r.request().url().startsWith('https://testnet.ckb.dev/'))return r.abort();
let q;try{q=r.request().postDataJSON()}catch{return r.abort()}
if(!q?.method?.startsWith('get_'))return r.abort();
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
await p.goto('http://127.0.0.1:5195/app?pocket='+pocket);
await p.locator('.public-permissions').waitFor({timeout:22000});const policy=Date.now()-first;
await p.getByText('739 CKB',{exact:true}).first().waitFor({timeout:22000});const funds=Date.now()-first;
await p.getByText(/Payment \u00b7 61 CKB/).first().waitFor({timeout:22000});const history=Date.now()-first;
assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await p.screenshot({path:output+'/04-'+width+'.png',fullPage:true});
const refreshRuns = {};
async function refresh(name) {
  const start = Date.now();
  const offset = calls.length;
  const button = p.getByRole('button',{name:'Refresh',exact:true}).first();
  await button.click();
  await button.waitFor({timeout:15000});
  await p.getByRole('heading', { name: 'Protected balance', exact: true }).waitFor({timeout:15000});
  return refreshRuns[name] = { ms: Date.now()-start, calls: calls.slice(offset) };
}
if(width===1250){
  assert.deepEqual((await refresh('unchanged')).calls.map(call=>call.method).sort(),
    ['get_block_hash','get_indexer_tip','get_tip_header']);
  for (const gap of [1n, 3n, 10n]) {
    nodeLag = gap;
    const lagged = await refresh('lag-' + gap);
    assert.equal(lagged.calls.some(call => call.method === 'get_cells'), false, 'Canonical indexed checkpoint should be reusable');
    const balance = p.getByRole('heading', { name: 'Protected balance', exact: true }).locator('..');
    assert((await balance.innerText()).includes(BigInt(baseTip.block_number).toString()));
  }
  nodeLag = 0n;
  tip = { block_number: '0x'+(BigInt(baseTip.block_number)+1n).toString(16), block_hash: '0x'+'a'.repeat(64) };
  const advanced=await refresh('unrelated');
  assert.equal(advanced.calls.filter(call=>call.method==='get_transactions').length,2);
  assert.equal(advanced.calls.some(call=>call.method==='get_cells'),false);
  relevant=true;
  tip = { block_number: '0x'+(BigInt(tip.block_number)+1n).toString(16), block_hash: '0x'+'b'.repeat(64) };
  const changed=await refresh('relevant');
  assert.equal(changed.calls.filter(call=>call.method==='get_cells').length,2);
}
fs.writeFileSync(output+'/04-'+width+'.json',JSON.stringify({policy,funds,history,historyStart,calls,errors,refreshRuns,queue:await p.evaluate(()=>performance.getEntriesByType('measure').filter(x=>x.name.startsWith('quotacell.queue.')).map(x=>[x.name,x.duration]))},null,2));console.log({width,policy,funds,history,historyStart,count:calls.length,errors});await p.close();
}}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
