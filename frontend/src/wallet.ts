import type { PocketState, WalletIdentity } from './domain';

const STANDARD_LOCK = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const PUDGE_GENESIS = '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const RESTORE_WAIT_MS = 8_000;
const CONNECT_WAIT_MS = 120_000;
const CKB_PROVIDER_METHODS = ['connect', 'isConnected', 'getAccount', 'getPublicKey', 'getNetwork', 'switchNetwork', 'signMessage', 'signTransaction', 'on', 'removeListener'];
type ConnectorModule = typeof import('@ckb-ccc/connector');
type Signer = {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getRecommendedAddressObj(): Promise<any>;
  signOnlyTransaction(transaction: unknown): Promise<{ toHex(): string }>;
  signType?: string;
  provider?: { getNetwork?: () => Promise<string> };
  onReplaced?: (listener: () => void) => () => void;
};
type ConnectorState = {
  ready: boolean;
  signer?: Signer;
  walletName?: string;
  open: () => unknown;
  disconnect: () => unknown;
  isOpen: boolean;
};

export class WalletProviderUnavailableError extends Error {
  constructor() {
    super('UTXO Global Wallet provider is not available to this page.');
    this.name = 'WalletProviderUnavailableError';
  }
}

export class WalletTemporarilyUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The wallet is connected, but its identity check is temporarily unavailable.', { cause });
    this.name = 'WalletTemporarilyUnavailableError';
  }
}

export function isTemporaryWalletError(error: unknown) {
  if (error instanceof WalletTemporarilyUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|network error|timed? ?out|temporar|rpc unavailable|provider.*not responding|message port closed/i.test(message);
}

export function hasUtxoGlobalCkbProvider(value: unknown) {
  try {
    if (!value || typeof value !== 'object') return false;
    const provider = (value as { ckbSigner?: unknown }).ckbSigner;
    if (!provider || typeof provider !== 'object') return false;
    return CKB_PROVIDER_METHODS.every((method) => typeof (provider as Record<string, unknown>)[method] === 'function');
  } catch { return false; }
}

export class CkbWalletSession {
  private playgroundSigner?: import('@ckb-ccc/core').SignerCkbPrivateKey;
  private playgroundExpiresAt=0;
  private state: ConnectorState | undefined;
  private signer: Signer | undefined;
  private walletName = '';
  private connectorModule?: Promise<ConnectorModule>;
  private readonly listeners = new Set<() => void>();
  private signerReplacementCleanup?: () => void;
  private explicitDisconnect = false;
  private connectionEpoch = 0;
  private restoreInFlight?: Promise<WalletIdentity | null>;

  get hasSigner() { return Boolean(this.signer || this.playgroundSigner); }
  get connectorReady() { return Boolean(this.state?.ready); }

  private connector() {
    return this.connectorModule ??= import('@ckb-ccc/connector');
  }

  attachConnectorState(state: ConnectorState) {
    const previousSigner = this.signer;
    this.state = state;
    if (state.signer && !this.explicitDisconnect) {
      this.signer = state.signer;
      this.walletName = state.walletName || '';
    }
    if (previousSigner !== this.signer) {
      this.signerReplacementCleanup?.();
      this.signerReplacementCleanup = this.signer?.onReplaced?.(() => this.emit()) ?? undefined;
    }
    if (!state.signer && previousSigner && !this.explicitDisconnect) {
      void previousSigner.isConnected().then((connected) => {
        if (connected || this.signer !== previousSigner || this.explicitDisconnect) return;
        this.signer = undefined;
        this.walletName = '';
        this.signerReplacementCleanup?.();
        this.signerReplacementCleanup = undefined;
        this.emit();
      }).catch(() => {});
    }
    this.emit();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private async validateSigner(signer: Signer, walletName: string): Promise<WalletIdentity> {
    const connector = await this.connector();
    let connected: boolean;
    try { connected = await signer.isConnected(); }
    catch (cause) { throw new WalletTemporarilyUnavailableError(cause); }
    if (!connected) throw new Error('Wallet disconnected. Connect again to continue.');
    if (walletName !== 'UTXO Global Wallet') throw new Error('This prototype has verified UTXO Global Wallet signing only.');
    if (signer.signType !== connector.SignerSignType.CkbSecp256k1) throw new Error('QCN4 needs a CKB secp256k1 wallet account.');
    if (typeof signer.provider?.getNetwork !== 'function') throw new Error('The wallet does not expose its CKB network.');
    let network: string;
    try { network = await signer.provider.getNetwork(); }
    catch (cause) { throw new WalletTemporarilyUnavailableError(cause); }
    if (network !== 'nervos_testnet') throw new Error('Select CKB testnet in the wallet, then connect again.');
    let publicKey: string;
    try { publicKey = await signer.getPublicKey(); }
    catch (cause) { throw new WalletTemporarilyUnavailableError(cause); }
    if (!/^0x0[23][0-9a-f]{64}$/i.test(publicKey)) throw new Error('The wallet did not provide a compressed CKB secp256k1 public key.');
    let address: any;
    try { address = await signer.getRecommendedAddressObj(); }
    catch (cause) { throw new WalletTemporarilyUnavailableError(cause); }
    const expectedArgs = connector.hashCkb(connector.bytesFrom(publicKey)).slice(0, 42);
    if (!address?.script || address.script.codeHash !== STANDARD_LOCK || address.script.hashType !== 'type' || address.script.args !== expectedArgs) throw new Error('The connected address does not match the supported CKB lock.');
    return { publicKey, address: await address.toString() };
  }

  private waitForSigner(timeoutMs: number) {
    if (this.signer) return Promise.resolve(this.signer);
    return new Promise<Signer | undefined>((resolve) => {
      let settled = false;
      let sawOpen = this.state?.isOpen === true;
      const finish = (signer?: Signer) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(signer);
      };
      const unsubscribe = this.subscribe(() => {
        if (this.signer) return finish(this.signer);
        if (this.state?.isOpen) sawOpen = true;
        else if (sawOpen) finish();
      });
      const timer = window.setTimeout(() => finish(this.signer), timeoutMs);
    });
  }

  async restore(validatePudge?: (identity: WalletIdentity) => Promise<boolean>): Promise<WalletIdentity | null> {
    if (this.restoreInFlight) return this.restoreInFlight;
    const task = (async () => {
      if (!this.state?.ready) return null;
      const signer = await this.waitForSigner(RESTORE_WAIT_MS);
      if (!signer) return null;
      try {
        const identity = await this.validateSigner(signer, this.walletName);
        if (validatePudge && !await validatePudge(identity)) return null;
        return identity;
      } catch { return null; }
    })();
    const tracked = task.finally(() => { if (this.restoreInFlight === tracked) this.restoreInFlight = undefined; });
    this.restoreInFlight = tracked;
    return tracked;
  }

  async connect(): Promise<WalletIdentity> {
    if (!this.state?.ready) throw new Error('Wallet connector is still starting. Try Connect wallet again in a moment.');
    this.explicitDisconnect = false;
    const epoch = ++this.connectionEpoch;
    if (this.signer) return this.identity();
    const connected = this.waitForSigner(CONNECT_WAIT_MS);
    try { this.state.open(); }
    catch (cause) { throw cause instanceof Error ? cause : new Error(String(cause)); }
    const signer = await connected;
    if (epoch !== this.connectionEpoch) throw new Error('Wallet session changed. Connect again.');
    if (!signer) throw new Error('Wallet connection was canceled.');
    return this.validateSigner(signer, this.walletName);
  }

  async identity(): Promise<WalletIdentity> {
    if(this.playgroundSigner) {if(Date.now()>=this.playgroundExpiresAt)throw new Error('Playground access expired.'); return {publicKey:this.playgroundSigner.publicKey,address:await this.playgroundSigner.getRecommendedAddress()};}
    const signer = this.signer;
    if (!signer) throw new Error('Wallet disconnected. Connect again to continue.');
    return this.validateSigner(signer, this.walletName);
  }

  async sign(transactionHex: string, expectedPublicKey: string, onPlaygroundSigning?:()=>void): Promise<string> {
    if(this.playgroundSigner) {
      await this.identity();
      const {signPreparedPlaygroundTransaction}=await import('./playground-signing');
      return signPreparedPlaygroundTransaction(this.playgroundSigner,transactionHex,expectedPublicKey,onPlaygroundSigning);
    }
    const connector = await this.connector();
    const before = await this.identity();
    if (before.publicKey.toLowerCase() !== expectedPublicKey.toLowerCase()) throw new Error('Connected wallet does not match the required Pocket role.');
    const signer = this.signer!;
    const prepared = connector.Transaction.fromBytes(transactionHex);
    let signed: { toHex(): string };
    try { signed = await signer.signOnlyTransaction(connector.Transaction.fromBytes(prepared.toBytes())); }
    catch (cause) { throw cause instanceof Error ? cause : new Error(String(cause)); }
    const after = await this.identity();
    if (signer !== this.signer || before.publicKey !== after.publicKey) throw new Error('Wallet account changed while signing. No transaction was submitted.');
    return signed.toHex();
  }

  onAccountOrNetworkChange(listener: () => void) {
    return this.subscribe(listener);
  }

  disconnect() {
    this.playgroundSigner=undefined;
    this.playgroundExpiresAt=0;
    this.explicitDisconnect = true;
    this.connectionEpoch += 1;
    this.signerReplacementCleanup?.();
    this.signerReplacementCleanup = undefined;
    this.signer = undefined;
    this.walletName = '';
    this.emit();
    void this.state?.disconnect();
  }

  async activatePlayground(privateKey:string,expiresAt:string) {
    if(import.meta.env.VITE_QUOTACELL_PLAYGROUND!=='1') throw new Error('Playground mode is unavailable.');
    const c=await import('@ckb-ccc/core');
    const signer=new c.SignerCkbPrivateKey(new c.ClientPublicTestnet({url:'https://testnet.ckb.dev/',fallbacks:[]}),privateKey);
    const genesis=await signer.client.getBlockByNumber(0);
    if(genesis?.header.hash?.toLowerCase()!==PUDGE_GENESIS)throw new Error('Playground requires Pudge.');
    const expiry=Date.parse(expiresAt);if(!Number.isFinite(expiry)||expiry<=Date.now())throw new Error('Playground access expired.');
    this.disconnect();this.playgroundSigner=signer;this.playgroundExpiresAt=expiry;
    return this.identity();
  }
}

export const wallet = new CkbWalletSession();

export function isVerifiedPudgeContext(state: PocketState, selectedPocket = '') {
  return state.networkMode?.startsWith('pudge') === true
    && state.genesis?.toLowerCase() === PUDGE_GENESIS
    && (!selectedPocket || state.pocket?.toLowerCase() === selectedPocket.toLowerCase());
}
