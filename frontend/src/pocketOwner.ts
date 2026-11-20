import * as c from '@ckb-ccc/core';
import { JsonRpcTransformers as rpc } from '@ckb-ccc/core/advanced';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { buildPayment } from './pocketPayment';

const K = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const A = '0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const Q = '0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';
const F = '0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a';
type Live = Parameters<typeof buildPayment>[0]['policy'];
type Deps = Parameters<typeof buildPayment>[0]['deps'];
export type OwnerOperation = 'genesis' | 'deposit' | 'admin' | 'revoke' | 'close' | 'sweep';
export type Terms = { sharedLimit: string; delegates: { publicKey: string; recipient: c.ScriptLike; limit: string; perPayment: string }[] };
export type Admin = { shared: bigint; alice: bigint; ben: bigint; mask: number };
const terminalCapacity = 13_400_000_000n;
const policyCapacity = 60_000_000_000n;
function check(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function key(value: string) {
  check(/^0x0[23][0-9a-f]{64}$/i.test(value), 'Invalid compressed public key');
  const bytes = c.bytesFrom(value);
  secp256k1.Point.fromBytes(bytes);
  return bytes;
}
export function ownerLockFor(publicKey: string) {
  return c.Script.from({ codeHash: K, hashType: 'type', args: c.hashCkb(key(publicKey)).slice(0, 42) });
}
function read128(data: Uint8Array, offset: number) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true) | view.getBigUint64(offset + 8, true) << 64n;
}
function put128(data: Uint8Array, offset: number, value: bigint) {
  check(value >= 0n && value < 1n << 128n, 'Limit out of range');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(offset + 8, value >> 64n, true);
}
const outputOf = (input: Live) => rpc.cellOutputTo(input.cell.output as Parameters<typeof rpc.cellOutputTo>[0]);
const ordinary = (cell: Live, lock: c.Script) => cell.status === 'live' && !cell.cell.output.type && cell.cell.data.content === '0x' && outputOf(cell).lock.eq(lock);

function initialState(owner: string, terms: Terms) {
  check(terms.delegates.length === 2, 'Two delegates are required');
  const participants = [owner, ...terms.delegates.map(delegate => delegate.publicKey)].map(ownerLockFor);
  check(new Set(participants.map(lock => lock.hash())).size === 3, 'Actor identities must be distinct');
  const shared = BigInt(terms.sharedLimit);
  const state = new Uint8Array(466);
  state.set(c.bytesFrom('0x51434e3404000003'));
  put128(state, 8, shared);
  state.set(key(owner), 125);
  const recipients = new Set<string>(participants.map(lock => lock.hash()));
  for (const [index, delegate] of terms.delegates.entries()) {
    const offset = 158 + 154 * index;
    const recipient = c.Script.from(delegate.recipient);
    const limit = BigInt(delegate.limit);
    const max = BigInt(delegate.perPayment);
    check(recipient.codeHash === K && recipient.hashType === 'type' && /^0x[0-9a-f]{40}$/i.test(recipient.args) &&
      !recipients.has(recipient.hash()), 'Invalid or duplicate recipient lock');
    check(max > 0n && max <= limit && limit <= shared, 'Invalid delegate limits');
    recipients.add(recipient.hash());
    state.set(key(delegate.publicKey), offset);
    state.set(recipient.toBytes(), offset + 33);
    put128(state, offset + 106, limit);
    put128(state, offset + 138, max);
  }
  return state;
}

export function buildOwnerTransaction(options: {
  operation: OwnerOperation; publicKey: string; owner: Live; deps: Deps; fee: bigint;
  policy?: Live; funds?: Live[]; terms?: Terms; amount?: bigint; mask?: number; admin?: Admin;
}) {
  const { operation, publicKey, owner, deps, fee, policy, terms, admin } = options;
  const lock = ownerLockFor(publicKey);
  check(ordinary(owner, lock), 'Owner input lock mismatch');
  check(fee >= 0n && fee <= 1_000_000n, 'Invalid fee');
  const ownerCapacity = outputOf(owner).capacity;
  let inputs = [owner];
  const outputs: c.CellOutputLike[] = [];
  const data: string[] = [];
  let change = ownerCapacity - fee;
  let position = 0;
  let action: string | undefined;
  let type: c.Script;
  let amount = 0n;
  let release = 0n;
  if (operation === 'genesis') {
    check(terms, 'Missing Pocket terms');
    const input = c.CellInput.from({ previousOutput: owner.outPoint, since: 0 });
    const seed = new Uint8Array(input.toBytes().length + 8);
    seed.set(input.toBytes());
    type = c.Script.from({ codeHash: Q, hashType: 'data2', args: c.hashCkb(seed) });
    outputs.push({ capacity: policyCapacity, lock: { codeHash: A, hashType: 'data1', args: '0x' }, type });
    data.push(c.hexFrom(initialState(publicKey, terms)));
    change -= policyCapacity;
    action = '0x5143413100ff0000';
  } else {
    check(policy?.status === 'live', 'Policy is not live');
    const policyOutput = outputOf(policy);
    check(policyOutput.type?.codeHash === Q && policyOutput.type.hashType === 'data2' &&
      policyOutput.lock.eq(c.Script.from({ codeHash: A, hashType: 'data1', args: '0x' })), 'Policy identity mismatch');
    type = policyOutput.type;
    const state = c.bytesFrom(policy.cell.data.content);
    const active = state.length === 466 && c.hexFrom(state.slice(0, 7)) === '0x51434e34040000';
    const closed = state.length === 28 && c.hexFrom(state.slice(0, 8)) === '0x5143543404000100';
    check((active && c.hexFrom(state.slice(125, 158)) === publicKey.toLowerCase()) ||
      (closed && c.hexFrom(state.slice(8)) === lock.args), 'Connected account is not the owner');
    const fundLock = c.Script.from({ codeHash: F, hashType: 'data1', args: type.hash() });
    if (operation === 'deposit') {
      amount = options.amount ?? 0n;
      check(amount >= 7_300_000_000n, 'Deposit below occupied capacity');
      outputs.push({ capacity: amount, lock: fundLock });
      data.push('0x');
      change -= amount;
    } else {
      inputs = [policy, owner];
      position = 1;
      outputs.push(policyOutput.clone());
      data.push(c.hexFrom(state));
      if (operation === 'admin' || operation === 'revoke') {
        check(active, 'Pocket is closed');
        if (operation === 'revoke') {
          const mask = options.mask ?? 0;
          check(mask > 0 && mask <= 3 && (mask & state[7]) === mask, 'Delegate is already revoked');
          state[7] &= ~mask;
          action = '0x5143413103ff0000' + mask.toString(16).padStart(2, '0');
        } else {
          check(admin && admin.mask >= 0 && admin.mask <= 3 && !(admin.mask & state[7]) &&
            (admin.shared || admin.alice || admin.ben || admin.mask), 'Invalid permission update');
          const actionBytes = new Uint8Array(57);
          actionBytes.set(c.bytesFrom('0x5143413102ff0000'));
          for (const [offset, actionOffset, delta] of [[8, 8, admin.shared], [264, 24, admin.alice], [418, 40, admin.ben]] as const) {
            put128(actionBytes, actionOffset, delta);
            put128(state, offset, read128(state, offset) + delta);
          }
          check(read128(state, 264) <= read128(state, 8) && read128(state, 418) <= read128(state, 8), 'Personal limit exceeds shared limit');
          actionBytes[56] = admin.mask;
          state[7] |= admin.mask;
          action = c.hexFrom(actionBytes);
        }
        data[0] = c.hexFrom(state);
      } else {
        const funds = options.funds || [];
        check(funds.length > 0 && funds.length <= 64 && funds.every(cell => ordinary(cell, fundLock)), 'No eligible protected funds or too many inputs');
        check(operation === 'close' ? active : closed, 'Pocket state changed');
        inputs.push(...funds);
        amount = funds.reduce((sum, input) => sum + outputOf(input).capacity, 0n);
        outputs.push({ capacity: amount, lock });
        data.push('0x');
        action = operation === 'close' ? '0x5143413104ff0000' : '0x5143413105ff0000';
        if (operation === 'close') {
          release = policyOutput.capacity - terminalCapacity;
          check(release > 0n, 'Insufficient releasable policy capacity');
          outputs[0] = { ...policyOutput, capacity: terminalCapacity };
          data[0] = '0x5143543404000100' + lock.args.slice(2);
          change += release;
        }
      }
    }
  }
  check(new Set(inputs.map(({ outPoint }) => c.OutPoint.from(outPoint).toHex())).size === inputs.length, 'Duplicate inputs');
  check(change >= 6_100_000_000n, 'Owner cell cannot cover the amount, fee and change');
  outputs.push({ capacity: change, lock });
  data.push('0x');
  const transaction = c.Transaction.from({
    inputs: inputs.map(({ outPoint }) => ({ previousOutput: outPoint, since: 0 })),
    outputs, outputsData: data, cellDeps: operation === 'deposit' ? deps.slice(0, 1) : deps,
    witnesses: inputs.map(() => '0x'),
  });
  transaction.setWitnessArgs(position, { lock: '0x' + '00'.repeat(65), inputType: action });
  return { transaction, inputs, position, pocket: type.hash(), amount, change, release };
}
