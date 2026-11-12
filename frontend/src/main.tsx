import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import './i18n';
import './style.css';
import { formatCkb, progressPercent, shortHash } from './amount';
import { getPocketState, prepareGenesis, prepareOwnerAction, preparePayment, reconcile, submitTransaction } from './api';
import { CreationFlow, type People } from './CreationFlow';
import { importMetadata, loadMetadata, saveMetadata, exportMetadata } from './metadata';
import type { HistoryItem, PocketMetadata, PocketState, PreparedTransaction, TransactionResult, WalletIdentity } from './domain';
import { CkbWalletSession } from './wallet';
import { OperationDialog, type Intent, type Operation } from './OperationDialog';

const wallet = new CkbWalletSession();
type ActorRole = 'owner' | 'alice' | 'ben' | 'unrecognized';
type SignedPending = { transaction: string; hash: string };
type Participant = { publicKey: string; fallback: string; role: 'owner' | 'alice' | 'ben' };

function actorRole(identity: WalletIdentity | null, state: PocketState | null): ActorRole | null {
  if (!identity || !state || state.empty) return null;
  if (state.owner?.toLowerCase() === identity.publicKey.toLowerCase()) return 'owner';
  return state.delegates?.find((delegate) => delegate.publicKey && delegate.publicKey.toLowerCase() === identity.publicKey.toLowerCase())?.role || 'unrecognized';
}

function localizedError(message: string, t: (key: string) => string): string {
  const rules: Array<[RegExp, string]> = [
    [/wallet disconnected|not connected|connect again/i, 'walletDisconnectedError'],
    [/only the UTXO Global|verified UTXO Global/i, 'unsupportedWalletError'],
    [/CKB secp256k1|signing scheme/i, 'signingSchemeError'],
    [/wrong wallet network|CKB testnet is required|select CKB testnet/i, 'wrongNetworkError'],
    [/compressed secp256k1 public key/i, 'publicKeyError'],
    [/incompatible wallet lock|does not match the supported CKB lock/i, 'walletLockError'],
    [/wallet changed|account changed/i, 'walletChangedError'],
    [/different wallet|identities must be distinct/i, 'differentWalletsError'],
    [/Each payment maximum|Invalid delegate limits|allowance.*shared/i, 'termsError'],
    [/fee below|fee exceeds|Fee statistics/i, 'feeError'],
    [/No Pocket is open|already open/i, 'pocketStateError'],
    [/needs a plain cell covering policy capacity/i, 'ownerCellError'],
    [/Pudge transactions are disabled/i, 'readonlyAction'],
    [/User rejected|rejected.*wallet|canceled/i, 'walletCanceledError'],
    [/Recipient changed|approved recipient/i, 'recipientPolicyError'],
    [/An earlier outcome is uncertain|outcome is uncertain/i, 'unresolvedBody'],
    [/payment exceeds|allowance|maximum per payment|personal.*limit/i, 'paymentBoundsError'],
    [/not live|stale|expired/i, 'inputChangedError'],
  ];
  const found = rules.find(([pattern]) => pattern.test(message));
  return found ? t(found[1]) : `${t('actionFailed')} ${message}`;
}

function localizedConnectionError(message: string, t: (key: string) => string): string {
  if (/User rejected|rejected.*wallet|canceled/i.test(message)) return t('walletConnectionCanceledError');
  return localizedError(message, t);
}

function App() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<PocketState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [identityError, setIdentityError] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [prepared, setPrepared] = useState<PreparedTransaction | null>(null);
  const [working, setWorking] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [transactionNotice, setTransactionNotice] = useState<{ state: string; hash?: string; detail?: string } | null>(null);
  const [pendingSigned, setPendingSigned] = useState<SignedPending | null>(null);
  const [pendingPeople, setPendingPeople] = useState<People | null>(null);
  const [showCreation, setShowCreation] = useState(false);
  const [metadata, setMetadata] = useState<PocketMetadata>({});
  const [recipientAddresses, setRecipientAddresses] = useState<Record<string, string>>({});
  const [editPerson, setEditPerson] = useState<Participant | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const next = await getPocketState();
      setState(next);
      setLoadError('');
      return next;
    } catch (cause) {
      setState(null);
      setLoadError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally { if (!quiet) setRefreshing(false); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(true), 15000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => () => wallet.disconnect(), []);

  useEffect(() => {
    if (!identity) return;
    let active = true;
    let checking = false;
    const syncIdentity = async () => {
      if (checking) return;
      checking = true;
      try {
        const current = await wallet.identity();
        if (!active) return;
        if (current.publicKey.toLowerCase() !== identity.publicKey.toLowerCase() || current.address !== identity.address) {
          setIdentity(current);
          setIdentityError('');
        }
      } catch (cause) {
        if (!active) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        wallet.disconnect();
        setIdentity(null);
        setIdentityError(localizedConnectionError(message, t));
      } finally { checking = false; }
    };
    const stopWatching = wallet.onAccountOrNetworkChange(() => window.setTimeout(() => void syncIdentity(), 0));
    const onFocus = () => void syncIdentity();
    const onVisible = () => { if (document.visibilityState === 'visible') void syncIdentity(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      stopWatching();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [identity?.publicKey, identity?.address, t]);

  useEffect(() => {
    if (!state?.pocket || !state.genesis || state.empty) { setMetadata({}); return; }
    try { setMetadata(loadMetadata(state.genesis, state.pocket)); }
    catch { setMetadata({}); }
  }, [state?.genesis, state?.pocket, state?.empty]);

  useEffect(() => {
    let canceled = false;
    const snapshot = state;
    if (!snapshot?.pocket || !snapshot.delegates?.length) { setRecipientAddresses({}); return; }
    void import('@ckb-ccc/core').then(({ Address, ClientPublicTestnet }) => {
      const client = new ClientPublicTestnet({ url: `${window.location.origin}/api/ckb`, fallbacks: [] });
      const addresses = Object.fromEntries((snapshot.delegates || []).filter((item) => item.recipient).map((item) => [item.recipient, Address.fromScript({ codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: item.recipient }, client).toString()]));
      if (!canceled) setRecipientAddresses(addresses);
    }).catch(() => { if (!canceled) setRecipientAddresses({}); });
    return () => { canceled = true; };
  }, [state?.genesis, state?.pocket]);

  useEffect(() => {
    if (!pendingPeople || !state?.pocket || !state.genesis || state.empty) return;
    const people = [pendingPeople.owner, pendingPeople.alice, pendingPeople.ben];
    const next: PocketMetadata = { ...metadata };
    for (const person of people) if (person?.publicKey) next[person.publicKey] = { name: person.name.trim(), description: person.description.trim() };
    try { saveMetadata(state.genesis, state.pocket, next); setMetadata(next); setPendingPeople(null); }
    catch { setTransactionNotice({ state: 'metadata', detail: t('metadataSaveError') }); }
  }, [pendingPeople, state?.pocket, state?.genesis, state?.empty]);

  const role = useMemo(() => actorRole(identity, state), [identity, state]);
  const delegates = state?.delegates || [];
  const activeDelegate = role === 'alice' || role === 'ben' ? delegates.find((delegate) => delegate.role === role) : undefined;
  const funds = BigInt(state?.fundShannons || 0);
  const occupied = BigInt(state?.fundOccupiedShannons || 0);
  const available = funds > occupied ? funds - occupied : 0n;
  const sharedLimit = BigInt(state?.sharedLimit || 0);
  const sharedUsed = BigInt(state?.sharedUsed || 0);
  const sharedRemaining = sharedLimit > sharedUsed ? sharedLimit - sharedUsed : 0n;
  const closed = Boolean(state?.closed);
  const unsupported = state?.unsupportedFunds || [];
  const history = state?.history || [];
  const pudge = Boolean(state?.networkMode?.startsWith('pudge'));
  const pudgeReadOnly = state?.networkMode === 'pudge-readonly';
  const explorerEnabled = pudge;

  const labelFor = (publicKey: string | undefined, fallback: string) => metadata[publicKey || '']?.name?.trim() || fallback;
  const descriptionFor = (publicKey: string | undefined) => metadata[publicKey || '']?.description?.trim() || '';
  const recipientAddress = (args: string) => recipientAddresses[args] || args;
  const participants: Participant[] = [
    ...(state?.owner ? [{ publicKey: state.owner, fallback: t('owner'), role: 'owner' as const }] : []),
    ...delegates.filter((delegate) => Boolean(delegate.publicKey)).map((delegate, index) => ({ publicKey: delegate.publicKey, fallback: index === 0 ? t('delegateOne') : t('delegateTwo'), role: delegate.role })),
  ];

  const connectWallet = async () => {
    setWalletBusy(true); setIdentityError('');
    try { const connected = await wallet.connect(); setIdentity(connected); }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setIdentityError(localizedConnectionError(message, t)); wallet.disconnect(); setIdentity(null); }
    finally { setWalletBusy(false); }
  };
  const connectParticipant = async () => {
    wallet.disconnect(); setIdentity(null); setWalletBusy(true); setIdentityError('');
    try { const connected = await wallet.connect(); setIdentity(connected); return connected; }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); const translated = localizedConnectionError(message, t); setIdentityError(translated); wallet.disconnect(); throw new Error(translated); }
    finally { setWalletBusy(false); }
  };
  const connectExpectedSigner = async (expectedPublicKey: string) => {
    wallet.disconnect(); setIdentity(null); setWalletBusy(true); setIdentityError('');
    try {
      const connected = await wallet.connect();
      if (connected.publicKey.toLowerCase() !== expectedPublicKey.toLowerCase()) throw new Error(t('signerMismatch'));
      setIdentity(connected);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      wallet.disconnect();
      throw new Error(localizedConnectionError(message, t));
    } finally { setWalletBusy(false); }
  };

  const beginOperation = (operation: Operation, selectedRole?: 'alice' | 'ben', displayName?: string) => {
    setOperationError(''); setPrepared(null); setIntent({ operation, role: selectedRole, displayName });
  };
  const prepareOperation = async (body: Record<string, unknown>) => {
    if (!intent || !identity) throw new Error(t('connect'));
    setWorking(true); setOperationError('');
    try {
      const request = intent.operation === 'pay' ? await preparePayment(body) : await prepareOwnerAction(body);
      setPrepared(request);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setOperationError(localizedError(message, t));
    } finally { setWorking(false); }
  };

  const prepareCreation = async (body: unknown, people: People) => {
    if (pudgeReadOnly) throw new Error(t('readonlyAction'));
    setWorking(true); setOperationError('');
    try {
      const request = await prepareGenesis(body);
      setPendingPeople(people);
      setPrepared(request);
      setIntent({ operation: 'genesis' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(localizedError(message, t));
    } finally { setWorking(false); }
  };

  const submitSigned = async (transaction: string, hash?: string) => {
    if (!prepared) return;
    setWorking(true); setOperationError('');
    try {
      const result: TransactionResult = await submitTransaction(prepared.id, transaction);
      setTransactionNotice({ state: result.state, hash: result.txHash || hash, detail: result.error });
      setPrepared(null); setIntent(null); setPendingSigned(null);
      await refresh(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTransactionNotice({ state: 'uncertain', hash, detail: t('submitUnknown') });
      setOperationError(localizedError(message, t));
      setPrepared(null); setIntent(null); setPendingSigned(null);
      await refresh(true);
    } finally { setWorking(false); }
  };

  const signPrepared = async (request: PreparedTransaction) => {
    setWorking(true); setOperationError('');
    try {
      if (!identity || request.publicKey.toLowerCase() !== identity.publicKey.toLowerCase()) throw new Error(t('signerMismatch'));
      const signed = await wallet.sign(request.transaction, request.publicKey);
      const { Transaction } = await import('@ckb-ccc/connector');
      const hash = Transaction.fromBytes(signed).hash();
      if (pudge) {
        setPendingSigned({ transaction: signed, hash });
        setWorking(false);
        return;
      }
      await submitSigned(signed, hash);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setOperationError(localizedError(message, t));
    } finally { setWorking(false); }
  };

  const discardPending = () => { setPendingSigned(null); setPrepared(null); setIntent(null); setOperationError(''); };
  const closeDialog = () => { if (working || pendingSigned) return; setIntent(null); setPrepared(null); setOperationError(''); };

  const runReconcile = async () => {
    setReconcileBusy(true); setTransactionNotice(null);
    try {
      const result = await reconcile();
      const unresolved = result.outcomes.find((outcome) => outcome.state === 'uncertain' || outcome.status === 'unknown');
      setTransactionNotice(unresolved ? { state: 'uncertain', hash: unresolved.txHash } : { state: 'checked' });
      await refresh(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTransactionNotice({ state: 'error', detail: localizedError(message, t) });
    } finally { setReconcileBusy(false); }
  };

  const saveName = (person: Participant, name: string, description: string) => {
    if (!state?.genesis || !state.pocket) return;
    const next = { ...metadata, [person.publicKey]: { name: name.trim().slice(0, 32), description: description.trim().slice(0, 72) } };
    try { saveMetadata(state.genesis, state.pocket, next); setMetadata(next); setEditPerson(null); }
    catch { setIdentityError(t('metadataSaveError')); }
  };

  const downloadNames = () => {
    if (!state?.genesis || !state.pocket) return;
    const data = new Blob([exportMetadata(state.genesis, state.pocket, metadata)], { type: 'application/json' });
    const url = URL.createObjectURL(data); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `quotacell-participants-${state.pocket.slice(2, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const loadNames = async (file?: File) => {
    if (!file || !state?.genesis || !state.pocket) return;
    try {
      const parsed = importMetadata(await file.text(), state.genesis, state.pocket, participants.map((person) => person.publicKey));
      saveMetadata(state.genesis, state.pocket, parsed); setMetadata(parsed); setIdentityError('');
    } catch { setIdentityError(t('metadataImportError')); }
  };

  const dateText = (value: string) => new Intl.DateTimeFormat(i18n.language === 'zh-Hans' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const historyState = (value: string) => {
    const key = value === 'committed' ? 'statusCommitted' : value === 'pending' ? 'statusPending' : value === 'proposed' ? 'statusProposed' : value === 'uncertain' ? 'statusUncertain' : value === 'rejected' ? 'statusRejected' : '';
    return key ? t(key) : value;
  };
  const explorerUrl = (hash: string) => `https://pudge.explorer.nervos.org/transaction/${hash}`;
  const displayIdentityRole = role === 'owner' ? t('owner') : role === 'alice' ? labelFor(delegates.find((d) => d.role === 'alice')?.publicKey, t('delegateOne')) : role === 'ben' ? labelFor(delegates.find((d) => d.role === 'ben')?.publicKey, t('delegateTwo')) : role === 'unrecognized' ? t('unknownRole') : '';
  const noticeTitle = transactionNotice?.state === 'uncertain' ? t('statusUncertain') : transactionNotice?.state === 'error' ? t('statusFailed') : transactionNotice?.state === 'checked' ? t('checkedStatus') : transactionNotice?.state === 'metadata' ? t('metadataLocal') : transactionNotice ? historyState(transactionNotice.state) : '';

  return <>
    <header className="topbar sticky top-0 z-40 flex h-16 w-full items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-[max(26px,calc((100vw-1160px)/2))]"><a className="brand inline-flex shrink-0 items-center gap-2.5 text-lg font-bold text-navy no-underline" href="#home" aria-label={t('brand')}><CellMark/><span>{t('brand')}</span></a>
      <div className="topbar-controls flex min-w-0 items-center justify-end gap-1.5 sm:gap-3">
        {state && <div className={`network-state ${pudgeReadOnly ? 'is-readonly' : ''}`} role="status" aria-label={`${pudge ? t('networkPudge') : t('networkLocal')}${pudgeReadOnly ? ` · ${t('readOnly')}` : ''}`}><i aria-hidden="true"/><span className="network-full" aria-hidden="true">{pudge ? t('networkPudge') : t('networkLocal')}</span><span className="network-compact" aria-hidden="true">{pudge ? t('networkPudgeShort') : t('networkLocalShort')}</span>{pudgeReadOnly && <small>{t('readOnly')}</small>}</div>}
        <label className="language-control"><span className="sr-only">{t('language')}</span><select value={i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en'} onChange={(event) => void i18n.changeLanguage(event.target.value)} aria-label={t('language')}><option value="en">EN</option><option value="zh-Hans">简</option></select></label>
        <button className="icon-button refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={refreshing ? t('refreshing') : t('refresh')} title={t('refresh')}>{refreshing ? '…' : '↻'}</button>
        {identity ? <div className="connected-account"><div><strong>{displayIdentityRole || t('connected')}</strong><code dir="ltr">{shortHash(identity.address, 12, 7)}</code></div><button className="text-button disconnect-button" onClick={() => { wallet.disconnect(); setIdentity(null); setIdentityError(''); }} type="button">×</button></div> : <button className="connect-button" type="button" disabled={walletBusy} onClick={() => void connectWallet()}>{walletBusy ? t('connectingWallet') : t('disconnected')}</button>}
      </div>
    </header>

    {identityError && <div className="wallet-connection-alert inline-alert mx-auto mt-4 w-[min(calc(100%-2rem),64rem)] rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-5 text-red-800" role="alert">{identityError}</div>}

    {state?.creationRecovery ? <main className="loading-page mx-auto grid min-h-[55vh] w-[min(100%-2rem,64rem)] place-items-center text-slate-600"><section className="load-error w-full max-w-xl rounded-lg border border-red-200 bg-white p-5 shadow-sm" role="alert"><h1 className="text-lg font-semibold text-red-900">{t('creationRecoveryTitle')}</h1><p className="text-sm leading-6 text-slate-700">{t('creationRecoveryBody', { state: state.creationRecovery.state })}</p><p className="break-all text-xs text-slate-600"><code dir="ltr">{state.creationRecovery.txHash}</code></p><button className="secondary-button" disabled={reconcileBusy} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button></section></main>
      : state?.empty ? showCreation ? <CreationFlow pudgeReadOnly={pudgeReadOnly} onConnectParticipant={connectParticipant} onPrepare={prepareCreation} onCancel={() => setShowCreation(false)}/> : <main className="empty-pocket-page mx-auto flex min-h-[min(66vh,620px)] w-[min(100%-2rem,64rem)] flex-col items-start justify-center py-10"><div className="empty-cell-mark mb-5 grid size-14 place-items-center rounded-xl border border-blue-100 bg-blue-wash text-blue"><CellMark/></div><h1 className="mb-2 max-w-2xl text-3xl font-bold leading-tight text-navy sm:text-4xl">{t('emptyTitle')}</h1><p className="mb-5 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">{t('emptyBody')}</p><button className="primary-button" type="button" onClick={() => setShowCreation(true)}>{t('createPocket')} <span aria-hidden="true">→</span></button></main>
      : state && !state.empty ? <main id="home" className="app-page mx-auto w-[min(100%-2rem,64rem)] py-6 sm:py-8">
        <div className="pocket-heading mb-5 flex items-start justify-between gap-4"><div className="min-w-0"><h1 className="m-0 text-2xl font-bold text-navy sm:text-[28px]">{state.pocket ? t('activePocket') : t('brand')}</h1><p className="mt-1 text-xs text-slate-600 sm:text-sm">{identity ? displayIdentityRole : t('connectToSeeActions')}</p></div><span className={closed ? 'state-mark state-closed' : 'state-mark'}>{closed ? t('closedStatus') : t('active')}</span></div>

        {transactionNotice && <div className={`transaction-notice mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 ${transactionNotice.state === 'uncertain' || transactionNotice.state === 'error' ? 'notice-warning border-amber-200 bg-amber-50' : ''}`} role="status" aria-live="polite"><span className="notice-marker grid size-6 shrink-0 place-items-center rounded-full bg-success text-xs font-bold text-white" aria-hidden="true">{transactionNotice.state === 'uncertain' || transactionNotice.state === 'error' ? '!' : '✓'}</span><div className="min-w-0 flex-1"><strong className="text-sm font-semibold text-slate-800">{noticeTitle}</strong><p className="mt-1 break-words text-xs leading-5 text-slate-600">{transactionNotice.detail || (transactionNotice.hash ? <>{t('txId')}: <code dir="ltr">{shortHash(transactionNotice.hash, 14, 10)}</code> · {transactionNotice.state}</> : t('noUncertainTransactions'))}</p></div><button type="button" className="text-button rounded p-1 text-slate-500 hover:bg-white/70" onClick={() => setTransactionNotice(null)} aria-label={t('close')}>×</button></div>}

        {state.unresolved && <section className="unresolved-banner mb-4 flex flex-col items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center" role="alert"><div><strong className="text-sm font-semibold text-amber-950">{t('unresolvedTitle')}</strong><p className="mt-1 text-xs leading-5 text-amber-900">{t('unresolvedBody')}</p></div><button type="button" className="secondary-button shrink-0" disabled={reconcileBusy || pudgeReadOnly} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button></section>}

        <section className="metrics mb-7 grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('activePocket')}>
          <article className="metric min-w-0 rounded-lg border border-line bg-white p-4 sm:p-5"><span className="text-xs font-semibold text-slate-600">{t('protectedBalance')}</span><strong className="metric-value my-2 block break-words text-3xl font-bold leading-tight tabular-nums text-navy sm:text-4xl">{formatCkb(funds)} <i className="text-base font-medium not-italic text-slate-500">CKB</i></strong><p className="mb-2 text-xs text-slate-600">{t('availableSpend')}: <b className="font-semibold text-slate-800">{formatCkb(available)} CKB</b></p><div className="capacity-bar h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><span className="block h-full rounded-full bg-blue-bright" style={{ width: `${funds > 0n ? Number(available * 10000n / funds > 10000n ? 10000n : available * 10000n / funds) / 100 : 0}%` }}/></div><small className="mt-2 block text-[11px] leading-4 text-slate-500">{t('occupiedDisclosure')}</small></article>
          <article className="metric allowance-metric min-w-0 rounded-lg border border-line bg-white p-4 sm:p-5"><span className="text-xs font-semibold text-slate-600">{closed ? t('terminalCapacity') : t('sharedAllowance')}</span><strong className="metric-value my-2 block break-words text-3xl font-bold leading-tight tabular-nums text-navy sm:text-4xl">{closed ? <>{formatCkb(state.policyCapacity || '0')} <i className="text-base font-medium not-italic text-slate-500">CKB</i></> : <>{formatCkb(sharedRemaining)} <i className="text-base font-medium not-italic text-slate-500">CKB</i></>}</strong><p className="mb-2 text-xs text-slate-600">{closed ? t('terminalCapacityHint') : t('sharedUsedOf', { used: formatCkb(sharedUsed), total: formatCkb(sharedLimit) })}</p>{!closed && <div className="capacity-bar allowance-bar h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={t('sharedAllowance')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(sharedUsed.toString(), sharedLimit.toString())}><span className="block h-full rounded-full bg-blue" style={{ width: `${progressPercent(sharedUsed.toString(), sharedLimit.toString())}%` }}/></div>}{!closed && <small className="mt-2 block text-[11px] leading-4 text-slate-500">{t('allowanceExplanation')}</small>}</article>
        </section>

        {!identity && <section className="connect-prompt mb-6 flex flex-col items-start justify-between gap-4 rounded-lg border border-line bg-white p-4 sm:flex-row sm:items-center sm:p-5"><div><h2 className="mb-1 text-base font-semibold text-navy">{t('connectToContinue')}</h2><p className="m-0 max-w-xl text-xs leading-5 text-slate-600">{t('localDisclosure')}</p></div><button className="primary-button w-full sm:w-auto" onClick={() => void connectWallet()} disabled={walletBusy}>{walletBusy ? t('connectingWallet') : t('disconnected')} <span aria-hidden="true">→</span></button></section>}
        {identity && role === 'unrecognized' && <p className="role-message" role="status">{t('unknownRole')}</p>}

        {identity && role === 'owner' && !closed && <section className="owner-actions mt-7 flex flex-col items-start justify-between gap-4 rounded-lg border border-line bg-white p-4 sm:flex-row sm:items-center sm:p-5"><div className="section-title"><div><h2 className="text-base font-semibold text-navy">{t('ownerControls')}</h2><p className="mt-1 text-xs text-slate-600">{t('ownerDescription')}</p></div></div><div className="owner-action-list flex w-full flex-wrap gap-2 sm:w-auto"><button className="secondary-button flex-1 sm:flex-none" disabled={pudgeReadOnly || state.unresolved} onClick={() => beginOperation('deposit')}>{t('fund')}</button>{state.hasFund && <button className="secondary-button flex-1 sm:flex-none" disabled={pudgeReadOnly || state.unresolved} onClick={() => beginOperation('close')}>{t('closePocket')}</button>}</div></section>}
        {identity && role === 'owner' && closed && state.hasFund && <section className="owner-actions late-funds mt-7 flex flex-col items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold text-amber-950">{t('lateFunds')}</h2><p className="mt-1 text-sm tabular-nums text-amber-900">{formatCkb(funds)} CKB</p></div><button className="primary-button" disabled={pudgeReadOnly || state.unresolved} onClick={() => beginOperation('sweep')}>{t('sweep')} <span aria-hidden="true">→</span></button></section>}

        {identity && (role === 'alice' || role === 'ben') && activeDelegate && !closed && <section className="delegate-focus mb-7 rounded-lg border border-t-[3px] border-t-blue border-line bg-white p-4 sm:p-5">
          <div className="delegate-focus-heading flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5"><span className={`permission-dot mt-2 size-2 shrink-0 rounded-full ${activeDelegate.enabled ? 'bg-emerald-600' : 'is-revoked bg-red-600'}`} aria-hidden="true"/><div className="min-w-0"><h2 className="m-0 text-lg font-semibold text-navy">{labelFor(activeDelegate.publicKey, role === 'alice' ? t('delegateOne') : t('delegateTwo'))}</h2>{descriptionFor(activeDelegate.publicKey) && <p className="mt-1 text-xs text-slate-600">{descriptionFor(activeDelegate.publicKey)}</p>}</div></div><span className={activeDelegate.enabled ? 'permission-status' : 'permission-status is-revoked'}>{activeDelegate.enabled ? t('active') : t('revoked')}</span></div>
          <div className="delegate-summary mt-5 grid grid-cols-2 gap-3 border-y border-slate-100 py-4 sm:grid-cols-3 sm:gap-4"><div className="min-w-0"><span className="text-xs font-medium text-slate-600">{t('remaining')}</span><strong className="my-1 block break-words text-xl font-semibold tabular-nums text-navy">{formatCkb(BigInt(activeDelegate.limit) > BigInt(activeDelegate.used) ? BigInt(activeDelegate.limit) - BigInt(activeDelegate.used) : 0n)} <i className="text-xs font-normal not-italic text-slate-500">CKB</i></strong><small className="text-[11px] leading-4 text-slate-500">{formatCkb(activeDelegate.used)} {t('usedOf')} {formatCkb(activeDelegate.limit)} CKB</small></div><div className="min-w-0"><span className="text-xs font-medium text-slate-600">{t('maxPayment')}</span><strong className="my-1 block break-words text-xl font-semibold tabular-nums text-navy">{formatCkb(activeDelegate.perPayment)} <i className="text-xs font-normal not-italic text-slate-500">CKB</i></strong><small className="text-[11px] leading-4 text-slate-500">{t('perPaymentHint')}</small></div><div className="col-span-2 min-w-0 border-t border-slate-100 pt-3 sm:col-span-1 sm:border-0 sm:pt-0"><span className="text-xs font-medium text-slate-600">{t('sharedRemaining')}</span><strong className="my-1 block break-words text-xl font-semibold tabular-nums text-navy">{formatCkb(sharedRemaining)} <i className="text-xs font-normal not-italic text-slate-500">CKB</i></strong><small className="text-[11px] leading-4 text-slate-500">{t('sharedAuthorityHint')}</small></div></div>
          <div className="approved-recipient mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 sm:flex-row sm:justify-between sm:gap-4"><span className="text-xs font-medium text-slate-600">{t('recipient')}</span><code className="min-w-0 break-all text-left text-xs text-slate-700 sm:max-w-[70%] sm:text-right" dir="ltr" title={recipientAddress(activeDelegate.recipient)}>{recipientAddress(activeDelegate.recipient)}</code></div>
          {activeDelegate.enabled && <button className="primary-button pay-button mt-4 min-w-40" disabled={pudgeReadOnly || state.unresolved || !state.hasFund} onClick={() => beginOperation('pay', activeDelegate.role)}>{t('pay')} <span aria-hidden="true">→</span></button>}
          {!activeDelegate.enabled && <p className="revoked-message" role="status">{t('permissionRevokedMessage')}</p>}
        </section>}

        {identity && role === 'owner' && !closed && <section className="permissions-section mt-7"><div className="section-title flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold text-navy">{t('delegatePermissions')}</h2><p className="mt-1 text-xs text-slate-600">{t('sharedRelationship')}</p></div><span className="two-person-count grid size-6 place-items-center rounded-full border border-slate-300 text-xs text-slate-600">2</span></div>
          <div className="permission-list">{delegates.map((delegate, index) => {
            const fallback = index === 0 ? t('delegateOne') : t('delegateTwo');
            const name = labelFor(delegate.publicKey, fallback);
            const remaining = BigInt(delegate.limit) > BigInt(delegate.used) ? BigInt(delegate.limit) - BigInt(delegate.used) : 0n;
            return <article className="permission-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-3 py-3 first:border-0 sm:grid-cols-[minmax(0,1.5fr)_minmax(120px,.8fr)_auto] sm:gap-4 sm:px-4">
              <div className="permission-person"><div className="participant-mark" aria-hidden="true">{index + 1}</div><div><div className="permission-name"><h3>{name}</h3><span className={delegate.enabled ? 'permission-status' : 'permission-status is-revoked'}>{delegate.enabled ? t('active') : t('revoked')}</span><button type="button" className="text-button edit-name" onClick={() => setEditPerson({ publicKey: delegate.publicKey, role: delegate.role, fallback: name })}>{t('rename')}</button></div>{descriptionFor(delegate.publicKey) && <p>{descriptionFor(delegate.publicKey)}</p>}<span className="permission-subline">{formatCkb(remaining)} / {formatCkb(delegate.limit)} CKB · {t('maxPayment').toLowerCase()} {formatCkb(delegate.perPayment)} CKB</span></div></div>
              <div className="permission-recipient"><span>{t('recipient')}</span><code dir="ltr" title={recipientAddress(delegate.recipient)}>{shortHash(recipientAddress(delegate.recipient), 18, 8)}</code></div>
              <div className="permission-actions"><details className="participant-inspector"><summary>{t('details')}</summary><div><span>{t('publicKey')}</span><code dir="ltr">{delegate.publicKey}</code><span>{t('recipient')}</span><code dir="ltr">{recipientAddress(delegate.recipient)}</code><span>{t('used')}</span><code>{formatCkb(delegate.used)} CKB</code></div></details><button type="button" className="text-button revoke-button" disabled={!delegate.enabled || state.unresolved || pudgeReadOnly || closed} onClick={() => beginOperation('revoke', delegate.role, name)}>{t('revoke')}</button></div>
            </article>;
          })}</div>
        </section>}

        {identity && role === 'unrecognized' && <section className="public-permissions"><h2>{t('delegatePermissions')}</h2><div className="permission-list">{delegates.map((delegate, index) => <div className="public-permission-row" key={delegate.role}><strong>{labelFor(delegate.publicKey, index === 0 ? t('delegateOne') : t('delegateTwo'))}</strong><span>{formatCkb(BigInt(delegate.limit) > BigInt(delegate.used) ? BigInt(delegate.limit) - BigInt(delegate.used) : 0n)} / {formatCkb(delegate.limit)} CKB</span><span>{delegate.enabled ? t('active') : t('revoked')}</span></div>)}</div></section>}

        {closed && <section className="closed-summary"><div className="closed-icon" aria-hidden="true">✓</div><div><h2>{t('closedTitle')}</h2><p>{t('closedBody')}</p>{history.filter((item) => item.operation === 'close' && item.state === 'committed').slice(-1).map((item) => <p key={item.id}>{t('recoveredAmount')}: <strong>{formatCkb(item.amount)} CKB</strong></p>)}{state.hasFund && <p>{t('lateFunds')}</p>}</div></section>}

        {unsupported.length > 0 && <section className="unsupported-section" role="status"><div className="unsupported-heading"><span aria-hidden="true">!</span><div><h2>{t('unsupportedTitle')}</h2><p>{t('unsupportedBody')}</p></div></div><div className="unsupported-list">{unsupported.map((item) => { const outPoint = item.outPoint; const hash = outPoint.txHash || outPoint.tx_hash || ''; return <div className="unsupported-row" key={`${hash}:${outPoint.index}`}><strong>{formatCkb(item.capacity)} CKB</strong><span>{item.hasType ? t('typedCell') : t('dataCell')} · {item.dataBytes} {t('bytes')}</span><code dir="ltr">{shortHash(hash, 14, 8)}:{outPoint.index}</code></div>; })}</div></section>}

        {identity && <section className="metadata-tools"><details><summary>{t('participantNames')}</summary><p>{t('metadataNote')}</p><div className="metadata-actions"><button type="button" className="text-button" onClick={downloadNames}>{t('exportNames')}</button><label className="file-import">{t('importNames')}<input type="file" accept="application/json,.json" onChange={(event) => void loadNames(event.target.files?.[0])}/></label></div></details></section>}

        <section className="history-section mt-8"><div className="section-title mb-3 flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold text-navy">{t('history')}</h2></div>{history.some((item) => item.state === 'uncertain') && <button className="text-button" disabled={reconcileBusy || pudgeReadOnly} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button>}</div>
          {history.length ? <ol className="history-list">{[...history].reverse().slice(0, 8).map((item) => <HistoryRow item={item} key={item.id} locale={i18n.language} label={labelFor(item.actor, item.actor === state.owner ? t('owner') : t('participantEmpty'))} stateLabel={historyState(item.state)} explorer={explorerEnabled ? explorerUrl(item.tx_hash) : undefined} t={t}/>)}</ol> : <p className="empty-history">{t('noHistory')}</p>}
        </section>

        <details className="technical-footer"><summary>{t('technical')}</summary><div><p>{t('localDisclosure')}</p><dl><div><dt>{t('appIdentity')}</dt><dd><code dir="ltr">{state.genesis}</code></dd></div>{state.pocket && <div><dt>{t('policyId')}</dt><dd><code dir="ltr">{state.pocket}</code></dd></div>}{state.indexedTip && <div><dt>{t('indexerTip')}</dt><dd><code dir="ltr">{state.indexedTip.block_number} · {state.indexedTip.block_hash}</code></dd></div>}</dl></div></details>
      </main>
      : <main id="home" className="loading-page">{loadError ? <section className="load-error" role="alert"><h1>{t('loadError')}</h1><p>{localizedError(loadError, t)}</p><button className="primary-button" onClick={() => void refresh()}>{t('retry')}</button></section> : <p role="status">{t('loadingState')}</p>}</main>}

    {state && state.empty && <div className="fallback-link flex justify-center px-5 pb-6 text-[11px]"><a className="text-slate-500 no-underline hover:underline" href="/legacy" target="_blank" rel="noreferrer">{t('legacyHelp')} ↗</a></div>}
    {state && !state.empty && <footer className="app-footer mx-auto flex w-[min(100%-2rem,64rem)] flex-col justify-between gap-2 pb-6 text-[11px] text-slate-500 sm:flex-row sm:gap-5"><span className="max-w-2xl">{t('localDisclosure')}</span><a className="text-slate-600 no-underline hover:underline" href="/legacy" target="_blank" rel="noreferrer">{t('legacyHelp')} ↗</a></footer>}
    {!state && <div className="fallback-link"><a href="/legacy" target="_blank" rel="noreferrer">{t('legacyHelp')} ↗</a></div>}

    {state && <OperationDialog intent={intent} prepared={prepared} state={state} identity={identity} delegates={delegates} history={history} recipientAddresses={recipientAddresses} working={working} error={operationError} onPrepare={prepareOperation} onSign={signPrepared} onConnectSigner={connectExpectedSigner} onClose={closeDialog}/>}
    {editPerson && <EditParticipantDialog participant={editPerson} initial={metadata[editPerson.publicKey]} onClose={() => setEditPerson(null)} onSave={saveName} t={t}/>}

    <AlertDialog.Root open={Boolean(pendingSigned)} onOpenChange={(open) => { if (!open && !working) discardPending(); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px]"/><AlertDialog.Content className="dialog-content alert-dialog fixed left-1/2 top-1/2 z-[51] max-h-[min(88dvh,850px)] w-[min(500px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6" aria-modal="true">
        <span className="dialog-symbol warning-symbol mb-3 grid size-8 place-items-center rounded-lg border border-amber-200 bg-amber-50 font-bold text-amber-800" aria-hidden="true">!</span><AlertDialog.Title className="dialog-title text-xl font-semibold text-navy">{t('pudgeBroadcastTitle')}</AlertDialog.Title><AlertDialog.Description className="dialog-description mb-4 mt-1.5 block text-xs leading-5 text-slate-600">{t('pudgeBroadcastBody')}</AlertDialog.Description>
        {pendingSigned && <div className="signed-hash grid gap-1.5 rounded-md border border-line bg-slate-50 p-3"><span className="text-[11px] text-slate-500">{t('txId')}</span><code className="break-all text-xs text-slate-700" dir="ltr">{pendingSigned.hash}</code></div>}
        <div className="dialog-actions mt-4 flex flex-wrap justify-end gap-2"><AlertDialog.Cancel asChild><button className="secondary-button" disabled={working}>{t('discardSignature')}</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="primary-button" disabled={working || pudgeReadOnly} onClick={(event) => { event.preventDefault(); if (pendingSigned) void submitSigned(pendingSigned.transaction, pendingSigned.hash); }}>{working ? t('submitting') : t('sendToPudge')}</button></AlertDialog.Action></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}

function HistoryRow({ item, locale, label, stateLabel, explorer, t }: { item: HistoryItem; locale: string; label: string; stateLabel: string; explorer?: string; t: (key: string) => string }) {
  const operationLabel = item.operation === 'genesis' ? t('actionGenesis') : item.operation === 'pay' ? t('actionPay') : item.operation === 'deposit' ? t('actionDeposit') : item.operation === 'revoke' ? t('actionRevoke') : item.operation === 'close' ? t('actionClose') : item.operation === 'sweep' ? t('actionSweep') : item.operation;
  return <li className="history-row grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-t border-slate-100 px-3 py-3 first:border-0 sm:px-4"><span className="history-symbol grid size-7 place-items-center rounded-md bg-blue-50 text-sm text-blue-800" aria-hidden="true">{item.operation === 'pay' ? '↗' : item.operation === 'deposit' ? '+' : item.operation === 'revoke' ? '−' : '◈'}</span><div className="history-description grid min-w-0 gap-1"><strong className="text-xs font-semibold text-slate-800">{operationLabel}{item.operation === 'pay' || item.operation === 'deposit' || item.operation === 'close' || item.operation === 'sweep' ? ` · ${formatCkb(item.amount)} CKB` : ''}</strong><span className="text-[10px] text-slate-500">{label} · {new Intl.DateTimeFormat(locale === 'zh-Hans' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created))}</span></div><span className={`history-state whitespace-nowrap px-1.5 py-0.5 text-[10px] ${item.state === 'uncertain' ? 'is-uncertain text-amber-800' : item.state === 'committed' ? 'is-confirmed text-emerald-800' : 'text-slate-600'}`}>{stateLabel}</span>{explorer ? <a className="history-link grid size-7 place-items-center rounded text-blue hover:bg-blue-wash" href={explorer} target="_blank" rel="noreferrer" aria-label={`${t('explorer')}: ${item.tx_hash}`}>↗</a> : <code className="history-hash whitespace-nowrap text-[10px] text-slate-500" title={item.tx_hash}>{shortHash(item.tx_hash, 10, 7)}</code>}</li>;
}

function EditParticipantDialog({ participant, initial, onClose, onSave, t }: { participant: Participant; initial?: { name: string; description?: string }; onClose: () => void; onSave: (participant: Participant, name: string, description: string) => void; t: (key: string) => string }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content name-dialog" aria-modal="true"><div className="dialog-top"><span className="dialog-symbol" aria-hidden="true"><CellMark/></span><Dialog.Close asChild><button className="icon-button" aria-label={t('close')}>×</button></Dialog.Close></div><Dialog.Title className="dialog-title">{t('rename')}</Dialog.Title><Dialog.Description className="dialog-description">{t('metadataNote')}</Dialog.Description><label className="field-block">{t('name')}<input autoFocus value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder={participant.fallback}/></label><label className="field-block">{t('description')}<input value={description} maxLength={72} onChange={(event) => setDescription(event.target.value)}/></label><div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button">{t('cancel')}</button></Dialog.Close><button className="primary-button" onClick={() => onSave(participant, name, description)}>{t('save')}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function CellMark() {
  return <svg viewBox="0 0 28 28" role="presentation"><path d="M14 2.5 25.5 9v10L14 25.5 2.5 19V9L14 2.5Z"/><path d="m14 8 5.5 3.2v5.6L14 20l-5.5-3.2v-5.6L14 8Z"/><path d="M14 8v12m5.5-8.8L8.5 16.8m0-5.6 11 5.6"/></svg>;
}

createRoot(document.getElementById('root')!).render(<App/>);
