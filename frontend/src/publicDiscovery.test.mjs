import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import * as c from '@ckb-ccc/core';
import { discoverPublicPocket, discoverPublicPockets, publicDiscoveryNetwork } from './publicDiscovery.ts';

const publicKey = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const tip = { number: '0x10', hash: `0x${'11'.repeat(32)}` };
const indexed = { block_number: tip.number, block_hash: tip.hash };
function rpcFor(overrides = {}) {
  return async (method, params = []) => {
    if (method === 'get_consensus') return { id: 'ckb_testnet' };
    if (method === 'get_block_hash') return params[0] === '0x0' ? publicDiscoveryNetwork.genesis : (overrides.canonical === false && params[0] === indexed.block_number ? `0x${'22'.repeat(32)}` : tip.hash);
    if (method === 'get_tip_header') return overrides.tip || tip;
    if (method === 'get_indexer_tip') return overrides.indexed || indexed;
    if (method === 'get_cells') return { objects: [], last_cursor: '0x' };
    throw new Error(`Unexpected RPC method ${method}`);
  };
}

assert.deepEqual(await discoverPublicPockets(publicKey, rpcFor()), []);
await assert.rejects(discoverPublicPocket('bad-id', rpcFor()), /Invalid Pocket ID/);
await assert.rejects(discoverPublicPocket(`0x${'33'.repeat(32)}`, rpcFor()), /Pocket was not found/);
await assert.rejects(discoverPublicPocket(`0x${'33'.repeat(32)}`, async () => { throw new Error('RPC offline'); }), /RPC offline/);
function keyFrom(seed) { const ecdh = createECDH('secp256k1'); ecdh.setPrivateKey(Buffer.from(seed.padStart(64, '0'), 'hex')); return `0x${ecdh.getPublicKey(null, 'compressed').toString('hex')}`; }
function write128(data, offset, value) { let amount = BigInt(value); for (let i = 0; i < 16; i++) { data[offset + i] = Number(amount & 255n); amount >>= 8n; } }
const ownerKey = keyFrom('01'), delegateOne = keyFrom('02'), delegateTwo = keyFrom('03'), recipientOne = keyFrom('04'), recipientTwo = keyFrom('05');
const state = Buffer.alloc(466); Buffer.from('51434e34040000', 'hex').copy(state); state[7] = 3; write128(state, 8, 12200000000n);
Buffer.from(ownerKey.slice(2), 'hex').copy(state, 125);
for (const [index, publicKey, recipient] of [[0, delegateOne, recipientOne], [1, delegateTwo, recipientTwo]]) {
  const offset = 158 + 154 * index;
  Buffer.from(publicKey.slice(2), 'hex').copy(state, offset);
  const lock = c.Script.from({ codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: c.hashCkb(c.bytesFrom(recipient)).slice(0, 42) });
  Buffer.from(lock.toBytes()).copy(state, offset + 33);
  write128(state, offset + 106, 6100000000n); write128(state, offset + 138, 6100000000n);
}
const activeType = { code_hash: '0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e', hash_type: 'data2', args: `0x${'44'.repeat(32)}` };
const activeOutput = { capacity: '0x8bb2c97000', lock: { code_hash: '0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1', hash_type: 'data1', args: '0x' }, type: activeType };
const activePoint = { tx_hash: `0x${'55'.repeat(32)}`, index: '0x0' }, activeData = `0x${state.toString('hex')}`;
const activePocketId = c.Script.from({ codeHash: activeType.code_hash, hashType: activeType.hash_type, args: activeType.args }).hash();
const activeRpc = async (method, params = []) => {
  if (method === 'get_consensus') return { id: 'ckb_testnet' };
  if (method === 'get_block_hash') return params[0] === '0x0' ? publicDiscoveryNetwork.genesis : tip.hash;
  if (method === 'get_tip_header') return tip;
  if (method === 'get_indexer_tip') return indexed;
  if (method === 'get_cells') return { objects: [{ out_point: activePoint, block_number: tip.number, output: activeOutput, output_data: activeData }], last_cursor: '0x' };
  if (method === 'get_live_cell') return { status: 'live', cell: { output: activeOutput, data: { content: activeData } } };
  if (method === 'get_transaction') return { tx_status: { status: 'committed', block_hash: tip.hash }, transaction: { outputs: [activeOutput], outputs_data: [activeData] } };
  if (method === 'get_header') return tip;
  throw new Error(`Unexpected RPC method ${method}`);
};
const activeResult = await discoverPublicPocket(activePocketId, activeRpc);
assert.equal(activeResult.closed, false);
assert.equal(activeResult.role, 'public');
assert.equal(activeResult.summary.sharedLimit, '12200000000');
assert.equal(activeResult.summary.delegates.length, 2);
await assert.rejects(discoverPublicPockets(publicKey, async (method) => method === 'get_consensus' ? { id: 'ckb_dev' } : null), /not the verified Pudge testnet/);
await assert.rejects(discoverPublicPockets(publicKey, rpcFor({ tip: { number: '0x100', hash: tip.hash }, indexed: { block_number: '0x1', block_hash: tip.hash } })), /too far behind/);
await assert.rejects(discoverPublicPockets(publicKey, rpcFor({ canonical: false })), /not canonical/);
await assert.rejects(discoverPublicPockets('0x1234', rpcFor()), /compressed public key/);
console.log('Hosted discovery rejects wrong network, stale/noncanonical indexer snapshots, and malformed wallet identities');
