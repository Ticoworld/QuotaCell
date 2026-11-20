// Browser acceptance uses disposable wallet keys and never submits a transaction.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as c from '@ckb-ccc/core';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const frontend = path.join(repo, 'frontend');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const { build } = require('esbuild');
const oldPocket = '0xfd76ec009d7ceeaf4ad1f49806dccb673cbc5530b07f270c28395112a7320898';
const genesis = '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const browserExe = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotDir = process.env.WO19C_SCREENSHOTS || path.join(os.tmpdir(), 'QuotaCell-WO19C-browser');
const client = new c.ClientPublicTestnet();
const privateKey = (n) => `0x${'00'.repeat(31)}${n.toString(16).padStart(2, '0')}`;
const publicKey = (n) => new c.SignerCkbPrivateKey(client, privateKey(n)).publicKey;
const addressFor = (key) => c.Address.fromScript(c.Script.from({
  codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
  hashType: 'type', args: c.hashCkb(c.bytesFrom(key)).slice(0, 42),
}), client).toString();
const ownerKey = publicKey(1), delegateOneKey = publicKey(2), delegateTwoKey = publicKey(3);
const ownerAddress = addressFor(ownerKey);
const recipientOne = addressFor(publicKey(4)), recipientTwo = addressFor(publicKey(5));
const providerPath = path.join(here, 'wallet_sim_provider.mjs');
const provider = (await build({ entryPoints: [providerPath], bundle: true, write: false, platform: 'browser', format: 'iife' })).outputFiles[0].text;
const appState = {
  empty: false, closed: true, historicalTermsUnavailable: true, networkMode: 'pudge-readonly',
  genesis, pocket: oldPocket, owner: ownerKey, fundShannons: '13400000000',
  fundOccupiedShannons: '13400000000', policyCapacity: '13400000000',
  sharedLimit: '0', sharedUsed: '0', delegates: [], unsupportedFunds: [], history: [],
  multiPocket: false,
};

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close((error) => error ? reject(error) : resolve(value));
    });
  });
}

async function startFrontend() {
  const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: frontend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QUOTACELL_BACKEND_URL: 'http://127.0.0.1:4199' },
  });
  let output = '';
  child.stdout.on('data', (part) => { output = (output + part.toString()).slice(-5000); });
  child.stderr.on('data', (part) => { output = (output + part.toString()).slice(-5000); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Vite exited (${child.exitCode}): ${output}`);
    try { if ((await fetch(origin)).ok) return { child, origin }; } catch { /* Wait for Vite to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`Vite did not start: ${output}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function newWalletContext(browser, origin, key, { wrongNetwork = false, otherKey } = {}) {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript({ content: `window.__testKey=${JSON.stringify(key)};${otherKey ? `window.__otherTestKey=${JSON.stringify(otherKey)};` : ''}${provider}${wrongNetwork ? "window.testWallet.mode='wrong-network';window.testWallet.network='nervos';" : ''}window.__signCalls=0;const __sign=window.utxoGlobal.ckbSigner.signTransaction.bind(window.utxoGlobal.ckbSigner);window.utxoGlobal.ckbSigner.signTransaction=async(...a)=>{window.__signCalls++;return __sign(...a)};` });
  return { context, page: await context.newPage(), origin };
}

async function connectWallet(page, registration = false) {
  if (registration) await page.getByRole('button', { name: 'Share my wallet identity' }).click();
  else await page.locator('.connect-button').click();
  const connector = page.locator('ccc-connector');
  await connector.getByText('UTXO Global Wallet', { exact: true }).first().click();
  await connector.getByText('CKB', { exact: true }).first().click();
}

async function invitationLink(page, slotIndex) {
  await page.locator('.person-row').nth(slotIndex).getByRole('button', { name: 'Invite contributor' }).click();
  return page.getByLabel('Invitation link').inputValue();
}

async function responseFrom(browser, origin, link, key, options) {
  const wallet = await newWalletContext(browser, origin, key, options);
  await wallet.page.goto(link);
  await connectWallet(wallet.page, true);
  return wallet;
}

async function copyResponseLink(page) {
  await page.getByRole('button', { name: 'Copy response link' }).click();
  try { return await page.evaluate(() => navigator.clipboard.readText()); }
  catch {
    const code = await page.locator('main textarea').inputValue();
    const url = new URL(page.url());
    url.search = '?register=1';
    url.hash = new URLSearchParams({ response: code }).toString();
    return url.toString();
  }
}

async function importResponse(page, slot, text) {
  await page.locator('main select').first().selectOption(slot);
  await page.locator('main textarea').first().fill(text);
  await page.getByRole('button', { name: 'Validate and add' }).click();
}

async function assertVisibleError(page, pattern) {
  const alert = page.getByRole('alert');
  await alert.waitFor({ state: 'visible' });
  assert.match(await alert.innerText(), pattern);
}

async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
}

async function setLanguage(page, language) {
  await page.locator('.language-control select').selectOption(language);
}

await fs.mkdir(screenshotDir, { recursive: true });
const vite = await startFrontend();
const browser = await chromium.launch({ headless: true, executablePath: browserExe });
let ownerContext, ownerPage;
const forbiddenRequests = [];
try {
  const ownerWallet = await newWalletContext(browser, vite.origin, privateKey(1), { otherKey: privateKey(2) });
  ownerContext = ownerWallet.context;
  ownerPage = ownerWallet.page;
  await ownerContext.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/state') {
      if (url.searchParams.has('actor') && !url.searchParams.has('pocket')) {
        await route.fulfill({ json: { discovery: [
          { pocket: oldPocket, role: 'owner', closed: true },
          { pocket: `0x${'11'.repeat(32)}`, role: 'owner', closed: false },
        ] } });
      } else await route.fulfill({ json: appState });
      return;
    }
    forbiddenRequests.push(`${route.request().method()} ${url.pathname}`);
    await route.fulfill({ status: 409, json: { error: 'Transaction APIs are disabled in this browser acceptance fixture.' } });
  });
  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  await ownerPage.goto(`${vite.origin}/?pocket=${oldPocket}`);
  await ownerPage.getByText('Pocket closed', { exact: true }).first().waitFor();
  await ownerPage.getByText('134', { exact: false }).first().waitFor();
  await screenshot(ownerPage, 'owner-closed-pocket-desktop-en');
  await connectWallet(ownerPage);
  await ownerPage.locator('.connected-account').waitFor();
  assert.equal(await ownerPage.evaluate(() => window.testWallet.publicKey), ownerKey);
  console.log('PASS Main connected to historical closed Pocket; simulated owner identity unchanged');

  await ownerPage.getByRole('button', { name: 'My Pockets' }).click();
  await ownerPage.getByRole('heading', { name: 'My Pockets' }).waitFor();
  assert.equal(await ownerPage.locator('main section[aria-label="My Pockets"] > div > div').count(), 2);
  await screenshot(ownerPage, 'my-pockets-desktop-en');
  const historicalRow = ownerPage.locator('main section[aria-label="My Pockets"] > div > div').filter({ hasText: oldPocket });
  await historicalRow.getByRole('button', { name: 'Open Pocket' }).click();
  assert.match(ownerPage.url(), new RegExp(`pocket=${oldPocket}`));
  await ownerPage.getByText('Pocket closed', { exact: true }).first().waitFor();
  await ownerPage.getByRole('button', { name: 'My Pockets' }).click();
  await ownerPage.getByRole('button', { name: 'New Pocket' }).click();
  await ownerPage.getByRole('heading', { name: 'Pocket draft' }).waitFor();
  assert.equal(await ownerPage.evaluate(() => window.testWallet.publicKey), ownerKey);
  assert.equal(await ownerPage.locator('.person-row').first().locator('.registered-address').innerText(), `${ownerAddress.slice(0, 15)}…${ownerAddress.slice(-10)}`);
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await screenshot(ownerPage, 'draft-people-mobile-en');
  console.log('PASS separate draft opened from the historical Pocket with Main preselected');

  const inviteOneOld = await invitationLink(ownerPage, 1);
  const damagedInvite = new URL(inviteOneOld);
  const damagedInviteCode = damagedInvite.searchParams.get('invite');
  damagedInvite.searchParams.set('invite', `${damagedInviteCode.slice(0, -1)}${damagedInviteCode.endsWith('A') ? 'B' : 'A'}`);
  const invalidInvitePage = await browser.newPage();
  await invalidInvitePage.goto(damagedInvite.toString());
  await assertVisibleError(invalidInvitePage, /checksum|Malformed/i);
  await invalidInvitePage.close();

  const wrongNetwork = await responseFrom(browser, vite.origin, inviteOneOld, privateKey(2), { wrongNetwork: true });
  await wrongNetwork.page.locator('ccc-connector').getByText(/Wrong wallet network.*testnet/i).waitFor();
  await wrongNetwork.context.close();
  console.log('PASS invalid invitation and wrong-network contributor attempts rejected');

  const delegateOneOld = await responseFrom(browser, vite.origin, inviteOneOld, privateKey(2));
  const staleResponse = await delegateOneOld.page.locator('main textarea').inputValue();
  const responseOneOldLink = await copyResponseLink(delegateOneOld.page);
  assert.match(responseOneOldLink, /#response=/);
  await delegateOneOld.context.close();

  const inviteOne = await invitationLink(ownerPage, 1);
  await importResponse(ownerPage, 'alice', responseOneOldLink);
  await assertVisibleError(ownerPage, /does not match this invitation/i);
  const delegateOne = await responseFrom(browser, vite.origin, inviteOne, privateKey(2));
  const responseOne = await copyResponseLink(delegateOne.page);
  await delegateOne.context.close();

  const inviteTwo = await invitationLink(ownerPage, 2);
  await importResponse(ownerPage, 'alice', staleResponse);
  await assertVisibleError(ownerPage, /does not match this invitation/i);
  await importResponse(ownerPage, 'ben', responseOne);
  await assertVisibleError(ownerPage, /does not match this invitation/i);
  await importResponse(ownerPage, 'alice', responseOne);
  assert.equal(await ownerPage.locator('.person-row').nth(1).locator('.registered-state').innerText(), 'Wallet registered');

  const duplicate = await responseFrom(browser, vite.origin, inviteTwo, privateKey(2));
  const duplicateResponse = await copyResponseLink(duplicate.page);
  await duplicate.context.close();
  await importResponse(ownerPage, 'ben', duplicateResponse);
  await assertVisibleError(ownerPage, /different wallet/i);

  const badResponse = new URL(responseOne);
  const badResponseValue = new URLSearchParams(badResponse.hash.slice(1)).get('response');
  badResponse.hash = new URLSearchParams({ response: `${badResponseValue.slice(0, -1)}${badResponseValue.endsWith('A') ? 'B' : 'A'}` }).toString();
  await importResponse(ownerPage, 'alice', badResponse.toString());
  await assertVisibleError(ownerPage, /checksum|Malformed/i);

  const wrongNetworkTwo = await responseFrom(browser, vite.origin, inviteTwo, privateKey(3), { wrongNetwork: true });
  await wrongNetworkTwo.page.locator('ccc-connector').getByText(/Wrong wallet network.*testnet/i).waitFor();
  await wrongNetworkTwo.context.close();
  const delegateTwo = await responseFrom(browser, vite.origin, inviteTwo, privateKey(3));
  const responseTwo = await copyResponseLink(delegateTwo.page);
  await delegateTwo.context.close();
  await importResponse(ownerPage, 'ben', responseTwo);
  assert.equal(await ownerPage.locator('.person-row').nth(2).locator('.registered-state').innerText(), 'Wallet registered');
  console.log('PASS two separate contributor invitations imported; wrong slot, stale request, duplicate identity, corrupt response, and wrong network rejected');

  await ownerPage.locator('.person-row').nth(0).locator('input').nth(0).fill('Main');
  await ownerPage.locator('.person-row').nth(1).locator('input').nth(0).fill('Delegate One');
  await ownerPage.locator('.person-row').nth(2).locator('input').nth(0).fill('Delegate Two');
  await ownerPage.getByRole('button', { name: 'Continue' }).click();
  await ownerPage.locator('.shared-field input').fill('300');
  const firstRules = ownerPage.locator('.rule-section').nth(0).locator('input');
  const secondRules = ownerPage.locator('.rule-section').nth(1).locator('input');
  await firstRules.nth(0).fill('200'); await firstRules.nth(1).fill('100'); await firstRules.nth(2).fill(recipientOne);
  await secondRules.nth(0).fill('100'); await secondRules.nth(1).fill('61'); await secondRules.nth(2).fill(recipientTwo);
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await screenshot(ownerPage, 'draft-rules-mobile-en');
  await ownerPage.getByRole('button', { name: 'Continue' }).click();
  await ownerPage.getByRole('heading', { name: 'Review Pocket rules' }).waitFor();
  assert.equal(await ownerPage.getByRole('button', { name: 'Create and review in wallet' }).isDisabled(), true);
  await setLanguage(ownerPage, 'zh-Hans');
  await ownerPage.getByRole('heading', { name: '确认 Pocket 规则' }).waitFor();
  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  await screenshot(ownerPage, 'draft-review-desktop-zh');
  assert.equal(await ownerPage.evaluate(() => window.testWallet.publicKey), ownerKey);
  assert.equal(forbiddenRequests.length, 0, `Unexpected transaction API call: ${forbiddenRequests.join(', ')}`);
  assert.equal(await ownerPage.evaluate(() => window.__signCalls), 0);
  console.log('PASS spending rules reviewed; no genesis preparation, wallet signing, or broadcast was invoked');

  const indexKey = `quotacell.drafts.v1:${genesis}:${ownerKey.toLowerCase()}`;
  const ids = await ownerPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').map((item) => item.id), indexKey);
  assert.equal(ids.length, 1);
  const draftKey = `${indexKey}:draft:${ids[0]}`;
  const savedDraft = await ownerPage.evaluate((key) => JSON.parse(localStorage.getItem(key)), draftKey);
  assert.equal(savedDraft.step, 2);
  assert.equal(savedDraft.people.owner.publicKey, ownerKey);
  assert.equal(savedDraft.people.alice.publicKey, delegateOneKey);
  assert.equal(savedDraft.people.ben.publicKey, delegateTwoKey);
  const invitePayload = Buffer.from(new URL(inviteOne).searchParams.get('invite').slice('QCI1.'.length), 'base64url');
  assert.equal(savedDraft.inviteBySlot.alice.requestId, invitePayload.subarray(3, 19).toString('hex'));
  assert.doesNotMatch(JSON.stringify(savedDraft), /privateKey|signature|signedTransaction|transactionHex/i);

  await ownerPage.reload();
  await connectWallet(ownerPage);
  await ownerPage.locator('.connected-account').waitFor();
  await setLanguage(ownerPage, 'en');
  await ownerPage.getByRole('button', { name: 'My Pockets' }).click();
  await ownerPage.getByRole('button', { name: 'Resume draft' }).waitFor();
  await ownerPage.getByRole('button', { name: 'Resume draft' }).click();
  await ownerPage.getByRole('heading', { name: 'Pocket draft' }).waitFor();
  const resumedDraft = await ownerPage.evaluate((key) => JSON.parse(localStorage.getItem(key)), draftKey);
  assert.deepEqual(resumedDraft.terms, savedDraft.terms);
  assert.deepEqual(resumedDraft.people, savedDraft.people);
  assert.deepEqual(resumedDraft.inviteBySlot, savedDraft.inviteBySlot);
  await setLanguage(ownerPage, 'zh-Hans');
  await ownerPage.getByRole('heading', { name: 'Pocket 草稿' }).waitFor();
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await screenshot(ownerPage, 'draft-review-mobile-zh');
  console.log('PASS saved draft reloaded with people, request bindings, rules, and review step intact');

  await setLanguage(ownerPage, 'en');
  await ownerPage.evaluate(() => { window.testWallet.switched = true; window.dispatchEvent(new Event('focus')); });
  await assertVisibleError(ownerPage, /wallet.*draft|draft.*wallet|草稿.*钱包/i);
  assert.equal(await ownerPage.locator('.setup-page').count(), 0);
  await ownerPage.evaluate(() => { window.testWallet.switched = false; window.dispatchEvent(new Event('focus')); });
  await ownerPage.getByRole('button', { name: 'Resume draft' }).click();
  await ownerPage.getByRole('heading', { name: 'Pocket draft' }).waitFor();
  await ownerPage.getByRole('button', { name: 'Return to Pocket' }).click();
  await ownerPage.getByText('Pocket closed', { exact: true }).first().waitFor();
  assert.match(ownerPage.url(), new RegExp(`pocket=${oldPocket}`));
  assert.equal(await ownerPage.evaluate(() => window.testWallet.publicKey), ownerKey);
  assert.equal(forbiddenRequests.length, 0);
  assert.equal(await ownerPage.evaluate(() => window.__signCalls), 0);
  console.log('PASS wallet account change closed the draft; returning restored the original closed Pocket; no transaction action occurred');

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const publicPage = await publicContext.newPage();
  const localApiRequests = [];
  publicPage.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) localApiRequests.push(request.url()); });
  await publicPage.goto(`${vite.origin}/?view=1&pocket=${oldPocket}`);
  await publicPage.waitForFunction(() => document.querySelector('[role="alert"]') || document.querySelector('main')?.textContent?.includes('Closed Pocket'), null, { timeout: 120000 });
  const publicText = await publicPage.locator('main').innerText();
  assert.match(publicText, /Closed Pocket/);
  assert.match(publicText, /134 CKB/);
  assert.match(publicText, /delegate identities|transaction history/i);
  assert.equal(await publicPage.evaluate(() => window.utxoGlobal), undefined);
  assert.equal(localApiRequests.length, 0, `Public viewer used a local API: ${localApiRequests.join(', ')}`);
  await setLanguage(publicPage, 'zh-Hans');
  await publicPage.getByRole('heading', { name: '公开 Pocket' }).waitFor();
  await screenshot(publicPage, 'public-wo18-mobile-zh');
  await publicPage.setViewportSize({ width: 1440, height: 1000 });
  await setLanguage(publicPage, 'en');
  await publicPage.getByRole('heading', { name: 'Public Pocket' }).waitFor();
  await screenshot(publicPage, 'public-wo18-desktop-en');
  assert.equal(localApiRequests.length, 0);
  await publicContext.close();
  console.log('PASS live WO18 QCT4 public link: no wallet, local descriptor, SQLite journal, or local transaction backend');
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  if (ownerContext) await ownerContext.close();
  await browser.close();
  await stopProcess(vite.child);
}
