import type { PocketState, PreparedTransaction, TransactionResult } from './domain';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data as T;
}

export const getPocketState = () => request<PocketState>('/api/state');
export const prepareGenesis = (body: unknown) => request<PreparedTransaction>('/api/external/genesis', body);
export const preparePayment = (body: unknown) => request<PreparedTransaction>('/api/external/prepare', body);
export const prepareOwnerAction = (body: unknown) => request<PreparedTransaction>('/api/external/owner', body);
export const submitTransaction = (id: string, transaction: string) => request<TransactionResult>('/api/external/submit', { id, transaction });
export const reconcile = () => request<{ outcomes: { txHash: string; state?: string; status?: string }[] }>('/api/reconcile', {});

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
