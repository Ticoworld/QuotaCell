import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as c from '@ckb-ccc/core';
import { buildOwnerTransaction } from '../../frontend/src/pocketOwner.ts';
import { buildPayment } from '../../frontend/src/pocketPayment.ts';

export async function qualifyBrowserBuilders({ rpc, live, commit, raw, deps, client, deployed, privateKeys, other, CKB, url, genesis }) {
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
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../../frontend/src/browserPudge.ts', import.meta.url))],
    bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'isolated-chain-only', setup(plugin) {
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
  globalThis.fetch = async (target, options) => {
    const request = options?.body && JSON.parse(options.body);
    if (String(target) === url && request?.method === 'get_fee_rate_statistics') {
      return Response.json({ result: { median: '0x3e8' } });
    }
    if (String(target) === url && request?.method === 'get_cells' && request.params[0].script.code_hash ===
        '0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a' && fundFailure) {
      if (request.params.length === 4 && fundFailure === 'interrupted') throw new Error('Interrupted fund pagination');
      const response = await originalFetch(target, options);
      const body = await response.json();
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
  const prepared = await pipeline.prepareBrowserOwner(scope, ownerRequest);
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
  for (let attempt = 0; attempt < 15; attempt++) await rpc('generate_block');
  await waitForIndexer();
  const recovered = await restarted.reconcileBrowser(scope);
  assert.equal(recovered.outcomes.find(outcome => outcome.txHash === signedDeposit.hash()).state, 'committed');
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
  console.log(JSON.stringify({ result: 'PASS', operations: results, terminal: policyPoint }));
}


