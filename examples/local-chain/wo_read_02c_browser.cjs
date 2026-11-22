// Run against vite preview on port 5195 with a recorded read-only RPC trace and an output directory.
const {chromium}=require('playwright'), assert=require('node:assert/strict'),fs=require('fs');
const output = process.argv[3] || require('node:os').tmpdir();
const rows=JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter(r=>r.response?.result!=null);
const tip=rows.find(r=>r.method==='get_indexer_tip').response.result;
const canonical=rows.find(r=>r.method==='get_block_hash'&&r.params[0]===tip.block_number)?.response.result;
assert.equal(canonical,tip.block_hash);
const pocket='0x7b3d89c22431e061814fbe61cc09e6c888b44a7076b782a75c3f1612d1597cc0';
(async()=>{const b=await chromium.launch({channel:'chrome'});try{for(const width of [1250,390]){
const p=await b.newPage({viewport:{width,height:950}}),calls=[], errors=[];let failure=false,first,historyStart;
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
else if(q.method==='get_tip_header')result={number:tip.block_number,hash:tip.block_hash};
else if(q.method==='get_cells'||q.method==='get_transactions')result=lookup(x=>x.params[0].script_type===q.params[0].script_type);
else if(q.method==='get_live_cell')result=lookup(x=>x.params[0].tx_hash===q.params[0].tx_hash&&x.params[0].index===q.params[0].index);
else result=lookup(x=>JSON.stringify(x.params)===JSON.stringify(q.params));
if(failure&&q.method==='get_cells'&&q.params[0].script_type==='lock')return r.fulfill({status:503,json:{}});
await r.fulfill({json:{id:q.id,jsonrpc:'2.0',result}});
});
await p.goto('http://127.0.0.1:5195/app?pocket='+pocket);
await p.locator('.public-permissions').waitFor({timeout:22000});const policy=Date.now()-first;
await p.getByText('739 CKB',{exact:true}).first().waitFor({timeout:22000});const funds=Date.now()-first;
await p.getByText(/Payment · 61 CKB/).first().waitFor({timeout:22000});const history=Date.now()-first;
assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await p.screenshot({path:output+'/02c-'+width+'.png',fullPage:true});
if(width===1250){failure=true;await p.getByRole('button',{name:'Refresh',exact:true}).first().click();await p.getByText(/Pudge is temporarily unavailable/).waitFor({timeout:15000});assert(await p.getByText('Last verified protected balance').isVisible());assert(await p.locator('.public-permissions').isVisible());await p.screenshot({path:output+'/02c-settled-failure.png',fullPage:true});}
fs.writeFileSync(output+'/02c-'+width+'.json',JSON.stringify({policy,funds,history,historyStart,calls,errors,queue:await p.evaluate(()=>performance.getEntriesByType('measure').filter(x=>x.name.startsWith('quotacell.queue.')).map(x=>[x.name,x.duration]))},null,2));console.log({width,policy,funds,history,historyStart,count:calls.length,errors});await p.close();
}}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
