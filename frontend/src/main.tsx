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
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setIdentityError(localizedError(message, t)); wallet.disconnect(); setIdentity(null); }
    finally { setWalletBusy(false); }
  };
  const connectParticipant = async () => {
    wallet.disconnect(); setIdentity(null); setWalletBusy(true); setIdentityError('');
    try { const connected = await wallet.connect(); setIdentity(connected); return connected; }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); const translated = localizedError(message, t); setIdentityError(translated); wallet.disconnect(); throw new Error(translated); }
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
      throw new Error(localizedError(message, t));
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
    <header className="topbar"><a className="brand" href="#home" aria-label={t('brand')}><CellMark/><span>{t('brand')}</span></a>
      <div className="topbar-controls">
        {state && <div className={`network-state ${pudgeReadOnly ? 'is-readonly' : ''}`} role="status" aria-label={`${pudge ? t('networkPudge') : t('networkLocal')}${pudgeReadOnly ? ` · ${t('readOnly')}` : ''}`}><i aria-hidden="true"/><span className="network-full" aria-hidden="true">{pudge ? t('networkPudge') : t('networkLocal')}</span><span className="network-compact" aria-hidden="true">{pudge ? t('networkPudgeShort') : t('networkLocalShort')}</span>{pudgeReadOnly && <small>{t('readOnly')}</small>}</div>}
        <label className="language-control"><span className="sr-only">{t('language')}</span><select value={i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en'} onChange={(event) => void i18n.changeLanguage(event.target.value)} aria-label={t('language')}><option value="en">EN</option><option value="zh-Hans">简</option></select></label>
        <button className="icon-button refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={refreshing ? t('refreshing') : t('refresh')} title={t('refresh')}>{refreshing ? '…' : '↻'}</button>
        {identity ? <div className="connected-account"><div><strong>{displayIdentityRole || t('connected')}</strong><code dir="ltr">{shortHash(identity.address, 12, 7)}</code></div><button className="text-button disconnect-button" onClick={() => { wallet.disconnect(); setIdentity(null); setIdentityError(''); }} type="button">×</button></div> : <button className="connect-button" type="button" disabled={walletBusy} onClick={() => void connectWallet()}>{walletBusy ? t('preparing') : t('disconnected')}</button>}
      </div>
    </header>

    {state?.creationRecovery ? <main className="loading-page"><section className="load-error" role="alert"><h1>{t('creationRecoveryTitle')}</h1><p>{t('creationRecoveryBody', { state: state.creationRecovery.state })}</p><p><code dir="ltr">{state.creationRecovery.txHash}</code></p><button className="secondary-button" disabled={reconcileBusy} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button></section></main>
      : state?.empty ? showCreation ? <CreationFlow pudgeReadOnly={pudgeReadOnly} onConnectParticipant={connectParticipant} onPrepare={prepareCreation} onCancel={() => setShowCreation(false)}/> : <main className="empty-pocket-page"><div className="empty-cell-mark" aria-hidden="true"><CellMark/></div><h1>{t('emptyTitle')}</h1><p>{t('emptyBody')}</p><button className="primary-button" type="button" onClick={() => setShowCreation(true)}>{t('createPocket')} <span aria-hidden="true">→</span></button></main>
      : state && !state.empty ? <main id="home" className="app-page">
        <div className="pocket-heading"><div><h1>{state.pocket ? t('activePocket') : t('brand')}</h1><p>{identity ? displayIdentityRole : t('connectToSeeActions')}</p></div><span className={closed ? 'state-mark state-closed' : 'state-mark'}>{closed ? t('closedStatus') : t('active')}</span></div>

        {identityError && <p className="inline-alert" role="alert">{identityError}</p>}
        {transactionNotice && <div className={`transaction-notice ${transactionNotice.state === 'uncertain' || transactionNotice.state === 'error' ? 'notice-warning' : ''}`} role="status" aria-live="polite"><span className="notice-marker" aria-hidden="true">{transactionNotice.state === 'uncertain' || transactionNotice.state === 'error' ? '!' : '✓'}</span><div><strong>{noticeTitle}</strong><p>{transactionNotice.detail || (transactionNotice.hash ? <>{t('txId')}: <code dir="ltr">{shortHash(transactionNotice.hash, 14, 10)}</code> · {transactionNotice.state}</> : t('noUncertainTransactions'))}</p></div><button type="button" className="text-button" onClick={() => setTransactionNotice(null)} aria-label={t('close')}>×</button></div>}

        {state.unresolved && <section className="unresolved-banner" role="alert"><div><strong>{t('unresolvedTitle')}</strong><p>{t('unresolvedBody')}</p></div><button type="button" className="secondary-button" disabled={reconcileBusy || pudgeReadOnly} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button></section>}

        <section className="metrics" aria-label={t('activePocket')}>
          <article className="metric"><span>{t('protectedBalance')}</span><strong className="metric-value">{formatCkb(funds)} <i>CKB</i></strong><p>{t('availableSpend')}: <b>{formatCkb(available)} CKB</b></p><div className="capacity-bar" aria-hidden="true"><span style={{ width: `${funds > 0n ? Number(available * 10000n / funds > 10000n ? 10000n : available * 10000n / funds) / 100 : 0}%` }}/></div><small>{t('occupiedDisclosure')}</small></article>
          <article className="metric allowance-metric"><span>{closed ? t('terminalCapacity') : t('sharedAllowance')}</span><strong className="metric-value">{closed ? <>{formatCkb(state.policyCapacity || '0')} <i>CKB</i></> : <>{formatCkb(sharedRemaining)} <i>CKB</i></>}</strong><p>{closed ? t('terminalCapacityHint') : t('sharedUsedOf', { used: formatCkb(sharedUsed), total: formatCkb(sharedLimit) })}</p>{!closed && <div className="capacity-bar allowance-bar" role="progressbar" aria-label={t('sharedAllowance')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(sharedUsed.toString(), sharedLimit.toString())}><span style={{ width: `${progressPercent(sharedUsed.toString(), sharedLimit.toString())}%` }}/></div>}{!closed && <small>{t('allowanceExplanation')}</small>}</article>
        </section>

        {!identity && <section className="connect-prompt"><div><h2>{t('connectToContinue')}</h2><p>{t('localDisclosure')}</p></div><button className="primary-button" onClick={() => void connectWallet()} disabled={walletBusy}>{walletBusy ? t('preparing') : t('disconnected')} <span aria-hidden="true">→</span></button></section>}
        {identity && role === 'unrecognized' && <p className="role-message" role="status">{t('unknownRole')}</p>}

        {identity && role === 'owner' && !closed && <section className="owner-actions"><div className="section-title"><div><h2>{t('ownerControls')}</h2><p>{t('ownerDescription')}</p></div></div><div className="owner-action-list"><button className="secondary-button" disabled={pudgeReadOnly || state.unresolved} onClick={() => beginOperation('deposit')}>{t('fund')}</button>{state.hasFund && <button className="secondary-button" disabled={pudgeReadOnly || state.unresolved} onClick={() => beginOperation('close')}>{t('closePocket')}</button>}</div></section>}
        {identity && role === 'owner' && closed && state.hasFund && <section className="owner-actions late-funds"><div><h2>{t('lateFunds')}</h2><p>{formatCkb(funds)} CKB</p></div><button className="primary-button" disabled={pudgeReadOnly || state.unresolved} onClick={() => beginOperation('sweep')}>{t('sweep')} <span aria-hidden="true">→</span></button></section>}

        {identity && (role === 'alice' || role === 'ben') && activeDelegate && !closed && <section className="delegate-focus">
          <div className="delegate-focus-heading"><div><span className={`permission-dot ${activeDelegate.enabled ? '' : 'is-revoked'}`} aria-hidden="true"/><div><h2>{labelFor(activeDelegate.publicKey, role === 'alice' ? t('delegateOne') : t('delegateTwo'))}</h2>{descriptionFor(activeDelegate.publicKey) && <p>{descriptionFor(activeDelegate.publicKey)}</p>}</div></div><span className={activeDelegate.enabled ? 'permission-status' : 'permission-status is-revoked'}>{activeDelegate.enabled ? t('active') : t('revoked')}</span></div>
          <div className="delegate-summary"><div><span>{t('remaining')}</span><strong>{formatCkb(BigInt(activeDelegate.limit) > BigInt(activeDelegate.used) ? BigInt(activeDelegate.limit) - BigInt(activeDelegate.used) : 0n)} <i>CKB</i></strong><small>{formatCkb(activeDelegate.used)} {t('usedOf')} {formatCkb(activeDelegate.limit)} CKB</small></div><div><span>{t('maxPayment')}</span><strong>{formatCkb(activeDelegate.perPayment)} <i>CKB</i></strong><small>{t('perPaymentHint')}</small></div><div><span>{t('sharedRemaining')}</span><strong>{formatCkb(sharedRemaining)} <i>CKB</i></strong><small>{t('sharedAuthorityHint')}</small></div></div>
          <div className="approved-recipient"><span>{t('recipient')}</span><code dir="ltr" title={recipientAddress(activeDelegate.recipient)}>{recipientAddress(activeDelegate.recipient)}</code></div>
          {activeDelegate.enabled && <button className="primary-button pay-button" disabled={pudgeReadOnly || state.unresolved || !state.hasFund} onClick={() => beginOperation('pay', activeDelegate.role)}>{t('pay')} <span aria-hidden="true">→</span></button>}
          {!activeDelegate.enabled && <p className="revoked-message" role="status">{t('permissionRevokedMessage')}</p>}
        </section>}

        {identity && role === 'owner' && !closed && <section className="permissions-section"><div className="section-title"><div><h2>{t('delegatePermissions')}</h2><p>{t('sharedRelationship')}</p></div><span className="two-person-count">2</span></div>
          <div className="permission-list">{delegates.map((delegate, index) => {
            const fallback = index === 0 ? t('delegateOne') : t('delegateTwo');
            const name = labelFor(delegate.publicKey, fallback);
            const remaining = BigInt(delegate.limit) > BigInt(delegate.used) ? BigInt(delegate.limit) - BigInt(delegate.used) : 0n;
            return <article className="permission-row" key={delegate.role}>
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

        <section className="history-section"><div className="section-title"><div><h2>{t('history')}</h2></div>{history.some((item) => item.state === 'uncertain') && <button className="text-button" disabled={reconcileBusy || pudgeReadOnly} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button>}</div>
          {history.length ? <ol className="history-list">{[...history].reverse().slice(0, 8).map((item) => <HistoryRow item={item} key={item.id} locale={i18n.language} label={labelFor(item.actor, item.actor === state.owner ? t('owner') : t('participantEmpty'))} stateLabel={historyState(item.state)} explorer={explorerEnabled ? explorerUrl(item.tx_hash) : undefined} t={t}/>)}</ol> : <p className="empty-history">{t('noHistory')}</p>}
        </section>

        <details className="technical-footer"><summary>{t('technical')}</summary><div><p>{t('localDisclosure')}</p><dl><div><dt>{t('appIdentity')}</dt><dd><code dir="ltr">{state.genesis}</code></dd></div>{state.pocket && <div><dt>{t('policyId')}</dt><dd><code dir="ltr">{state.pocket}</code></dd></div>}{state.indexedTip && <div><dt>{t('indexerTip')}</dt><dd><code dir="ltr">{state.indexedTip.block_number} · {state.indexedTip.block_hash}</code></dd></div>}</dl></div></details>
      </main>
      : <main id="home" className="loading-page">{loadError ? <section className="load-error" role="alert"><h1>{t('loadError')}</h1><p>{localizedError(loadError, t)}</p><button className="primary-button" onClick={() => void refresh()}>{t('retry')}</button></section> : <p role="status">{t('loadingState')}</p>}</main>}

    {state && state.empty && <div className="fallback-link"><a href="/legacy" target="_blank" rel="noreferrer">{t('legacyHelp')} ↗</a></div>}
    {state && !state.empty && <footer className="app-footer"><span>{t('localDisclosure')}</span><a href="/legacy" target="_blank" rel="noreferrer">{t('legacyHelp')} ↗</a></footer>}
    {!state && <div className="fallback-link"><a href="/legacy" target="_blank" rel="noreferrer">{t('legacyHelp')} ↗</a></div>}

    {state && <OperationDialog intent={intent} prepared={prepared} state={state} identity={identity} delegates={delegates} history={history} recipientAddresses={recipientAddresses} working={working} error={operationError} onPrepare={prepareOperation} onSign={signPrepared} onConnectSigner={connectExpectedSigner} onClose={closeDialog}/>}
    {editPerson && <EditParticipantDialog participant={editPerson} initial={metadata[editPerson.publicKey]} onClose={() => setEditPerson(null)} onSave={saveName} t={t}/>}

    <AlertDialog.Root open={Boolean(pendingSigned)} onOpenChange={(open) => { if (!open && !working) discardPending(); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay"/><AlertDialog.Content className="dialog-content alert-dialog" aria-modal="true">
        <span className="dialog-symbol warning-symbol" aria-hidden="true">!</span><AlertDialog.Title className="dialog-title">{t('pudgeBroadcastTitle')}</AlertDialog.Title><AlertDialog.Description className="dialog-description">{t('pudgeBroadcastBody')}</AlertDialog.Description>
        {pendingSigned && <div className="signed-hash"><span>{t('txId')}</span><code dir="ltr">{pendingSigned.hash}</code></div>}
        <div className="dialog-actions"><AlertDialog.Cancel asChild><button className="secondary-button" disabled={working}>{t('discardSignature')}</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="primary-button" disabled={working || pudgeReadOnly} onClick={(event) => { event.preventDefault(); if (pendingSigned) void submitSigned(pendingSigned.transaction, pendingSigned.hash); }}>{working ? t('submitting') : t('sendToPudge')}</button></AlertDialog.Action></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}

function HistoryRow({ item, locale, label, stateLabel, explorer, t }: { item: HistoryItem; locale: string; label: string; stateLabel: string; explorer?: string; t: (key: string) => string }) {
  const operationLabel = item.operation === 'genesis' ? t('actionGenesis') : item.operation === 'pay' ? t('actionPay') : item.operation === 'deposit' ? t('actionDeposit') : item.operation === 'revoke' ? t('actionRevoke') : item.operation === 'close' ? t('actionClose') : item.operation === 'sweep' ? t('actionSweep') : item.operation;
  return <li className="history-row"><span className="history-symbol" aria-hidden="true">{item.operation === 'pay' ? '↗' : item.operation === 'deposit' ? '+' : item.operation === 'revoke' ? '−' : '◈'}</span><div className="history-description"><strong>{operationLabel}{item.operation === 'pay' || item.operation === 'deposit' || item.operation === 'close' || item.operation === 'sweep' ? ` · ${formatCkb(item.amount)} CKB` : ''}</strong><span>{label} · {new Intl.DateTimeFormat(locale === 'zh-Hans' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created))}</span></div><span className={`history-state ${item.state === 'uncertain' ? 'is-uncertain' : item.state === 'committed' ? 'is-confirmed' : ''}`}>{stateLabel}</span>{explorer ? <a className="history-link" href={explorer} target="_blank" rel="noreferrer" aria-label={`${t('explorer')}: ${item.tx_hash}`}>↗</a> : <code className="history-hash" title={item.tx_hash}>{shortHash(item.tx_hash, 10, 7)}</code>}</li>;
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
