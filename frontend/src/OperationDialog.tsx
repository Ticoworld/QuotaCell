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
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content" aria-modal="true" onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }} onPointerDownOutside={(event) => { if (working) event.preventDefault(); }}>
        <div className="dialog-top"><span className="dialog-symbol" aria-hidden="true"><CellMark/></span><Dialog.Close asChild><button className="icon-button" aria-label={t('close')} disabled={working}>×</button></Dialog.Close></div>
        <Dialog.Title className="dialog-title">{isPrepared ? t('transactionReview') : title}</Dialog.Title>
        <Dialog.Description className="dialog-description">
          {isPrepared ? t('feeDisclosure') : intent?.operation === 'pay' ? t('delegateDescription') : intent?.operation === 'revoke' ? `${t('ownerActionConfirm')} ${intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}.` : intent?.operation === 'close' ? t('closeConsequences') : intent?.operation === 'sweep' ? t('lateFunds') : intent?.operation === 'genesis' ? t('stepReviewBody') : t('ownerDescription')}
        </Dialog.Description>

        {!isPrepared && intent && <div className="dialog-form">
          {intent.operation === 'pay' && selected && <>
            <label className="field-block">{t('paymentAmount')}<span className="input-unit"><input autoFocus inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0"/><i>CKB</i></span></label>
            <div className="inline-facts"><span>{t('remaining')}</span><strong>{formatCkb(BigInt(selected.limit) > BigInt(selected.used) ? BigInt(selected.limit) - BigInt(selected.used) : 0n)} CKB</strong></div>
            <div className="inline-facts"><span>{t('sharedRemaining')}</span><strong>{formatCkb(BigInt(state?.sharedLimit || 0) > BigInt(state?.sharedUsed || 0) ? BigInt(state?.sharedLimit || 0) - BigInt(state?.sharedUsed || 0) : 0n)} CKB</strong></div>
            <div className="review-row"><span>{t('target')}</span><code dir="ltr">{selectedRecipient}</code></div>
          </>}
          {intent.operation === 'deposit' && <label className="field-block">{t('depositAmount')}<span className="input-unit"><input autoFocus inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="0"/><i>CKB</i></span></label>}
          {intent.operation === 'revoke' && selected && <div className="consequence-box"><strong>{intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</strong><p>{t('revokeConsequences')}</p><div className="inline-facts"><span>{t('remaining')}</span><strong>{formatCkb(BigInt(selected.limit) > BigInt(selected.used) ? BigInt(selected.limit) - BigInt(selected.used) : 0n)} CKB</strong></div></div>}
          {intent.operation === 'close' && <div className="consequence-box"><strong>{t('closePocket')}</strong><p>{t('closeConsequences')}</p><div className="inline-facts"><span>{t('protectedBalance')}</span><strong>{formatCkb(state?.fundShannons || '0')} CKB</strong></div><div className="inline-facts"><span>{t('terminalCapacity')}</span><strong>{formatCkb(state?.policyCapacity || '0')} CKB</strong></div></div>}
          {intent.operation === 'sweep' && <div className="consequence-box"><strong>{t('lateFunds')}</strong><div className="inline-facts"><span>{t('protectedBalance')}</span><strong>{formatCkb(state?.fundShannons || '0')} CKB</strong></div></div>}
          {identity && <div className="wallet-review"><span>{t('signer')}</span><code dir="ltr">{shortHash(identity.address, 13, 8)}</code></div>}
          {validation && <p className="form-error" role="alert">{validation}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {readOnly && <p className="readonly-notice" role="status">{t('readonlyAction')}</p>}
          <div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button" type="button" disabled={working}>{t('cancel')}</button></Dialog.Close><button className="primary-button" type="button" disabled={working || readOnly || !identity} onClick={() => void submitPreparation()}>{working ? t('preparing') : intent.operation === 'pay' ? t('reviewPayment') : t('continueToReview')} <span aria-hidden="true">→</span></button></div>
        </div>}

        {prepared && intent && <div className="transaction-review">
          <p className="transaction-operation">{title}</p>
          <div className="transaction-facts">
            {intent.operation === 'pay' && <div className="transaction-amount">{paymentAmount} <span>CKB</span></div>}
            {intent.operation === 'deposit' && <div className="transaction-amount">{depositAmount} <span>CKB</span></div>}
            {intent.operation === 'close' && <div className="transaction-amount">{formatCkb(state?.fundShannons || '0')} <span>CKB</span></div>}
            {intent.operation === 'sweep' && <div className="transaction-amount">{formatCkb(state?.fundShannons || '0')} <span>CKB</span></div>}
            <div className="inline-facts"><span>{t('actualFee')}</span><strong>{formatCkb(prepared.fee)} CKB</strong></div>
            <div className="inline-facts"><span>{t('network')}</span><strong>{networkMode.startsWith('pudge') ? t('networkPudge') : t('networkLocal')}</strong></div>
            <div className="inline-facts"><span>{t('signer')}</span><code dir="ltr">{identity ? shortHash(identity.address, 13, 8) : '—'}</code></div>
            {intent.operation === 'pay' && selected && <div className="review-row"><span>{t('target')}</span><code dir="ltr">{selectedRecipient}</code></div>}
            {intent.operation === 'revoke' && <div className="inline-facts"><span>{t('revoke')}</span><strong>{intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</strong></div>}
          </div>
          {intent.operation === 'pay' && <div className="consequence-box"><p>{t('paymentEffect')}</p></div>}
          {intent.operation === 'deposit' && <div className="consequence-box"><p>{t('depositConsequences')}</p></div>}
          {intent.operation === 'revoke' && <div className="consequence-box"><p>{t('revokeConsequences')}</p></div>}
          {intent.operation === 'close' && <div className="consequence-box"><p>{t('closeConsequences')}</p></div>}
          {intent.operation === 'sweep' && <div className="consequence-box"><p>{t('sweepConsequences')}</p></div>}
          <div className="critical-note">{t('localDisclosure')}</div>
          {!signerMatches && <div className="readonly-notice"><p>{t('signerMismatch')}</p><button type="button" className="text-button" onClick={() => void reconnectExpectedSigner()}>{t('reconnectSigner')}</button></div>}
          {validation && <p className="form-error" role="alert">{validation}</p>}
          <details className="technical-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary>{t('technical')}</summary>
            <dl><div><dt>{t('txId')}</dt><dd><code dir="ltr">{transactionDetails?.hash || shortHash(prepared.transaction, 16, 12)}</code></dd></div><div><dt>{t('appIdentity')}</dt><dd><code dir="ltr">{prepared.genesis}</code></dd></div></dl>
            {transactionDetails && <><h3>{t('inputs')}</h3><ul>{transactionDetails.inputs.map((line) => <li key={line}><code dir="ltr">{line}</code></li>)}</ul><h3>{t('outputs')}</h3><ul>{transactionDetails.outputs.map((line) => <li key={line}><code dir="ltr">{line}</code></li>)}</ul></>}
          </details>
          {error && <p className="form-error" role="alert">{error}</p>}
          {history.some((item) => item.state === 'uncertain') && <p className="readonly-notice">{t('unresolvedBody')}</p>}
          <div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button" type="button" disabled={working}>{t('cancel')}</button></Dialog.Close><button className="primary-button" type="button" disabled={working || readOnly || !signerMatches} onClick={() => void onSign(prepared)}>{working ? t('walletApproval') : t('continueWallet')} <span aria-hidden="true">→</span></button></div>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function CellMark() {
  return <svg viewBox="0 0 28 28" role="presentation"><path d="M14 2.5 25.5 9v10L14 25.5 2.5 19V9L14 2.5Z"/><path d="m14 8 5.5 3.2v5.6L14 20l-5.5-3.2v-5.6L14 8Z"/><path d="M14 8v12m5.5-8.8L8.5 16.8m0-5.6 11 5.6"/></svg>;
}
