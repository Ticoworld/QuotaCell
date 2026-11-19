import * as c from '@ckb-ccc/core';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const RPC_URL = 'https://testnet.ckb.dev/';
const GENESIS = '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const POLICY_CODE = '0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const POLICY_LOCK = '0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const STANDARD_LOCK = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const MAX_INDEXER_LAG = 64n;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

type Rpc = <T>(method: string, params?: unknown[]) => Promise<T>;
type Script = { code_hash: string; hash_type: string; args: string };
type OutPoint = { tx_hash: string; index: string };
type PublicPocketSummary = { owner: string; sharedLimit: string; sharedUsed: string; delegates: Array<{ role: 'alice' | 'ben'; publicKey: string; limit: string; used: string; perPayment: string; recipient: string; enabled: boolean }> };
type Discovery = { pocket: string; role: 'owner' | 'alice' | 'ben' | 'public'; closed: boolean; capacity: string; summary: PublicPocketSummary | null; policyScript: Script; outPoint: OutPoint; indexedTip: { block_number: string; block_hash: string } };

function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function normalizedScript(value: Script) { return { code_hash: value.code_hash.toLowerCase(), hash_type: value.hash_type, args: value.args.toLowerCase() }; }
function normalizeOutput(value: any) { return { capacity: value.capacity.toLowerCase(), lock: normalizedScript(value.lock), type: value.type ? normalizedScript(value.type) : null }; }
function parseScript(value: Script) { return c.Script.from({ codeHash: value.code_hash, hashType: value.hash_type, args: value.args }); }
function read128(data: Uint8Array, offset: number) {
  let value = 0n;
  for (let i = 15; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]);
  return value;
}
function bytesFromHex(value: string) {
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(value)) throw new Error('Malformed QCN4/QCT4 state.');
  return Uint8Array.from(value.slice(2).match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
}
function validPublicKey(value: Uint8Array) {
  if (value.length !== 33 || (value[0] !== 2 && value[0] !== 3)) throw new Error('Invalid compressed public key in Pocket state.');
  secp256k1.Point.fromBytes(value);
  return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
function argsFor(publicKey: string) { return c.hashCkb(c.bytesFrom(publicKey)).slice(0, 42); }

const policyScripts = new Map<string, Script>();
const rpcReads = new Map<string, Promise<unknown>>();
let rpcActive = 0;
const rpcQueue: (() => void)[] = [];

export function httpRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const read = method.startsWith('get_');
  const key = JSON.stringify([method, params]);
  const current = read && rpcReads.get(key);
  if (current) return current as Promise<T>;
  const task = (async () => {
    if (rpcActive >= 8) await new Promise<void>(resolve => rpcQueue.push(resolve));
    else rpcActive++;
    const start = performance.now();
    try { return await requestRpc<T>(method, params); }
    finally {
      performance.measure('quotacell.rpc.' + method, { start, end: performance.now() });
      const next = rpcQueue.shift();
      if (next) next();
      else rpcActive--;
    }
  })().finally(() => { if (read) rpcReads.delete(key); });
  if (read) rpcReads.set(key, task);
  return task;
}

async function requestRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Public CKB read failed (${response.status}).`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'Public CKB read failed.');
  return body.result as T;
}

function validateActiveState(cell: any, actor?: string) {
  const state = bytesFromHex(cell.data.content);
  if (state.length !== 466 || Array.from(state.slice(0, 7)).map((v) => v.toString(16).padStart(2, '0')).join('') !== '51434e34040000') throw new Error('Malformed active QCN4 policy state.');
  if ((state[7] & ~3) !== 0 || state.slice(40, 125).some((byte: number) => byte !== 0)) throw new Error('Invalid QCN4 reserved state.');
  const sharedLimit = read128(state, 8), sharedUsed = read128(state, 24);
  if (sharedUsed > sharedLimit) throw new Error('Invalid shared Pocket allowance.');
  const owner = validPublicKey(state.slice(125, 158));
  const delegates = [0, 1].map((index) => {
    const offset = 158 + 154 * index;
    const publicKey = validPublicKey(state.slice(offset, offset + 33));
    const recipientBytes = state.slice(offset + 33, offset + 106);
    if (recipientBytes.length !== 73) throw new Error('Invalid delegate recipient lock.');
    const recipient = c.Script.fromBytes(recipientBytes);
    const limit = read128(state, offset + 106), used = read128(state, offset + 122), perPayment = read128(state, offset + 138);
    if (recipient.codeHash !== STANDARD_LOCK || recipient.hashType !== 'type' || !/^0x[0-9a-f]{40}$/i.test(recipient.args) || used > limit || limit > sharedLimit || perPayment <= 0n || perPayment > limit) throw new Error('Invalid delegate permission in Pocket state.');
    return { publicKey, role: index === 0 ? 'alice' as const : 'ben' as const, limit, used, perPayment, recipient };
  });
  const keys = [owner, ...delegates.map((item) => item.publicKey)];
  if (new Set(keys.map((key) => key.toLowerCase())).size !== 3) throw new Error('Duplicate participant identity in Pocket state.');
  const recipients = delegates.map((delegate) => delegate.recipient);
  if (recipients[0].eq(recipients[1]) || recipients.some((recipient) => keys.some((key) => recipient.args === argsFor(key)))) throw new Error('Duplicate Pocket recipient.');
  if (delegates[0].used + delegates[1].used !== sharedUsed) throw new Error('QCN4 shared usage counters do not match.');
  const role: 'owner' | 'alice' | 'ben' | null = actor ? owner.toLowerCase() === actor.toLowerCase() ? 'owner' : delegates.find((item) => item.publicKey.toLowerCase() === actor.toLowerCase())?.role || null : null;
  return { role, summary: {
    owner, sharedLimit: sharedLimit.toString(), sharedUsed: sharedUsed.toString(),
    delegates: delegates.map((delegate, index) => ({ role: delegate.role, publicKey: delegate.publicKey, limit: delegate.limit.toString(), used: delegate.used.toString(), perPayment: delegate.perPayment.toString(), recipient: delegate.recipient.args, enabled: (state[7] & (1 << index)) !== 0 })),
  } };
}

function candidateRole(cell: any, actor?: string): { role: 'owner' | 'alice' | 'ben' | null; closed: boolean; summary: PublicPocketSummary | null } {
  const type = cell.output.type as Script | null;
  if (!type || type.code_hash.toLowerCase() !== POLICY_CODE || type.hash_type !== 'data2' || !/^0x[0-9a-f]{64}$/i.test(type.args)) throw new Error('Invalid QCN4 Type ID.');
  const lock = cell.output.lock as Script;
  if (lock.code_hash.toLowerCase() !== POLICY_LOCK || lock.hash_type !== 'data1' || lock.args !== '0x') throw new Error('QCN4 policy lock mismatch.');
  const state = bytesFromHex(cell.data.content);
  if (state.length === 466) return { ...validateActiveState(cell, actor), closed: false };
  if (state.length === 28 && Array.from(state.slice(0, 8)).map((v) => v.toString(16).padStart(2, '0')).join('') === '5143543404000100') {
    if (BigInt(cell.output.capacity) < 13_400_000_000n) throw new Error('Insufficient terminal QCT4 capacity.');
    return { role: actor && `0x${Array.from(state.slice(8), (v) => v.toString(16).padStart(2, '0')).join('')}` === argsFor(actor) ? 'owner' as const : null, closed: true, summary: null };
  }
  throw new Error('Malformed QCN4/QCT4 state.');
}

export async function discoverPublicPockets(publicKey: string, rpc: Rpc = httpRpc): Promise<Discovery[]> {
  if (!/^0x0[23][0-9a-f]{64}$/i.test(publicKey)) throw new Error('Invalid compressed public key.');
  secp256k1.Point.fromBytes(c.bytesFrom(publicKey));
  return discover(publicKey, undefined, rpc);
}

export async function discoverPublicPocket(pocketId: string, rpc: Rpc = httpRpc, actor?: string): Promise<Discovery> {
  if (!/^0x[0-9a-f]{64}$/i.test(pocketId)) throw new Error('Invalid Pocket ID.');
  const found = await discover(actor, pocketId.toLowerCase(), rpc);
  const exact = found.find((item) => item.pocket.toLowerCase() === pocketId.toLowerCase());
  if (!exact) throw new Error('Pocket was not found on Pudge.');
  if (found.length !== 1) throw new Error('Ambiguous live Pocket.');
  return exact;
}

async function discover(publicKey: string | undefined, targetPocket: string | undefined, rpc: Rpc): Promise<Discovery[]> {
  const consensus = await rpc<{ id: string }>('get_consensus');
  if (consensus.id !== 'ckb_testnet' || (await rpc<string>('get_block_hash', ['0x0'])).toLowerCase() !== GENESIS) throw new Error('Public RPC is not the verified Pudge testnet.');
  const [tip, indexed] = await Promise.all([rpc<any>('get_tip_header'), rpc<any>('get_indexer_tip')]);
  if (!tip || !indexed || !/^0x[0-9a-f]{64}$/i.test(tip.hash) || !/^0x[0-9a-f]{64}$/i.test(indexed.block_hash)) throw new Error('Invalid node or indexer tip.');
  const nodeHeight = BigInt(tip.number), indexerHeight = BigInt(indexed.block_number);
  if (indexerHeight > nodeHeight || nodeHeight - indexerHeight > MAX_INDEXER_LAG) throw new Error('Pudge indexer is too far behind the node.');
  const canonicalTips = await Promise.all([rpc<string>('get_block_hash', [indexed.block_number]), rpc<string>('get_block_hash', [tip.number])]);
  if (canonicalTips[0].toLowerCase() !== indexed.block_hash.toLowerCase() || canonicalTips[1].toLowerCase() !== tip.hash.toLowerCase()) throw new Error('Node or indexer tip is not canonical.');
  const knownScript = rpc === httpRpc && targetPocket ? policyScripts.get(targetPocket) : undefined;
  const key = { script: knownScript || { code_hash: POLICY_CODE, hash_type: 'data2', args: '0x' }, script_type: 'type', script_search_mode: knownScript ? 'exact' : 'prefix', with_data: true };
  const candidates: Array<Discovery & { cell: any }> = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let finished = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: unknown[] = [key, 'asc', `0x${PAGE_SIZE.toString(16)}`];
    if (cursor !== undefined) params.push(cursor);
    const result = await rpc<any>('get_cells', params);
    if (!result || !Array.isArray(result.objects) || typeof result.last_cursor !== 'string') throw new Error('Invalid Pudge indexer response.');
    for (const item of result.objects) {
      const point = item.out_point as OutPoint;
      if (!point || !/^0x[0-9a-f]{64}$/i.test(point.tx_hash) || !/^0x[0-9a-f]+$/i.test(point.index)) throw new Error('Invalid indexed policy outpoint.');
      if (BigInt(item.block_number) > indexerHeight) throw new Error('Indexer returned a Cell newer than its snapshot.');
      const id = `${point.tx_hash}:${point.index}`;
      if (seen.has(id)) throw new Error('Duplicate indexer outpoint.');
      seen.add(id);
      if (item.output_data !== item.output_data?.toLowerCase() || !/^0x(?:[0-9a-f]{2})*$/i.test(item.output_data)) throw new Error('Invalid indexed policy data.');
      const live = await rpc<any>('get_live_cell', [point, true]);
      if (live?.status !== 'live' || !live.cell?.output || live.cell.data?.content !== item.output_data || !equal(normalizeOutput(live.cell.output), normalizeOutput(item.output))) throw new Error('Indexed policy does not match its live chain Cell.');
      const policy = live.cell.output.type as Script;
      const pocketId = parseScript(policy).hash().toLowerCase();
      if (targetPocket && pocketId !== targetPocket) continue;
      const role = candidateRole(live.cell, publicKey);
      if (targetPocket ? pocketId !== targetPocket : !role.role) continue;
      const transaction = await rpc<any>('get_transaction', [point.tx_hash]);
      if (transaction?.tx_status?.status !== 'committed' || !transaction.tx_status.block_hash) throw new Error('Indexed policy transaction is not committed.');
      const header = await rpc<any>('get_header', [transaction.tx_status.block_hash]);
      if (!header || header.number !== item.block_number || (await rpc<string>('get_block_hash', [header.number])).toLowerCase() !== header.hash.toLowerCase()) throw new Error('Indexed policy transaction is not canonical.');
      const outputIndex = Number(BigInt(point.index));
      if (!equal(normalizeOutput(transaction.transaction.outputs[outputIndex]), normalizeOutput(live.cell.output)) || transaction.transaction.outputs_data[outputIndex] !== live.cell.data.content) throw new Error('Canonical policy transaction output mismatch.');
      candidates.push({ pocket: pocketId, role: role.role || 'public', closed: role.closed, capacity: live.cell.output.capacity, summary: role.summary, policyScript: policy, outPoint: point, indexedTip: indexed, cell: live.cell });
    }
    if (result.objects.length < PAGE_SIZE) { finished = true; break; }
    if (result.last_cursor === '0x' || result.last_cursor === cursor) throw new Error('Pudge indexer cursor did not advance.');
    cursor = result.last_cursor;
  }
  if (!finished) throw new Error('Pudge discovery exceeded its page limit.');
  const finalTips = await Promise.all([rpc<string>('get_block_hash', [indexed.block_number]), rpc<string>('get_block_hash', [tip.number])]);
  if (finalTips[0].toLowerCase() !== indexed.block_hash.toLowerCase() || finalTips[1].toLowerCase() !== tip.hash.toLowerCase()) throw new Error('Pudge chain changed during discovery.');
  for (const candidate of candidates) {
    const live = await rpc<any>('get_live_cell', [candidate.outPoint, true]);
    if (live?.status !== 'live' || live.cell.data?.content !== candidate.cell.data.content || !equal(normalizeOutput(live.cell.output), normalizeOutput(candidate.cell.output))) throw new Error('Pocket changed during discovery.');
  }
  if (rpc === httpRpc) {
    for (const candidate of candidates) {
      if (policyScripts.size >= 128) policyScripts.delete(policyScripts.keys().next().value!);
      policyScripts.set(candidate.pocket, candidate.policyScript);
    }
  }
  return candidates.map(({ cell: _cell, ...candidate }) => candidate);
}

export const publicDiscoveryNetwork = { rpc: RPC_URL, genesis: GENESIS };
