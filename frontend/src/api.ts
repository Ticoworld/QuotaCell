import type { PocketState, PreparedTransaction, TransactionResult } from './domain';

export class ApiError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly timedOut: boolean;

  constructor(message: string, retryable: boolean, status?: number, timedOut = false) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
    this.status = status;
    this.timedOut = timedOut;
  }
}

async function request<T>(url: string, body?: unknown, timeoutMs = 20_000, timeoutRetries = 0): Promise<T> {
  const selectedPocket = new URLSearchParams(window.location.search).get('pocket');
  const scopedBody = selectedPocket && !url.endsWith('/api/external/genesis') && body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body as Record<string, unknown>, pocket: selectedPocket }
    : body;
  let response: Response | undefined;
  for (let attempt = 0; !response; attempt++) {
    try {
      response = await fetch(url, body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) } : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scopedBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
      if (timedOut && attempt < timeoutRetries) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw new ApiError(timedOut ? 'Pocket preparation is taking longer than expected; retry will resume the same request.' : 'Pocket backend is unreachable.', true, undefined, timedOut);
    }
  }
  let text: string;
  try { text = await response.text(); }
  catch { throw new ApiError('Pocket backend response was interrupted.', true, response.status); }
  let data: unknown;
  try {
    data = text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('Pocket backend returned an invalid response.', response.status >= 500, response.status);
  }
  if (data === null) throw new ApiError('Pocket backend returned an empty response.', response.status >= 500, response.status);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    throw new ApiError(typeof message === 'string' ? message : `Request failed (${response.status}).`, response.status >= 500, response.status);
  }
  return data as T;
}

export const getPocketState = (publicKey?: string) => {
  const params = new URLSearchParams(window.location.search);
  if (publicKey && !params.has('pocket')) return getActorPockets(publicKey);
  if (publicKey) params.set('actor', publicKey);
  const url = `/api/state${params.has('pocket') || publicKey ? `?${new URLSearchParams({ ...(params.has('pocket') ? { pocket: params.get('pocket') || '' } : {}), ...(publicKey ? { actor: publicKey } : {}) })}` : ''}`;
  return request<PocketState>(url, undefined, params.has('pocket') ? (publicKey ? 60_000 : 8_000) : undefined);
};
export async function getActorPockets(publicKey: string) {
  const url = `/api/state?actor=${encodeURIComponent(publicKey)}`;
  let result = await request<PocketState>(url);
  for (let retry = 0; retry < 4 && result.empty; retry++) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    result = await request<PocketState>(url);
  }
  return result;
}
export const prepareGenesis = (body: unknown) => request<PreparedTransaction>('/api/external/genesis', body, 120_000);
export const preparePayment = (body: unknown) => request<PreparedTransaction>('/api/external/prepare', body, 20_000, 1);
export const prepareOwnerAction = (body: unknown) => request<PreparedTransaction>('/api/external/owner', body, 20_000, 1);
export const submitTransaction = (id: string, transaction: string) => request<TransactionResult>('/api/external/submit', { id, transaction }, 15_000);
export const retryJournaledTransaction = (approvedHash: string, publicKey: string) => request<TransactionResult>('/api/external/retry', { approvedHash, publicKey });
export const reconcile = () => request<{ outcomes: { txHash: string; state?: string; status?: string; reason?: string; operation?: string; pocket?: string }[] }>('/api/reconcile', {});

async function ckbRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await request<{ result: T }>('/api/ckb', { id: 1, jsonrpc: '2.0', method, params }, 5_000);
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

export type PudgeTransactionResolution = {
  status: string;
  reason?: string;
  operation?: string;
  pocket?: string;
  notSent?: boolean;
  blockHash?: string;
  blockNumber?: string;
};

export async function resolvePudgeTransaction(hash: string): Promise<PudgeTransactionResolution> {
  const journal = await reconcile();
  const outcome = journal.outcomes.find((item) => item.txHash.toLowerCase() === hash.toLowerCase());
  if (outcome) {
    const state = outcome.state || outcome.status || 'uncertain';
    if (['committed', 'pending', 'proposed', 'submitted', 'rejected'].includes(state)) {
      return { status: state, reason: outcome.reason, operation: outcome.operation, pocket: outcome.pocket };
    }
    const chain = await checkPudgeTransaction(hash);
    return chain.status === 'unknown' ? { ...chain, status: 'uncertain', reason: outcome.reason || chain.reason, operation: outcome.operation, pocket: outcome.pocket } : { ...chain, operation: outcome.operation, pocket: outcome.pocket };
  }

  const chain = await checkPudgeTransaction(hash);
  return chain.status === 'unknown' ? { ...chain, status: 'not-sent', notSent: true } : chain;
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
