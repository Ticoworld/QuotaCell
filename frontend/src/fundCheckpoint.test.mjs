import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the production enumeration with deterministic node and live-read boundaries.
const source = ts.createSourceFile('browserPudge.ts',
  readFileSync(new URL('./browserPudge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['requireCondition', 'FundCheckpointError', 'discoverFunds']);
const declarations = source.statements.filter(node => names.has(node.name?.text))
  .map(node => node.getText(source).replace(/^export /, '')).join('\n');
const create = new Function('httpRpc', 'live', 'rpcFormat', 'hex', 'fundCode',
  ts.transpile(declarations) + '\nreturn discoverFunds');

const hash = digit => '0x' + digit.repeat(64);
const opening = { block_number: '0x64', block_hash: hash('a') };
const next = { block_number: '0x65', block_hash: hash('b') };
const output = { type: null, capacity: '0x100', lock: { code_hash: 'fund', hash_type: 'data1', args: 'pocket' } };
const cell = index => ({ out_point: { tx_hash: hash('c'), index: '0x' + index.toString(16) }, output, output_data: '0x' });

async function scan({ closing = opening, openingHash = opening.block_hash, closingHash = openingHash,
  height = '0x65', pages = [[cell(0)]], liveError, rpcError } = {}) {
  let tips = 0, anchors = 0, page = 0;
  const rpc = async (method, [param] = []) => {
    if (method === rpcError) throw new Error('fixture transport failure');
    if (method === 'get_indexer_tip') return tips++ === 0 ? opening : closing;
    if (method === 'get_tip_header') return { number: height };
    if (method === 'get_block_hash') return param === next.block_number ? next.block_hash : anchors++ === 0 ? openingHash : closingHash;
    if (method === 'get_cells') return { objects: pages[page] ?? [], last_cursor: String(++page) };
    throw new Error(method);
  };
  const live = async () => {
    if (liveError) throw new Error(liveError);
    return { cell: { output, data: { content: '0x' } } };
  };
  const transform = { cellOutputTo: value => value, cellOutputFrom: value => value };
  return create(rpc, live, transform, number => '0x' + number.toString(16), 'fund')('pocket');
}

assert.equal((await scan()).funds.length, 1);
assert.equal((await scan({ pages: [[]] })).funds.length, 0);
assert.equal((await scan({ pages: [[cell(0), cell(1)]] })).funds.length, 2);
// The original page is identical when a deposit or spend lands after it was read.
for (const pages of [[[cell(0)]], [Array.from({ length: 100 }, (_, index) => cell(index)), [cell(100)]]]) {
  await assert.rejects(scan({ closing: next, pages }), { reason: 'advanced' });
}
await assert.rejects(scan({ liveError: 'Input is stale' }), /Input is stale/);
await assert.rejects(scan({ closing: { ...opening, block_hash: hash('d') } }), { reason: 'canonical' });
await assert.rejects(scan({ closing: next, closingHash: hash('d') }), { reason: 'canonical' });
await assert.rejects(scan({ openingHash: hash('d') }), { reason: 'canonical' });
await assert.rejects(scan({ closing: { ...opening, block_number: '0x63' } }), { reason: 'lag' });
await assert.rejects(scan({ height: '0xc0' }), { reason: 'lag' });
await assert.rejects(scan({ rpcError: 'get_cells' }), /transport failure/);
console.log('Fund enumeration rejects incomplete or conflicting snapshots.');
