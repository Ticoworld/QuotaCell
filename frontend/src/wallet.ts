import type { WalletIdentity } from './domain';

const STANDARD_LOCK = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const CONNECTOR_SUCCESS_GRACE_MS = 2_000;
type Signer = {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getRecommendedAddressObj(): Promise<any>;
  signOnlyTransaction(transaction: unknown): Promise<{ toHex(): string }>;
  signType?: string;
  provider?: { getNetwork?: () => Promise<string> };
  onReplaced?: (listener: () => void) => () => void;
};

export class CkbWalletSession {
  private element: (HTMLElement & { client: unknown; name: string; hideKhie: boolean; disconnect?: () => void }) | undefined;
  private signer: Signer | undefined;
  private walletName = '';
  private epoch = 0;
  private loadConnector?: Promise<typeof import('@ckb-ccc/connector')>;

  async connect(): Promise<WalletIdentity> {
    const connector = await (this.loadConnector ??= import('@ckb-ccc/connector'));
    if (this.element && this.signer) return this.identity();
    if (this.element) {
      this.element.hidden = false;
      return new Promise((resolve, reject) => this.element!.addEventListener('connection', (event) => this.accept(event, resolve, reject), { once: true }));
    }
    const epoch = ++this.epoch;
    const client = new connector.ClientPublicTestnet({ url: `${location.origin}/api/ckb`, fallbacks: [] });
    const element = document.createElement('ccc-connector') as CkbWalletSession['element'] & HTMLElement;
    element.client = client;
    element.name = 'QuotaCell';
    element.hideKhie = true;
    this.element = element;
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
      document.body.append(element);
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
    const connector = await (this.loadConnector ??= import('@ckb-ccc/connector'));
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
    const connector = await (this.loadConnector ??= import('@ckb-ccc/connector'));
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
    this.epoch += 1;
    this.element?.disconnect?.();
    this.element?.remove();
    this.element = undefined;
    this.signer = undefined;
    this.walletName = '';
  }
}
