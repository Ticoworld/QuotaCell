import assert from 'node:assert/strict';
import { clearPaymentIntent, PAYMENT_INTENT_KEY, paymentRequestFromIntent, readSavedPaymentIntent, savePaymentIntent } from './paymentIntent.ts';

const values = new Map();
globalThis.sessionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};

const intent = {
  version: 1,
  id: '9a0d76d0-65ec-4b85-a3f1-b4f4826d3437',
  pocket: `0x${'11'.repeat(32)}`,
  publicKey: `0x02${'22'.repeat(32)}`,
  role: 'alice',
  amount: '100',
  recipient: `0x${'33'.repeat(20)}`,
};

savePaymentIntent(intent);
assert.deepEqual(readSavedPaymentIntent(), intent, 'the same unsigned intent can resume after reload');
assert.deepEqual(paymentRequestFromIntent(intent), {
  publicKey: intent.publicKey,
  role: intent.role,
  amount: intent.amount,
  recipient: intent.recipient,
  id: intent.id,
});
const stored = JSON.parse(values.get(PAYMENT_INTENT_KEY));
assert.deepEqual(Object.keys(stored).sort(), ['amount', 'id', 'pocket', 'publicKey', 'recipient', 'role', 'version'].sort());
assert.equal('transaction' in stored, false);
assert.equal('signature' in stored, false);
assert.equal('signer' in stored, false);

values.set(PAYMENT_INTENT_KEY, JSON.stringify({ ...intent, id: 'not-a-uuid' }));
assert.equal(readSavedPaymentIntent(), null, 'malformed request IDs are discarded');
clearPaymentIntent();
assert.equal(values.has(PAYMENT_INTENT_KEY), false);
console.log('Payment reload recovery stores only the bound unsigned intent');
