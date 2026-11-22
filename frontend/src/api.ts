import type { BroadcastConsent } from './browserPudge';
import { browserMode, browserState, creationScope, actorCreationScope, prepareBrowserOwner, selectedBrowserPocket, requireBrowserPocket, prepareBrowserPayment, cancelBrowserIntent, submitBrowserPayment, reconcileBrowser } from './browserPudge';
import { httpRpc, publicDiscoveryNetwork } from './publicDiscovery';
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

export const getPocketState = (publicKey?: string, onPolicy?: (state: PocketState) => void) => {
  if (browserMode) return browserState(selectedBrowserPocket(), publicKey, onPolicy);
  const params = new URLSearchParams(window.location.search);
  if (publicKey && !params.has('pocket')) return getActorPockets(publicKey);
  if (publicKey) params.set('actor', publicKey);
  const url = `/api/state${params.has('pocket') || publicKey ? `?${new URLSearchParams({ ...(params.has('pocket') ? { pocket: params.get('pocket') || '' } : {}), ...(publicKey ? { actor: publicKey } : {}) })}` : ''}`;
  return request<PocketState>(url, undefined, params.has('pocket') ? (publicKey ? 60_000 : 8_000) : undefined);
};
export async function getActorPockets(publicKey: string) {
  if (browserMode) return browserState(undefined, publicKey);
  const url = `/api/state?actor=${encodeURIComponent(publicKey)}`;
  let result = await request<PocketState>(url);
  for (let retry = 0; retry < 4 && result.empty; retry++) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    result = await request<PocketState>(url);
  }
  return result;
}
export const prepareGenesis = (body: unknown) => browserMode ? prepareBrowserOwner(actorCreationScope((body as { publicKey: string }).publicKey), { ...body as Parameters<typeof prepareBrowserOwner>[1], operation: 'genesis' }) : request<PreparedTransaction>('/api/external/genesis', body, 120_000);
type PreparationStatus = { state: string; result?: PreparedTransaction; txHash?: string };

const preparationDeadlineMs = 35_000;
const preparationPollMs = 1_250;

function preparationStatusBody(body: unknown, endpoint: 'payment' | 'owner') {
  if (!body || typeof body !== 'object' || !('id' in body) || typeof (body as { id?: unknown }).id !== 'string') {
    throw new ApiError('The preparation request has no recovery ID.', false);
  }
  return { ...(body as Record<string, unknown>), id: body.id, endpoint };
}

async function readPreparationStatus(body: Record<string, unknown>): Promise<PreparationStatus> {
  return request<PreparationStatus>('/api/external/preparation-status', body, 5_000);
}

async function waitForPreparation(body: Record<string, unknown>, started: number): Promise<PreparedTransaction> {
  while (Date.now() - started < preparationDeadlineMs) {
    await new Promise((resolve) => window.setTimeout(resolve, preparationPollMs));
    const status = await readPreparationStatus(body);
    if (status.state === 'prepared' && status.result) return status.result;
    if (status.state === 'submitted' || status.state === 'uncertain' || status.state === 'committed') {
      throw new ApiError('An earlier outcome is uncertain. Check transaction status before preparing another payment.', false);
    }
    if (['not-found', 'expired', 'cancelled', 'failed'].includes(status.state)) {
      throw new ApiError('Preparation is taking longer than expected. Your request is saved; retry will check this same request. No wallet action has happened.', true, undefined, true);
    }
  }
  throw new ApiError('Preparation is taking longer than expected. Your request is saved; retry will check this same request. No wallet action has happened.', true, undefined, true);
}

async function prepareResumable(endpoint: 'payment' | 'owner', body: unknown) {
  const requestBody = preparationStatusBody(body, endpoint);
  const status = await readPreparationStatus(requestBody);
  if (status.state === 'prepared' && status.result) return status.result;
  if (['submitted', 'uncertain', 'committed'].includes(status.state)) {
    throw new ApiError('An earlier outcome is uncertain. Check transaction status before preparing another payment.', false);
  }
  if (status.state === 'preparing' || status.state === 'cancelling') return waitForPreparation(requestBody, Date.now());
  try {
    return await request<PreparedTransaction>(endpoint === 'payment' ? '/api/external/prepare' : '/api/external/owner', body, 20_000);
  } catch (cause) {
    if (!(cause instanceof ApiError) || !cause.retryable) throw cause;
    return waitForPreparation(requestBody, Date.now());
  }
}

export const preparePayment = (body: unknown) => browserMode ? prepareBrowserPayment(requireBrowserPocket(), body as Parameters<typeof prepareBrowserPayment>[1]) : prepareResumable('payment', body);
export const prepareOwnerAction = (body: unknown) => browserMode ? prepareBrowserOwner(requireBrowserPocket(), body as Parameters<typeof prepareBrowserOwner>[1]) : prepareResumable('owner', body);
export async function cancelPreparation(body: unknown, endpoint: 'payment' | 'owner') {
  const requestBody = preparationStatusBody(body, endpoint);
  if (browserMode) return cancelBrowserIntent(requireBrowserPocket(), String(requestBody.id));
  let status = await request<PreparationStatus>('/api/external/preparation-cancel', requestBody, 10_000);
  const started = Date.now();
  while (status.state === 'preparing' || status.state === 'cancelling') {
    if (Date.now() - started >= 15_000) throw new ApiError('Preparation cancellation is still being checked. Retry cancellation for this same request.', true, undefined, true);
    await new Promise((resolve) => window.setTimeout(resolve, preparationPollMs));
    status = await readPreparationStatus(requestBody);
  }
  if (['submitted', 'uncertain', 'committed'].includes(status.state)) throw new ApiError('An earlier outcome is uncertain. Check transaction status before preparing another payment.', false);
  return status;
}

export const getPreparationStatus = (body: unknown, endpoint: 'payment' | 'owner') => browserMode ? Promise.resolve({ state: 'not-found' } as PreparationStatus) : readPreparationStatus(preparationStatusBody(body, endpoint));
export const submitTransaction = (id: string, transaction: string, consent?: BroadcastConsent, scope?: string) => browserMode ? submitBrowserPayment(scope || requireBrowserPocket(), id, transaction, consent) : request<TransactionResult>('/api/external/submit', { id, transaction }, 15_000);
export const retryJournaledTransaction = (approvedHash: string, publicKey: string) => request<TransactionResult>('/api/external/retry', { approvedHash, publicKey });
export const reconcile = (actor?: string, hash?: string) => browserMode ? (async () => {
  const pocket = selectedBrowserPocket();
  const scopes = [...(pocket ? [pocket] : []), ...(actor ? [actorCreationScope(actor), creationScope] : [])];
  const results = await Promise.all(scopes.map(scope => reconcileBrowser(scope, actor, hash)));
  return { outcomes: results.flatMap(result => result.outcomes) };
})() : request<{ outcomes: { txHash: string; state?: string; status?: string; reason?: string; operation?: string; pocket?: string }[] }>('/api/reconcile', {});

async function ckbRpc<T>(method: string, params: unknown[]): Promise<T> {
  if (browserMode) return httpRpc<T>(method, params);
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

export async function resolvePudgeTransaction(hash: string, actor?: string): Promise<PudgeTransactionResolution> {
  const journal = await reconcile(actor, hash);
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
  return chain.status === 'unknown' ? { ...chain, status: browserMode ? 'uncertain' : 'not-sent', notSent: !browserMode } : chain;
}

export async function resolveRecipient(address: string): Promise<string> {
  if (/^0x[0-9a-f]{40}$/i.test(address)) return address.toLowerCase();
  const c = await import('@ckb-ccc/core');
  const client = new c.ClientPublicTestnet({ url: browserMode ? publicDiscoveryNetwork.rpc : `${window.location.origin}/api/ckb`, fallbacks: [] });
  const parsed = await c.Address.fromString(address, client);
  const script = parsed.script;
  if (parsed.prefix !== 'ckt' || script.codeHash !== '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8' || script.hashType !== 'type' || !/^0x[0-9a-f]{40}$/i.test(script.args)) {
    throw new Error('Use a standard CKB testnet address for the approved recipient.');
  }
  return script.args.toLowerCase();
}
