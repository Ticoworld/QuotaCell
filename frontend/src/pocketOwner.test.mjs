import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';
import { Script } from '@ckb-ccc/core';

const fixture = async name => JSON.parse(await readFile(new URL('../../evidence/pocket-native-v2/' + name + '.json', import.meta.url)));
const deps = record => record.transaction.cell_deps.map(dep => ({
  outPoint: { txHash: dep.out_point.tx_hash, index: Number(dep.out_point.index) },
  depType: dep.dep_type === 'dep_group' ? 'depGroup' : 'code',
}));

test('browser owner genesis reconstructs the confirmed QCN4 shape', async () => {
  const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { buildOwnerTransaction } = await vite.ssrLoadModule('/src/pocketOwner.ts');
    const record = await fixture('02-policy-genesis');
    const state = Buffer.from(record.transaction.outputs_data[0].slice(2), 'hex');
    const uint = offset => (state.readBigUInt64LE(offset) + (state.readBigUInt64LE(offset + 8) << 64n)).toString();
    const terms = { sharedLimit: uint(8), delegates: [158, 312].map(offset => ({
      publicKey: '0x' + state.subarray(offset, offset + 33).toString('hex'),
      recipient: Script.fromBytes(state.subarray(offset + 33, offset + 106)),
      limit: uint(offset + 106), perPayment: uint(offset + 138),
    })) };
    const input = { operation: 'genesis', publicKey: record.signing.publicKey, owner: record.resolvedInputs[0], deps: deps(record), terms, fee: BigInt(record.feeShannon) };
    assert.equal(buildOwnerTransaction(input).transaction.hash(), record.txHash);
    assert.throws(() => buildOwnerTransaction({ ...input, owner: { ...input.owner, status: 'dead' } }), /Owner input/);
    assert.throws(() => buildOwnerTransaction({ ...input, terms: { ...terms, delegates: [terms.delegates[0], terms.delegates[0]] } }), /distinct/);
    for (const [operation, name] of [['revoke', 'owner-revoke-alice'], ['close', 'owner-close-recover'], ['sweep', 'owner-late-sweep']]) {
      const existing = await fixture(name);
      const [policy, owner, ...funds] = existing.resolvedInputs;
      const options = { operation, publicKey: record.signing.publicKey, policy, owner, funds, deps: deps(existing), fee: BigInt(existing.feeShannon), mask: 1 };
      const built = buildOwnerTransaction(options);
      assert.equal(built.transaction.hash(), existing.txHash, operation);
      if (operation === 'close') assert.equal(built.release, 46_600_000_000n);
      assert.throws(() => buildOwnerTransaction({ ...options, publicKey: terms.delegates[0].publicKey }), /Owner input/);
      if (funds.length) assert.throws(() => buildOwnerTransaction({ ...options, funds: [...funds, funds[0]] }), /Duplicate inputs/);
    }
  } finally {
    await vite.close();
  }
});
