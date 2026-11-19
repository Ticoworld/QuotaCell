import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { formatCkb, parseCkb, shortHash } from './amount';
import { MINIMUM_PAYMENT_SHANNONS, minimumProtectedFundingShannons, REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS } from './funding';
import type { DelegateState, HistoryItem, PocketState, PreparedTransaction, WalletIdentity } from './domain';
import { clearPaymentIntent, paymentRequestFromIntent, savePaymentIntent, type SavedPaymentIntent } from './paymentIntent';

export type Operation = 'genesis' | 'pay' | 'deposit' | 'revoke' | 'admin' | 'close' | 'sweep';
export type Intent = { operation: Operation; role?: 'alice' | 'ben'; displayName?: string };

type Props = {
  intent: Intent | null;
  prepared: PreparedTransaction | null;
  pendingSigned: { transaction: string; hash: string } | null;
  state: PocketState | null;
  identity: WalletIdentity | null;
  delegates: DelegateState[];
  history: HistoryItem[];
  recipientAddresses: Record<string, string>;
  working: boolean;
  error: string;
  resumePayment: SavedPaymentIntent | null;
  onPrepare: (body: Record<string, unknown>) => Promise<void>;
  onCancelPreparation: (intent: SavedPaymentIntent) => Promise<void>;
  onSign: (prepared: PreparedTransaction) => Promise<void>;
  onSubmitSigned: (pending: { transaction: string; hash: string }) => Promise<void>;
  onDiscardSigned: () => void;
  canSubmitSigned: boolean;
  onConnectSigner: (expectedPublicKey: string) => Promise<void>;
  onClose: () => void;
};

export function OperationDialog({ intent, prepared, pendingSigned, state, identity, delegates, history, recipientAddresses, working, error, resumePayment, onPrepare, onCancelPreparation, onSign, onSubmitSigned, onDiscardSigned, canSubmitSigned, onConnectSigner, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [paymentAmount, setPaymentAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [validation, setValidation] = useState('');
  const [transactionDetails, setTransactionDetails] = useState<{ hash: string; inputs: string[]; outputs: string[] } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [walletPickerActive, setWalletPickerActive] = useState(false);
  const [savedPayment, setSavedPayment] = useState<SavedPaymentIntent | null>(null);
  const preparationRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const [paymentRequestBound, setPaymentRequestBound] = useState(false);
  const networkMode = state?.networkMode || '';
  const readOnly = networkMode === 'pudge-readonly';
  const prepareOnly = networkMode === 'pudge-prepare-only';
  const selected = intent?.role ? delegates.find((delegate) => delegate.role === intent.role) : undefined;
  const selectedRecipient = selected ? recipientAddresses[selected.recipient] || selected.recipient : '';
  const isPrepared = Boolean(prepared);
  const signerMatches = Boolean(prepared && identity && prepared.publicKey.toLowerCase() === identity.publicKey.toLowerCase());
  const title = useMemo(() => {
    if (!intent) return '';
    if (intent.operation === 'deposit' && state?.closed) return t('lateDepositTitle');
    const key = intent.operation === 'genesis' ? 'actionGenesis' : intent.operation === 'pay' ? 'actionPay' : intent.operation === 'deposit' ? 'actionDeposit' : intent.operation === 'admin' ? 'actionAdmin' : intent.operation === 'revoke' ? 'actionRevoke' : intent.operation === 'close' ? 'actionClose' : 'actionSweep';
    return t(key);
  }, [intent, state?.closed, t]);

  useEffect(() => {
    setPaymentAmount(''); setDepositAmount(''); setValidation(''); setDetailsOpen(false); setTransactionDetails(null);
    preparationRequest.current = null;
    setPaymentRequestBound(false);
    setSavedPayment(null);
  }, [intent?.operation, intent?.role]);

  useEffect(() => {
    if (!intent || intent.operation !== 'pay' || !resumePayment || resumePayment.role !== intent.role || !selected || !identity || resumePayment.publicKey.toLowerCase() !== identity.publicKey.toLowerCase()) return;
    const request = paymentRequestFromIntent(resumePayment);
    const { id: ignoredId, ...parameters } = request;
    void ignoredId;
    setSavedPayment(resumePayment);
    setPaymentAmount(resumePayment.amount);
    preparationRequest.current = { fingerprint: JSON.stringify(parameters), id: resumePayment.id };
    setPaymentRequestBound(true);
  }, [identity?.publicKey, intent?.operation, intent?.role, resumePayment?.id, selected?.recipient]);

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

  const [adminShared, setAdminShared] = useState('');
  const [adminAlice, setAdminAlice] = useState('');
  const [adminBen, setAdminBen] = useState('');
  const [reactivation, setReactivation] = useState(0);

  const submitPreparation = async () => {
    if (!intent || !identity) { setValidation(t('connect')); return; }
    setValidation('');
    if (readOnly || (prepareOnly && intent.operation !== 'genesis')) { setValidation(t(prepareOnly ? 'prepareOnlyNotice' : 'readonlyAction')); return; }
    let amount = '';
    try {
      if (intent.operation === 'pay') {
        const parsed = parseCkb(paymentAmount, t('minAmount'));
        if (parsed < MINIMUM_PAYMENT_SHANNONS) throw new Error(t('paymentMinimum'));
        if (paymentLimits && parsed > paymentLimits.effective) throw new Error(t('paymentBoundsError'));
        amount = paymentAmount;
      }
      if (intent.operation === 'deposit') { const value = parseCkb(depositAmount, t('minAmount')); if (value < REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS) throw new Error(t('depositMinimum')); amount = depositAmount; }
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : t('minAmount')); return; }
    const request: Record<string, unknown> = { publicKey: identity.publicKey };
    if (intent.operation === 'pay' && selected) Object.assign(request, { role: selected.role, amount, recipient: selected.recipient });
    else if (intent.operation === 'genesis') return;
    else Object.assign(request, { operation: intent.operation, ...(intent.role ? { role: intent.role } : {}), ...(amount ? { amount } : {}) });
    if (intent.operation === 'admin') Object.assign(request, { shared: adminShared, alice: adminAlice, ben: adminBen, mask: reactivation });
    const fingerprint = JSON.stringify(request);
    if (intent.operation === 'pay' && paymentRequestBound && preparationRequest.current?.fingerprint !== fingerprint) {
      setValidation(t('preparationParametersChanged'));
      return;
    }
    if (!preparationRequest.current || preparationRequest.current.fingerprint !== fingerprint) preparationRequest.current = { fingerprint, id: crypto.randomUUID() };
    const body = { ...request, id: preparationRequest.current.id };
    if (intent.operation === 'pay' && selected && state?.pocket) {
      const saved: SavedPaymentIntent = { version: 1, id: preparationRequest.current.id, pocket: state.pocket, publicKey: identity.publicKey, role: selected.role, amount, recipient: selected.recipient };
      try { savePaymentIntent(saved); setPaymentRequestBound(true); setSavedPayment(saved); }
      catch { setValidation(t('draftStorageUnavailable')); return; }
    }
    await onPrepare(body);
  };
  const discardPreparation = async () => {
    const saved = savedPayment || resumePayment;
    if (!saved || pendingSigned) return;
    setValidation('');
    try {
      await onCancelPreparation(saved);
      clearPaymentIntent();
      preparationRequest.current = null;
      setPaymentRequestBound(false);
      setSavedPayment(null);
      setPaymentAmount('');
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : t('actionFailed')); }
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
  const paymentLimits = useMemo(() => {
    if (!selected) return null;
    const personal = BigInt(selected.limit) > BigInt(selected.used) ? BigInt(selected.limit) - BigInt(selected.used) : 0n;
    const shared = BigInt(state?.sharedLimit || 0) > BigInt(state?.sharedUsed || 0) ? BigInt(state?.sharedLimit || 0) - BigInt(state?.sharedUsed || 0) : 0n;
    const funds = BigInt(state?.fundShannons || 0);
    const protectedLiquidity = funds > REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS ? funds - REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS : 0n;
    const authorized = [BigInt(selected.perPayment), personal, shared].reduce((limit, value) => value < limit ? value : limit);
    return { personal, shared, protectedLiquidity, effective: authorized < protectedLiquidity ? authorized : protectedLiquidity };
  }, [selected, state?.fundShannons, state?.sharedLimit, state?.sharedUsed]);
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
      <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 z-[51] max-h-[min(88dvh,850px)] w-[min(540px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-ink shadow-2xl sm:p-6" aria-modal="true" onEscapeKeyDown={(event) => { if (working || pendingSigned) event.preventDefault(); }} onPointerDownOutside={(event) => { if (working || pendingSigned) event.preventDefault(); }}>
        <div className="dialog-top mb-3 flex items-center justify-between"><span className={`dialog-symbol grid size-8 place-items-center rounded-lg ${pendingSigned ? 'warning-symbol' : 'bg-blue-wash text-blue'}`} aria-hidden="true">{pendingSigned ? '!' : <CellMark/>}</span><Dialog.Close asChild><button className="icon-button grid size-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={t('close')} disabled={working || Boolean(pendingSigned)}>×</button></Dialog.Close></div>
        <Dialog.Title className="dialog-title text-xl font-semibold text-navy sm:text-[22px]">{pendingSigned ? t('pudgeBroadcastTitle') : isPrepared ? t('transactionReview') : title}</Dialog.Title>
        <Dialog.Description className="dialog-description mb-4 mt-1.5 block text-xs leading-5 text-slate-600">
          {pendingSigned ? t('pudgeBroadcastBody') : isPrepared ? t(state?.networkMode === 'pudge-browser' ? 'browserFeeDisclosure' : 'feeDisclosure') : intent?.operation === 'pay' ? t('delegateDescription') : intent?.operation === 'revoke' ? `${t('ownerActionConfirm')} ${intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}.` : intent?.operation === 'close' ? t('closeConsequences') : intent?.operation === 'sweep' ? t('lateFunds') : intent?.operation === 'genesis' ? t('stepReviewBody') : intent?.operation === 'deposit' && state?.closed ? t('lateDepositBody') : t('ownerDescription')}
        </Dialog.Description>

        {!isPrepared && intent && <div className="dialog-form grid gap-3">
          {intent.operation === 'pay' && selected && paymentLimits && <>
            <label className="field-block grid gap-1.5 text-xs font-semibold text-slate-700">{t('paymentAmount')}<span className="input-unit flex min-w-0 items-center rounded-md border border-slate-300 bg-white focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/20"><input className="h-11 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 text-base text-ink outline-none" autoFocus inputMode="decimal" value={paymentAmount} disabled={working || paymentRequestBound} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0"/><i className="px-3 text-xs not-italic text-slate-500">CKB</i></span></label>
            <section className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="inline-facts flex justify-between gap-3"><span>{t('effectivePaymentLimit')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.effective)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('personalRemaining')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.personal)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('sharedRemaining')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.shared)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('maxPayment')}</span><strong className="text-right tabular-nums">{formatCkb(selected.perPayment)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3 border-t border-slate-200 pt-2"><span>{t('protectedLiquidityAfterReserve')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.protectedLiquidity)} CKB</strong></div>
              <p className="m-0 leading-5 text-slate-600">{t('paymentLimitHint', { minimum: formatCkb(MINIMUM_PAYMENT_SHANNONS) })}</p>
            </section>
            <div className="review-row flex justify-between gap-3 py-2 text-xs text-slate-600"><span>{t('recipient')}</span><code className="max-w-[68%] break-all text-right text-slate-800" dir="ltr">{selectedRecipient}</code></div>
          </>}
          {intent.operation === 'deposit' && <>
            <label className="field-block grid gap-1.5 text-xs font-semibold text-slate-700">{t('depositAmount')}<span className="input-unit flex min-w-0 items-center rounded-md border border-slate-300 bg-white focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/20"><input className="h-11 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 text-base text-ink outline-none" autoFocus inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="0"/><i className="px-3 text-xs not-italic text-slate-500">CKB</i></span></label>
            {!state?.closed && <section className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="inline-facts flex justify-between gap-3"><span>{t('policyCapacity')}</span><strong className="text-right tabular-nums">{formatCkb(state?.policyCapacity || '60000000000')} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('sharedLifetimeAllowance')}</span><strong className="text-right tabular-nums">{formatCkb(state?.sharedLimit || '60000000000')} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('protectedChangeReserve')}</span><strong className="text-right tabular-nums">{formatCkb(REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3 border-t border-slate-200 pt-2"><span>{t('minimumForFullAllowance')}</span><strong className="text-right tabular-nums">{formatCkb(minimumProtectedFundingShannons(state?.sharedLimit || '60000000000'))} CKB</strong></div>
              <p className="m-0 leading-5 text-slate-600">{t('protectedFundingCanExceedAllowance')}</p>
            </section>}
          </>}
          {intent.operation === 'deposit' && state?.closed && <div className="consequence-box rounded-lg border border-amber-200 bg-amber-50 p-3.5"><p className="m-0 text-xs leading-5 text-amber-950">{t('lateDepositConsequences')}</p></div>}
          {intent.operation === 'admin' && <fieldset className="grid gap-2">
            <label className="field-block">{t('increaseShared')}<input inputMode="decimal" value={adminShared} onChange={event => setAdminShared(event.target.value)}/></label>
            <label className="field-block">{t('increasePersonal')} · {t('delegateOne')}<input inputMode="decimal" value={adminAlice} onChange={event => setAdminAlice(event.target.value)}/></label>
            <label className="field-block">{t('increasePersonal')} · {t('delegateTwo')}<input inputMode="decimal" value={adminBen} onChange={event => setAdminBen(event.target.value)}/></label>
            {delegates.map((delegate, index) => !delegate.enabled && <label key={delegate.role}><input type="checkbox" checked={Boolean(reactivation & (1 << index))} onChange={event => setReactivation(value => event.target.checked ? value | (1 << index) : value & ~(1 << index))}/> {t('reactivate')} {t(index === 0 ? 'delegateOne' : 'delegateTwo')}</label>)}
          </fieldset>}
          {intent.operation === 'revoke' && selected && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><strong className="text-sm font-semibold text-slate-800">{intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</strong><p className="my-2 text-xs leading-5 text-slate-600">{t('revokeConsequences')}</p><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('remaining')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(BigInt(selected.limit) > BigInt(selected.used) ? BigInt(selected.limit) - BigInt(selected.used) : 0n)} CKB</strong></div></div>}
          {intent.operation === 'close' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><strong className="text-sm font-semibold text-slate-800">{t('closePocket')}</strong><p className="my-2 text-xs leading-5 text-slate-600">{t('closeConsequences')}</p><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('protectedBalance')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(state?.fundShannons || '0')} CKB</strong></div><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('terminalCapacity')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(state?.policyCapacity || '0')} CKB</strong></div></div>}
          {intent.operation === 'sweep' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><strong className="text-sm font-semibold text-slate-800">{t('lateFunds')}</strong><div className="inline-facts flex justify-between gap-3 border-t border-slate-200 py-2 text-xs text-slate-600"><span>{t('protectedBalance')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(state?.fundShannons || '0')} CKB</strong></div></div>}
          {identity && <div className="wallet-review"><span>{t('signer')}</span><code dir="ltr">{shortHash(identity.address, 13, 8)}</code></div>}
          {validation && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{validation}</p>}
          {error && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{error}</p>}
          {readOnly && <p className="readonly-notice rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900" role="status">{t('readonlyAction')}</p>}
          {prepareOnly && intent.operation !== 'genesis' && <p className="readonly-notice rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900" role="status">{t('prepareOnlyNotice')}</p>}
          <div className="dialog-actions mt-4 flex flex-wrap justify-end gap-2">{intent.operation === 'pay' && paymentRequestBound && (savedPayment || resumePayment) && <button className="text-button" type="button" disabled={working} onClick={() => void discardPreparation()}>{t('cancelPreparation')}</button>}<Dialog.Close asChild><button className="secondary-button" type="button" disabled={working}>{t('cancel')}</button></Dialog.Close><button className="primary-button" type="button" disabled={working || readOnly || (prepareOnly && intent.operation !== 'genesis') || !identity} onClick={() => void submitPreparation()}>{working ? t('preparing') : intent.operation === 'pay' && paymentRequestBound ? t('resumePreparation') : intent.operation === 'pay' ? t('reviewPayment') : t('continueToReview')} <span aria-hidden="true">→</span></button></div>
        </div>}

        {prepared && intent && <div className="transaction-review grid gap-3">
          <p className="transaction-operation">{title}</p>
          <div className="transaction-facts">
          {intent.operation === 'pay' && <div className="transaction-amount">{paymentAmount} <span>CKB</span></div>}
            {intent.operation === 'deposit' && <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('selectedDeposit')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(prepared.operationAmount ?? parseCkb(depositAmount))} CKB</strong></div>}
            {intent.operation === 'close' && <div className="transaction-amount">{formatCkb(state?.fundShannons || '0')} <span>CKB</span></div>}
            {intent.operation === 'sweep' && <div className="transaction-amount">{formatCkb(state?.fundShannons || '0')} <span>CKB</span></div>}
            {intent.operation === 'pay' && paymentLimits && <section className="grid gap-1 border-y border-slate-100 py-2 text-xs">
              <div className="inline-facts flex justify-between gap-3"><span>{t('effectivePaymentLimit')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.effective)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('personalRemaining')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.personal)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('sharedRemaining')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.shared)} CKB</strong></div>
              <div className="inline-facts flex justify-between gap-3"><span>{t('protectedLiquidityAfterReserve')}</span><strong className="text-right tabular-nums">{formatCkb(paymentLimits.protectedLiquidity)} CKB</strong></div>
            </section>}
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('actualFee')}</span><strong className="font-semibold tabular-nums text-slate-800">{formatCkb(prepared.fee)} CKB</strong></div>
            {intent.operation === 'genesis' && <section className="grid gap-2 border-t border-line pt-3 text-xs">
              <h3 className="m-0 text-sm font-semibold text-navy">{t('capitalReview')}</h3>
              <div className="inline-facts flex justify-between gap-3"><span>{t('activePolicyCapacity')}</span><strong className="text-right tabular-nums">{formatCkb(prepared.policyCapacity || '60000000000')} CKB</strong></div>
              {prepared.ownerInputCapacity && <div className="inline-facts flex justify-between gap-3"><span>{t('ownerInput')}</span><strong className="text-right tabular-nums">{formatCkb(prepared.ownerInputCapacity)} CKB</strong></div>}
              {prepared.ownerChangeCapacity && <div className="inline-facts flex justify-between gap-3"><span>{t('ownerChange')}</span><strong className="text-right tabular-nums">{formatCkb(prepared.ownerChangeCapacity)} CKB</strong></div>}
              {prepared.minimumOwnerInputCapacity && <div className="inline-facts flex justify-between gap-3"><span>{t('minimumOwnerInput')}</span><strong className="text-right tabular-nums">{formatCkb(prepared.minimumOwnerInputCapacity)} CKB</strong></div>}
              <div className="inline-facts flex justify-between gap-3 border-t border-slate-100 pt-2"><span>{t('terminalCapacity')}</span><strong className="text-right tabular-nums">{formatCkb(prepared.terminalCapacity || '13400000000')} CKB</strong></div>
              <p className="m-0 text-slate-600">{t('terminalCapacityHint')}</p>
            </section>}
            <div className="inline-facts flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('network')}</span><strong className="text-right font-semibold text-slate-800">{networkMode.startsWith('pudge') ? t('networkPudge') : t('networkLocal')}</strong></div>
            <div className="inline-facts flex flex-col gap-1 border-b border-slate-100 py-2 text-xs text-slate-600"><span>{t('signer')}</span><code className="break-all text-slate-800" dir="ltr">{identity?.address || '—'}</code></div>
            {prepared.operationAmount && intent.operation !== 'genesis' && <div>{t('amount')} · {formatCkb(prepared.operationAmount)} CKB</div>}
            {prepared.releasedCapacity && BigInt(prepared.releasedCapacity) > 0n && <div>{t('recoveredAmount')} · {formatCkb(prepared.releasedCapacity)} CKB · {t('terminalCapacity')} · {formatCkb(prepared.terminalCapacity || '0')} CKB</div>}
            {prepared.ownerChangeCapacity && intent.operation !== 'genesis' && <div>{t('ownerChange')} · {formatCkb(prepared.ownerChangeCapacity)} CKB</div>}
            {prepared.adminTerms && <div>{t('increaseShared')} · {formatCkb(prepared.adminTerms.shared)} CKB<br/>{t('delegateOne')} +{formatCkb(prepared.adminTerms.alice)} CKB {Boolean(prepared.adminTerms.mask & 1) && t('reactivate')}<br/>{t('delegateTwo')} +{formatCkb(prepared.adminTerms.ben)} CKB {Boolean(prepared.adminTerms.mask & 2) && t('reactivate')}</div>}
            {pendingSigned && <div className="grid gap-1 border-b border-slate-100 py-2 text-xs"><span className="text-slate-600">{t('txId')}</span><code className="break-all text-slate-800" dir="ltr">{pendingSigned.hash}</code></div>}
            {intent.operation === 'pay' && selected && <div className="review-row"><span>{t('recipient')}</span><code dir="ltr">{selectedRecipient}</code></div>}
            {intent.operation === 'revoke' && <div className="inline-facts"><span>{t('revoke')}</span><strong>{intent.displayName || t(intent.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</strong></div>}
          </div>
          {intent.operation === 'pay' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('paymentEffect')}</p></div>}
          {intent.operation === 'deposit' && <div className={`consequence-box rounded-lg border p-3.5 ${state?.closed ? 'border-amber-200 bg-amber-50' : 'border-line bg-slate-50'}`}><p className={`m-0 text-xs leading-5 ${state?.closed ? 'text-amber-950' : 'text-slate-700'}`}>{t(state?.closed ? 'lateDepositConsequences' : 'depositConsequences')}</p></div>}
          {intent.operation === 'revoke' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('revokeConsequences')}</p></div>}
          {intent.operation === 'close' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('closeConsequences')}</p></div>}
          {intent.operation === 'sweep' && <div className="consequence-box rounded-lg border border-line bg-slate-50 p-3.5"><p className="m-0 text-xs leading-5 text-slate-700">{t('sweepConsequences')}</p></div>}
          <div className="critical-note rounded-md border-l-2 border-blue-300 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-slate-700">{t(state?.networkMode === 'pudge-browser' ? 'browserDisclosure' : 'localDisclosure')}</div>
          {prepareOnly && intent.operation === 'genesis' && <p className="readonly-notice rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900" role="status">{t('prepareOnlyNotice')}</p>}
          {!signerMatches && <div className="readonly-notice"><p>{t('signerMismatch')}</p><button type="button" className="text-button" onClick={() => void reconnectExpectedSigner()}>{t('reconnectSigner')}</button></div>}
          {validation && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{validation}</p>}
          <details className="technical-details border-t border-line pt-2" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary className="cursor-pointer py-1.5 text-xs font-medium text-slate-600">{t('technical')}</summary>
            <dl><div><dt>{t('txId')}</dt><dd><code dir="ltr">{transactionDetails?.hash || shortHash(prepared.transaction, 16, 12)}</code></dd></div><div><dt>{t('appIdentity')}</dt><dd><code dir="ltr">{prepared.genesis}</code></dd></div></dl>
            {transactionDetails && <><h3>{t('inputs')}</h3><ul>{transactionDetails.inputs.map((line) => <li key={line}><code dir="ltr">{line}</code></li>)}</ul><h3>{t('outputs')}</h3><ul>{transactionDetails.outputs.map((line) => <li key={line}><code dir="ltr">{line}</code></li>)}</ul></>}
          </details>
          {error && <p className="form-error rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">{error}</p>}
          {history.some((item) => item.state === 'uncertain') && <p className="readonly-notice rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">{t('unresolvedBody')}</p>}
          <div className="dialog-actions mt-4 flex flex-wrap justify-end gap-2">{pendingSigned ? <><button className="secondary-button" type="button" disabled={working} onClick={onDiscardSigned}>{t('discardSignature')}</button><button className="primary-button" type="button" disabled={working || !canSubmitSigned} onClick={() => void onSubmitSigned(pendingSigned)}>{working ? t('submitting') : intent.operation === 'pay' ? t('sendToPudge') : title}</button></> : <>{intent.operation === 'pay' && paymentRequestBound && (savedPayment || resumePayment) && <button className="text-button" type="button" disabled={working} onClick={() => void discardPreparation()}>{t('discardUnsignedPreparation')}</button>}<Dialog.Close asChild><button className="secondary-button" type="button" disabled={working}>{t('cancel')}</button></Dialog.Close><button className="primary-button" type="button" disabled={working || readOnly || prepareOnly || !signerMatches} onClick={() => void onSign(prepared)}>{working ? t('walletApproval') : prepareOnly ? t('signingDisabled') : networkMode === 'pudge-browser' ? intent.operation === 'pay' ? t('signAndSendPayment') : title : t('continueWallet')} <span aria-hidden="true">→</span></button></>}</div>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function CellMark() {
  return <svg viewBox="0 0 28 28" role="presentation"><path d="M14 2.5 25.5 9v10L14 25.5 2.5 19V9L14 2.5Z"/><path d="m14 8 5.5 3.2v5.6L14 20l-5.5-3.2v-5.6L14 8Z"/><path d="M14 8v12m5.5-8.8L8.5 16.8m0-5.6 11 5.6"/></svg>;
}
