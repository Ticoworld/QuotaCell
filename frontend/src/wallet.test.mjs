import assert from 'node:assert/strict';
import { CkbWalletSession, hasUtxoGlobalCkbProvider, isVerifiedPudgeContext, WalletProviderUnavailableError } from './wallet.ts';

assert.equal(hasUtxoGlobalCkbProvider(undefined), false);
assert.equal(hasUtxoGlobalCkbProvider(null), false);
assert.equal(hasUtxoGlobalCkbProvider({}), false);
assert.equal(hasUtxoGlobalCkbProvider({ ckbSigner: {} }), false);
const completeProvider = Object.fromEntries(['connect', 'isConnected', 'getAccount', 'getPublicKey', 'getNetwork', 'switchNetwork', 'signMessage', 'signTransaction', 'on', 'removeListener'].map((method) => [method, () => undefined]));
assert.equal(hasUtxoGlobalCkbProvider({ ckbSigner: completeProvider }), true);

globalThis.window = { utxoGlobal: undefined };
await assert.rejects(new CkbWalletSession().connect(), WalletProviderUnavailableError);
globalThis.window = { utxoGlobal: { ckbSigner: {} } };
await assert.rejects(new CkbWalletSession().connect(), WalletProviderUnavailableError);

const ownerKey = `0x02${'11'.repeat(32)}`;
const addressArgs = `0x${'22'.repeat(20)}`;
const signer = {
  signType: 'ckb-secp256k1',
  provider: { getNetwork: async () => 'nervos_testnet' },
  isConnected: async () => true,
  getPublicKey: async () => ownerKey,
  getRecommendedAddressObj: async () => ({
    script: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: addressArgs },
    toString: async () => 'ckt1verified',
  }),
};
const connector = {
  ClientPublicTestnet: class {},
  SignerSignType: { CkbSecp256k1: signer.signType },
  bytesFrom: () => new Uint8Array(),
  hashCkb: () => `${addressArgs}${'00'.repeat(11)}`,
};

function createRestoreHarness({ network = 'nervos_testnet', emitConnection = true } = {}) {
  const element = new EventTarget();
  Object.assign(element, { hidden: false, isConnected: false, client: undefined, signer: undefined, wallet: undefined, name: '', hideKhie: false, removed: false, disconnected: false });
  element.remove = () => { element.removed = true; element.isConnected = false; };
  element.disconnect = () => { element.disconnected = true; };
  const liveSigner = { ...signer, provider: { getNetwork: async () => network } };
  const liveConnector = {
    ...connector,
    hashCkb: () => `${addressArgs}${'00'.repeat(11)}`,
  };
  element.signer = { signer: liveSigner };
  element.wallet = { name: 'UTXO Global Wallet' };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { createElement: () => element, body: { append: (node) => {
    node.isConnected = true;
    if (emitConnection) queueMicrotask(() => {
      const event = new Event('connection');
      event.connectionOwner = { value: { signerInfo: { signer: liveSigner }, wallet: { name: 'UTXO Global Wallet' } } };
      node.dispatchEvent(event);
    });
  } } };
  globalThis.window = { utxoGlobal: { ckbSigner: completeProvider }, setTimeout, clearTimeout };
  const session = new CkbWalletSession(async () => liveConnector, 5);
  return { element, session, restore: () => session.restore(async (identity) => identity.publicKey === ownerKey), restoreInvalidContext: () => session.restore(async () => false), restoreWrongLock: async () => {
    liveSigner.getRecommendedAddressObj = async () => ({ script: { codeHash: '0x00', hashType: 'data', args: addressArgs }, toString: async () => 'ckt1wrong' });
    return session.restore();
  }, restoreWrongNetwork: async () => {
    liveSigner.provider = { getNetwork: async () => 'nervos_mainnet' };
    return session.restore();
  }, cleanup: () => { globalThis.document = previousDocument; globalThis.window = previousWindow; } };
}

{
  const harness = createRestoreHarness();
  try {
    const identity = await harness.restore();
    assert.deepEqual(identity, { publicKey: ownerKey, address: 'ckt1verified' });
    assert.equal(harness.element.hidden, true, 'restore does not open the wallet picker');
    harness.session.disconnect();
    assert.equal(harness.element.disconnected, true, 'explicit disconnect clears the CCC session');
    assert.equal(harness.element.removed, true);
  } finally { harness.cleanup(); }
}

{
  const harness = createRestoreHarness({ emitConnection: false });
  try {
    assert.deepEqual(await harness.restore(), { publicKey: ownerKey, address: 'ckt1verified' }, 'CCC signer state is also adopted if its connection event was missed');
  } finally { harness.cleanup(); }
}

{
  const harness = createRestoreHarness();
  try { assert.equal(await harness.restoreInvalidContext(), null, 'a non-Pudge context is not restored'); }
  finally { harness.cleanup(); }
}

{
  const harness = createRestoreHarness({ network: 'nervos_mainnet' });
  try { assert.equal(await harness.restore(), null, 'a wallet on the wrong network is not restored'); }
  finally { harness.cleanup(); }
}

{
  const harness = createRestoreHarness();
  try { assert.equal(await harness.restoreWrongLock(), null, 'an unsupported CKB lock is not restored'); }
  finally { harness.cleanup(); }
}

const verifiedPocketContext = { networkMode: 'pudge', genesis: '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606', pocket: `0x${'44'.repeat(32)}` };
assert.equal(isVerifiedPudgeContext(verifiedPocketContext, `0x${'44'.repeat(32)}`), true);
assert.equal(isVerifiedPudgeContext({ ...verifiedPocketContext, genesis: `0x${'33'.repeat(32)}` }, `0x${'44'.repeat(32)}`), false);
assert.equal(isVerifiedPudgeContext({ ...verifiedPocketContext, networkMode: 'isolated' }, `0x${'44'.repeat(32)}`), false);
console.log('CCC session restore validates CKB network, lock, key, Pudge context, and keeps the picker hidden; explicit disconnect remains effective');
