import { hexFrom, Script, WitnessArgs, bytesFrom, hashCkb } from '@ckb-ccc/core';
import { JsonRpcTransformers as format } from '@ckb-ccc/core/advanced';
import { httpRpc as requestRpc } from './publicDiscovery';
import type { HistoryItem } from './domain';

const httpRpc = <T>(method: string, params: unknown[]) => requestRpc<T>(method, params, 'history');

type Raw = Parameters<typeof format.transactionTo>[0];
type RawScript = Parameters<typeof format.scriptTo>[0];
type Hit = { tx_hash: string; block_number: string; tx_index: string; io_type: 'input' | 'output'; io_index: string };
type Header = { hash: string; number: string; timestamp: string };
const active = (data?: string) => /^0x51434e34040000[0-9a-f]{918}$/.test(data || '');
const terminal = (data?: string) => /^0x5143543404000100[0-9a-f]{40}$/.test(data || '');
const standard = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const matches = (raw: RawScript | null | undefined, script: Script) => !!raw && format.scriptTo(raw).eq(script);
const number = (value: bigint) => '0x' + value.toString(16);

async function indexedHits(script: Script, scriptType: 'type' | 'lock', end: string) {
  const hits: Hit[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = { script: format.scriptFrom(script), script_type: scriptType, script_search_mode: 'exact', filter: { block_range: ['0x0', end] } };
    const result = await httpRpc<{ objects: Hit[]; last_cursor: string }>('get_transactions', cursor ? [query, 'asc', '0x64', cursor] : [query, 'asc', '0x64']);
    if (!Array.isArray(result?.objects)) throw new Error('Invalid Pudge history response');
    hits.push(...result.objects);
    if (result.objects.length < 100) return hits;
    if (!result.last_cursor || cursors.has(result.last_cursor)) throw new Error('Pudge history cursor did not advance');
    cursor = result.last_cursor;
    cursors.add(cursor);
  }
  throw new Error('Pudge history exceeded its page limit');
}

function classify(tx: Raw, previousPolicy: string | undefined, policyIndex: number, policyInputIndex: number, fundIn: bigint, fundOut: bigint): Pick<HistoryItem, 'operation' | 'actor' | 'amount' | 'recipient'> {
  const next = tx.outputs_data[policyIndex];
  const unclassified = { operation: 'unknown', actor: '', amount: '0', recipient: '' };
  if (policyIndex === -1 && policyInputIndex === -1 && fundIn === 0n && fundOut > 0n) {
    return { ...unclassified, operation: 'deposit', amount: fundOut.toString() };
  }
  const position = policyInputIndex === -1 ? 0 : 1;
  const witness = tx.witnesses[position];
  let action: string | undefined;
  try { if (witness && witness !== '0x') action = WitnessArgs.fromBytes(witness).inputType; }
  catch { return unclassified; }
  if (policyIndex === 0 && policyInputIndex === -1 && active(next) && action === '0x5143413100ff0000') {
    return { ...unclassified, operation: 'genesis', actor: '0x' + next.slice(252, 318) };
  }
  if (policyIndex !== 0 || policyInputIndex !== 0 || !previousPolicy) return unclassified;
  if (active(previousPolicy) && active(next) && /^0x51434131010[01]0000$/.test(action || '')) {
    const delegate = action === '0x5143413101000000' ? 0 : 1;
    const offset = 158 + 154 * delegate;
    const previous = bytesFrom(previousPolicy);
    const recipient = Script.fromBytes(previous.subarray(offset + 33, offset + 106));
    const amount = fundIn - fundOut;
    const output = tx.outputs[2];
    if (output && amount > 0n && BigInt(output.capacity) === amount && matches(output.lock, recipient) && !output.type && tx.outputs_data[2] === '0x') {
      return { operation: 'pay', actor: hexFrom(previous.subarray(offset, offset + 33)), amount: amount.toString(), recipient: recipient.args };
    }
  }
  if (active(previousPolicy) && active(next) && /^0x5143413102ff0000[0-9a-f]{98}$/.test(action || '') && fundIn === 0n && fundOut === 0n) {
    return { ...unclassified, operation: 'admin', actor: '0x' + previousPolicy.slice(252, 318) };
  }
  const owner = active(previousPolicy) ? '0x' + previousPolicy.slice(252, 318) : '';
  if (owner && active(next) && /^0x5143413103ff0000[0-9a-f]{2}$/.test(action || '') && fundIn === 0n && fundOut === 0n) {
    return { ...unclassified, operation: 'revoke', actor: owner };
  }
  const payout = tx.outputs[1];
  const ownerArgs = owner ? hashCkb(owner).slice(0, 42) : previousPolicy.slice(18);
  if (payout && fundIn > 0n && fundOut === 0n && BigInt(payout.capacity) === fundIn &&
      matches(payout.lock, Script.from({ codeHash: standard, hashType: 'type', args: '0x' + ownerArgs.replace(/^0x/, '') }))) {
    if (owner && terminal(next) && action === '0x5143413104ff0000') return { ...unclassified, operation: 'close', actor: owner, amount: fundIn.toString() };
    if (terminal(previousPolicy) && next === previousPolicy && action === '0x5143413105ff0000') return { ...unclassified, operation: 'sweep', amount: fundIn.toString() };
  }
  return unclassified;
}

export async function loadPocketHistory(policyScript: RawScript, fund: Script, tip: { block_number: string; block_hash: string }, policyHash: string) {
  const policy = format.scriptTo(policyScript);
  const end = number(BigInt(tip.block_number) + 1n);
  const [policyHits, fundHits] = await Promise.all([indexedHits(policy, 'type', end), indexedHits(fund, 'lock', end)]);
  const hits = [...policyHits, ...fundHits];
  const byHash = new Map(hits.map(hit => [hit.tx_hash, hit]));
  if (!byHash.has(policyHash)) throw new Error('Pudge history has not reached the current policy');
  const committed = new Map<string, { tx: Raw; header: Header }>();
  const headers = new Map<string, Promise<Header>>();
  for (const hit of byHash.values()) {
    const response = await httpRpc<{ transaction: Raw; tx_status: { status: string; block_hash: string; tx_index: string } }>('get_transaction', [hit.tx_hash]);
    const status = response?.tx_status;
    if (status?.status !== 'committed' || !response.transaction || format.transactionTo(response.transaction).hash() !== hit.tx_hash || BigInt(status.tx_index) !== BigInt(hit.tx_index)) throw new Error('Invalid committed Pocket transaction');
    let header = headers.get(status.block_hash);
    if (!header) {
      header = (async () => {
        const found = await httpRpc<Header>('get_header', [status.block_hash]);
        if (!found || found.hash !== status.block_hash || await httpRpc('get_block_hash', [found.number]) !== found.hash) throw new Error('Noncanonical Pocket history block');
        return found;
      })();
      headers.set(status.block_hash, header);
    }
    const verified = await header;
    if (BigInt(verified.number) !== BigInt(hit.block_number) || BigInt(verified.number) >= BigInt(end)) throw new Error('Unexpected Pocket transaction block');
    committed.set(hit.tx_hash, { tx: response.transaction, header: verified });
  }
  const records: HistoryItem[] = [];
  const sorted = [...byHash.values()].sort((a, b) => {
    const order = BigInt(a.block_number) - BigInt(b.block_number) || BigInt(a.tx_index) - BigInt(b.tx_index);
    return order < 0n ? -1 : order > 0n ? 1 : 0;
  });
  for (const hit of sorted) {
    const { tx, header } = committed.get(hit.tx_hash)!;
    const inputs = tx.inputs.map(({ previous_output }) => {
      const previous = committed.get(previous_output.tx_hash)?.tx;
      const index = Number(BigInt(previous_output.index));
      return { output: previous?.outputs[index], data: previous?.outputs_data[index] };
    });
    const policyIndex = tx.outputs.findIndex(output => matches(output.type, policy));
    const policyInput = inputs.findIndex(({ output }) => matches(output?.type, policy));
    const protectedCapacity = (output: Raw['outputs'][number] | undefined, data: string | undefined) =>
      output && !output.type && data === '0x' && matches(output.lock, fund) ? BigInt(output.capacity) : 0n;
    const fundIn = inputs.reduce((sum, { output, data }) => sum + protectedCapacity(output, data), 0n);
    const fundOut = tx.outputs.reduce((sum, output, index) => sum + protectedCapacity(output, tx.outputs_data[index]), 0n);
    if (policyIndex < 0 && policyInput < 0 && fundIn === 0n && fundOut === 0n) continue;
    records.push({ id: hit.tx_hash, tx_hash: hit.tx_hash, state: 'committed', created: new Date(Number(BigInt(header.timestamp))).toISOString(),
      ...classify(tx, inputs[policyInput]?.data, policyIndex, policyInput, fundIn, fundOut) });
  }
  if (await httpRpc('get_block_hash', [tip.block_number]) !== tip.block_hash) throw new Error('Pudge reorganized during history lookup');
  return records;
}
