import assert from 'node:assert/strict';
import * as connector from '@ckb-ccc/connector';
import { CkbWalletSession, isTemporaryWalletError, isVerifiedPudgeContext, WalletProviderUnavailableError, WalletTemporarilyUnavailableError } from './wallet.ts';

const publicKey = `0x02${'11'.repeat(32)}`;
const addressArgs = connector.hashCkb(connector.bytesFrom(publicKey)).slice(0, 42);
const addressScript = {
  codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
  hashType: 'type',
  args: addressArgs,
};
const previousWindow = globalThis.window;
globalThis.window = { setTimeout, clearTimeout };

function makeSigner({ key = publicKey, network = 'nervos_testnet', lock = addressScript, isConnected = true } = {}) {
  return {
    signType: connector.SignerSignType.CkbSecp256k1,
    provider: { getNetwork: async () => network },
    isConnected: async () => isConnected,
    getPublicKey: async () => key,
    getRecommendedAddressObj: async () => ({ script: lock, toString: async () => 'ckt1verified' }),
    signOnlyTransaction: async () => ({ toHex: () => '0x00' }),
  };
}

function attach(session, signer, overrides = {}) {
  session.attachConnectorState({
    ready: true,
    signer,
    walletName: 'UTXO Global Wallet',
    open: () => undefined,
    disconnect: () => undefined,
    isOpen: false,
    ...overrides,
  });
}

try {
  {
    const session = new CkbWalletSession();
    assert.equal(await session.restore(), null, 'a connector that has not initialized is not treated as a connection');
    await assert.rejects(session.connect(), /still starting/);
    attach(session, makeSigner(), { ready: false });
    assert.equal(await session.restore(), null, 'provider initialization delay remains pending');
    attach(session, makeSigner());
    assert.deepEqual(await session.restore(), { publicKey, address: 'ckt1verified' }, 'CCC-restored signer is adopted without opening the wallet picker');
  }

  {
    const session = new CkbWalletSession();
    const signer = makeSigner();
    attach(session, signer);
    let disconnectCalls = 0;
    session.attachConnectorState({ ready: true, signer, walletName: 'UTXO Global Wallet', open() {}, disconnect() { disconnectCalls++; }, isOpen: false });
    assert.deepEqual(await session.identity(), { publicKey, address: 'ckt1verified' });
    session.disconnect();
    assert.equal(session.hasSigner, false);
    assert.equal(disconnectCalls, 1, 'explicit disconnect uses CCC disconnect');
    attach(session, signer);
    assert.equal(session.hasSigner, false, 'a stale provider render cannot undo explicit disconnect');
  }

  {
    const session = new CkbWalletSession();
    const signer = makeSigner();
    attach(session, signer);
    signer.provider.getNetwork = async () => { throw new TypeError('Failed to fetch'); };
    assert.equal(await session.restore(), null, 'transient identity failure does not claim restoration succeeded');
    assert.equal(session.hasSigner, true, 'transient identity failure keeps the CCC session');
    await assert.rejects(session.identity(), WalletTemporarilyUnavailableError);
    assert.equal(isTemporaryWalletError(new WalletTemporarilyUnavailableError()), true);
  }

  {
    const session = new CkbWalletSession();
    const signer = makeSigner();
    attach(session, signer);
    signer.isConnected = async () => { throw new TypeError('Provider is still initializing'); };
    session.attachConnectorState({ ready: true, walletName: undefined, open() {}, disconnect() {}, isOpen: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(session.hasSigner, true, 'a transient empty CCC state does not disconnect the existing signer');
    signer.isConnected = async () => false;
    session.attachConnectorState({ ready: true, walletName: undefined, open() {}, disconnect() {}, isOpen: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(session.hasSigner, false, 'a confirmed provider disconnect clears the active signer');
  }

  {
    const wrongNetwork = new CkbWalletSession();
    attach(wrongNetwork, makeSigner({ network: 'nervos_mainnet' }));
    assert.equal(await wrongNetwork.restore(), null, 'mainnet identity is rejected for Pudge testnet');

    const wrongLock = new CkbWalletSession();
    attach(wrongLock, makeSigner({ lock: { ...addressScript, codeHash: '0x00' } }));
    assert.equal(await wrongLock.restore(), null, 'an unverified CKB lock is rejected');

    const wrongWallet = new CkbWalletSession();
    attach(wrongWallet, makeSigner(), { walletName: 'Other wallet' });
    assert.equal(await wrongWallet.restore(), null, 'only the supported wallet is restored');
  }

  {
    const session = new CkbWalletSession();
    const first = makeSigner();
    attach(session, first);
    const secondKey = `0x03${'22'.repeat(32)}`;
    const secondArgs = connector.hashCkb(connector.bytesFrom(secondKey)).slice(0, 42);
    attach(session, makeSigner({ key: secondKey, lock: { ...addressScript, args: secondArgs } }));
    assert.deepEqual(await session.identity(), { publicKey: secondKey, address: 'ckt1verified' }, 'a CCC account replacement updates the active identity');
  }

  {
    const session = new CkbWalletSession();
    const next = makeSigner();
    let opened = 0;
    const state = { ready: true, walletName: undefined, isOpen: false, open() { opened++; setTimeout(() => attach(session, next, { open: this.open, disconnect: this.disconnect, isOpen: true }), 0); }, disconnect() {} };
    session.attachConnectorState(state);
    assert.deepEqual(await session.connect(), { publicKey, address: 'ckt1verified' });
    assert.equal(opened, 1, 'a genuinely disconnected wallet opens CCC on user request');
  }

  const verifiedPocketContext = { networkMode: 'pudge', genesis: '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606', pocket: `0x${'44'.repeat(32)}` };
  assert.equal(isVerifiedPudgeContext(verifiedPocketContext, `0x${'44'.repeat(32)}`), true);
  assert.equal(isVerifiedPudgeContext({ ...verifiedPocketContext, genesis: `0x${'33'.repeat(32)}` }, `0x${'44'.repeat(32)}`), false);
  assert.equal(isVerifiedPudgeContext({ ...verifiedPocketContext, networkMode: 'isolated' }, `0x${'44'.repeat(32)}`), false);
  assert.ok(WalletProviderUnavailableError);
  console.log('CCC restoration preserves transient sessions, validates wallet identity, follows account changes, and honors explicit disconnect');
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}
