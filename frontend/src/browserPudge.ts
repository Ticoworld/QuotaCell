import { loadPocketHistory } from './pocketHistory';
/// <reference types="vite/client" />
import * as c from '@ckb-ccc/core';
import { JsonRpcTransformers as rpcFormat } from '@ckb-ccc/core/advanced';
import deployment from '../../evidence/wo15/pudge-deployment.json';
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
type Entry = {
  payment: Payment; prepared: PreparedTransaction; hash: string; message: string; created: string;
  state: 'prepared' | 'signed' | 'uncertain' | 'committed' | 'conflict';
  signed?: string;
};
const entries = (pocket: string): Entry[] => JSON.parse(localStorage.getItem(key(pocket)) || '[]');
const save = (pocket: string, records: Entry[]) => localStorage.setItem(key(pocket), JSON.stringify(records));
const locked = <T>(pocket: string, action: () => Promise<T>) => navigator.locks.request(key(pocket), action) as unknown as Promise<T>;

function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function canonical(point: Point) {
  const tx = await httpRpc<any>('get_transaction', [point.tx_hash]);
  const header = tx?.tx_status?.status === 'committed' && await httpRpc<any>('get_header', [tx.tx_status.block_hash]);
  requireCondition(header && header.hash === tx.tx_status.block_hash && await httpRpc('get_block_hash', [header.number]) === header.hash, 'Input transaction is not canonical.');
  return tx.transaction;
}

async function live(point: Point) {
  const [result, tx] = await Promise.all([httpRpc<any>('get_live_cell', [point, true]), canonical(point)]);
  const index = Number(BigInt(point.index));
  requireCondition(result?.status === 'live', 'Input is stale');
  const output = rpcFormat.cellOutputTo(result.cell.output);
  requireCondition(JSON.stringify(rpcFormat.cellOutputFrom(output)) === JSON.stringify(rpcFormat.cellOutputFrom(rpcFormat.cellOutputTo(tx.outputs[index]))) &&
    result.cell.data.content === tx.outputs_data[index], 'Canonical input mismatch');
  return { ...result, outPoint: { txHash: point.tx_hash, index } } as Parameters<typeof buildPayment>[0]['policy'];
}

async function verifyDependencies() {
  const points = deployment.allDeps.map(({ outPoint }) => ({ tx_hash: outPoint.txHash, index: hex(outPoint.index) }));
  const [group, a, f, q] = await Promise.all(points.map(live));
  for (const [cell, hash] of [[a, policyLock], [f, fundCode], [q, deployment.verification.qDataHash]] as const) {
    requireCondition(c.hashCkb(cell.cell.data.content) === hash, 'Wrong Pudge contract dependency');
  }
  const members = c.bytesFrom(group.cell.data.content);
  const view = new DataView(members.buffer, members.byteOffset, members.byteLength);
  requireCondition(members.length === 76 && view.getUint32(0, true) === 2, 'Invalid K dependency group');
  const [data, code] = await Promise.all([4, 40].map(offset => live({
    tx_hash: c.hexFrom(members.subarray(offset, offset + 32)), index: hex(view.getUint32(offset + 32, true)),
  })));
  requireCondition(c.hashCkb(data.cell.data.content) === '0x9799bee251b975b82c45a02154ce28cec89c5853ecc14d12b7b8cccfc19e0af4' &&
    c.hashCkb(code.cell.data.content) === '0x709f3fda12f561cfacf92273c57a98fede188a3f1a59b1f888d113f9cce08649' &&
    code.cell.output.type && rpcFormat.scriptTo(code.cell.output.type as Parameters<typeof rpcFormat.scriptTo>[0]).hash() === standard, 'Wrong Pudge signer dependencies');
}

async function plainCells(lock: c.Script, max: number) {
  const result = await httpRpc<any>('get_cells', [{
    script: rpcFormat.scriptFrom(lock), script_type: 'lock', script_search_mode: 'exact', with_data: true,
    filter: { script_len_range: ['0x0', '0x1'], output_data_len_range: ['0x0', '0x1'] },
  }, 'desc', hex(max + 1)]);
  requireCondition(Array.isArray(result?.objects) && result.objects.length <= max, 'Too many matching inputs');
  return result.objects as { out_point: Point }[];
}

async function snapshot(pocket: string) {
  const policy = await discoverPublicPocket(pocket);
  const funds = await plainCells(c.Script.from({ codeHash: fundCode, hashType: 'data1', args: pocket }), 64);
  return { policy, funds: await Promise.all(funds.map(item => live(item.out_point))) };
}

export async function browserState(pocket?: string, actor?: string): Promise<PocketState> {
  const base = { networkMode: 'pudge-browser', genesis: deployment.genesis, multiPocket: true };
  if (!pocket) {
    if (!actor) return { ...base, empty: true };
    const discovered = await discoverPublicPockets(actor);
    return { ...base, empty: true, discovery: discovered.flatMap(({ role, pocket, closed }) => role === 'public' ? [] : [{ role, pocket, closed }]) };
  }
  const { policy, funds } = await snapshot(pocket);
  const journal = entries(pocket);
  return {
    ...base, ...policy.summary, historyPolicy: { script: policy.policyScript, txHash: policy.outPoint.tx_hash }, pocket, closed: policy.closed, indexedTip: policy.indexedTip,
    policyCapacity: BigInt(policy.capacity).toString(), hasFund: Boolean(funds.length),
    fundShannons: funds.reduce((total, cell) => total + BigInt(cell.cell.output.capacity), 0n).toString(),
    fundOccupiedShannons: funds.length ? '7300000000' : '0',
    unresolved: journal.some(entry => entry.state === 'uncertain'),
    history: journal.filter(entry => ['uncertain', 'conflict'].includes(entry.state)).map(entry => ({
      id: entry.payment.id, tx_hash: entry.hash, state: entry.state === 'conflict' ? 'rejected' : entry.state,
      actor: entry.payment.publicKey, recipient: entry.payment.recipient, amount: parseCkb(entry.payment.amount).toString(),
      operation: 'pay', created: entry.created,
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

export function readBrowserIntent(pocket: string, actor: string) {
  return entries(pocket).find(entry => entry.state === 'signed' && entry.payment.publicKey === actor);
}

async function freshInputs(transaction: c.Transaction) {
  return Promise.all(transaction.inputs.map(({ previousOutput }) => live({
    tx_hash: previousOutput.txHash, index: hex(previousOutput.index),
  })));
}

export function prepareBrowserPayment(pocket: string, payment: Payment) {
  return locked(pocket, async () => {
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
    const { policy, funds } = await snapshot(pocket);
    const selected = policy.summary?.delegates.find(item => item.role === payment.role);
    requireCondition(selected?.enabled && selected.publicKey === payment.publicKey, 'Connected account is not the selected delegate');
    requireCondition(selected.recipient === payment.recipient, 'Recipient changed');
    const amount = parseCkb(payment.amount);
    requireCondition(amount <= BigInt(selected.perPayment), 'Payment exceeds per-payment limit');
    const actorLock = c.Script.from({ codeHash: standard, hashType: 'type', args: c.hashCkb(payment.publicKey).slice(0, 42) });
    const [policyCell, available, statistics] = await Promise.all([
      live(policy.outPoint), plainCells(actorLock, 64), httpRpc<{ median: string }>('get_fee_rate_statistics', ['0x65']), verifyDependencies(),
    ]);
    const feeRate = BigInt(statistics.median);
    requireCondition(feeRate > 0n, 'Fee statistics unavailable');
    const actorCells = await Promise.all(available.map(item => live(item.out_point)));
    const actor = actorCells.reduce<typeof actorCells[number] | undefined>((largest, cell) =>
      !largest || BigInt(cell.cell.output.capacity) > BigInt(largest.cell.output.capacity) ? cell : largest, undefined);
    requireCondition(actor, 'No delegate fee input');
    const inputs = { policy: policyCell, funds, actor, deps: deployment.allDeps as Parameters<typeof buildPayment>[0]['deps'], amount, delegate: payment.role === 'alice' ? 0 as const : 1 as const };
    const size = BigInt(buildPayment({ ...inputs, fee: 0n }).toBytes().length + 4);
    const fee = (size * feeRate + 999n) / 1000n;
    const tx = buildPayment({ ...inputs, fee });
    const info = await tx.getSignHashInfo(actorLock, client);
    requireCondition(info?.position === 1, 'Invalid signer position');
    const prepared = { id: payment.id, transaction: tx.toHex(), publicKey: payment.publicKey, genesis: deployment.genesis, fee: fee.toString() };
    journal.push({ payment, prepared, message: info.message, hash: tx.hash(), state: 'prepared', created: new Date().toISOString() });
    save(pocket, journal);
    return prepared;
  });
}

function verifiedSignature(entry: Entry, bytes: string) {
  const prepared = c.Transaction.fromBytes(entry.prepared.transaction);
  const signed = c.Transaction.fromBytes(bytes);
  const signature = signed.getWitnessArgs(1)?.lock;
  requireCondition(signature && /^0x[0-9a-f]{130}$/i.test(signature), 'Expected 65-byte secp256k1 signature');
  const expected = prepared.getWitnessArgs(1);
  requireCondition(expected, 'Missing prepared witness');
  expected.lock = signature;
  prepared.witnesses[1] = expected.toHex();
  requireCondition(prepared.toHex() === signed.toHex() && signed.hash() === entry.hash &&
    c.verifyMessageSecp256k1(entry.message, signature, entry.payment.publicKey) &&
    c.recoverMessageSecp256k1(entry.message, signature).toLowerCase() === entry.payment.publicKey, 'Wallet altered transaction or returned an invalid signature');
  return signed;
}

export function validateBeforeSigning(pocket: string, id: string) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === id);
    requireCondition(entry?.state === 'prepared' && !journal.some(item => ['signed', 'uncertain'].includes(item.state)), 'Signing request expired');
    await discoverPublicPocket(pocket);
    await Promise.all([freshInputs(c.Transaction.fromBytes(entry.prepared.transaction)), verifyDependencies()]);
  });
}

export function persistBrowserSignature(pocket: string, id: string, bytes: string) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === id);
    requireCondition(entry?.state === 'prepared' && !journal.some(item => ['signed', 'uncertain'].includes(item.state)), 'Signing request expired');
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

export function submitBrowserPayment(pocket: string, id: string, bytes: string): Promise<TransactionResult> {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const entry = journal.find(item => item.payment.id === id);
    requireCondition(entry?.signed === bytes, 'Unknown or expired signing request');
    if (entry.state !== 'signed') return { txHash: entry.hash, state: entry.state };
    const signed = verifiedSignature(entry, bytes);
    const raw = rpcFormat.transactionFrom(signed);
    try {
      const policy = await discoverPublicPocket(pocket);
      requireCondition(signed.inputs[0].previousOutput.eq(c.OutPoint.from({txHash: policy.outPoint.tx_hash, index: policy.outPoint.index})), 'Input is stale');
      const [inputs] = await Promise.all([freshInputs(signed), verifyDependencies()]);
      const fee = inputs.reduce((sum, cell) => sum + BigInt(cell.cell.output.capacity), 0n) - signed.outputs.reduce((sum, output) => sum + output.capacity, 0n);
      requireCondition(fee > 0n && fee <= 1000000n && fee === BigInt(entry.prepared.fee), 'Transaction fee is outside policy bounds');
      await httpRpc('dry_run_transaction', [raw]);
      await httpRpc('test_tx_pool_accept', [raw]);
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

export function reconcileBrowser(pocket: string) {
  return locked(pocket, async () => {
    const journal = entries(pocket);
    const uncertain = journal.filter(entry => entry.state === 'uncertain');
    if (uncertain.length) requireCondition(await httpRpc('get_block_hash', ['0x0']) === deployment.genesis, 'Wrong Pudge genesis');
    const outcomes: { txHash: string; state: string; pocket: string; operation: string; status?: string; reason?: string }[] = journal.filter(entry => entry.state === 'committed' || entry.state === 'conflict').map(entry => ({ txHash: entry.hash, state: entry.state === 'committed' ? 'committed' : 'rejected', operation: 'pay', pocket }));
    for (const entry of uncertain) {
      const response = await httpRpc<any>('get_transaction', [entry.hash]);
      let status = response?.tx_status?.status;
      if (status === 'committed') {
        await canonical({ tx_hash: entry.hash, index: '0x0' });
        entry.state = 'committed';
      } else if (!['pending', 'proposed'].includes(status)) {
        // A different canonical successor consuming this exact policy input makes the original impossible.
        const policy = await discoverPublicPocket(pocket);
        const original = c.Transaction.fromBytes(entry.prepared.transaction).inputs[0].previousOutput;
        const liveOriginal = await httpRpc<any>('get_live_cell', [rpcFormat.outPointFrom(original), false]);
        const successor = await canonical(policy.outPoint);
        const consumed = successor.inputs.some((input: { previous_output: Point }) => original.eq(c.OutPoint.from({txHash: input.previous_output.tx_hash, index: input.previous_output.index})));
        if (liveOriginal?.status === 'dead' && consumed && policy.outPoint.tx_hash !== entry.hash) {
          entry.state = 'conflict';
          status = 'rejected';
        } else status = 'uncertain';
      }
      outcomes.push({ txHash: entry.hash, state: status, pocket, operation: 'pay' });
    }
    if (uncertain.length) save(pocket, journal);
    return { outcomes };
  });
}
