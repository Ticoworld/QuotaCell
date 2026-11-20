import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as c from '@ckb-ccc/core';
import { buildOwnerTransaction } from '../../frontend/src/pocketOwner.ts';
import { buildPayment } from '../../frontend/src/pocketPayment.ts';

export async function qualifyBrowserBuilders({ rpc, live, commit, raw, deps, client, deployed, privateKeys, other, CKB, url, genesis, browser, provider }) {
  const signers = privateKeys.map(key => new c.SignerCkbPrivateKey(client, '0x' + key));
  const [owner, alice, ben] = signers;
  const recipient = other.slice(0, 2).map(signer => c.Script.from({
    codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
    hashType: 'type', args: c.hashCkb(signer.publicKey).slice(0, 42),
  }));
  const terms = { sharedLimit: String(500n * CKB), delegates: [alice, ben].map((signer, i) => ({
    publicKey: signer.publicKey, recipient: recipient[i], limit: String(250n * CKB), perPayment: String(100n * CKB),
  })) };
  let ownerPoint = { txHash: deployed.hash(), index: 3 };
  const actorPoints = [4, 5].map(index => ({ txHash: deployed.hash(), index }));
  let policyPoint;
  let funds = [];
  const fee = 2000n;
  const ownerDraft = async (operation, extra = {}) => buildOwnerTransaction({
    operation, publicKey: owner.publicKey, owner: await live(ownerPoint),
    policy: policyPoint && await live(policyPoint), deps, fee, terms,
    funds: await Promise.all(funds.map(live)), ...extra,
  });
  const results = [];
  async function commitOwner(operation, extra = {}, draft) {
    const { transaction, position, release } = draft || await ownerDraft(operation, extra);
    const signed = await owner.signOnlyTransaction(transaction);
    assert.equal(signed.hash(), transaction.hash());
    assert.equal(signed.getWitnessArgs(position).inputType, transaction.getWitnessArgs(position).inputType);
    await commit(signed);
    ownerPoint = { txHash: signed.hash(), index: signed.outputs.length - 1 };
    if (operation === 'deposit') funds.push({ txHash: signed.hash(), index: 0 });
    else policyPoint = { txHash: signed.hash(), index: 0 };
    if (operation === 'close' || operation === 'sweep') funds = [];
    results.push(operation);
    console.log('VM PASS', operation, signed.hash());
    return { signed, release };
  }
  const counters = async () => {
    const data = Buffer.from((await live(policyPoint)).cell.data.content.slice(2), 'hex');
    return [24, 280, 434].map(offset => data.readBigUInt64LE(offset));
  };
  async function payment(delegate, override) {
    const policy = await live(policyPoint);
    if (override) policy.cell.data.content = override(policy.cell.data.content);
    const tx = buildPayment({ policy, actor: await live(actorPoints[delegate]), funds: await Promise.all(funds.map(live)), deps, fee, amount: 61n * CKB, delegate });
    return signers[delegate + 1].signOnlyTransaction(tx);
  }
  async function commitPayment(delegate, signed) {
    await commit(signed);
    policyPoint = { txHash: signed.hash(), index: 0 };
    funds = [{ txHash: signed.hash(), index: 1 }];
    actorPoints[delegate] = { txHash: signed.hash(), index: 3 };
    results.push('pay-' + delegate);
    console.log('VM PASS', 'pay-' + delegate, signed.hash());
  }
  const compile = (entry, extra = {}) => build({
    entryPoints: [fileURLToPath(new URL('../../frontend/src/' + entry, import.meta.url))],
    ...extra, bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'isolated-chain-only', setup(plugin) {
      plugin.onLoad({ filter: /[.]css$/ }, () => ({ loader: 'empty', contents: '' }));
      plugin.onLoad({ filter: /wallet[.]ts$/ }, async ({ path }) => ({
        loader: 'ts', contents: (await fs.readFile(path, 'utf8')).replace('0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606', genesis),
      }));
      plugin.onLoad({ filter: /pudge-deployment[.]json$/ }, () => ({
        loader: 'json', contents: JSON.stringify({ genesis, allDeps: deps, verification: {
          qDataHash: '0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e',
        } }),
      }));
      plugin.onLoad({ filter: /browserPudge[.]ts$/ }, async ({ path }) => ({
        loader: 'ts', contents: (await fs.readFile(path, 'utf8')).replace(
          /async function discoverFunds[\s\S]+?(?=async function snapshot)/,
          source => source.replaceAll("'0x64'", "'0x2'").replaceAll('length <= 100', 'length <= 2').replaceAll('length < 100', 'length < 2'),
        ),
      }));
      plugin.onLoad({ filter: /publicDiscovery[.]ts$/ }, async ({ path }) => ({
        loader: 'ts', contents: (await fs.readFile(path, 'utf8'))
          .replace('https://testnet.ckb.dev/', url)
          .replace('0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606', genesis)
          .replace('ckb_testnet', 'ckb_dev'),
      }));
    } }],
  });
  const compiled = await compile('browserPudge.ts');
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64');
  const pipeline = await import(moduleUrl);
  const journal = new Map();
  globalThis.localStorage = { getItem: key => journal.get(key), setItem: (key, value) => journal.set(key, value) };
  Object.defineProperty(navigator, 'locks', { value: { request: (_, action) => action() } });
  const originalFetch = fetch;
  let dropResponse = false;
  let broadcasts = 0;
  let fundFailure;
  let fundPage;
  let delayedIndexerTip;
  let omittedFund;
  globalThis.fetch = async (target, options) => {
    const request = options?.body && JSON.parse(options.body);
    if (String(target) === url && request?.method === 'get_indexer_tip' && delayedIndexerTip) {
      return Response.json({ result: delayedIndexerTip });
    }
    if (String(target) === url && request?.method === 'get_fee_rate_statistics') {
      return Response.json({ result: { median: '0x3e8' } });
    }
    if (String(target) === url && request?.method === 'get_cells' && request.params[0].script.code_hash ===
        '0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a' && (fundFailure || omittedFund)) {
      if (fundFailure === 'unavailable') return new Response(null, { status: 503 });
      if (request.params.length === 4 && fundFailure === 'interrupted') throw new Error('Interrupted fund pagination');
      const response = await originalFetch(target, options);
      const body = await response.json();
      if (omittedFund) body.result.objects = body.result.objects.filter(item => item.out_point.tx_hash !== omittedFund);
      if (request.params.length === 3) fundPage = structuredClone(body.result);
      else if (fundFailure === 'repeated') body.result = fundPage;
      else if (fundFailure === 'malformed') body.result.objects = null;
      else if (fundFailure === 'inconsistent') {
        const ordinary = body.result.objects.find(item => !item.output.type && item.output_data === '0x');
        if (ordinary) ordinary.output.capacity = '0x1';
        else body.result.objects[0].output_data = 'invalid';
      }
      return Response.json(body);
    }
    if (String(target) === url && request?.method === 'send_transaction') {
      broadcasts++;
      const response = await originalFetch(target, options);
      const message = await response.clone().json();
      assert.equal(typeof message.result, 'string', JSON.stringify(message));
      if (dropResponse) throw new Error('Test transport dropped the accepted submission response');
      return response;
    }
    return originalFetch(target, options);
  };
  const waitForIndexer = async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const [tip, indexed] = await Promise.all([rpc('get_tip_header'), rpc('get_indexer_tip')]);
      if (tip.hash === indexed?.block_hash) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Isolated indexer failed to reach the canonical tip');
  };
  const genesisRequest = { ...terms, id: crypto.randomUUID(), draftId: crypto.randomUUID(), publicKey: owner.publicKey, operation: 'genesis' };
  const creation = pipeline.actorCreationScope(owner.publicKey);
  const genesisReview = await pipeline.prepareBrowserOwner(creation, genesisRequest);
  await pipeline.validateBeforeSigning(creation, genesisReview);
  const genesisSigned = await owner.signOnlyTransaction(c.Transaction.fromBytes(genesisReview.transaction));
  await pipeline.persistBrowserSignature(creation, genesisReview.id, genesisSigned.toHex());
  const genesisConsent = { hash: genesisSigned.hash(), publicKey: owner.publicKey, verifySigner: async () => alice.publicKey };
  const switched = await pipeline.submitBrowserPayment(creation, genesisReview.id, genesisSigned.toHex(), genesisConsent);
  assert.match(switched.error, /account changed/i);
  assert.equal(broadcasts, 0);
  genesisConsent.verifySigner = async () => owner.publicKey;
  dropResponse = true;
  const creationLost = await pipeline.submitBrowserPayment(creation, genesisReview.id, genesisSigned.toHex(), genesisConsent);
  dropResponse = false;
  assert.equal(creationLost.state, 'uncertain', JSON.stringify(creationLost));
  const reloadedCreation = await import(moduleUrl + '#creation-reload');
  assert.equal(reloadedCreation.readPendingCreation(alice.publicKey), undefined);
  assert.equal(reloadedCreation.readPendingCreation(owner.publicKey).hash, genesisSigned.hash());
  assert.deepEqual((await reloadedCreation.reconcileBrowser(creation, alice.publicKey)).outcomes, []);
  const modernJournalKey = [...journal.keys()].find(key => key.endsWith(':' + creation));
  const legacyJournalKey = modernJournalKey.slice(0, -owner.publicKey.length - 1);
  journal.set(legacyJournalKey, journal.get(modernJournalKey));
  journal.delete(modernJournalKey);
  assert.deepEqual((await reloadedCreation.reconcileBrowser('creation', alice.publicKey)).outcomes, []);
  for (let attempt = 0; attempt < 15; attempt++) await rpc('generate_block');
  await waitForIndexer();
  const creationRecovered = await reloadedCreation.reconcileBrowser('creation', owner.publicKey);
  assert.equal(creationRecovered.outcomes[0].state, 'committed');
  assert.equal(creationRecovered.outcomes[0].txHash, genesisSigned.hash());
  assert.equal(reloadedCreation.readPendingCreation(owner.publicKey).ownerRequest.draftId, genesisRequest.draftId);
  assert.equal(broadcasts, 1);
  policyPoint = { txHash: genesisSigned.hash(), index: 0 };
  ownerPoint = { txHash: genesisSigned.hash(), index: 1 };
  results.push('genesis');
  console.log('Pipeline PASS creation lost response, reload, account switch, legacy recovery and one broadcast');
  await commitOwner('deposit', { amount: 250n * CKB });
  await waitForIndexer();
  const pocket = (await live(policyPoint)).cell.output.type;
  const scope = c.Script.from({ codeHash: pocket.code_hash, hashType: pocket.hash_type, args: pocket.args }).hash();
  const protectedLock = c.Script.from({
    codeHash: '0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a',
    hashType: 'data1', args: scope,
  });
  const source = await live(ownerPoint);
  const ownerLock = c.Script.from({ codeHash: source.cell.output.lock.code_hash, hashType: 'type', args: source.cell.output.lock.args });
  const unsupported = c.Transaction.from({
    inputs: [{ previousOutput: ownerPoint, since: 0 }],
    outputs: [
      { capacity: 150n * CKB, lock: protectedLock, type: { codeHash: '0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1', hashType: 'data1', args: '0x' } },
      { capacity: 75n * CKB, lock: protectedLock },
      { capacity: BigInt(source.cell.output.capacity) - 225n * CKB - fee, lock: ownerLock },
    ],
    outputsData: ['0x', '0x01', '0x'], cellDeps: deps.slice(0, 2), witnesses: ['0x'],
  });
  unsupported.setWitnessArgs(0, { lock: '0x' + '00'.repeat(65) });
  const injected = await owner.signOnlyTransaction(unsupported);
  await commit(injected);
  ownerPoint = { txHash: injected.hash(), index: 2 };
  await waitForIndexer();
  const withUnsupported = await pipeline.browserState(scope, owner.publicKey);
  assert.equal(withUnsupported.unsupportedFunds.length, 2);
  assert.equal(BigInt(withUnsupported.fundShannons), 250n * CKB);
  for (const fault of ['interrupted', 'repeated', 'malformed', 'inconsistent']) {
    fundFailure = fault;
    await assert.rejects(pipeline.browserState(scope, owner.publicKey));
  }
  fundFailure = undefined;
  assert.equal((await pipeline.browserState(scope, owner.publicKey)).unsupportedFunds.length, 2);
  console.log('Pipeline PASS fund pagination, mixed cells, duplicate pages, interrupted and malformed data');
  const ownerRequest = { id: crypto.randomUUID(), publicKey: owner.publicKey, operation: 'deposit', amount: '250' };
  fundFailure = 'unavailable';
  const prepared = await pipeline.prepareBrowserOwner(scope, ownerRequest);
  fundFailure = undefined;
  await pipeline.validateBeforeSigning(scope, prepared);
  assert.equal((await pipeline.prepareBrowserOwner(scope, ownerRequest)).transaction, prepared.transaction);
  const independent = c.Transaction.fromBytes(prepared.transaction);
  const [first, competing] = await Promise.all([payment(0), payment(1)]);
  assert(first.inputs[0].previousOutput.eq(competing.inputs[0].previousOutput));
  await commitPayment(0, first);
  await assert.rejects(rpc('dry_run_transaction', [raw(competing)]));
  await waitForIndexer();
  await pipeline.validateBeforeSigning(scope, prepared);
  const signedDeposit = await owner.signOnlyTransaction(independent);
  await assert.rejects(pipeline.persistBrowserSignature(scope, prepared.id, prepared.transaction), /signature/i);
  await pipeline.persistBrowserSignature(scope, prepared.id, signedDeposit.toHex());
  const restarted = await import(moduleUrl + '#restart');
  assert.equal(restarted.readBrowserIntent(scope, owner.publicKey).hash, signedDeposit.hash());
  await assert.rejects(restarted.submitBrowserPayment(scope, prepared.id, signedDeposit.toHex()), /approval/i);
  const consent = { hash: signedDeposit.hash(), publicKey: owner.publicKey, verifySigner: async () => owner.publicKey };
  broadcasts = 0;
  dropResponse = true;
  const lost = await restarted.submitBrowserPayment(scope, prepared.id, signedDeposit.toHex(), consent);
  dropResponse = false;
  assert.equal(lost.state, 'uncertain', JSON.stringify(lost));
  assert.equal(broadcasts, 1);
  assert.equal((await restarted.submitBrowserPayment(scope, prepared.id, signedDeposit.toHex(), consent)).state, 'uncertain');
  assert.equal(broadcasts, 1);
  const priorIndexerTip = await rpc('get_indexer_tip');
  for (let attempt = 0; attempt < 15; attempt++) await rpc('generate_block');
  await waitForIndexer();
  delayedIndexerTip = priorIndexerTip;
  const recovered = await restarted.reconcileBrowser(scope);
  assert.equal(recovered.outcomes.find(outcome => outcome.txHash === signedDeposit.hash()).state, 'committed');
  await assert.rejects(restarted.browserState(scope, owner.publicKey), /awaiting Pocket synchronization/);
  delayedIndexerTip = undefined;
  omittedFund = signedDeposit.hash();
  await assert.rejects(restarted.browserState(scope, owner.publicKey), /awaiting Pocket synchronization/);
  omittedFund = undefined;
  const journalKey = [...journal.keys()].find(key => key.endsWith(':' + scope));
  const oldRecords = JSON.parse(journal.get(journalKey));
  const oldDeposit = oldRecords.find(item => item.hash === signedDeposit.hash());
  delete oldDeposit.committedHeight;
  delete oldDeposit.committedBlock;
  journal.set(journalKey, JSON.stringify(oldRecords));
  assert.equal((await restarted.browserState(scope, owner.publicKey)).unresolved, false);
  const migrated = JSON.parse(journal.get(journalKey)).find(item => item.hash === signedDeposit.hash());
  assert.equal(await rpc('get_block_hash', [migrated.committedHeight]), migrated.committedBlock);
  console.log('Pipeline PASS omitted output fails closed and legacy commit receives canonical anchor');
  console.log('Pipeline PASS canonical deposit stays gated until the indexer catches up');
  assert.equal(broadcasts, 1);
  console.log('Pipeline PASS independent deposit, reload, exact consent, dropped response and same-hash recovery');
  funds.push({ txHash: signedDeposit.hash(), index: 0 });
  ownerPoint = { txHash: signedDeposit.hash(), index: 1 };
  results.push('deposit');
  for (const mutate of [
    tx => { tx.outputs[2].lock = recipient[0]; },
    tx => { tx.outputs[2].capacity += 1n; },
    tx => { tx.setWitnessArgs(1, { lock: '0x' + '00'.repeat(65), inputType: '0x5143413107ff0000' }); },
    tx => { tx.inputs.push(tx.inputs[2]); },
    tx => { tx.outputs[3].capacity -= 1_000_001n; },
  ]) {
    const tampered = c.Transaction.fromBytes((await payment(1)).toBytes());
    mutate(tampered);
    await assert.rejects(rpc('dry_run_transaction', [raw(tampered)]));
  }
  await commitPayment(1, await payment(1));
  assert.deepEqual(await counters(), [122n, 61n, 61n].map(value => value * CKB));
  await commitOwner('admin', { admin: { shared: 50n * CKB, alice: 20n * CKB, ben: 20n * CKB, mask: 0 } });
  const wrongOwner = (await ownerDraft('revoke', { mask: 1 })).transaction;
  const delegateInput = await live(actorPoints[0]);
  wrongOwner.inputs[1] = c.CellInput.from({ previousOutput: actorPoints[0], since: 0 });
  wrongOwner.outputs[1].capacity = BigInt(delegateInput.cell.output.capacity) - fee;
  await assert.rejects(rpc('dry_run_transaction', [raw(await alice.signOnlyTransaction(wrongOwner))]), /Inputs\[0\]\.Type.*error code 15/);
  console.log('VM PASS independently signed wrong-owner revoke rejected by QCN4 type script');
  const outdated = await payment(0);
  await commitOwner('revoke', { mask: 1 });
  await assert.rejects(rpc('dry_run_transaction', [raw(outdated)]));
  const spoofEnable = hex => { const bytes = Buffer.from(hex.slice(2), 'hex'); bytes[7] |= 1; return '0x' + bytes.toString('hex'); };
  const revoked = await payment(0, spoofEnable);
  await assert.rejects(rpc('dry_run_transaction', [raw(revoked)]), /17/);
  await commitOwner('admin', { admin: { shared: 0n, alice: 0n, ben: 0n, mask: 1 } });
  assert.deepEqual(await counters(), [122n, 61n, 61n].map(value => value * CKB));
  await commitOwner('revoke', { mask: 1 });
  const poisonedClose = await ownerDraft('close');
  poisonedClose.transaction.inputs.push(c.CellInput.from({ previousOutput: { txHash: injected.hash(), index: 1 }, since: 0 }));
  poisonedClose.transaction.witnesses.push('0x');
  await assert.rejects(rpc('dry_run_transaction', [raw(await owner.signOnlyTransaction(poisonedClose.transaction))]));
  const { signed, release } = await commitOwner('close');
  assert.equal(release, 466n * CKB);
  assert.equal(signed.outputs[0].capacity, 134n * CKB);
  await commitOwner('deposit', { amount: 100n * CKB });
  await commitOwner('sweep');
  const terminal = await live(policyPoint);
  assert.match(terminal.cell.data.content, /^0x5143543404000100/);
  assert.equal(BigInt(terminal.cell.output.capacity), 134n * CKB);
  await waitForIndexer();
  const terminalState = await pipeline.browserState(scope, owner.publicKey);
  assert.equal(terminalState.closed, true);
  assert.equal(terminalState.unsupportedFunds.length, 2);
  console.log('VM PASS typed and data-bearing deposits remain separate through payment, closure and sweep');
  assert.equal(terminalState.owner, owner.publicKey);
  const history = await pipeline.browserHistory(terminalState);
  assert.deepEqual(history.map(item => item.operation), results.map(operation => operation.startsWith('pay-') ? 'pay' : operation));
  console.log('Pipeline PASS terminal discovery and ordered canonical history');
  const ui = await compile('main.tsx', { jsx: 'automatic', define: {
    'import.meta.env.VITE_QUOTACELL_BROWSER': '"1"',
    'import.meta.env.DEV': 'false',
    'process.env.NODE_ENV': '"production"',
  } });
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(10000);
    const origin = 'http://localhost:18341';
    await page.addInitScript({ content: 'window.__testKey = ' + JSON.stringify('0x' + privateKeys[0]) + ';' + provider });
    await page.route(origin + '/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: ui.outputFiles[0].text });
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' });
    });
    let delayHistory = false;
    let failPocketOpen = false;
    await page.route(url + '/**', async route => {
      const request = route.request().postDataJSON();
      if (failPocketOpen && request.method === 'get_cells') {
        failPocketOpen = false;
        return route.fulfill({ status: 503, body: 'Temporary indexer failure' });
      }
      if (delayHistory && request.method === 'get_transactions' && request.params[0]?.filter?.block_range) {
        return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: null } });
      }
      const result = request.method === 'get_fee_rate_statistics' ? { median: '0x3e8' } : await rpc(request.method, request.params);
      await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result } });
    });
    const address = lock => c.Address.fromScript(lock, new c.ClientPublicTestnet()).toString();
    const identities = signers.map(signer => ({
      publicKey: signer.publicKey,
      address: address(c.Script.from({ codeHash: recipient[0].codeHash, hashType: 'type', args: c.hashCkb(signer.publicKey).slice(0, 42) })),
      name: '', description: '',
    }));
    const draftId = crypto.randomUUID();
    const unrelated = crypto.randomUUID();
    const draftKey = 'quotacell.drafts.v1:' + genesis + ':' + owner.publicKey;
    await page.addInitScript(({ draftKey, draftId, unrelated, identities, recipients }) => {
      if (sessionStorage.getItem('fixture-initialized')) return;
      sessionStorage.setItem('fixture-initialized', '1');
      localStorage.setItem(draftKey, JSON.stringify([{ id: draftId, updatedAt: 2 }, { id: unrelated, updatedAt: 1 }]));
      localStorage.setItem(draftKey + ':draft:' + draftId, JSON.stringify({
        step: 2, people: { owner: identities[0], alice: identities[1], ben: identities[2] },
        terms: { shared: '500', firstLimit: '250', secondLimit: '250', firstMax: '100', secondMax: '100', firstRecipient: recipients[0], secondRecipient: recipients[1] },
      }));
    }, { draftKey, draftId, unrelated, identities, recipients: recipient.map(address) });
    const sent = [];
    let loseResponse = false;
    await page.route(url + '/**', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const request = route.request().postDataJSON();
      if (request.method !== 'send_transaction') return route.fallback();
      const hash = await rpc(request.method, request.params);
      sent.push(hash);
      for (let attempt = 0; attempt < 8; attempt++) await rpc('generate_block');
      await waitForIndexer();
      if (loseResponse) { loseResponse = false; return route.abort(); }
      return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: hash } });
    });

    const button = (name, within = page) => within.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog');
    const connect = async (index, role, key = privateKeys[index]) => {
      if (await page.locator('.disconnect-button').count()) await page.locator('.disconnect-button').click();
      await page.evaluate(key => window.switchTestWallet(key), key);
      await button('Connect wallet').first().click();
      const picker = page.locator('ccc-connector');
      await picker.getByText('UTXO Global Wallet', { exact: true }).click();
      await picker.getByText('CKB', { exact: true }).click();
      await page.locator('.connected-account strong').getByText(role, { exact: true }).waitFor();
    };
    const review = async (action, values = [], opener = button(action)) => {
      await opener.click();
      const fields = dialog.locator('input[inputmode=decimal]');
      for (const [index, value] of values.entries()) await fields.nth(index).fill(value);
      const started = await page.evaluate(() => performance.now());
      await button(action === 'Pay' ? 'Review payment' : 'Prepare transaction', dialog).click();
      await dialog.getByRole('heading', { name: 'Review transaction' }).waitFor();
      const metrics = await page.evaluate(start => {
        const entries = performance.getEntriesByType('measure').filter(entry =>
          entry.startTime >= start && entry.name.startsWith('quotacell.transport.'));
        return {
          ms: Math.round(performance.now() - start), calls: entries.length,
          failures: entries.filter(entry => entry.detail.outcome !== 'ok').length,
          bytes: entries.reduce((sum, entry) => sum + entry.detail.requestBytes + entry.detail.responseBytes, 0),
        };
      }, started);
      console.log('Preparation sample', action, JSON.stringify(metrics));
    };
    const confirm = async (action, opts = {}) => {
      const before = sent.length;
      const reviewed = await dialog.innerText();
      const signer = await page.evaluate(() => window.testWallet.address);
      assert(reviewed.includes(signer), action + ' reviewed signer');
      assert(/Pudge/i.test(reviewed), action + ' reviewed network');
      const feeMatch = (await dialog.getByText('Network fee', { exact: true }).locator('..').locator('strong').innerText()).match(/([\d.]+)\s*CKB/i);
      assert(feeMatch, action + ' reviewed fee');
      const [whole, fraction = ''] = feeMatch[1].split('.');
      const reviewedFee = BigInt(whole) * CKB + BigInt(fraction.padEnd(8, '0'));

      await button(action, dialog).click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      assert.equal(sent.length, before + 1, action);
      const hash = sent.at(-1);
      if (opts.reload) {
        assert(await page.locator('.transaction-notice').count() <= 1);
        assert.equal(await page.locator('[data-sonner-toast]').count(), 0);
        await page.reload();
      }
      const historyRow = page.locator('.history-row').filter({ has: page.locator('a[href$="' + hash + '"]') });
      if (opts.historyLag) {
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(
          button => button.textContent.trim() === 'Add funds' && !button.disabled,
        ));
        assert.equal(await historyRow.count(), 0, 'Owner controls recover before history');
        delayHistory = false;
      }
      await historyRow.waitFor({ timeout: 25000 });
      assert.equal(sent.length, before + 1, 'No duplicate broadcast');
      const record = await rpc('get_transaction', [hash]);
      assert.equal(record.tx_status.status, 'committed');
      const header = await rpc('get_header', [record.tx_status.block_hash]);
      assert.equal(await rpc('get_block_hash', [header.number]), header.hash);
      const consumed = await Promise.all(record.transaction.inputs.map(async input => {
        const previous = await rpc('get_transaction', [input.previous_output.tx_hash]);
        return BigInt(previous.transaction.outputs[Number(BigInt(input.previous_output.index))].capacity);
      }));
      const produced = record.transaction.outputs.reduce((sum, output) => sum + BigInt(output.capacity), 0n);
      assert.equal(consumed.reduce((sum, capacity) => sum + capacity, 0n) - produced, reviewedFee);
      console.log('React + canonical CKB PASS', action, hash);
      return record.transaction;
    };
    const policyBytes = tx => Buffer.from(tx.outputs_data[0].slice(2), 'hex');
    const checkUsage = (tx, expected) => assert.deepEqual([24, 280, 434].map(offset => policyBytes(tx).readBigUInt64LE(offset) / CKB), expected);
    const checkFund = (tx, amount, index = 0) => {
      assert.equal(tx.outputs[index].lock.args, new URL(page.url()).searchParams.get('pocket'));
      assert.equal(BigInt(tx.outputs[index].capacity), amount * CKB);
    };

    await page.goto(origin + '/');
    await connect(0, 'Connected');
    await page.getByRole('button', { name: /Resume/ }).first().click();
    await page.getByRole('button', { name: /Create and review in wallet|Prepare for review/i }).click();
    await dialog.getByRole('heading', { name: 'Review transaction' }).waitFor();
    const created = await confirm('Create Pocket');
    assert.equal(BigInt(created.outputs[0].capacity), 600n * CKB);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).map(d => d.id), draftKey), [unrelated]);
    const createdUrl = page.url();
    failPocketOpen = true;
    await page.goto(createdUrl);
    await page.getByText('Protected balance', { exact: true }).waitFor();
    assert.equal(failPocketOpen, false);
    assert.equal(await page.getByRole('heading', { name: 'Pocket could not be opened' }).count(), 0);
    console.log('Pipeline PASS Pocket opens after a transient indexer failure without manual retry');
    await connect(0, 'This wallet has no permission in this Pocket.', other[2].privateKey);
    for (const action of ['Pay', 'Add funds', 'Update permissions', 'Close and recover', 'Revoke permission']) {
      assert.equal(await button(action).count(), 0, action);
    }
    await connect(0, 'Pocket owner');
    for (let index = 0; index < 2; index++) {
      await review('Add funds', ['250']);
      if (!index) {
        await page.evaluate(() => { window.testWallet.mode = 'reject'; });
        await button('Add funds', dialog).click();
        await dialog.getByText(/reject/i).first().waitFor();
        assert.equal(sent.length, 1);
        await page.evaluate(() => { window.testWallet.mode = 'ok'; });
      } else loseResponse = true;
      delayHistory = index === 0;
      checkFund(await confirm('Add funds', { reload: index === 1, historyLag: index === 0 }), 250n);
      if (index === 1 && !await page.locator('.disconnect-button').count()) await connect(0, 'Pocket owner');
    }
    for (const index of [1, 2]) {
      await connect(index, 'Delegate ' + index);
      assert.equal(await button('Update permissions').count(), 0);
      await review('Pay', ['61']);
      const paymentReview = await dialog.innerText();
      assert(paymentReview.includes('61 CKB'));
      assert(paymentReview.includes(address(recipient[index - 1])));
      const paid = await confirm('Sign and send payment');
      assert.equal(BigInt(paid.outputs[2].capacity), 61n * CKB);
      assert.equal(paid.outputs[2].lock.args, recipient[index - 1].args);
      checkFund(paid, 500n - 61n * BigInt(index), 1);
      checkUsage(paid, index === 1 ? [61n, 61n, 0n] : [122n, 61n, 61n]);
    }
    await connect(0, 'Pocket owner');
    await review('Update permissions', ['50', '20', '20']);
    const increased = await confirm('Update permissions');
    assert.deepEqual([8, 264, 418].map(offset => policyBytes(increased).readBigUInt64LE(offset) / CKB), [550n, 270n, 270n]);
    const revoke = async () => {
      await review('Revoke permission', [], button('Revoke permission').first());
      assert.equal(policyBytes(await confirm('Revoke permission'))[7] & 1, 0);
    };
    await revoke();
    await connect(1, 'Delegate 1');
    assert.equal(await button('Pay').count(), 0);
    await connect(0, 'Pocket owner');
    await button('Update permissions').click();
    await dialog.getByRole('checkbox', { name: /Reactivate Delegate 1/ }).check();
    await button('Prepare transaction', dialog).click();
    await dialog.getByRole('heading', { name: 'Review transaction' }).waitFor();
    const reactivated = await confirm('Update permissions');
    assert.equal(policyBytes(reactivated)[7] & 1, 1);
    checkUsage(reactivated, [122n, 61n, 61n]);
    await revoke();
    await review('Close and recover');
    const closed = await confirm('Close and recover');
    assert.equal(BigInt(closed.outputs[0].capacity), 134n * CKB);
    assert.equal(BigInt(closed.outputs[1].capacity), 378n * CKB);
    assert.equal(600n * CKB - BigInt(closed.outputs[0].capacity), 466n * CKB);
    await review('Add late funds', ['100']);
    checkFund(await confirm('Add late funds'), 100n);
    await review('Recover late deposit');
    const swept = await confirm('Recover late funds');
    assert.equal(BigInt(swept.outputs[1].capacity), 100n * CKB);
    await page.goto(createdUrl);
    await page.getByRole('heading', { name: 'Pocket closed' }).waitFor();
    await page.locator('.history-row').filter({ hasText: 'Recover late funds' }).first().waitFor();
    await page.locator('.history-row').nth(7).waitFor();
    assert.deepEqual(await page.locator('.history-row a').evaluateAll(links => links.map(link => link.href.split('/').at(-1))), [...sent].reverse().slice(0, 8));

  } finally {
    await page.close();
  }
  console.log(JSON.stringify({ result: 'PASS', operations: results, terminal: policyPoint }));
}
