// External-owner transport regression on a disposable existing Pocket.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_CORE||'playwright-core');
const run=process.argv[2],url=process.argv[3]||'http://127.0.0.1:4173';assert(run,'Supply a disposable run directory');
const key=JSON.parse(await fs.readFile(path.join(run,'keys/owner.json'))).privateKey,other=JSON.parse(await fs.readFile(path.join(run,'keys/alice.json'))).privateKey;
const provider=(await build({entryPoints:[new URL('./wallet_sim_provider.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
try{
 const p=await browser.newPage();await p.addInitScript({content:`window.__testKey=${JSON.stringify(key)};window.__otherTestKey=${JSON.stringify(other)};`+provider});await p.goto(url);
 await p.locator('#connectWallet').click();await p.getByText('UTXO Global Wallet',{exact:true}).first().click();await p.getByText('CKB',{exact:true}).first().click();
 async function status(pattern){await p.waitForFunction(r=>new RegExp(r).test(document.querySelector('#status').textContent),pattern.source,{timeout:20000});return p.locator('#status').innerText();}
 await p.waitForFunction(()=>document.querySelector('#walletStatus').textContent.includes('· owner ·'),null,{timeout:15000});
 for(const [mode,pattern] of [['reject',/Authorization rejected/],['mutate',/Wallet altered transaction fields/]]){await p.evaluate(m=>window.testWallet.mode=m,mode);await p.locator('#revoke').click();console.log(mode,await status(pattern));}
 await p.evaluate(()=>window.testWallet.mode='ok');
 for(const op of ['revoke','close','deposit','sweep']){await p.waitForFunction(id=>!document.getElementById(id).disabled,op,{timeout:20000});await p.locator('#status').evaluate(e=>e.textContent='');await p.locator('#'+op).click();console.log(op,await status(/^committed: 0x[0-9a-f]{64}/));}
 await p.close();
}finally{await browser.close();}
