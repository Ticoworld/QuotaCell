import type { PocketState, WalletIdentity } from './domain';

const STANDARD_LOCK = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const PUDGE_GENESIS = '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
const CONNECTOR_SUCCESS_GRACE_MS = 2_000;
const CONNECTOR_RESTORE_TIMEOUT_MS = 3_000;
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
type ConnectorElement = HTMLElement & {
  client: unknown;
  name: string;
  hideKhie: boolean;
  wallet?: { name?: string };
  signer?: { signer?: Signer };
  disconnect?: () => void;
};

export class WalletProviderUnavailableError extends Error {
  constructor() {
    super('UTXO Global Wallet provider is not available to this page.');
    this.name = 'WalletProviderUnavailableError';
  }
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
  private element: ConnectorElement | undefined;
  private signer: Signer | undefined;
  private walletName = '';
  private epoch = 0;
  private connectorModule?: Promise<ConnectorModule>;
  private restoreInFlight?: Promise<WalletIdentity | null>;
  private cancelRestore?: () => void;
  private readonly loadConnector: () => Promise<ConnectorModule>;
  private readonly restoreTimeoutMs: number;

  constructor(
    loadConnector: () => Promise<ConnectorModule> = () => import('@ckb-ccc/connector'),
    restoreTimeoutMs = CONNECTOR_RESTORE_TIMEOUT_MS,
  ) {
    this.loadConnector = loadConnector;
    this.restoreTimeoutMs = restoreTimeoutMs;
  }

  private connector() {
    return this.connectorModule ??= this.loadConnector();
  }

  private ensureElement(connector: ConnectorModule) {
    if (this.element) return this.element;
    const client = new connector.ClientPublicTestnet({ url: 'https://testnet.ckb.dev/', fallbacks: [] });
    const element = document.createElement('ccc-connector') as ConnectorElement;
    element.client = client;
    element.name = 'QuotaCell';
    element.hideKhie = true;
    element.hidden = true;
    this.element = element;
    return element;
  }

  private adoptElementSigner() {
    const signer = this.element?.signer?.signer;
    if (!signer) return false;
    this.signer = signer;
    this.walletName = this.element?.wallet?.name || '';
    return true;
  }

  private async restoredIdentity(validatePudge?: (identity: WalletIdentity) => Promise<boolean>) {
    try {
      const identity = await this.identity();
      if (validatePudge && !await validatePudge(identity)) throw new Error('Pudge testnet could not be verified.');
      return identity;
    } catch {
      this.signer = undefined;
      this.walletName = '';
      return null;
    }
  }

  restore(validatePudge?: (identity: WalletIdentity) => Promise<boolean>): Promise<WalletIdentity | null> {
    if (this.restoreInFlight) return this.restoreInFlight;
    const task = this.restoreExistingSession(validatePudge);
    const tracked = task.finally(() => {
      if (this.restoreInFlight === tracked) this.restoreInFlight = undefined;
      this.cancelRestore = undefined;
    });
    this.restoreInFlight = tracked;
    return tracked;
  }

  private async restoreExistingSession(validatePudge?: (identity: WalletIdentity) => Promise<boolean>): Promise<WalletIdentity | null> {
    const injected = (window as Window & { utxoGlobal?: unknown }).utxoGlobal;
    if (!hasUtxoGlobalCkbProvider(injected)) return null;
    let connector: ConnectorModule;
    try { connector = await this.connector(); }
    catch { return null; }
    const element = this.ensureElement(connector);
    element.hidden = true;
    if (this.adoptElementSigner()) return this.restoredIdentity(validatePudge);

    const epoch = ++this.epoch;
    return new Promise((resolve) => {
      let settled = false;
      let validationStarted = false;
      let timer = 0;
      const finish = (identity: WalletIdentity | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        element.removeEventListener('connection', onConnection);
        if (this.cancelRestore === cancel) this.cancelRestore = undefined;
        resolve(identity);
      };
      const validate = (signer: Signer, walletName: string) => {
        if (settled || validationStarted) return;
        validationStarted = true;
        window.clearTimeout(timer);
        element.removeEventListener('connection', onConnection);
        this.signer = signer;
        this.walletName = walletName;
        void this.restoredIdentity(validatePudge).then(finish);
      };
      const onConnection = (event: Event) => {
        if (epoch !== this.epoch) return finish(null);
        const detail = event as Event & { connectionOwner?: { value?: { signerInfo?: { signer?: Signer }; wallet?: { name?: string } } } };
        const restoredSigner = detail.connectionOwner?.value?.signerInfo?.signer || element.signer?.signer;
        if (!restoredSigner) return;
        validate(restoredSigner, detail.connectionOwner?.value?.wallet?.name || element.wallet?.name || '');
      };
      const cancel = () => finish(null);
      this.cancelRestore = cancel;
      element.addEventListener('connection', onConnection);
      timer = window.setTimeout(() => {
        if (epoch === this.epoch && this.adoptElementSigner() && this.signer) validate(this.signer, this.walletName);
        else finish(null);
      }, this.restoreTimeoutMs);
      if (!element.isConnected) document.body.append(element);
    });
  }

  async connect(): Promise<WalletIdentity> {
    const injected = (window as Window & { utxoGlobal?: unknown }).utxoGlobal;
    if (!hasUtxoGlobalCkbProvider(injected)) throw new WalletProviderUnavailableError();
    const connector = await this.connector();
    this.cancelRestore?.();
    if (this.adoptElementSigner()) return this.identity();
    if (this.element && this.signer) return this.identity();
    const epoch = ++this.epoch;
    const element = this.ensureElement(connector);
    element.hidden = false;
    // Identity sharing uses CCC's public testnet client configuration and never
    // depends on QuotaCell's local application API.
    return new Promise((resolve, reject) => {
      element.addEventListener('connection', (event) => {
        if (epoch !== this.epoch) return reject(new Error('Wallet session changed. Connect again.'));
        this.accept(event, resolve, reject);
      }, { once: true });
      // CCC dispatches close after its animation, then performs an async signer check
      // before emitting connection. Give that success event time to arrive.
      element.addEventListener('close', () => {
        element.hidden = true;
        window.setTimeout(() => {
          if (epoch === this.epoch && !this.signer) reject(new Error('Wallet connection was canceled.'));
        }, CONNECTOR_SUCCESS_GRACE_MS);
      }, { once: true });
      if (!element.isConnected) document.body.append(element);
    });
  }

  private accept(event: Event, resolve: (identity: WalletIdentity) => void, reject: (error: Error) => void) {
    try {
      const detail = event as Event & { connectionOwner?: { value?: { signerInfo?: { signer?: Signer }; wallet?: { name?: string } } } };
      this.signer = detail.connectionOwner?.value?.signerInfo?.signer;
      this.walletName = detail.connectionOwner?.value?.wallet?.name || '';
      void this.identity().then(resolve, reject);
    } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
  }

  async identity(): Promise<WalletIdentity> {
    const connector = await this.connector();
    const signer = this.signer;
    if (!signer || !await signer.isConnected()) throw new Error('Wallet disconnected. Connect again to continue.');
    if (this.walletName !== 'UTXO Global Wallet') throw new Error('This prototype has verified UTXO Global Wallet signing only.');
    if (signer.signType !== connector.SignerSignType.CkbSecp256k1) throw new Error('QCN4 needs a CKB secp256k1 wallet account.');
    if (typeof signer.provider?.getNetwork !== 'function' || await signer.provider.getNetwork() !== 'nervos_testnet') throw new Error('Select CKB testnet in the wallet, then connect again.');
    const publicKey = await signer.getPublicKey();
    if (!/^0x0[23][0-9a-f]{64}$/i.test(publicKey)) throw new Error('The wallet did not provide a compressed CKB secp256k1 public key.');
    const address = await signer.getRecommendedAddressObj();
    const expectedArgs = connector.hashCkb(connector.bytesFrom(publicKey)).slice(0, 42);
    if (!address?.script || address.script.codeHash !== STANDARD_LOCK || address.script.hashType !== 'type' || address.script.args !== expectedArgs) throw new Error('The connected address does not match the supported CKB lock.');
    return { publicKey, address: await address.toString() };
  }

  async sign(transactionHex: string, expectedPublicKey: string): Promise<string> {
    const connector = await this.connector();
    const before = await this.identity();
    if (before.publicKey !== expectedPublicKey) throw new Error('Connected wallet does not match the required Pocket role.');
    const signer = this.signer!;
    const prepared = connector.Transaction.fromBytes(transactionHex);
    const signed = await signer.signOnlyTransaction(connector.Transaction.fromBytes(prepared.toBytes()));
    const after = await this.identity();
    if (signer !== this.signer || before.publicKey !== after.publicKey) throw new Error('Wallet account changed while signing. No transaction was submitted.');
    return signed.toHex();
  }

  onAccountOrNetworkChange(listener: () => void) {
    return this.signer?.onReplaced?.(listener) ?? (() => undefined);
  }

  disconnect() {
    this.cancelRestore?.();
    this.epoch += 1;
    this.element?.disconnect?.();
    this.element?.remove();
    this.element = undefined;
    this.signer = undefined;
    this.walletName = '';
  }
}

export function isVerifiedPudgeContext(state: PocketState, selectedPocket = '') {
  return state.networkMode?.startsWith('pudge') === true
    && state.genesis?.toLowerCase() === PUDGE_GENESIS
    && (!selectedPocket || state.pocket?.toLowerCase() === selectedPocket.toLowerCase());
}
