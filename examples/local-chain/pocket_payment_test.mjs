import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildPayment} from './pocket_payment.ts';

const evidence=JSON.parse(await fs.readFile(new URL('../../evidence/pocket-native-v2/pay-alice.json',import.meta.url),'utf8'));
const deps=evidence.transaction.cell_deps.map(d=>({outPoint:{txHash:d.out_point.tx_hash,index:Number(d.out_point.index)},depType:d.dep_type==='dep_group'?'depGroup':'code'}));
const [policy,actor,...funds]=evidence.resolvedInputs;
const input={policy,actor,funds,deps,delegate:0,amount:10000000000n,fee:2000n};
assert.equal(buildPayment(input).hash(),evidence.txHash);
assert.throws(()=>buildPayment({...input,amount:10100000000n}),/limits/);
assert.throws(()=>buildPayment({...input,fee:1000001n}),/fee/);
const lowFund=structuredClone(funds);lowFund[0].cell.output.capacity='0x'+(172n*100000000n).toString(16);
assert.throws(()=>buildPayment({...input,funds:[lowFund[0]]}),/insufficient protected change/);
const altered=structuredClone(funds);altered[0].cell.output.lock.args='0x'+'00'.repeat(32);
assert.throws(()=>buildPayment({...input,funds:altered}),/fund identity/);
assert.throws(()=>buildPayment({...input,actor:funds[0]}),/actor input/);
assert.throws(()=>buildPayment({...input,funds:[funds[0],funds[0]]}),/duplicate input/);
console.log('PASS: QCN4 payment builder reconstructs the recorded transaction and rejects invalid terms');
