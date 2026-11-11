import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { formatCkb, parseCkb, shortHash } from './amount';
import type { DelegateState, HistoryItem, PocketState, PreparedTransaction, WalletIdentity } from './domain';

export type Operation = 'genesis' | 'pay' | 'deposit' | 'revoke' | 'close' | 'sweep';
export type Intent = { operation: Operation; role?: 'alice' | 'ben'; displayName?: string };

type Props = {
  intent: Intent | null;
  prepared: PreparedTransaction | null;
  state: PocketState | null;
  identity: WalletIdentity | null;
  delegates: DelegateState[];
  history: HistoryItem[];
  recipientAddresses: Record<string, string>;
  working: boolean;
  error: string;
  onPrepare: (body: Record<string, unknown>) => Promise<void>;
  onSign: (prepared: PreparedTransaction) => Promise<void>;
  onConnectSigner: (expectedPublicKey: string) => Promise<void>;
  onClose: () => void;
};

export function OperationDialog({ intent, prepared, state, identity, delegates, history, recipientAddresses, working, error, onPrepare, onSign, onConnectSigner, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [paymentAmount, setPaymentAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [validation, setValidation] = useState('');
  const [transactionDetails, setTransactionDetails] = useState<{ hash: string; inputs: string[]; outputs: string[] } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [walletPickerActive, setWalletPickerActive] = useState(false);
  const networkMode = state?.networkMode || '';
  const readOnly = networkMode === 'pudge-readonly';
  const selected = intent?.role ? delegates.find((delegate) => delegate.role === intent.role) : undefined;
  const selectedRecipient = selected ? recipientAddresses[selected.recipient] || selected.recipient : '';
  const isPrepared = Boolean(prepared);
  const signerMatches = Boolean(prepared && identity && prepared.publicKey.toLowerCase() === identity.publicKey.toLowerCase());
  const title = useMemo(() => {
    if (!intent) return '';
    const key = intent.operation === 'genesis' ? 'actionGenesis' : intent.operation === 'pay' ? 'actionPay' : intent.operation === 'deposit' ? 'actionDeposit' : intent.operation === 'revoke' ? 'actionRevoke' : intent.operation === 'close' ? 'actionClose' : 'actionSweep';
    return t(key);
  }, [intent, t]);

  useEffect(() => {
    setPaymentAmount(''); setDepositAmount(''); setValidation(''); setDetailsOpen(false); setTransactionDetails(null);
  }, [intent?.operation, intent?.role]);

  useEffect(() => {
    if (!prepared) { setTransactionDetails(null); return; }
    let canceled = false;
    void import('@ckb-ccc/core').then(({ Transaction }) => {
      if (canceled) return;
      const tx = Transaction.fromBytes(prepared.transaction);
      setTransactionDetails({
        hash: tx.hash(),
        inputs: tx.inputs.map((input: any, index: number) => `${index + 1}. ${input.previousOutput.txHash}:${input.previousOutput.index}`),
        outputs: tx.outputs.map((output: any, index: number) => `${index + 1}. ${formatCkb(BigInt(output.capacity))} CKB · ${output.lock.codeHash} · ${output.lock.hashType} · ${output.lock.args}`),
      });
    }).catch(() => { if (!canceled) setTransactionDetails(null); });
    return () => { canceled = true; };
  }, [prepared]);

  const submitPreparation = async () => {
    if (!intent || !identity) { setValidation(t('connect')); return; }
    setValidation('');
    if (readOnly) { setValidation(t('readonlyAction')); return; }
    let amount = '';
    try {
      if (intent.operation === 'pay') { parseCkb(paymentAmount, t('minAmount')); amount = paymentAmount; }
      if (intent.operation === 'deposit') { const value = parseCkb(depositAmount, t('minAmount')); if (value < 7_300_000_000n) throw new Error(t('depositMinimum')); amount = depositAmount; }
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : t('minAmount')); return; }
    const id = crypto.randomUUID();
    const body: Record<string, unknown> = { id, publicKey: identity.publicKey };
    if (intent.operation === 'pay' && selected) Object.assign(body, { role: selected.role, amount, recipient: selected.recipient });
    else if (intent.operation === 'genesis') return;
    else Object.assign(body, { operation: intent.operation, ...(intent.role ? { role: intent.role } : {}), ...(amount ? { amount } : {}) });
    await onPrepare(body);
  };
  const reconnectExpectedSigner = async () => {
    if (!prepared) return;
    setValidation('');
    setWalletPickerActive(true);
    try {
      // Let Radix release its modal focus and pointer boundary before CCC opens its wallet picker.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await onConnectSigner(prepared.publicKey);
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : t('signerMismatch')); }
    finally { setWalletPickerActive(false); }
  };

  const locale = i18n.language === 'zh-Hans' ? 'zh-CN' : 'en-US';
  const statusLabel = (stateValue: string) => {
    const normalized = stateValue.toLowerCase();
    if (normalized === 'committed' || normalized === 'confirmed') return t('statusCommitted');
    if (normalized === 'pending') return t('statusPending');
    if (normalized === 'proposed') return t('statusProposed');
    if (normalized === 'uncertain' || normalized === 'unknown') return t('statusUncertain');
    if (normalized === 'rejected') return t('statusRejected');
    return stateValue;
  };

  return <Dialog.Root open={Boolean(intent) && !walletPickerActive} onOpenChange={(open) => { if (!open && !working && !walletPickerActive) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px]" />
      <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 z-[51] max-h-[min(88dvh,850px)] w-[min(540px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-ink shadow-2xl sm:p-6" aria-modal="true" onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }} onPointerDownOutside={(event) => { if (working) event.preventDefault(); }}>
        <div className="dialog-top mb-3 flex items-center justify-between"><span className="dialog-symbol grid size-8 place-items-center rounded-lg bg-blue-wash text-blue" aria-hidden="true"><CellMark/></span><Dialog.Close asChild><button className="icon-button grid size-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={t('close')} disabled={working}>×</button></Dialog.Close></div>
        <Dialog.Title className="dialog-title text-xl font-semibold text-navy sm:text-[22px]">{isPrepared ? t('transactionReview') : title}</Dialog.Title>
        <Dialog.Description className="dialog-description mb-4 mt-1.5 block text-xs leading-5 text-slate-600">
          {isPrepared ? t('feeDisclosure') : intent?.operation === 'pay' ? t('delegateDescription') : intent?.operation === 'revoke' ? `${t('ownerActionConfirm')} ${intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}.` : intent?.operation === 'close' ? t('closeConsequences') : intent?.operation === 'sweep' ? t('lateFunds') : intent?.operation === 'genesis' ? t('stepReviewBody') : t('ownerDescription')}
        </Dialog.Description>

        {!isPrepared && intent && <div className="dialog-form grid gap-3">
          {intent.operation === 'pay' && selected && <>
            <label className="field-block grid gap-1.5 text-xs font-semibold text-slate-700">{t('paymentAmount')}<span className="input-unit flex min-w-0 items-center rounded-md border border-slate-300 bg-white focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/20"><input className="h-11 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 text-base text-ink outline-none" autoFocus inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0"/><i className="px-3 text-xs not-italic text-slate-500">CKB</i></span></label>
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('remaining')}</span><strong className="text-right font-semibold tabular-nums text-slate-800">{formatCkb(BigInt(selected.limit) > BigInt(selected.used) ? BigInt(selected.limit) - BigInt(selected.used) : 0n)} CKB</strong></div>
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('sharedRemaining')}</span><strong className="text-right font-semibold tabular-nums text-slate-800">{formatCkb(BigInt(state?.sharedLimit || 0) > BigInt(state?.sharedUsed || 0) ? BigInt(state?.sharedLimit || 0) - BigInt(state?.sharedUsed || 0) : 0n)} CKB</strong></div>
            <div className="review-row flex justify-between gap-3 py-2 text-xs text-slate-600"><span>{t('target')}</span><code className="max-w-[68%] break-all text-right text-slate-800" dir="ltr">{selectedRecipient}</code></div>
          </>}
          {intent.operation === 'deposit' && <label className="field-block grid gap-1.5 text-xs font-semibold text-slate-700">{t('depositAmount')}<span className="input-unit flex min-w-0 items-center rounded-md border border-slate-300 bg-white focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/20"><input className="h-11 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 text-base text-ink outline-none" autoFocus inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="0"/><i className="px-3 text-xs not-italic text-slate-500">CKB</i></span></label>}
          {intent.operation === 'revoke' && selected && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><strong className="text-sm font-semibold text-slate-800">{intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</strong><p className="my-2 text-xs leading-5 text-slate-600">{t('revokeConsequences')}</p><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('remaining')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(BigInt(selected.limit) > BigInt(selected.used) ? BigInt(selected.limit) - BigInt(selected.used) : 0n)} CKB</strong></div></div>}
          {intent.operation === 'close' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><strong className="text-sm font-semibold text-slate-800">{t('closePocket')}</strong><p className="my-2 text-xs leading-5 text-slate-600">{t('closeConsequences')}</p><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('protectedBalance')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(state?.fundShannons || '0')} CKB</strong></div><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('terminalCapacity')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(state?.policyCapacity || '0')} CKB</strong></div></div>}
          {intent.operation === 'sweep' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><strong className="text-sm font-semibold text-slate-800">{t('lateFunds')}</strong><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('protectedBalance')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(state?.fundShannons || '0')} CKB</strong></div></div>}
          {identity && <div className="wallet-review"><span>{t('signer')}</span><code dir="ltr">{shortHash(identity.address, 13, 8)}</code></div>}
          {validation && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{validation}</p>}
          {error && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{error}</p>}
          {readOnly && <p className="readonly-notice rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900" role="status">{t('readonlyAction')}</p>}
          <div className="dialog-actions mt-4 flex flex-wrap justify-end gap-2"><Dialog.Close asChild><button className="secondary-button" type="button" disabled={working}>{t('cancel')}</button></Dialog.Close><button className="primary-button" type="button" disabled={working || readOnly || !identity} onClick={() => void submitPreparation()}>{working ? t('preparing') : intent.operation === 'pay' ? t('reviewPayment') : t('continueToReview')} <span aria-hidden="true">→</span></button></div>
        </div>}

        {prepared && intent && <div className="transaction-review grid gap-3">
          <p className="transaction-operation">{title}</p>
          <div className="transaction-facts">
            {intent.operation === 'pay' && <div className="transaction-amount">{paymentAmount} <span>CKB</span></div>}
            {intent.operation === 'deposit' && <div className="transaction-amount">{depositAmount} <span>CKB</span></div>}
            {intent.operation === 'close' && <div className="transaction-amount">{formatCkb(state?.fundShannons || '0')} <span>CKB</span></div>}
            {intent.operation === 'sweep' && <div className="transaction-amount">{formatCkb(state?.fundShannons || '0')} <span>CKB</span></div>}
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('actualFee')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(prepared.fee)} CKB</strong></div>
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('network')}</span><strong className="text-right font-semibold text-slate-800">{networkMode.startsWith('pudge') ? t('networkPudge') : t('networkLocal')}</strong></div>
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('signer')}</span><code className="text-right text-slate-800" dir="ltr">{identity ? shortHash(identity.address, 13, 8) : '—'}</code></div>
            {intent.operation === 'pay' && selected && <div className="review-row"><span>{t('target')}</span><code dir="ltr">{selectedRecipient}</code></div>}
            {intent.operation === 'revoke' && <div className="inline-facts"><span>{t('revoke')}</span><strong>{intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</strong></div>}
          </div>
          {intent.operation === 'pay' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('paymentEffect')}</p></div>}
          {intent.operation === 'deposit' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('depositConsequences')}</p></div>}
          {intent.operation === 'revoke' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('revokeConsequences')}</p></div>}
          {intent.operation === 'close' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('closeConsequences')}</p></div>}
          {intent.operation === 'sweep' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('sweepConsequences')}</p></div>}
          <div className="critical-note rounded-md border-l-2 border-blue-300 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-slate-700">{t('localDisclosure')}</div>
          {!signerMatches && <div className="readonly-notice"><p>{t('signerMismatch')}</p><button type="button" className="text-button" onClick={() => void reconnectExpectedSigner()}>{t('reconnectSigner')}</button></div>}
          {validation && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{validation}</p>}
          <details className="technical-details border-t border-line pt-2" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary className="cursor-pointer py-1.5 text-xs font-medium text-slate-600">{t('technical')}</summary>
            <dl><div><dt>{t('txId')}</dt><dd><code dir="ltr">{transactionDetails?.hash || shortHash(prepared.transaction, 16, 12)}</code></dd></div><div><dt>{t('appIdentity')}</dt><dd><code dir="ltr">{prepared.genesis}</code></dd></div></dl>
            {transactionDetails && <><h3>{t('inputs')}</h3><ul>{transactionDetails.inputs.map((line) => <li key={line}><code dir="ltr">{line}</code></li>)}</ul><h3>{t('outputs')}</h3><ul>{transactionDetails.outputs.map((line) => <li key={line}><code dir="ltr">{line}</code></li>)}</ul></>}
          </details>
          {error && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{error}</p>}
          {history.some((item) => item.state === 'uncertain') && <p className="readonly-notice rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">{t('unresolvedBody')}</p>}
          <div className="dialog-actions mt-4 flex flex-wrap justify-end gap-2"><Dialog.Close asChild><button className="secondary-button" type="button" disabled={working}>{t('cancel')}</button></Dialog.Close><button className="primary-button" type="button" disabled={working || readOnly || !signerMatches} onClick={() => void onSign(prepared)}>{working ? t('walletApproval') : t('continueWallet')} <span aria-hidden="true">→</span></button></div>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function CellMark() {
  return <svg viewBox="0 0 28 28" role="presentation"><path d="M14 2.5 25.5 9v10L14 25.5 2.5 19V9L14 2.5Z"/><path d="m14 8 5.5 3.2v5.6L14 20l-5.5-3.2v-5.6L14 8Z"/><path d="M14 8v12m5.5-8.8L8.5 16.8m0-5.6 11 5.6"/></svg>;
}
