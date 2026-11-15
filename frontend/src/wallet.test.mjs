import assert from 'node:assert/strict';
import { CkbWalletSession, hasUtxoGlobalCkbProvider, WalletProviderUnavailableError } from './wallet.ts';

assert.equal(hasUtxoGlobalCkbProvider(undefined), false);
assert.equal(hasUtxoGlobalCkbProvider(null), false);
assert.equal(hasUtxoGlobalCkbProvider({}), false);
assert.equal(hasUtxoGlobalCkbProvider({ ckbSigner: {} }), false);
const provider = Object.fromEntries(['connect', 'isConnected', 'getAccount', 'getPublicKey', 'getNetwork', 'switchNetwork', 'signMessage', 'signTransaction', 'on', 'removeListener'].map((method) => [method, () => undefined]));
assert.equal(hasUtxoGlobalCkbProvider({ ckbSigner: provider }), true);

globalThis.window = { utxoGlobal: undefined };
await assert.rejects(new CkbWalletSession().connect(), WalletProviderUnavailableError);
globalThis.window = { utxoGlobal: { ckbSigner: {} } };
await assert.rejects(new CkbWalletSession().connect(), WalletProviderUnavailableError);
console.log('Missing and incomplete UTXO Global providers fail before opening CCC; the complete injected CKB interface is recognized');
