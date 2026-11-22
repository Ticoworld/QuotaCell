/// <reference types="vite/client" />
import { loadPocketHistory } from './pocketHistory';
import * as c from '@ckb-ccc/core';
import { JsonRpcTransformers as rpcFormat } from '@ckb-ccc/core/advanced';
import deployment from '../../evidence/wo15/pudge-deployment.json';
import { buildOwnerTransaction, ownerLockFor, type OwnerOperation, type Terms } from './pocketOwner';
import { buildPayment } from './pocketPayment';
import { discoverPublicPocket, discoverPublicPockets, httpRpc, publicDiscoveryNetwork } from './publicDiscovery';
import { parseCkb } from './amount';
import type { PocketState, PreparedTransaction, TransactionResult } from './domain';

export const browserMode = import.meta.env?.VITE_QUOTACELL_BROWSER === '1';
export const demoPocket = '0x7b3d89c22431e061814fbe61cc09e6c888b44a7076b782a75c3f1612d1597cc0';
const client = new c.ClientPublicTestnet({ url: publicDiscoveryNetwork.rpc, fallbacks: [] });
const standard = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const fundCode = '0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a';
const policyLock = '0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const key = (pocket: string) => 'quotacell.browser.v1:' + deployment.genesis + ':' + pocket;
const hex = (value: bigint | number) => '0x' + value.toString(16);
type Point = { tx_hash: string; index: string };
type Payment = { id: string; publicKey: string; role: 'alice' | 'ben'; amount: string; recipient: string };
export const creationScope = 'creation';
export const actorCreationScope = (actor: string) => creationScope + ':' + actor.toLowerCase();
export const isCreationScope = (scope?: string) => scope === creationScope || Boolean(scope?.startsWith(creationScope + ':'));
const creationEntries = (actor: string) => [...entries(actorCreationScope(actor)), ...entries(creationScope)]
  .filter(entry => entry.payment.publicKey === actor.toLowerCase());
type OwnerRequest = { id: string; draftId?: string; publicKey: string; operation: OwnerOperation; amount?: string; role?: 'alice' | 'ben'; shared?: string; alice?: string; ben?: string; mask?: number } & Partial<Terms>;
type Entry = {
  operation?: OwnerOperation | 'pay';
  targetPocket?: string;
  ownerRequest?: OwnerRequest;
  policyPoint?: Point;
  position?: number;
  policyClosed?: boolean;
  payment: Payment; prepared: PreparedTransaction; hash: string; message: string; created: string;
  state: 'prepared' | 'signed' | 'uncertain' | 'committed' | 'conflict';
  signed?: string;
  committedHeight?: string;
  committedBlock?: string;
};
const entries = (pocket: string): Entry[] => JSON.parse(localStorage.getItem(key(pocket)) || '[]');
const save = (pocket: string, records: Entry[]) => localStorage.setItem(key(pocket), JSON.stringify(records));
const locked = <T>(pocket: string, action: () => Promise<T>) => navigator.locks.request(key(pocket), action) as unknown as Promise<T>;

const reservesInputs = (entry: Entry) => entry.state === 'signed' || entry.state === 'uncertain';
const depositCanOverlap = (entry: Entry) => !entry.operation || ['pay', 'admin', 'revoke'].includes(entry.operation);

function checkReservations(journal: Entry[], entry: Entry) {
  const inputs = c.Transaction.fromBytes(entry.prepared.transaction).inputs;
  for (const other of journal.filter(item => item !== entry && reservesInputs(item))) {
    requireCondition(entry.operation === 'deposit' && depositCanOverlap(other) ||
      other.operation === 'deposit' && depositCanOverlap(entry), 'An earlier outcome is uncertain');
    const reserved = c.Transaction.fromBytes(other.prepared.transaction).inputs;
    requireCondition(!inputs.some(input => reserved.some(item => item.previousOutput.eq(input.previousOutput))),
      'An earlier outcome is uncertain');
  }
}

function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function canonical(point: Point) {
  const tx = await httpRpc<any>('get_transaction', [point.tx_hash], 'safety');
  const header = tx?.tx_status?.status === 'committed' && await httpRpc<any>('get_header', [tx.tx_status.block_hash]);
  requireCondition(header && header.hash === tx.tx_status.block_hash && await httpRpc('get_block_hash', [header.number]) === header.hash, 'Input transaction is not canonical.');
  requireCondition(tx.transaction && rpcFormat.transactionTo(tx.transaction).hash() === point.tx_hash, 'Canonical transaction hash mismatch');
  return { transaction: tx.transaction, anchor: { height: String(header.number), hash: String(header.hash) } };
}

async function live(point: Point) {
  const [result, { transaction: tx, anchor }] = await Promise.all([httpRpc<any>('get_live_cell', [point, true]), canonical(point)]);
  const index = Number(BigInt(point.index));
  requireCondition(result?.status === 'live', 'Input is stale');
  const output = rpcFormat.cellOutputTo(result.cell.output);
  requireCondition(JSON.stringify(rpcFormat.cellOutputFrom(output)) === JSON.stringify(rpcFormat.cellOutputFrom(rpcFormat.cellOutputTo(tx.outputs[index]))) &&
    result.cell.data.content === tx.outputs_data[index], 'Canonical input mismatch');
  return { ...result, anchor, outPoint: { txHash: point.tx_hash, index } } as Parameters<typeof buildPayment>[0]['policy'] & { anchor: Omit<Dependency, 'point'> };
}

type Dependency = { point: Point; height: string; hash: string };
let verifiedDependencies: Promise<Dependency[]> | undefined;

async function verifyDependencies() {
  requireCondition(await httpRpc('get_block_hash', ['0x0']) === deployment.genesis, 'Wrong Pudge genesis');
  const existing = verifiedDependencies;
  if (!existing) {
    verifiedDependencies = loadDependencies().catch(error => { verifiedDependencies = undefined; throw error; });
    await verifiedDependencies;
    return;
  }
  const dependencies = await existing;
  try {
    await Promise.all(dependencies.map(async ({ point, height, hash }) => {
      const [cell, canonicalHash] = await Promise.all([
        httpRpc<{ status: string }>('get_live_cell', [point, false]), httpRpc('get_block_hash', [height]),
      ]);
      requireCondition(cell?.status === 'live' && canonicalHash === hash, 'Contract dependency changed');
    }));
  } catch (error) {
    verifiedDependencies = undefined;
    throw error;
  }
}

async function loadDependencies() {
  const points = deployment.allDeps.map(({ outPoint }) => ({ tx_hash: outPoint.txHash, index: hex(outPoint.index) }));
  const [group, a, f, q] = await Promise.all(points.map(live));
  for (const [cell, hash] of [[a, policyLock], [f, fundCode], [q, deployment.verification.qDataHash]] as const) {
    requireCondition(c.hashCkb(cell.cell.data.content) === hash, 'Wrong Pudge contract dependency');
  }
  const members = c.bytesFrom(group.cell.data.content);
  const view = new DataView(members.buffer, members.byteOffset, members.byteLength);
  requireCondition(members.length === 76 && view.getUint32(0, true) === 2, 'Invalid K dependency group');
  const memberPoints = [4, 40].map(offset => ({
    tx_hash: c.hexFrom(members.subarray(offset, offset + 32)), index: hex(view.getUint32(offset + 32, true)),
  }));
  const [data, code] = await Promise.all(memberPoints.map(live));
  requireCondition(c.hashCkb(data.cell.data.content) === '0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4' &&
    c.hashCkb(code.cell.data.content) === '0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649' &&
    code.cell.output.type && rpcFormat.scriptTo(code.cell.output.type as Parameters<typeof rpcFormat.scriptTo>[0]).hash() === standard, 'Wrong Pudge signer dependencies');
  return [group, a, f, q, data, code].map((cell, index) => ({ ...cell.anchor, point: [...points, ...memberPoints][index] }));
}

async function plainCells(lock: c.Script, max: number) {
  const result = await httpRpc<any>('get_cells', [{
    script: rpcFormat.scriptFrom(lock), script_type: 'lock', script_search_mode: 'exact', with_data: true,
    filter: { script_len_range: ['0x0', '0x1'], output_data_len_range: ['0x0', '0x1'] },
  }, 'desc', hex(max + 1)]);
  requireCondition(Array.isArray(result?.objects) && result.objects.length <= max, 'Too many matching inputs');
  return result.objects as { out_point: Point }[];
}

export class FundCheckpointError extends Error {
  constructor(readonly reason: 'advanced' | 'lag' | 'canonical') {
    super(reason);
  }
}

async function discoverFunds(pocket: string) {
  const script = { code_hash: fundCode, hash_type: 'data1', args: pocket };
  const indexed = await httpRpc<{ block_number: string; block_hash: string }>('get_indexer_tip');
  const tip = await httpRpc<{ number: string }>('get_tip_header');
  if (!indexed || !tip || BigInt(tip.number) < BigInt(indexed.block_number) ||
      BigInt(tip.number) - BigInt(indexed.block_number) > 64n) throw new FundCheckpointError('lag');
  if (await httpRpc('get_block_hash', [indexed.block_number]) !== indexed.block_hash) throw new FundCheckpointError('canonical');
  const ordinary: { out_point: Point; output: unknown; output_data: string }[] = [];
  const cursors = new Set<string>();
  const unsupportedFunds: NonNullable<PocketState['unsupportedFunds']> = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const query = { script, script_type: 'lock', script_search_mode: 'exact', with_data: true, filter: { block_range: ['0x0', hex(BigInt(indexed.block_number) + 1n)] } };
    const result = await httpRpc<{ objects: { out_point: Point; output: { type: unknown; capacity: string }; output_data: string }[]; last_cursor: string }>(
      'get_cells', cursor ? [query, 'asc', '0x64', cursor] : [query, 'asc', '0x64'],
    );
    requireCondition(Array.isArray(result?.objects) && result.objects.length <= 100 && typeof result.last_cursor === 'string', 'Invalid protected fund page');
    for (const item of result.objects) {
      requireCondition(item?.out_point && /^0x[0-9a-f]{64}$/i.test(item.out_point.tx_hash) &&
        /^0x[0-9a-f]+$/i.test(item.out_point.index) && /^0x[0-9a-f]+$/i.test(item.output?.capacity) &&
        /^0x(?:[0-9a-f]{2})*$/i.test(item.output_data), 'Invalid protected fund cell');
      const identity = item.out_point.tx_hash + ':' + BigInt(item.out_point.index);
      requireCondition(!seen.has(identity), 'Duplicate protected fund cell');
      seen.add(identity);
      if (item.output.type || item.output_data !== '0x') {
        unsupportedFunds.push({ outPoint: item.out_point, capacity: BigInt(item.output.capacity).toString(), hasType: Boolean(item.output.type), dataBytes: (item.output_data.length - 2) / 2 });
      } else ordinary.push(item);
    }
    if (result.objects.length < 100) {
      const funds = await Promise.all(ordinary.map(async item => {
        const cell = await live(item.out_point);
        requireCondition(JSON.stringify(rpcFormat.cellOutputFrom(rpcFormat.cellOutputTo(item.output as Parameters<typeof rpcFormat.cellOutputTo>[0]))) ===
          JSON.stringify(rpcFormat.cellOutputFrom(rpcFormat.cellOutputTo(cell.cell.output as Parameters<typeof rpcFormat.cellOutputTo>[0]))), 'Indexed protected fund output changed');
        return cell;
      }));
      const finalTip = await httpRpc<{ block_number: string; block_hash: string }>('get_indexer_tip');
      if (await httpRpc('get_block_hash', [indexed.block_number]) !== indexed.block_hash) throw new FundCheckpointError('canonical');
      if (!finalTip || BigInt(finalTip.block_number) < BigInt(indexed.block_number)) throw new FundCheckpointError('lag');
      if (BigInt(finalTip.block_number) > BigInt(indexed.block_number)) {
        if (await httpRpc('get_block_hash', [finalTip.block_number]) !== finalTip.block_hash) throw new FundCheckpointError('canonical');
        // A live index query does not pin a historical UTXO set.
        throw new FundCheckpointError('advanced');
      }
      if (finalTip.block_hash !== indexed.block_hash) throw new FundCheckpointError('canonical');
      requireCondition(funds.every(cell => !cell.cell.output.type && cell.cell.data.content === '0x' &&
        cell.cell.output.lock.code_hash === fundCode && cell.cell.output.lock.hash_type === 'data1' &&
        cell.cell.output.lock.args === pocket), 'Protected fund identity changed');
      return { funds, unsupportedFunds, fundTip: indexed };
    }
    requireCondition(result.last_cursor && !cursors.has(result.last_cursor), 'Protected fund cursor did not advance');
    cursors.add(result.last_cursor);
    cursor = result.last_cursor;
  }
  throw new Error('Protected fund discovery exceeded its page limit');
}

export class PocketIndexSyncError extends Error {
  constructor() { super('Confirmed transaction is awaiting Pocket synchronization'); }
}

const historicalChecks = new Map<string, { height: string; hash: string; spent: Set<string>; entries: Map<string, string> }>();

async function snapshot(pocket: string, verifiedPolicy?: Promise<Awaited<ReturnType<typeof discoverPublicPocket>>>, reading = false) {
  const fundRead = reading ? retryFunds(pocket) : discoverFunds(pocket);
  void fundRead.catch(() => {});
  const policy = await (verifiedPolicy ?? discoverPublicPocket(pocket));
  const funds = await fundRead;
  const policyHeight = BigInt(policy.indexedTip.block_number);
  const fundHeight = BigInt(funds.fundTip.block_number);
  const journal = entries(pocket);
  const committed = journal.filter(entry => entry.state === 'committed');
  const indexedPoints = new Set(funds.funds.map(cell => cell.outPoint.txHash + ':' + cell.outPoint.index));
  indexedPoints.add(policy.outPoint.tx_hash + ':' + Number(BigInt(policy.outPoint.index)));
  const checkpoint = policyHeight <= fundHeight ? policy.indexedTip : funds.fundTip;
  const prior = historicalChecks.get(pocket);
  const validPrior = prior && BigInt(prior.height) <= BigInt(checkpoint.block_number) &&
    await httpRpc('get_block_hash', [prior.height]) === prior.hash ? prior : undefined;
  const spent = new Set(validPrior?.spent);
  const priorVerifiedEntries = validPrior?.entries ?? new Map<string, string>();
  const verifiedEntries = new Map<string, string>();
  let backfilled = false;
  await Promise.all(committed.map(async entry => {
    const reviewed = c.Transaction.fromBytes(entry.prepared.transaction);
    requireCondition(reviewed.hash() === entry.hash && entry.prepared.genesis === deployment.genesis &&
      entry.prepared.publicKey === entry.payment.publicKey, 'Committed journal identity mismatch');
    if (!entry.committedHeight || !entry.committedBlock ||
        (!(validPrior && BigInt(entry.committedHeight) <= BigInt(validPrior.height) &&
          priorVerifiedEntries.get(entry.hash) === entry.committedBlock) &&
          await httpRpc('get_block_hash', [entry.committedHeight]) !== entry.committedBlock)) {
      const { anchor } = await canonical({ tx_hash: entry.hash, index: '0x0' });
      entry.committedHeight = anchor.height;
      entry.committedBlock = anchor.hash;
      backfilled = true;
    }
    if (BigInt(entry.committedHeight) > policyHeight || BigInt(entry.committedHeight) > fundHeight) {
      throw new PocketIndexSyncError();
    }
    verifiedEntries.set(entry.hash, entry.committedBlock);
    await Promise.all(reviewed.outputs.map(async (output, index) => {
      const protectedFund = output.lock.codeHash === fundCode && output.lock.hashType === 'data1' &&
        output.lock.args === pocket && !output.type && reviewed.outputsData[index] === '0x';
      const pocketPolicy = output.type?.hash() === pocket;
      const outputKey = entry.hash + ':' + index;
      if ((!protectedFund && !pocketPolicy) || indexedPoints.has(outputKey) || spent.has(outputKey)) return;
      const point = { tx_hash: entry.hash, index: hex(index) };
      const result = await httpRpc<{ status: string }>('get_live_cell', [point, false]);
      if (result?.status === 'dead' || result?.status === 'unknown') {
        const spender = await canonicalSpender(point, entry.committedHeight!, rpcFormat.cellOutputFrom(output));
        if (spender && BigInt(spender.height) <= BigInt(checkpoint.block_number)) {
          spent.add(outputKey);
          return;
        }
      }
      throw new PocketIndexSyncError();
    }));
  }));
  if (await httpRpc('get_block_hash', [checkpoint.block_number]) !== checkpoint.block_hash) {
    throw new PocketIndexSyncError();
  }
  historicalChecks.set(pocket, { height: checkpoint.block_number, hash: checkpoint.block_hash, spent, entries: verifiedEntries });
  if (backfilled) save(pocket, journal);
  return { policy, ...funds };
}

async function retryFunds(pocket: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await discoverFunds(pocket); }
    catch (error) {
      if (attempt >= 2 || !(error instanceof FundCheckpointError) || error.reason !== 'advanced') throw error;
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}

export async function browserState(pocket?: string, actor?: string, onPolicy?: (state: PocketState) => void): Promise<PocketState> {
  const base = { networkMode: 'pudge-browser', genesis: deployment.genesis, multiPocket: true };
  if (!pocket) {
    if (!actor) return { ...base, empty: true };
    const pending = creationEntries(actor).find(entry => entry.state === 'uncertain' && entry.payment.publicKey === actor.toLowerCase());
    const discovered = await discoverPublicPockets(actor);
    return { ...base, empty: true, unresolved: Boolean(pending), history: pending ? [{
      id: pending.payment.id, tx_hash: pending.hash, state: 'uncertain', actor: pending.payment.publicKey,
      amount: '0', recipient: '', created: pending.created, operation: 'genesis',
    }] : [], discovery: discovered.flatMap(({ role, pocket, closed }) => role === 'public' ? [] : [{ role, pocket, closed, verifiedAt: Date.now() }]) };
  }
  const verified = onPolicy ? discoverPublicPocket(pocket).then(policy => {
    onPolicy({
      ...base, ...policy.summary, pocket, closed: policy.closed,
      historicalTermsUnavailable: policy.closed, policyCapacity: BigInt(policy.capacity).toString(),
      historyPolicy: { script: policy.policyScript, txHash: policy.outPoint.tx_hash },
      indexedTip: policy.indexedTip,
    });
    return policy;
  }) : undefined;
  // Attach rejection handling before the per-Pocket lock becomes available.
  if (verified) void verified.catch(() => {});
  const { policy, funds, unsupportedFunds, fundTip } = await locked(pocket, () => snapshot(pocket, verified, Boolean(onPolicy)));
  if (verified) {
    const [anchor, current] = await Promise.all([
      httpRpc('get_block_hash', [policy.indexedTip.block_number]),
      httpRpc<{ status: string }>('get_live_cell', [policy.outPoint, false]),
    ]);
    if (anchor !== policy.indexedTip.block_hash) throw new FundCheckpointError('canonical');
    requireCondition(current?.status === 'live', 'Policy changed during fund verification');
  }
  const journal = entries(pocket);
  return {
    ...base, ...policy.summary, ...(policy.closed && actor && (await discoverPublicPocket(pocket, undefined, actor)).role === 'owner' ? { owner: actor } : {}), historyPolicy: { script: policy.policyScript, txHash: policy.outPoint.tx_hash }, pocket, closed: policy.closed, indexedTip: policy.indexedTip,
    unsupportedFunds, fundTip, historicalTermsUnavailable: policy.closed, policyCapacity: BigInt(policy.capacity).toString(), hasFund: Boolean(funds.length),
    fundShannons: funds.reduce((total, cell) => total + BigInt(cell.cell.output.capacity), 0n).toString(),
    fundOccupiedShannons: funds.length ? '7300000000' : '0',
    fundCellCount: funds.length,
    unresolved: journal.some(reservesInputs),
    depositMayPrepare: journal.filter(reservesInputs).every(depositCanOverlap),
    history: journal.filter(entry => ['uncertain', 'conflict'].includes(entry.state)).map(entry => ({
      id: entry.payment.id, tx_hash: entry.hash, state: entry.state === 'conflict' ? 'rejected' : entry.state,
      actor: entry.payment.publicKey, recipient: entry.payment.recipient, amount: entry.prepared.operationAmount || parseCkb(entry.payment.amount).toString(),
      operation: entry.operation || 'pay', created: entry.created,
    })),
  };
}

export const selectedBrowserPocket = () => new URLSearchParams(location.search).get('pocket')?.toLowerCase() || undefined;

export function requireBrowserPocket() {
  const pocket = selectedBrowserPocket();
  requireCondition(pocket && /^0x[0-9a-f]{64}$/.test(pocket), 'No Pocket selected');
  return pocket;
}

export function browserHistory(state: PocketState) {
  requireCondition(state.historyPolicy && state.indexedTip && state.pocket, 'Pocket history requires a verified policy');
  return loadPocketHistory(
    state.historyPolicy.script as Parameters<typeof loadPocketHistory>[0],
    c.Script.from({ codeHash: fundCode, hashType: 'data1', args: state.pocket }),
    state.indexedTip,
    state.historyPolicy.txHash,
  );
}

export function readPendingCreation(actor: string) {
  return creationEntries(actor).find(entry => entry.state === 'uncertain') || creationEntries(actor).reverse().find(entry => entry.state === 'committed');
}

export function readBrowserIntent(pocket: string, actor: string) {
  return (pocket === creationScope ? creationEntries(actor) : entries(pocket)).find(entry => entry.state === 'signed' && entry.payment.publicKey === actor);
}

async function freshInputs(transaction: c.Transaction) {
  return Promise.all(transaction.inputs.map(({ previousOutput }) => live({
    tx_hash: previousOutput.txHash, index: hex(previousOutput.index),
  })));
}

const preparations = new Map<string, Promise<PreparedTransaction>>();

export function prepareBrowserPayment(pocket: string, payment: Payment) {
  const key = JSON.stringify([pocket, payment.id, payment.publicKey, payment.role, payment.amount, payment.recipient]);
  const equivalent = preparations.get(key);
  if (equivalent) return equivalent;
  const start = performance.now();
  const task = locked(pocket, async () => {
    requireCondition(/^[0-9a-f-]{36}$/i.test(payment.id) && ['alice', 'ben'].includes(payment.role), 'Invalid payment request');
    const journal = entries(pocket);
    requireCondition(!journal.some(entry => ['signed', 'uncertain'].includes(entry.state)), 'An earlier outcome is uncertain');
    const existing = journal.find(entry => entry.payment.id === payment.id);
    if (existing) {
      requireCondition(existing.state === 'prepared' && Object.keys(existing.payment).every(field => {
        const key = field as keyof Payment;
        return existing.payment[key] === payment[key];
      }), 'Signing request ID was reused or parameters changed');
      await freshInputs(c.Transaction.fromBytes(existing.prepared.transaction));
      return existing.prepared;
    }
    const actorLock = c.Script.from({ codeHash: standard, hashType: 'type', args: c.hashCkb(payment.publicKey).slice(0, 42) });
    const discoveryStart = performance.now();
    const [{ policy, funds }, available, statistics] = await Promise.all([
      snapshot(pocket), plainCells(actorLock, 64), httpRpc<{ median: string }>('get_fee_rate_statistics', ['0x65']), verifyDependencies(),
    ]);
    performance.measure('quotacell.prepare.discovery', { start: discoveryStart, end: performance.now() });
    const inputStart = performance.now();
    const policyCell = await live(policy.outPoint);
    const selected = policy.summary?.delegates.find(item => item.role === payment.role);
    requireCondition(selected?.enabled && selected.publicKey === payment.publicKey, 'Connected account is not the selected delegate');
    requireCondition(selected.recipient === payment.recipient, 'Recipient changed');
    const amount = parseCkb(payment.amount);
    requireCondition(amount <= BigInt(selected.perPayment), 'Payment exceeds per-payment limit');
    const feeRate = BigInt(statistics.median);
    requireCondition(feeRate > 0n, 'Fee statistics unavailable');
    const actorCells = await Promise.all(available.map(item => live(item.out_point)));
    const actor = actorCells.reduce<typeof actorCells[number] | undefined>((largest, cell) =>
      !largest || BigInt(cell.cell.output.capacity) > BigInt(largest.cell.output.capacity) ? cell : largest, undefined);
    requireCondition(actor, 'No delegate fee input');
    performance.measure('quotacell.prepare.inputs', { start: inputStart, end: performance.now() });
    const inputs = { policy: policyCell, funds, actor, deps: deployment.allDeps as Parameters<typeof buildPayment>[0]['deps'], amount, delegate: payment.role === 'alice' ? 0 as const : 1 as const };
    const size = BigInt(buildPayment({ ...inputs, fee: 0n }).toBytes().length + 4);
    const fee = (size * feeRate + 999n) / 1000n;
    const tx = buildPayment({ ...inputs, fee });
    const validatedInputs = [policyCell, actor, ...funds];
    await client.cache.recordCells(validatedInputs.map(({ outPoint, cell }) => ({
      outPoint,
      cellOutput: rpcFormat.cellOutputTo(cell.output as Parameters<typeof rpcFormat.cellOutputTo>[0]),
      outputData: cell.data.content,
    })));
    const info = await tx.getSignHashInfo(actorLock, client);
    requireCondition(info?.position === 1, 'Invalid signer position');
    const prepared = { id: payment.id, transaction: tx.toHex(), publicKey: payment.publicKey, genesis: deployment.genesis, fee: fee.toString() };
    journal.push({ operation: 'pay', payment, prepared, message: info.message, hash: tx.hash(), state: 'prepared', created: new Date().toISOString() });
    save(pocket, journal);
    return prepared;
  }).finally(() => {
    preparations.delete(key);
    performance.measure('quotacell.prepare', { start, end: performance.now() });
  });
  preparations.set(key, task);
  return task;
}

function verifiedSignature(entry: Entry, bytes: string) {
  const prepared = c.Transaction.fromBytes(entry.prepared.transaction);
  const signed = c.Transaction.fromBytes(bytes);
  const position = entry.position ?? 1;
  const signature = signed.getWitnessArgs(position)?.lock;
  requireCondition(signature && /^0x[0-9a-f]{130}$/i.test(signature), 'Expected 65-byte secp256k1 signature');
  const expected = prepared.getWitnessArgs(position);
  requireCondition(expected, 'Missing prepared witness');
  expected.lock = signature;
  prepared.witnesses[position] = expected.toHex();
  requireCondition(prepared.toHex() === signed.toHex() && signed.hash() === entry.hash &&
    c.verifyMessageSecp256k1(entry.message, signature, entry.payment.publicKey) &&
    c.recoverMessageSecp256k1(entry.message, signature).toLowerCase() === entry.payment.publicKey, 'Wallet altered transaction or returned an invalid signature');
  return signed;
}

async function validatePaymentInputs(pocket: string, tx: c.Transaction, entry: Entry) {
  const [policy, inputs] = await Promise.all([
    entry.operation === 'genesis' ? undefined : discoverPublicPocket(pocket, undefined, entry.payment.publicKey),
    freshInputs(tx), verifyDependencies(),
  ]);
  if (entry.operation && entry.operation !== 'pay') {
    if (entry.operation !== 'genesis') {
      requireCondition(policy?.role === 'owner', 'Owner permissions changed');
      if (entry.operation === 'deposit') {
        const original = entry.policyClosed === undefined && entry.policyPoint ? await canonical(entry.policyPoint) : undefined;
        const wasClosed = entry.policyClosed ?? String(original?.transaction.outputs_data[Number(BigInt(entry.policyPoint!.index))]).startsWith('0x51435434');
        requireCondition(policy.closed === wasClosed, 'Pocket closure state changed');
        const expected = buildOwnerTransaction({
          operation: 'deposit', publicKey: entry.payment.publicKey, owner: inputs[0],
          policy: await live(policy.outPoint), amount: BigInt(entry.prepared.operationAmount || parseCkb(entry.payment.amount)),
          deps: deployment.allDeps as Parameters<typeof buildOwnerTransaction>[0]['deps'], fee: BigInt(entry.prepared.fee),
        });
        requireCondition(expected.transaction.hash() === tx.hash(), 'Deposit outputs changed');
      } else {
        requireCondition(policy.outPoint.tx_hash === entry.policyPoint?.tx_hash &&
          policy.outPoint.index === entry.policyPoint?.index, 'Input is stale or owner permissions changed');
      }
    }
  } else {
    requireCondition(policy, 'Pocket is unavailable');
  const grant = policy.summary?.delegates.find(delegate => delegate.role === entry.payment.role);
  requireCondition(tx.inputs[0].previousOutput.eq(c.OutPoint.from({ txHash: policy.outPoint.tx_hash, index: policy.outPoint.index })), 'Input is stale');
  requireCondition(grant?.enabled && grant.publicKey === entry.payment.publicKey && grant.recipient === entry.payment.recipient, 'Pocket permissions changed');
  }
  const fee = inputs.reduce((sum, cell) => sum + BigInt(cell.cell.output.capacity), 0n) - tx.outputs.reduce((sum, output) => sum + output.capacity, 0n);
  requireCondition(fee > 0n && fee <= 1000000n && fee === BigInt(entry.prepared.fee), 'Transaction fee is outside policy bounds');
}

export type BroadcastConsent = { hash: string; publicKey: string; verifySigner: () => Promise<string> };

export function validateBeforeSigning(pocket: string, request: PreparedTransaction) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === request.id);
    requireCondition(entry?.state === 'prepared', 'Signing request expired');
    checkReservations(journal, entry);
    requireCondition(request.transaction === entry.prepared.transaction && request.publicKey === entry.payment.publicKey &&
      request.genesis === entry.prepared.genesis && request.fee === entry.prepared.fee, 'Reviewed transaction changed');
    await validatePaymentInputs(pocket, c.Transaction.fromBytes(request.transaction), entry);
  });
}

export function persistBrowserSignature(pocket: string, id: string, bytes: string) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === id);
    requireCondition(entry?.state === 'prepared', 'Signing request expired');
    checkReservations(journal, entry);
    verifiedSignature(entry, bytes);
    entry.state = 'signed';
    entry.signed = bytes;
    save(pocket, journal);
  });
}

export function cancelBrowserIntent(pocket: string, id: string) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === id);
    if (entry && ['prepared', 'signed'].includes(entry.state)) save(pocket, journal.filter(item => item !== entry));
    return { state: entry?.state === 'uncertain' ? 'uncertain' : 'cancelled' };
  });
}

export function submitBrowserPayment(pocket: string, id: string, bytes: string, consent?: BroadcastConsent): Promise<TransactionResult> {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === id);
    requireCondition(entry?.signed === bytes, 'Unknown or expired signing request');
    if (entry.state !== 'signed') return { txHash: entry.hash, state: entry.state };
    requireCondition(consent?.hash === entry.hash && consent.publicKey.toLowerCase() === entry.payment.publicKey, 'Broadcast approval required');
    checkReservations(journal, entry);
    const signed = verifiedSignature(entry, bytes);
    const raw = rpcFormat.transactionFrom(signed);
    try {
      await validatePaymentInputs(pocket, signed, entry);
      await httpRpc('dry_run_transaction', [raw]);
      await httpRpc('test_tx_pool_accept', [raw]);
      requireCondition((await consent.verifySigner()).toLowerCase() === entry.payment.publicKey, 'Connected account changed');
    } catch (cause) {
      if (String(cause).includes('Input is stale')) { entry.state = 'conflict'; save(pocket, journal); }
      return { txHash: entry.hash, state: 'error', notSent: true, phase: 'input-fee-check', error: String(cause) };
    }
    entry.state = 'uncertain';
    save(pocket, journal);
    try {
      const hash = await httpRpc('send_transaction', [raw]);
      requireCondition(hash === entry.hash, 'RPC returned a different transaction hash');
      return { txHash: entry.hash, state: 'submitted' };
    } catch {
      return { txHash: entry.hash, state: 'uncertain' };
    }
  });
}

async function hasCanonicalConflict(entry: Entry) {
  const original = c.Transaction.fromBytes(entry.prepared.transaction);
  const points = original.inputs.map(input => rpcFormat.outPointFrom(input.previousOutput));
  const liveness = await Promise.all(points.map(point => httpRpc<{ status: string }>('get_live_cell', [point, false])));
  // An indexer result is only a candidate. Require the canonical transaction to consume the exact original input.
  for (const [index, point] of points.entries()) {
    if (!['dead', 'unknown'].includes(liveness[index]?.status)) continue;
    const { transaction: source, anchor } = await canonical(point);
    const output = source.outputs[Number(BigInt(point.index))];
    if (await canonicalSpender(point, anchor.height, output, entry.hash)) return true;
  }
  return false;
}

async function canonicalSpender(
  point: Point, height: string, output: ReturnType<typeof rpcFormat.cellOutputFrom>, exclude?: string,
) {
    const query = {
      script: output.type || output.lock,
      script_type: output.type ? 'type' : 'lock',
      script_search_mode: 'exact',
      filter: { block_range: [height, '0xffffffffffffffff'] },
    };
    let cursor: string | undefined;
    for (let page = 0; page < 8; page++) {
      const result = await httpRpc<{ objects: { io_type: string; tx_hash: string }[]; last_cursor: string }>(
        'get_transactions', cursor ? [query, 'desc', '0x40', cursor] : [query, 'desc', '0x40'], 'safety',
      );
      requireCondition(Array.isArray(result?.objects), 'Invalid conflict indexer response');
      const candidates = new Set(result.objects.filter(hit => hit.io_type === 'input' && hit.tx_hash !== exclude).map(hit => hit.tx_hash));
      for (const hash of candidates) {
        const { transaction, anchor } = await canonical({ tx_hash: hash, index: '0x0' });
        if (transaction.inputs.some((input: { previous_output: Point }) =>
          input.previous_output.tx_hash === point.tx_hash && BigInt(input.previous_output.index) === BigInt(point.index))) return anchor;
      }
      if (result.objects.length < 64 || !result.last_cursor || result.last_cursor === cursor) break;
      cursor = result.last_cursor;
    }
  return false;
}

export function reconcileBrowser(pocket: string, actor?: string, hash?: string) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const relevant = isCreationScope(pocket) ? journal.filter(entry => actor && entry.payment.publicKey === actor.toLowerCase()) : journal;
    const matching = hash ? relevant.filter(entry => entry.hash === hash.toLowerCase()) : relevant;
    const uncertain = matching.filter(entry => entry.state === 'uncertain');
    if (uncertain.length) requireCondition(await httpRpc('get_block_hash', ['0x0']) === deployment.genesis, 'Wrong Pudge genesis');
    const outcomes: { txHash: string; state: string; pocket: string; operation: string; status?: string; reason?: string }[] = matching.filter(entry => entry.state === 'committed' || entry.state === 'conflict').map(entry => ({ txHash: entry.hash, state: entry.state === 'committed' ? 'committed' : 'rejected', operation: entry.operation || 'pay', pocket: entry.targetPocket || pocket }));
    for (const entry of uncertain) {
      const response = await httpRpc<any>('get_transaction', [entry.hash], 'safety');
      let status = response?.tx_status?.status;
      if (!['committed', 'pending', 'proposed'].includes(status)) status = 'uncertain';
      if (status === 'committed') {
        const { anchor } = await canonical({ tx_hash: entry.hash, index: '0x0' });
        entry.committedHeight = anchor.height;
        entry.committedBlock = anchor.hash;
        entry.state = 'committed';
      } else if (status === 'uncertain' && await hasCanonicalConflict(entry)) {
        entry.state = 'conflict';
        status = 'rejected';
      }
      outcomes.push({ txHash: entry.hash, state: status || 'uncertain', pocket: entry.targetPocket || pocket, operation: entry.operation || 'pay' });
    }
    if (uncertain.length) save(pocket, journal);
    return { outcomes };
  });
}

export function prepareBrowserOwner(scope: string, request: OwnerRequest) {
  return locked(scope, async () => {
    requireCondition(/^[0-9a-f-]{36}$/i.test(request.id) &&
      ['genesis', 'deposit', 'admin', 'revoke', 'close', 'sweep'].includes(request.operation) &&
      (scope === actorCreationScope(request.publicKey)) === (request.operation === 'genesis'), 'Invalid owner request');
    const journal = entries(scope);
    const relevant = request.operation === 'genesis' ? creationEntries(request.publicKey) : journal;
    const reservations = relevant.filter(reservesInputs);
    requireCondition(!reservations.length || request.operation === 'deposit' && reservations.every(depositCanOverlap),
      'An earlier outcome is uncertain');
    const reservedInputs = reservations.flatMap(entry => c.Transaction.fromBytes(entry.prepared.transaction).inputs);
    const existing = journal.find(entry => entry.payment.id === request.id);
    if (existing) {
      requireCondition(existing.state === 'prepared' && JSON.stringify(existing.ownerRequest) === JSON.stringify(request), 'Signing request ID was reused or parameters changed');
      await validatePaymentInputs(scope, c.Transaction.fromBytes(existing.prepared.transaction), existing);
      return existing.prepared;
    }
    const lock = ownerLockFor(request.publicKey);
    // Deposits create a fund Cell using a wallet input and need only the current policy.
    const [context, available, statistics] = await Promise.all([
      request.operation === 'deposit' ? discoverPublicPocket(scope).then(policy => ({ policy, funds: undefined })) :
        request.operation === 'genesis' ? undefined : snapshot(scope),
      plainCells(lock, 64), httpRpc<{ median: string }>('get_fee_rate_statistics', ['0x65']), verifyDependencies(),
    ]);
    const eligible = available.filter(item => !reservedInputs.some(input =>
      input.previousOutput.eq(c.OutPoint.from({ txHash: item.out_point.tx_hash, index: item.out_point.index }))));
    const ownerCells = await Promise.all(eligible.map(item => live(item.out_point)));
    const owner = ownerCells.reduce<typeof ownerCells[number] | undefined>((best, cell) =>
      !best || BigInt(cell.cell.output.capacity) > BigInt(best.cell.output.capacity) ? cell : best, undefined);
    requireCondition(owner, 'No eligible owner cell');
    const policy = context && await live(context.policy.outPoint);
    const admin = request.operation === 'admin' ? {
      shared: parseCkb(request.shared || '0'), alice: parseCkb(request.alice || '0'), ben: parseCkb(request.ben || '0'), mask: request.mask ?? 0,
    } : undefined;
    const options = {
      operation: request.operation, publicKey: request.publicKey, owner, policy, funds: context?.funds,
      terms: request as Terms, amount: request.amount ? parseCkb(request.amount) : undefined,
      mask: request.role === 'alice' ? 1 : request.role === 'ben' ? 2 : undefined, admin,
      deps: deployment.allDeps as Parameters<typeof buildOwnerTransaction>[0]['deps'],
    };
    const unsigned = buildOwnerTransaction({ ...options, fee: 0n });
    const rate = BigInt(statistics.median);
    requireCondition(rate > 0n, 'Fee statistics unavailable');
    const fee = (BigInt(unsigned.transaction.toBytes().length + 4) * rate + 999n) / 1000n;
    const { transaction, inputs, position, pocket, amount, change, release } = buildOwnerTransaction({ ...options, fee });
    await client.cache.recordCells(inputs.map(({ outPoint, cell }) => ({
      outPoint, cellOutput: rpcFormat.cellOutputTo(cell.output as Parameters<typeof rpcFormat.cellOutputTo>[0]), outputData: cell.data.content,
    })));
    const info = await transaction.getSignHashInfo(lock, client);
    requireCondition(info?.position === position, 'Invalid owner signer position');
    const prepared = {
      id: request.id, transaction: transaction.toHex(), publicKey: request.publicKey, genesis: deployment.genesis,
      fee: fee.toString(), targetPocket: pocket, journalScope: scope, ownerChangeCapacity: change.toString(),
      ownerInputCapacity: owner.cell.output.capacity ? BigInt(owner.cell.output.capacity).toString() : undefined,
      policyCapacity: request.operation === 'genesis' ? '60000000000' : policy && BigInt(policy.cell.output.capacity).toString(),
      terminalCapacity: '13400000000', operationAmount: amount.toString(), releasedCapacity: release.toString(),
      adminTerms: admin && { shared: admin.shared.toString(), alice: admin.alice.toString(), ben: admin.ben.toString(), mask: admin.mask },
    };
    journal.push({
      operation: request.operation, targetPocket: pocket, ownerRequest: request, position, policyPoint: context?.policy.outPoint, policyClosed: context?.policy.closed,
      payment: { id: request.id, publicKey: request.publicKey, role: 'alice', amount: request.amount || '0', recipient: lock.args },
      prepared, hash: transaction.hash(), message: info.message, state: 'prepared', created: new Date().toISOString(),
    });
    save(scope, journal);
    return prepared;
  });
}
