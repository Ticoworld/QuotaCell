const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const evidence = require('./wo_qual_01_ledger.json');

const entries = evidence.filter(row => row.transaction);
const headers = evidence.filter(row => row.timestamp);
const hex = value => '0x' + value.toString(16);
const point = (hash, index) => hash + ':' + BigInt(index);
const same = (a, b) => a && b && a.code_hash === b.code_hash && a.hash_type === b.hash_type && a.args === b.args;
const pocket = '0x7b3d89c22431e061814fbe61cc09e6c888b44a7076b782a75c3f1612d1597cc0';
const genesis = '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';

async function main() {
  const { JsonRpcTransformers } = require('@ckb-ccc/core/advanced');
  const ledger = entries.map(entry => ({
    ...entry, hash: JsonRpcTransformers.transactionTo(entry.transaction).hash(),
    height: BigInt(entry.tx_status.block_number),
  })).sort((a, b) => a.height < b.height ? -1 : 1);
  const policyScript = ledger[0].transaction.outputs[0].type;
  const fundScript = ledger[1].transaction.outputs[0].lock;
  assert.equal(JsonRpcTransformers.scriptTo(policyScript).hash(), pocket);
  assert.equal(fundScript.args, pocket);
  // Add a second deposit in the recorded deposit block. This is replay-only evidence.
  const extraDeposit = structuredClone(ledger[1].transaction);
  extraDeposit.inputs[0].previous_output.tx_hash = '0x' + 'fe'.repeat(32);
  extraDeposit.hash = JsonRpcTransformers.transactionTo(extraDeposit).hash();
  const extra = { transaction: extraDeposit, hash: extraDeposit.hash, height: ledger[1].height,
    tx_status: { ...ledger[1].tx_status, tx_index: '0x2' } };
  entries.push({ transaction: extra.transaction, tx_status: extra.tx_status });
  ledger.splice(2, 0, extra);
  let incompleteActivity = false;
  let activityRejected = false;
  const allOutputs = new Map();
  for (const row of ledger) {
    assert(headers.some(header => header.hash === row.tx_status.block_hash && BigInt(header.number) === row.height));
    row.transaction.outputs.forEach((output, index) => allOutputs.set(point(row.hash, index), {
      output, output_data: row.transaction.outputs_data[index], out_point: { tx_hash: row.hash, index: hex(index) },
      block_number: hex(row.height),
    }));
  }
  function state(height) {
    const live = new Map();
    const activity = { type: [], lock: [] };
    for (const row of ledger.filter(item => item.height <= height)) {
      const hit = (cell, io_type, index) => {
        for (const [stream, matches] of [['type', same(cell?.output.type, policyScript)], ['lock', same(cell?.output.lock, fundScript)]]) {
          if (matches) activity[stream].push({ tx_hash: row.hash, block_number: hex(row.height),
            tx_index: row.tx_status.tx_index, io_type, io_index: hex(index) });
        }
      };
      row.transaction.inputs.forEach(({ previous_output: input }, index) => {
        const key = point(input.tx_hash, input.index);
        if (allOutputs.has(key)) assert(live.has(key), 'Recorded Pocket input must descend from a live predecessor');
        hit(live.get(key), 'input', index);
        live.delete(key);
      });
      row.transaction.outputs.forEach((_, index) => {
        const key = point(row.hash, index);
        const cell = allOutputs.get(key);
        live.set(key, cell);
        hit(cell, 'output', index);
      });
    }
    return { live, activity };
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  let height = ledger[0].height;
  const origin = process.env.QUOTA_FIXTURE_ORIGIN || 'http://127.0.0.1:5195';
  async function open() {
    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
    await page.route('**/*', async route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      if (route.request().url() !== 'https://testnet.ckb.dev/') return route.abort();
      const { id, method, params } = route.request().postDataJSON();
      const [arg] = params;
      const { live, activity } = state(height);
      const tip = headers.find(header => BigInt(header.number) === height);
      let result;
      switch (method) {
        case 'get_tip_header': result = tip; break;
        case 'get_indexer_tip': result = { block_number: tip.number, block_hash: tip.hash }; break;
        case 'get_block_hash': result = arg === '0x0' ? genesis : headers.find(header => header.number === arg)?.hash; break;
        case 'get_header': result = headers.find(header => header.hash === arg); break;
        case 'get_transaction': result = entries.find(row => row.transaction.hash === arg && BigInt(row.tx_status.block_number) <= height); break;
        case 'get_live_cell': {
          const cell = live.get(point(arg.tx_hash, arg.index));
          result = cell ? { status: 'live', cell: { output: cell.output, data: { content: cell.output_data } } } : { status: 'dead' };
          break;
        }
        case 'get_cells':
        case 'get_transactions': {
          const [start, end] = arg.filter.block_range.map(BigInt);
          const items = method === 'get_transactions' ? activity[arg.script_type] : [...live.values()].filter(cell =>
            arg.script_type === 'type' ? same(cell.output.type, policyScript) : same(cell.output.lock, fundScript));
          if (incompleteActivity && method === 'get_transactions' && params[2] === '0x1') {
            activityRejected = true;
            result = { objects: [], last_cursor: '0x10' };
            break;
          }
          const offset = Number(params[3] || 0);
          const objects = items.filter(item => BigInt(item.block_number) >= start && BigInt(item.block_number) < end)
            .slice(offset, offset + Number(params[2]));
          result = { objects, last_cursor: objects.length ? hex(offset + objects.length) : '0x' };
          break;
        }
        default: return route.abort();
      }
      await route.fulfill({ json: { jsonrpc: '2.0', id, result: result ?? null } });
    });
    await page.goto(origin + '/app?pocket=' + pocket);
    return page;
  }

  async function observation(page) {
    const { live, activity } = state(height);
    const funds = [...live.values()].filter(cell => same(cell.output.lock, fundScript));
    const capacity = funds.reduce((sum, cell) => sum + BigInt(cell.output.capacity), 0n);
    const policy = [...live.values()].find(cell => same(cell.output.type, policyScript));
    const bytes = Buffer.from(policy.output_data.slice(2), 'hex');
    const u128 = offset => bytes.readBigUInt64LE(offset) + (bytes.readBigUInt64LE(offset + 8) << 64n);
    const balance = page.getByRole('heading', { name: 'Protected balance', exact: true }).locator('..');
    await balance.getByText((capacity / 100000000n) + ' CKB', { exact: true }).waitFor().catch(async e => { console.error(await page.locator('body').innerText()); throw e; });
    assert((await balance.innerText()).includes(height.toString()));
    assert((await balance.innerText()).includes('occupy ' + (73 * funds.length) + ' CKB'));
    const used = u128(24) / 100000000n;
    await page.getByText(used + ' used of ' + u128(8) / 100000000n + ' CKB', { exact: true }).waitFor();
    const indexedHashes = new Set([...activity.type, ...activity.lock].map(hit => hit.tx_hash));
    const hashes = ledger.filter(row => indexedHashes.has(row.hash)).map(row => row.hash).reverse();
    const historyLinks = page.locator('.history-list a[href*="/transaction/"]');
    await page.waitForFunction(expected => document.querySelectorAll('.history-list a[href*="/transaction/"]').length === expected, hashes.length);
    const actual = await historyLinks.evaluateAll(links => links.map(link => link.href.split('/').pop()));
    assert.deepEqual(actual, hashes);
    const rules = page.locator('.public-permissions');
    for (const offset of [158, 312]) {
      const remaining = (u128(offset + 106) - u128(offset + 122)) / 100000000n;
      const ceiling = u128(offset + 138) / 100000000n;
      assert((await rules.innerText()).includes('Remaining ' + remaining + ' CKB'));
      assert((await rules.innerText()).includes('Maximum per payment ' + ceiling + ' CKB'));
    }
    return { capacity: capacity.toString(), count: funds.length, sharedUsed: used.toString(), hashes: actual };
  }

  try {
    const incremental = await open();
    // Skip the standalone deposit stage first so one refresh spans creation and consumption.
    for (const row of [ledger[0], ledger[3], ledger[4], ledger[5], ledger[1]]) {
      incompleteActivity = row === ledger[3];
      height = row.height;
      if (row !== ledger[0]) await incremental.getByRole('button', { name: 'Refresh', exact: true }).first().click();
      const observed = await observation(incremental);
      const cold = await open();
      assert.deepEqual(await observation(cold), observed);
      await cold.close();
      if (incompleteActivity) assert(activityRejected);
      console.log(hex(height), observed.capacity, observed.count, observed.sharedUsed, observed.hashes.length);
    }
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
