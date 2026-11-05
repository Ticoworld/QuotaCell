/** Experimental QCN4 transaction construction. Never use with real funds. */
import * as c from '@ckb-ccc/core';

const CKB = 100000000n;
const K = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const F = '0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a';
const A = '0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1';
const Q = '0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e';

type Script = { code_hash: string; hash_type: string; args: string };
type Point = { txHash: string; index: number };
type LiveCell = { status: string; outPoint: Point; cell: { output: { capacity: string; lock: Script; type: Script | null }; data: { content: string } } };
type Dep = { outPoint: Point; depType: 'code' | 'depGroup' };

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function script(s: Script) { return c.Script.from({codeHash:s.code_hash, hashType:s.hash_type as 'type'|'data1'|'data2', args:s.args}); }
function read128(b: Buffer, o: number) { return b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n); }
function write128(b: Buffer, o: number, n: bigint) { check(n >= 0n && n < (1n << 128n), 'counter overflow'); b.writeBigUInt64LE(n & ((1n << 64n)-1n),o);b.writeBigUInt64LE(n >> 64n,o+8); }
function rawBytes(hex: string) { check(/^0x(?:[0-9a-f]{2})*$/i.test(hex), 'invalid hex');return Buffer.from(hex.slice(2),'hex'); }
function isEmpty(cell: LiveCell) { return cell.status === 'live' && !cell.cell.output.type && cell.cell.data.content === '0x'; }

/** Construct one unsigned payment from already resolved live cells. Re-resolve and
 * verify these cells immediately before signing; a stale snapshot is not authority. */
export function buildPayment({policy, actor, funds, deps, delegate, amount, fee}: {
  policy: LiveCell; actor: LiveCell; funds: LiveCell[]; deps: Dep[];
  delegate: 0 | 1; amount: bigint; fee: bigint;
}) {
  check(delegate === 0 || delegate === 1, 'invalid delegate');
  check(policy.status === 'live' && policy.cell.output.type, 'policy is not live');
  const policyType = script(policy.cell.output.type);
  check(policyType.codeHash === Q && policyType.hashType === 'data2' && rawBytes(policyType.args).length === 32, 'unexpected policy identity');
  check(script(policy.cell.output.lock).eq(c.Script.from({codeHash:A,hashType:'data1',args:'0x'})), 'unexpected policy lock');
  const state = rawBytes(policy.cell.data.content);
  check(state.length === 466 && state.subarray(0,7).equals(Buffer.from('51434e34040000','hex')) && state.subarray(40,125).every(x=>x===0), 'invalid active state');
  check((state[7] & (1 << delegate)) !== 0 && (state[7] & ~3) === 0, 'delegate disabled');
  const offset = 158 + delegate * 154, pub = state.subarray(offset, offset+33);
  check(pub[0] === 2 || pub[0] === 3, 'invalid delegate key');
  const actorLock = c.Script.from({codeHash:K,hashType:'type',args:c.hashCkb(pub).slice(0,42)});
  check(isEmpty(actor) && script(actor.cell.output.lock).eq(actorLock), 'actor input mismatch');
  const recipient = c.Script.fromBytes(state.subarray(offset+33, offset+106));
  check(recipient.codeHash === K && recipient.hashType === 'type' && rawBytes(recipient.args).length === 20, 'invalid recipient');
  check(funds.length > 0 && funds.length <= 64, 'invalid fund count');
  const fundLock = c.Script.from({codeHash:F,hashType:'data1',args:policyType.hash()});
  let available = 0n;
  const points = new Set<string>();
  for (const cell of [policy,actor,...funds]) {
    const key = `${cell.outPoint.txHash}:${cell.outPoint.index}`;
    check(!points.has(key), 'duplicate input');points.add(key);
  }
  for (const cell of funds) {check(isEmpty(cell) && script(cell.cell.output.lock).eq(fundLock), 'fund identity mismatch');available += BigInt(cell.cell.output.capacity);}
  const shared=read128(state,8),used=read128(state,24),limit=read128(state,offset+106),spent=read128(state,offset+122),per=read128(state,offset+138);
  check(read128(state,280)+read128(state,434)===used && used<=shared && spent<=limit && limit<=shared && per>0n && per<=limit, 'invalid counters');
  check(amount>=61n*CKB && amount<=per && spent+amount<=limit && used+amount<=shared, 'payment exceeds limits or output minimum');
  check(available-amount>=73n*CKB, 'insufficient protected change');
  const actorCapacity=BigInt(actor.cell.output.capacity);
  check(fee>=0n && fee<=1000000n && actorCapacity-fee>=61n*CKB, 'fee input too small or fee too large');
  write128(state,24,used+amount);write128(state,offset+122,spent+amount);
  const inputs=[policy,actor,...funds].map(x=>({previousOutput:x.outPoint,since:0}));
  const tx=c.Transaction.from({inputs,outputs:[
    {capacity:BigInt(policy.cell.output.capacity),lock:script(policy.cell.output.lock),type:policyType},
    {capacity:available-amount,lock:fundLock},
    {capacity:amount,lock:recipient},
    {capacity:actorCapacity-fee,lock:actorLock}
  ],outputsData:['0x'+state.toString('hex'),'0x','0x','0x'],cellDeps:deps,headerDeps:[],witnesses:inputs.map(()=> '0x')});
  tx.setWitnessArgs(1,{lock:'0x'+'00'.repeat(65),inputType:'0x5143413101'+delegate.toString(16).padStart(2,'0')+'0000'});
  return tx;
}
