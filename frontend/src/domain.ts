export type Role = 'owner' | 'alice' | 'ben';
export type Locale = 'en' | 'zh-Hans';

export type DelegateState = {
  role: 'alice' | 'ben';
  limit: string;
  used: string;
  perPayment: string;
  enabled: boolean;
  recipient: string;
  publicKey: string;
};

export type HistoryItem = {
  id: string;
  tx_hash: string;
  state: 'uncertain' | 'committed' | 'pending' | 'proposed' | string;
  amount: string;
  recipient: string;
  created: string;
  actor: string;
  operation: 'genesis' | 'pay' | 'revoke' | 'close' | 'deposit' | 'sweep' | string;
};

export type UnsupportedFund = {
  capacity: string;
  hasType: boolean;
  dataBytes: number;
  outPoint: { txHash?: string; tx_hash?: string; index: number | string };
};

export type PocketState = {
  empty?: boolean;
  closed?: boolean;
  unresolved?: boolean;
  recoveryRequired?: boolean;
  creationRecovery?: { txHash: string; state: string; reason?: string; recoveryAvailable: boolean };
  networkMode: string;
  genesis: string;
  pocket?: string;
  owner?: string;
  fundShannons?: string;
  fundOccupiedShannons?: string;
  sharedLimit?: string;
  sharedUsed?: string;
  delegates?: DelegateState[];
  unsupportedFunds?: UnsupportedFund[];
  policyCapacity?: string;
  hasFund?: boolean;
  history?: HistoryItem[];
  indexedTip?: { block_number: string; block_hash: string } | null;
};

export type WalletIdentity = {
  publicKey: string;
  address: string;
};

export type PocketMetadata = Record<string, { name: string; description?: string }>;

export type PreparedTransaction = {
  id: string;
  transaction: string;
  publicKey: string;
  genesis: string;
  fee: string;
};

export type TransactionResult = {
  txHash: string;
  state: string;
  error?: string;
};
