export const PAYMENT_INTENT_KEY = 'quotacell.payment-preparation-intent.v1';

export type SavedPaymentIntent = {
  version: 1;
  id: string;
  pocket: string;
  publicKey: string;
  role: 'alice' | 'ben';
  amount: string;
  recipient: string;
};

export function readSavedPaymentIntent(): SavedPaymentIntent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PAYMENT_INTENT_KEY) || 'null') as Partial<SavedPaymentIntent> | null;
    if (!value || value.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id || '') || !/^0x[0-9a-f]{64}$/i.test(value.pocket || '')
      || !/^0x0[23][0-9a-f]{64}$/i.test(value.publicKey || '') || !/^0x[0-9a-f]{40}$/i.test(value.recipient || '')
      || !/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value.amount || '') || !['alice', 'ben'].includes(value.role || '')) return null;
    return value as SavedPaymentIntent;
  } catch { return null; }
}

export function savePaymentIntent(intent: SavedPaymentIntent) {
  sessionStorage.setItem(PAYMENT_INTENT_KEY, JSON.stringify(intent));
}

export function clearPaymentIntent() {
  sessionStorage.removeItem(PAYMENT_INTENT_KEY);
}

export function paymentRequestFromIntent(intent: SavedPaymentIntent) {
  return { publicKey: intent.publicKey, role: intent.role, amount: intent.amount, recipient: intent.recipient, id: intent.id };
}
