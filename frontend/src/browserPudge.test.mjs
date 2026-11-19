import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('reloaded signed intents require fresh exact-hash consent and uncertain intents cannot be resent', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  const pocket = 'fixture';
  const id = 'request';
  const hash = '0x1234';
  const publicKey = '0x5678';
  const journal = [{ state: 'signed', payment: { id, publicKey }, hash, signed: 'fixture bytes' }];
  let writes = 0;
  const previousStorage = globalThis.localStorage;
  const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  globalThis.localStorage = { getItem: () => JSON.stringify(journal), setItem: () => { writes++; } };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_, action) => action() } });
  try {
    const { readBrowserIntent, submitBrowserPayment } = await vite.ssrLoadModule('/src/browserPudge.ts');
    assert.equal(readBrowserIntent(pocket, publicKey).hash, hash);
    await assert.rejects(submitBrowserPayment(pocket, id, 'fixture bytes'), /Broadcast approval required/);
    const verifySigner = async () => publicKey;
    await assert.rejects(submitBrowserPayment(pocket, id, 'fixture bytes', { hash: 'wrong hash', publicKey, verifySigner }), /Broadcast approval required/);
    await assert.rejects(submitBrowserPayment(pocket, id, 'fixture bytes', { hash, publicKey: 'wrong signer', verifySigner }), /Broadcast approval required/);
    await assert.rejects(submitBrowserPayment(pocket, id, 'different bytes', { hash, publicKey, verifySigner }), /Unknown or expired/);
    journal[0].state = 'uncertain';
    assert.equal(readBrowserIntent(pocket, publicKey), undefined);
    assert.deepEqual(await submitBrowserPayment(pocket, id, 'fixture bytes', { hash, publicKey, verifySigner }), { txHash: hash, state: 'uncertain' });
    assert.equal(writes, 0);
  } finally {
    globalThis.localStorage = previousStorage;
    if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
    else delete navigator.locks;
    await vite.close();
  }
});
