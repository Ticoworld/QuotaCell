import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGenesisAcceptanceOperation, assertGenesisAcceptanceRoute } from './pudge_acceptance_gate.mjs';

test('genesis acceptance permits only preparation, read-only RPC, reconciliation and submit routes', () => {
  for (const route of ['/api/ckb', '/api/reconcile', '/api/internal/cancel', '/api/external/genesis', '/api/external/submit']) {
    assert.doesNotThrow(() => assertGenesisAcceptanceRoute(route));
  }
  for (const route of ['/api/pay', '/api/owner', '/api/external/prepare', '/api/external/owner', '/api/external/retry']) {
    assert.throws(() => assertGenesisAcceptanceRoute(route), /Pocket genesis only/);
  }
});

test('genesis acceptance rejects submission of every non-genesis operation', () => {
  assert.doesNotThrow(() => assertGenesisAcceptanceOperation('genesis'));
  for (const operation of ['pay', 'deposit', 'revoke', 'close', 'sweep', '']) {
    assert.throws(() => assertGenesisAcceptanceOperation(operation), /only permits Pocket genesis/);
  }
});
