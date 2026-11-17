import type { PocketState, PreparedTransaction, TransactionResult } from './domain';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const selectedPocket = new URLSearchParams(window.location.search).get('pocket');
  const scopedBody = selectedPocket && !url.endsWith('/api/external/genesis') && body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body as Record<string, unknown>, pocket: selectedPocket }
    : body;
  let response: Response;
  try {
    response = await fetch(url, body === undefined ? { cache: 'no-store' } : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scopedBody),
    });
  } catch {
    throw new Error('Pocket backend is unreachable.');
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new Error('Pocket backend returned an invalid response.');
  }
  if (data === null) throw new Error('Pocket backend returned an empty response.');
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    throw new Error(typeof message === 'string' ? message : `Request failed (${response.status}).`);
  }
  return data as T;
}

export const getPocketState = (publicKey?: string) => {
  const params = new URLSearchParams(window.location.search);
  if (publicKey) params.set('actor', publicKey);
  return request<PocketState>(`/api/state${params.has('pocket') || publicKey ? `?${new URLSearchParams({ ...(params.has('pocket') ? { pocket: params.get('pocket') || '' } : {}), ...(publicKey ? { actor: publicKey } : {}) })}` : ''}`);
};
export const getActorPockets = (publicKey: string) => request<PocketState>(`/api/state?actor=${encodeURIComponent(publicKey)}`);
export const prepareGenesis = (body: unknown) => request<PreparedTransaction>('/api/external/genesis', body);
export const preparePayment = (body: unknown) => request<PreparedTransaction>('/api/external/prepare', body);
export const prepareOwnerAction = (body: unknown) => request<PreparedTransaction>('/api/external/owner', body);
export const submitTransaction = (id: string, transaction: string) => request<TransactionResult>('/api/external/submit', { id, transaction });
export const retryJournaledTransaction = (approvedHash: string, publicKey: string) => request<TransactionResult>('/api/external/retry', { approvedHash, publicKey });
export const reconcile = () => request<{ outcomes: { txHash: string; state?: string; status?: string }[] }>('/api/reconcile', {});

async function ckbRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await request<{ result: T }>('/api/ckb', { id: 1, jsonrpc: '2.0', method, params });
  return response.result;
}

export async function checkPudgeTransaction(hash: string) {
  const transaction = await ckbRpc<{ tx_status?: { status?: string; block_hash?: string; reason?: string } } | null>('get_transaction', [hash]);
  const txStatus = transaction?.tx_status;
  const status = txStatus?.status || 'unknown';
  if (status !== 'committed') return { status, reason: txStatus?.reason };
  if (!txStatus?.block_hash) return { status: 'uncertain', reason: 'The committed transaction has no block hash.' };

  const header = await ckbRpc<{ hash: string; number: string } | null>('get_header', [txStatus.block_hash]);
  if (!header) return { status: 'uncertain', reason: 'The transaction block header is unavailable.' };
  const canonicalHash = await ckbRpc<string | null>('get_block_hash', [header.number]);
  return canonicalHash === header.hash
    ? { status, blockHash: header.hash, blockNumber: header.number }
    : { status: 'uncertain', reason: 'The transaction block is not canonical.' };
}

export async function resolveRecipient(address: string): Promise<string> {
  if (/^0x[0-9a-f]{40}$/i.test(address)) return address.toLowerCase();
  const c = await import('@ckb-ccc/core');
  const client = new c.ClientPublicTestnet({ url: `${window.location.origin}/api/ckb`, fallbacks: [] });
  const parsed = await c.Address.fromString(address, client);
  const script = parsed.script;
  if (parsed.prefix !== 'ckt' || script.codeHash !== '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8' || script.hashType !== 'type' || !/^0x[0-9a-f]{40}$/i.test(script.args)) {
    throw new Error('Use a standard CKB testnet address for the approved recipient.');
  }
  return script.args.toLowerCase();
}
