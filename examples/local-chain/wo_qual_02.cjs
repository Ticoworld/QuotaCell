const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');
const frontend = path.resolve(__dirname, '../../frontend');
const requireFrontend = createRequire(path.join(frontend, 'package.json'));
const c = requireFrontend('@ckb-ccc/core');
const { JsonRpcTransformers: rpc } = requireFrontend('@ckb-ccc/core/advanced');
const deployment = require('../../evidence/wo15/pudge-deployment.json');
const evidence = require('./wo_qual_02_dependencies.json');
const recorded = require('./wo_qual_01_ledger.json');
const CKB = 100000000n;
const hex = value => '0x' + value.toString(16);
const origin = 'http://127.0.0.1:5197';

async function main() {
  const vite = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
  const preview = await vite.preview({ root: frontend, preview: { host: '127.0.0.1', port: 5197, strictPort: true } });
  const server = await vite.createServer({ root: frontend, server: { middlewareMode: true, hmr: false } });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'QuotaCell-wallet-'));
  console.log(output);
  try {
    const { buildOwnerTransaction, ownerLockFor } = await server.ssrLoadModule('/src/pocketOwner.ts');
    const esbuild = requireFrontend('esbuild');
    const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, 'wallet_sim_provider.mjs')],
      bundle: true, platform: 'browser', format: 'iife', write: false, nodePaths: [path.join(frontend, 'node_modules')] });
    const client = new c.ClientPublicTestnet();
    const keys = Array.from({ length: 3 }, () => '0x' + randomBytes(32).toString('hex'));
    const identities = keys.map(key => new c.SignerCkbPrivateKey(client, key).publicKey);
    const locks = identities.map(ownerLockFor);
    const recipients = Array.from({ length: 2 }, () => ownerLockFor(new c.SignerCkbPrivateKey(client, '0x' + randomBytes(32).toString('hex')).publicKey));
    const terms = { sharedLimit: String(300n * CKB), delegates: identities.slice(1).map((publicKey, i) =>
      ({ publicKey, recipient: recipients[i], limit: String(150n * CKB), perPayment: String(100n * CKB) })) };
    const source = c.Transaction.from({
      inputs: [{ previousOutput: { txHash: '0x' + '00'.repeat(32), index: 0xffffffff }, since: 1 }],
      outputs: locks.map(lock => ({ lock, capacity: 2000n * CKB })), outputsData: ['0x', '0x', '0x'],
    });
    function cell(tx, index) {
      const raw = rpc.transactionFrom(tx);
      return { status: 'live', outPoint: { txHash: tx.hash(), index },
        cell: { output: raw.outputs[index], data: { content: raw.outputs_data[index] } } };
    }
    const created = buildOwnerTransaction({ operation: 'genesis', publicKey: identities[0], owner: cell(source, 0),
      deps: deployment.allDeps, terms, fee: 1000n });
    const policy = cell(created.transaction, 0);
    const deposit = buildOwnerTransaction({ operation: 'deposit', publicKey: identities[0], owner: cell(created.transaction, 1),
      policy, deps: deployment.allDeps, amount: 500n * CKB, fee: 1000n });
    const fund = cell(deposit.transaction, 0);
    const ownerFee = cell(deposit.transaction, 1);
    const revoked = buildOwnerTransaction({ operation: 'revoke', publicKey: identities[0], owner: ownerFee,
      policy, deps: deployment.allDeps, mask: 1, fee: 1000n });
    const tip = recorded.filter(row => row.timestamp).sort((a,b)=>Number(BigInt(b.number)-BigInt(a.number)))[0];
    const headers = [...evidence.headers, tip];
    const transactions = new Map(evidence.transactions.map(obs => [obs.transaction.hash, obs]));
    for (const [index, tx] of [source, created.transaction, deposit.transaction, revoked.transaction].entries()) {
      transactions.set(tx.hash(), { transaction: rpc.transactionFrom(tx), tx_status: {
        status: 'committed', block_number: tip.number, block_hash: tip.hash, tx_index: hex(index),
      } });
    }
    let paidCells;
    const cells = [policy, fund, ownerFee, cell(source, 1), cell(source, 2)];
    for (const obs of evidence.transactions) {
      const tx = rpc.transactionTo(obs.transaction);
      tx.outputs.forEach((_, index) => cells.push(cell(tx, index)));
    }
    const same = (a, b) => a && b && a.code_hash === b.code_hash && a.hash_type === b.hash_type && a.args === b.args;
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const cases = [
        [0, 'owner'], [1, 'alice'], [2, 'ben'],
        [1, 'policy-consumed'], [1, 'fund-consumed'], [1, 'fee-cell-missing'],
        [1, 'route-changed'], [1, 'wallet-changed'], [1, 'counter-changed'], [1, 'revoked'], [1, 'unresolved'], [1, 'indexer-unavailable'], [1, 'canonical-unavailable'],
      ];
      for (const [i, role] of cases.filter(([, name]) => !process.env.QUOTA_CASE || name === process.env.QUOTA_CASE)) {
        const negative = !['owner', 'alice', 'ben'].includes(role);
        let preparing = false;
        const race = ['route-changed', 'wallet-changed'].includes(role);
        let markPending, releasePreparation;
        const pending = new Promise(resolve => { markPending = resolve; });
        const resume = new Promise(resolve => { releasePreparation = resolve; });
        const context = await browser.newContext();
        let writes = 0;
        await context.addInitScript({ content:
          `window.__testKey=${JSON.stringify(keys[i])};window.__otherTestKey=${JSON.stringify(keys[2])};${bundle.outputFiles[0].text}
           window.__signCalls=0;window.utxoGlobal.ckbSigner.signTransaction=async()=>{window.__signCalls++;throw Error('Signing forbidden in fixture')};` });
        await context.route('**/*', async route => {
          const request = route.request();
          if (request.url().startsWith(origin + '/')) return route.continue();
          if (request.url() !== 'https://testnet.ckb.dev/') return route.abort();
          const { id, method, params } = request.postDataJSON();
          const [arg] = params;
          if (!method.startsWith('get_')) { writes++; return route.abort(); }
          if (race && preparing && method === 'get_fee_rate_statistics') {
            markPending();
            await resume;
          }
          const liveCells = preparing && role === 'revoked'
            ? [cell(revoked.transaction, 0), fund, cell(revoked.transaction, 1), ...cells.slice(3)]
            : preparing && role === 'counter-changed' ? paidCells : cells;
          let result;
          switch (method) {
            case 'get_tip_header': result = tip; break;
            case 'get_indexer_tip': result = { block_number: tip.number, block_hash: tip.hash }; break;
            case 'get_block_hash': result = arg === '0x0' ? deployment.genesis : headers.find(h => h.number === arg)?.hash; break;
            case 'get_header': result = headers.find(h => h.hash === arg); break;
            case 'get_transaction': result = transactions.get(arg); break;
            case 'get_fee_rate_statistics': result = { median: '0x3e8', mean: '0x3e8' }; break;
            case 'get_live_cell': result = liveCells.find(item => item.outPoint.txHash === arg.tx_hash && item.outPoint.index === Number(arg.index)) ?? { status: 'dead' }; break;
            case 'get_cells': result = { last_cursor: '0x', objects: liveCells.slice(0,5).filter(item =>
              same(item.cell.output[arg.script_type], arg.script_search_mode === 'prefix' ? { ...arg.script, args: item.cell.output[arg.script_type]?.args } : arg.script) && (!arg.filter?.script_len_range || !item.cell.output.type))
              .map(item => ({ ...item.cell, out_point: { tx_hash: item.outPoint.txHash, index: hex(item.outPoint.index) },
                output_data: item.cell.data.content, block_number: tip.number })) }; break;
            case 'get_transactions': result = { last_cursor: '0x', objects: [{
              tx_hash: created.transaction.hash(), block_number: tip.number, tx_index: '0x1', io_type: 'output', io_index: '0x0',
            }] }; break;
          }
          if (preparing && (
            (role === 'policy-consumed' && method === 'get_live_cell' && arg.tx_hash === policy.outPoint.txHash) ||
            (role === 'fund-consumed' && method === 'get_live_cell' && arg.tx_hash === fund.outPoint.txHash)
          )) result = { status: 'dead' };
          if (preparing && role === 'fee-cell-missing' && method === 'get_cells' && same(arg.script, rpc.scriptFrom(locks[i]))) {
            result = { last_cursor: '0x', objects: [] };
          }
          if (preparing && (
            (role === 'indexer-unavailable' && method === 'get_indexer_tip') ||
            (role === 'canonical-unavailable' && method === 'get_block_hash' && arg === tip.number)
          )) result = null;
          await route.fulfill({ json: { jsonrpc: '2.0', id, result: result ?? null } });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        try {
          await page.goto(origin + '/app?pocket=' + created.pocket);
          await page.getByText('500 CKB', { exact: true }).first().waitFor();
          await page.locator('.connect-button').click();
          await page.locator('ccc-connector').getByText('UTXO Global Wallet', { exact: true }).first().click();
          await page.locator('ccc-connector').getByText('CKB', { exact: true }).first().click();
          const action = page.getByRole('button', { name: i ? 'Pay' : 'Add funds', exact: !i }).first();
          await action.click();
          const dialog = page.getByRole('dialog');
          await dialog.getByLabel(i ? 'Payment amount (CKB)' : 'Amount to add (CKB)').fill(i && role !== 'counter-changed' ? '61' : '100');
          if (role === 'unresolved') await page.evaluate(({ pocket, genesis }) => {
            localStorage.setItem('quotacell.browser.v1:' + genesis + ':' + pocket,
              JSON.stringify([{ state: 'signed', payment: { id: 'fixture' } }]));
          }, { pocket: created.pocket, genesis: deployment.genesis });
          preparing = true;
          const prepareButton = dialog.getByRole('button', { name: i ? 'Review payment' : 'Prepare transaction' });
          await prepareButton.click();
          if (race) {
            await Promise.race([pending, page.waitForTimeout(10000).then(() => { throw Error('Preparation did not reach fee RPC'); })]);
            await page.evaluate(test => {
              if (test === 'route-changed') {
                history.pushState(null, '', '/app');
                dispatchEvent(new PopStateEvent('popstate'));
              } else {
                window.testWallet.switched = true;
                dispatchEvent(new Event('focus'));
              }
            }, role);
            releasePreparation();
            await page.waitForFunction(pocket => Object.entries(localStorage)
              .some(([key, value]) => key.endsWith(':' + pocket) && value.includes('"state":"prepared"')), created.pocket);
            await page.waitForTimeout(200);
            assert.equal(await page.locator('.transaction-review').count(), 0, role);
            console.log('PASS rejection', role);
            continue;
          }
          if (negative) {
            await dialog.getByRole('alert').waitFor();
            assert.equal(await dialog.locator('.transaction-review').count(), 0);
            const message = await dialog.getByRole('alert').innerText();
            if (role === 'counter-changed') assert.match(message, /allowance|limit/i);
            if (role === 'revoked') assert.match(message, /not the selected delegate/i);
            if (role === 'unresolved') assert.match(message, /checking Pudge automatically/i);
            console.log('PASS rejection', role, message);
            continue;
          }
          await dialog.locator('.transaction-review').waitFor();
          const prepared = await page.evaluate(pocket => JSON.parse(localStorage.getItem(
            Object.keys(localStorage).find(key => key.startsWith('quotacell.browser.v1:') && key.endsWith(':'+pocket))
          )).at(-1).prepared, created.pocket);
          const tx = c.Transaction.fromBytes(prepared.transaction);
          assert.equal(prepared.publicKey, identities[i]);
          assert.deepEqual(tx.inputs.map(input => input.previousOutput.txHash),
            i ? [policy.outPoint.txHash, source.hash(), fund.outPoint.txHash] : [ownerFee.outPoint.txHash]);
          const capacity = tx.outputs.reduce((sum, item) => sum + item.capacity, 0n);
          const inputs = tx.inputs.reduce((sum, { previousOutput }) => sum + BigInt(cells.find(item =>
            item.outPoint.txHash === previousOutput.txHash && item.outPoint.index === Number(previousOutput.index)
          ).cell.output.capacity), 0n);
          assert.equal(inputs - capacity, BigInt(prepared.fee));
          if (i) {
            assert.equal(tx.outputs[1].capacity, 439n * CKB);
            assert.equal(tx.outputs[2].capacity, 61n * CKB);
            assert(tx.outputs[2].lock.eq(recipients[i-1]));
            const state = Buffer.from(tx.outputsData[0].slice(2), 'hex');
            assert.equal(state.readBigUInt64LE(24), 61n * CKB);
            assert.equal(state.readBigUInt64LE(158 + 154 * (i - 1) + 122), 61n * CKB);
          } else assert.equal(tx.outputs[0].capacity, 100n * CKB);
          if (role === 'alice') {
            transactions.set(tx.hash(), { transaction: rpc.transactionFrom(tx), tx_status: {
              status: 'committed', block_number: tip.number, block_hash: tip.hash, tx_index: '0x4',
            } });
            paidCells = [cell(tx, 0), cell(tx, 1), ownerFee, cell(tx, 3), cells[4], ...cells.slice(5)];
          }
          await page.screenshot({ path: path.join(output, role + '.png') });
          console.log('PASS', role, tx.hash());
        } catch (error) {
          console.error(role, await page.locator('body').innerText());
          throw error;
        } finally {
          releasePreparation();
          assert.equal(await page.evaluate(() => window.__signCalls), 0);
          assert.equal(writes, 0);
          await context.close();
        }
      }
    } finally { await browser.close(); }
  } finally { await server.close();
    await new Promise(resolve => preview.httpServer.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
