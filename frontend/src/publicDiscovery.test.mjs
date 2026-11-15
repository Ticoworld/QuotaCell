import assert from 'node:assert/strict';
import { discoverPublicPockets, publicDiscoveryNetwork } from './publicDiscovery.ts';

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
await assert.rejects(discoverPublicPockets(publicKey, async (method) => method === 'get_consensus' ? { id: 'ckb_dev' } : null), /not the verified Pudge testnet/);
await assert.rejects(discoverPublicPockets(publicKey, rpcFor({ tip: { number: '0x100', hash: tip.hash }, indexed: { block_number: '0x1', block_hash: tip.hash } })), /too far behind/);
await assert.rejects(discoverPublicPockets(publicKey, rpcFor({ canonical: false })), /not canonical/);
await assert.rejects(discoverPublicPockets('0x1234', rpcFor()), /compressed public key/);
console.log('Hosted discovery rejects wrong network, stale/noncanonical indexer snapshots, and malformed wallet identities');
