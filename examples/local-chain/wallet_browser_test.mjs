// Automated integration test. The provider is simulated and keys are disposable.
// Set PLAYWRIGHT_CORE to a playwright-core module path; pass local run directory and URL.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const run=process.argv[2],url=process.argv[3]||'http://127.0.0.1:4173';assert(run,'Supply a disposable run directory');
const key=JSON.parse(await fs.readFile(path.join(run,'keys/alice.json'))).privateKey;
const other=JSON.parse(await fs.readFile(path.join(run,'keys/ben.json'))).privateKey;
const provider=(await build({entryPoints:[new URL('./wallet_sim_provider.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
async function pageFor(chain='CKB'){
 const page=await browser.newPage();await page.addInitScript({content:`window.__testKey=${JSON.stringify(key)};window.__otherTestKey=${JSON.stringify(other)};`+provider});
 await page.goto(url);await page.locator('#connectWallet').click();await page.getByText('UTXO Global Wallet',{exact:true}).first().click();await page.getByText(chain,{exact:true}).first().click();return page;
}
async function waitText(page,selector,regex){await page.waitForFunction(([s,r])=>new RegExp(r).test(document.querySelector(s).textContent),[selector,regex.source],{timeout:15000});return page.locator(selector).innerText();}
try{
 let p=await pageFor('BTC');console.log('wrong scheme:',await waitText(p,'#walletStatus',/Incompatible signing scheme/));await p.close();
 p=await pageFor();await waitText(p,'#walletStatus',/Connected:.*alice/);await p.locator('#amount').fill('61');
 async function attempt(mode,pattern){await p.evaluate(mode=>{window.testWallet.mode=mode},mode);await p.locator('#pay').click();console.log(mode+':',await waitText(p,'#status',pattern));}
 await attempt('reject',/Authorization rejected/);
 await attempt('mutate',/Wallet altered transaction fields/);
 await p.evaluate(()=>{window.testWallet.network='nervos'});await p.locator('#pay').click();console.log('wrong network:',await waitText(p,'#status',/wrong network/));await p.evaluate(()=>{window.testWallet.network='nervos_testnet'});
 await p.locator('#role').selectOption('ben');await p.waitForTimeout(500);await p.locator('#pay').click();console.log('account mismatch:',await waitText(p,'#status',/not the selected delegate/));await p.locator('#role').selectOption('alice');await p.waitForTimeout(500);
 await attempt('switch',/Wallet.*changed|not the selected delegate/);await p.close();
 p=await pageFor();await waitText(p,'#walletStatus',/Connected:.*alice/);await p.locator('#amount').fill('61');await p.evaluate(()=>{window.testWallet.mode='disconnect'});await p.locator('#pay').click();console.log('connection loss:',await waitText(p,'#status',/disconnected|changed/));await p.close();
 p=await pageFor();await waitText(p,'#walletStatus',/Connected:.*alice/);await p.locator('#amount').fill('61');await p.locator('#pay').click();console.log('simulated-wallet payment:',await waitText(p,'#status',/committed: 0x[0-9a-f]{64}/));
 await p.locator('#disconnectWallet').click();await p.locator('#pay').click();console.log('disconnected:',await waitText(p,'#status',/disconnected/));await p.close();
}finally{await browser.close();}
