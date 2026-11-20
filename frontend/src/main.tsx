import { PocketIndexSyncError, browserMode, creationScope, isCreationScope, demoPocket, browserHistory, readPendingCreation, requireBrowserPocket, readBrowserIntent, validateBeforeSigning, persistBrowserSignature, cancelBrowserIntent } from './browserPudge';
import { publicDiscoveryNetwork } from './publicDiscovery';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { Toaster, toast } from 'sonner';
import { Provider as CccProvider, ccc, useCcc } from '@ckb-ccc/connector-react';
import { useTranslation } from 'react-i18next';
import './i18n';
import './style.css';
import { formatCkb, progressPercent, shortHash } from './amount';
import { ApiError, cancelPreparation, checkPudgeTransaction, getActorPockets, getPocketState, prepareGenesis, prepareOwnerAction, preparePayment, reconcile, resolvePudgeTransaction, retryJournaledTransaction, submitTransaction } from './api';
import { CreationFlow, type People } from './CreationFlow';
import { importMetadata, loadMetadata, saveMetadata, exportMetadata } from './metadata';
import type { HistoryItem, PocketMetadata, PocketState, PreparedTransaction, TransactionResult, WalletIdentity } from './domain';
import { isTemporaryWalletError, isVerifiedPudgeContext, wallet, WalletProviderUnavailableError } from './wallet';
import { RegistrationPage } from './RegistrationPage';
import { PocketDiscoveryPage } from './PocketDiscoveryPage';
import { OperationDialog, type Intent, type Operation } from './OperationDialog';
import { PocketPicker } from './PocketPicker';
import { createPocketDraft, listPocketDrafts, pocketDraftIndexKey, removePocketDraft } from './drafts';
import { clearPaymentIntent, paymentRequestFromIntent, readSavedPaymentIntent, type SavedPaymentIntent } from './paymentIntent';

type ActorRole = 'owner' | 'alice' | 'ben' | 'unrecognized';
type SignedPending = { transaction: string; hash: string };
type TransactionNotice = { actor?: string; state: string; hash?: string; detail?: string; phase?: string; technicalError?: string; operation?: string; draftIndexKey?: string; draftId?: string };
type Participant = { publicKey: string; fallback: string; role: 'owner' | 'alice' | 'ben' };
const PENDING_TRANSACTION_KEY = 'quotacell.pending-pudge-transaction';

function restorePendingTransaction(): TransactionNotice | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_TRANSACTION_KEY) || 'null') as TransactionNotice | null;
    return value && /^0x[0-9a-f]{64}$/i.test(value.hash || '') ? value : null;
  } catch { return null; }
}

function removeConfirmedGenesisDraft(notice: TransactionNotice) {
  if (notice.operation !== 'genesis' || !notice.draftIndexKey || !notice.draftId) return true;
  try { removePocketDraft(notice.draftIndexKey, notice.draftId); return true; }
  catch { return false; }
}

function actorRole(identity: WalletIdentity | null, state: PocketState | null): ActorRole | null {
  if (!identity || !state || state.empty || state.discovery || state.connectRequired) return null;
  if (state.owner?.toLowerCase() === identity.publicKey.toLowerCase()) return 'owner';
  return state.delegates?.find((delegate) => delegate.publicKey && delegate.publicKey.toLowerCase() === identity.publicKey.toLowerCase())?.role || 'unrecognized';
}

function localizedError(message: string, t: (key: string) => string): string {
  const rules: Array<[RegExp, string]> = [
    [/preparation is taking longer than expected/i, 'preparationStillProcessing'],
    [/pocket backend|failed to fetch|networkerror|invalid response|empty response|unexpected end of json/i, 'backendUnavailable'],
    [/wallet disconnected|not connected|connect again/i, 'walletDisconnectedError'],
    [/only the UTXO Global|verified UTXO Global/i, 'unsupportedWalletError'],
    [/CKB secp256k1|signing scheme/i, 'signingSchemeError'],
    [/wrong wallet network|CKB testnet is required|select CKB testnet/i, 'wrongNetworkError'],
    [/Pudge testnet could not be verified/i, 'pudgeContextUnverified'],
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
    [/signing request ID was reused|parameters changed|request belongs to another Pocket/i, 'preparationParametersChanged'],
    [/already has a signed transaction outcome/i, 'unresolvedBody'],
    [/payment exceeds|allowance|maximum per payment|personal.*limit/i, 'paymentBoundsError'],
    [/not live|stale|expired/i, 'inputChangedError'],
  ];
  const found = rules.find(([pattern]) => pattern.test(message));
  return found ? t(found[1]) : `${t('actionFailed')} ${message}`;
}

function localizedConnectionError(error: unknown, t: (key: string) => string): string {
  if (error instanceof WalletProviderUnavailableError) return t('walletProviderMissing');
  const message = error instanceof Error ? error.message : String(error);
  if (/User rejected|rejected.*wallet|canceled/i.test(message)) return t('walletConnectionCanceledError');
  return localizedError(message, t);
}

function App() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<PocketState | null>(null);
  const lastGoodState = useRef<PocketState | null>(null);
  const refreshInFlight = useRef<Promise<PocketState | null> | null>(null);
  const refreshInFlightActor = useRef<string | null>(null);
  const [stateStale, setStateStale] = useState(false);
  const [waitingForIndex, setWaitingForIndex] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [stateActor, setStateActor] = useState<string | null>(null);
  const stateActorRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const refreshScope = useRef({ actor: identity?.publicKey ?? null, generation: 0 });
  useLayoutEffect(() => {
    refreshScope.current = { actor: identity?.publicKey ?? null, generation: refreshScope.current.generation + 1 };
  }, [identity?.publicKey]);

  const [identityError, setIdentityError] = useState('');
  const [walletBusy, setWalletBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [resumePayment, setResumePayment] = useState<SavedPaymentIntent | null>(() => readSavedPaymentIntent());
  const [prepared, setPrepared] = useState<PreparedTransaction | null>(null);
  const [working, setWorking] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [rawTransactionNotice, setTransactionNotice] = useState<TransactionNotice | null>(() => restorePendingTransaction());
  const transactionNotice = browserMode && rawTransactionNotice?.operation === 'genesis' &&
    (!identity || rawTransactionNotice.actor !== identity.publicKey.toLowerCase()) ? null : rawTransactionNotice;
  const [pendingSigned, setPendingSigned] = useState<SignedPending | null>(null);
  const [pendingPeople, setPendingPeople] = useState<People | null>(null);
  const [showCreation, setShowCreation] = useState(false);
  const [showPocketList, setShowPocketList] = useState(false);
  const [selectedPocketId, setSelectedPocketId] = useState(() => new URLSearchParams(window.location.search).get('pocket') || '');
  const [selectedPocketLoading, setSelectedPocketLoading] = useState(false);
  const [selectedPocketError, setSelectedPocketError] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [activeDraftOwner, setActiveDraftOwner] = useState('');
  const [draftVersion, setDraftVersion] = useState(0);
  const [pocketChoices, setPocketChoices] = useState<NonNullable<PocketState['discovery']>>([]);
  const [pocketListLoading, setPocketListLoading] = useState(false);
  const [pocketListError, setPocketListError] = useState('');
  const [metadata, setMetadata] = useState<PocketMetadata>({});
  const [recipientAddresses, setRecipientAddresses] = useState<Record<string, string>>({});
  const [editPerson, setEditPerson] = useState<Participant | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [noticeCheckBusy, setNoticeCheckBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    const actor = identity?.publicKey ?? null;
    const route = location.search;
    const scope = refreshScope.current;
    const current = () => refreshScope.current === scope && scope.actor === actor && location.search === route;
    if (!current()) return null;
    const refreshKey = JSON.stringify([scope.generation, actor, route]);
    if (refreshInFlightActor.current === refreshKey && refreshInFlight.current) return refreshInFlight.current;
    if (!quiet) setRefreshing(true);
    const task = (async (): Promise<PocketState | null> => {
      try {
        let next: PocketState;
        const routePocket = new URLSearchParams(window.location.search).get('pocket')?.toLowerCase();
        for (let attempt = 0; ; attempt++) {
          if (!current()) return null;
          try {
            next = await getPocketState(actor ?? undefined);
          } catch (cause) {
            if (attempt >= 2 || !(cause instanceof ApiError) || !cause.retryable || cause.timedOut) throw cause;
            await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
            continue;
          }
          const selectionMatches = !actor || !routePocket || (!next.empty && !next.connectRequired && next.pocket?.toLowerCase() === routePocket);
          if (!selectionMatches && attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
            continue;
          }
          break;
        }
        if (!current()) return null;
        if (next.creationRecovery && lastGoodState.current && !lastGoodState.current.creationRecovery) {
          setStateStale(true);
          return null;
        }
        const selectionMatches = !actor || !routePocket || (!next.empty && !next.connectRequired && next.pocket?.toLowerCase() === routePocket);
        if (!selectionMatches && lastGoodState.current?.pocket?.toLowerCase() === routePocket && stateActorRef.current === actor?.toLowerCase()) {
          setStateStale(true);
          return null;
        }
        lastGoodState.current = next;
        setState(next);
        stateActorRef.current = actor?.toLowerCase() ?? null;
        setStateActor(stateActorRef.current);
        setStateStale(false);
        setWaitingForIndex(false);
        setLoadError('');
        return next;
      } catch (cause) {
        if (!current()) return null;
        setWaitingForIndex(cause instanceof PocketIndexSyncError);
        const message = cause instanceof Error ? cause.message : String(cause);
        if (actor && stateActorRef.current !== actor.toLowerCase()) {
          setState(null);
          stateActorRef.current = null;
          setStateActor(null);
          setLoadError(message);
        } else if (lastGoodState.current && stateActorRef.current === actor?.toLowerCase() &&
          lastGoodState.current.pocket === new URLSearchParams(route).get('pocket')) setStateStale(true);
        else { setState(null); setLoadError(message); }
        return null;
      } finally {
        if (refreshInFlightActor.current === refreshKey) {
          refreshInFlight.current = null;
          refreshInFlightActor.current = null;
          if (current()) setRefreshing(false);
        }
      }
    })();
    refreshInFlight.current = task;
    refreshInFlightActor.current = refreshKey;
    return task;
  }, [identity?.publicKey]);

  useEffect(() => {
    let active = true;
    let timer: number;
    let failures = 0;
    const update = async (quiet: boolean) => {
      const result = await refresh(quiet);
      if (!active) return;
      failures = result ? 0 : failures + 1;
      const delay = failures && browserMode
        ? Math.min(2000 * 2 ** Math.min(failures - 1, 4), 30000) + Math.random() * 500
        : 60000;
      timer = window.setTimeout(() => void update(true), delay);
    };
    void update(false);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!browserMode || !state?.genesis) return;
    const onStorage = (event: StorageEvent) => {
      const pocket = new URLSearchParams(location.search).get('pocket')?.toLowerCase();
      if (pocket && event.key === 'quotacell.browser.v1:' + state.genesis + ':' + pocket) {
        setStateStale(true);
        void refresh(true);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh, state?.genesis]);
  const loadSelectedPocket = useCallback(async (pocket: string) => {
    const scope = refreshScope.current;
    const current = () => refreshScope.current === scope &&
      new URLSearchParams(location.search).get('pocket')?.toLowerCase() === pocket.toLowerCase();
    setSelectedPocketLoading(true);
    setSelectedPocketError(false);
    try {
      const result = await refresh();
      const routePocket = new URLSearchParams(window.location.search).get('pocket');
      if (!current() || routePocket?.toLowerCase() !== pocket.toLowerCase()) return;
      if (!result || result.connectRequired || result.pocket?.toLowerCase() !== pocket.toLowerCase()) {
        const hasLastGood = stateActorRef.current === identity?.publicKey.toLowerCase() && lastGoodState.current?.pocket?.toLowerCase() === pocket.toLowerCase();
        setStateStale(hasLastGood);
        setSelectedPocketError(!hasLastGood);
      }
    } catch {
      if (current()) {
        const hasLastGood = stateActorRef.current === identity?.publicKey.toLowerCase() && lastGoodState.current?.pocket?.toLowerCase() === pocket.toLowerCase();
        setStateStale(hasLastGood);
        setSelectedPocketError(!hasLastGood);
      }
    } finally {
      if (current()) setSelectedPocketLoading(false);
    }
  }, [identity?.publicKey, refresh]);
  useEffect(() => {
    if (!selectedPocketId || (!identity && !browserMode)) return;
    if (state?.pocket?.toLowerCase() === selectedPocketId.toLowerCase() && !state.connectRequired) {
      setSelectedPocketLoading(false);
      setSelectedPocketError(false);
      return;
    }
    void loadSelectedPocket(selectedPocketId);
  }, [identity?.publicKey, loadSelectedPocket, selectedPocketId, state?.connectRequired, state?.pocket]);
  useEffect(() => {
    let active = true;
    let checking = false;
    const restoreSession = async () => {
      if (checking || !wallet.connectorReady) return;
      checking = true;
      setWalletBusy(true);
      try {
        const restored = await wallet.restore();
        if (!active) return;
        if (restored) {
          setIdentity(restored);
          setIdentityError('');
          setLoadError('');
        } else if (!wallet.hasSigner) {
          setIdentity(null);
        }
      } finally {
        checking = false;
        if (active) setWalletBusy(false);
      }
    };
    const unsubscribe = wallet.subscribe(() => {
      if (!wallet.hasSigner) {
        setIdentity(null);
        setWalletBusy(false);
        return;
      }
      void restoreSession();
    });
    void restoreSession();
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!transactionNotice?.hash) return;
    try {
      sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(transactionNotice));
    } catch { /* Session storage is optional; the notice remains visible in this tab. */ }
  }, [transactionNotice]);

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
          setLoadError('');
        }
      } catch (cause) {
        if (!active) return;
        if (isTemporaryWalletError(cause)) {
          setIdentityError(t('walletCheckTemporary'));
          return;
        }
        setIdentity(null);
        setIdentityError(localizedConnectionError(cause, t));
      } finally { checking = false; }
    };
    const stopWatching = wallet.onAccountOrNetworkChange(() => window.setTimeout(() => void syncIdentity(), 0));
    const onFocus = () => void syncIdentity();
    const onVisible = () => { if (document.visibilityState === 'visible') void syncIdentity(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    void syncIdentity();
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
      const client = new ClientPublicTestnet({ url: browserMode ? publicDiscoveryNetwork.rpc : `${window.location.origin}/api/ckb`, fallbacks: [] });
      const addresses = Object.fromEntries((snapshot.delegates || []).filter((item) => item.recipient).map((item) => [item.recipient, Address.fromScript({ codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: item.recipient }, client).toString()]));
      if (!canceled) setRecipientAddresses(addresses);
    }).catch(() => { if (!canceled) setRecipientAddresses({}); });
    return () => { canceled = true; };
  }, [state?.genesis, state?.pocket, state?.delegates]);

  useEffect(() => {
    if (!pendingPeople || !state?.pocket || !state.genesis || state.empty) return;
    const people = [pendingPeople.owner, pendingPeople.alice, pendingPeople.ben];
    const next: PocketMetadata = { ...metadata };
    for (const person of people) if (person?.publicKey) next[person.publicKey] = { name: person.name.trim(), description: person.description.trim() };
    try { saveMetadata(state.genesis, state.pocket, next); setMetadata(next); setPendingPeople(null); }
    catch { setTransactionNotice({ state: 'metadata', detail: t('metadataSaveError') }); }
  }, [pendingPeople, state?.pocket, state?.genesis, state?.empty]);

  const role = useMemo(() => actorRole(identity, state), [identity, state]);
  const draftIndexKey = identity && state?.genesis ? pocketDraftIndexKey(state.genesis, identity.publicKey) : '';
  const savedDrafts = useMemo(() => draftIndexKey ? listPocketDrafts(draftIndexKey) : [], [draftIndexKey, draftVersion]);
  const activeDraftKey = draftIndexKey && activeDraftId ? `${draftIndexKey}:draft:${activeDraftId}` : '';
  const delegates = state?.delegates || [];
  const activeDelegate = role === 'alice' || role === 'ben' ? delegates.find((delegate) => delegate.role === role) : undefined;
  const funds = BigInt(state?.fundShannons || 0);
  const occupied = BigInt(state?.fundOccupiedShannons || 0);
  const available = !stateStale && funds > occupied ? funds - occupied : 0n;
  const sharedLimit = BigInt(state?.sharedLimit || 0);
  const sharedUsed = BigInt(state?.sharedUsed || 0);
  const sharedRemaining = sharedLimit > sharedUsed ? sharedLimit - sharedUsed : 0n;
  const closed = Boolean(state?.closed);
  const unsupported = state?.unsupportedFunds || [];
  const [chainHistory, setChainHistory] = useState<{ pocket: string; rows?: HistoryItem[]; failed?: boolean }>();
  const historyPocket = state?.pocket;
  const historyPolicy = state?.historyPolicy?.txHash;
  const historyTip = state?.indexedTip?.block_hash;
  useEffect(() => {
    if (!browserMode || !state || !historyPocket || !historyPolicy) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout>;
    const query = async () => {
      try {
        const rows = await browserHistory(state);
        if (active) setChainHistory({ pocket: historyPocket, rows });
      } catch {
        if (active) {
          setChainHistory(current => ({ pocket: historyPocket, rows: current?.pocket === historyPocket ? current.rows : undefined, failed: true }));
          retry = setTimeout(query, 10000);
        }
      }
    };
    void query();
    return () => { active = false; clearTimeout(retry); };
  }, [historyPocket, historyPolicy, historyTip]);
  const currentHistory = chainHistory?.pocket === historyPocket ? chainHistory : undefined;
  const confirmed = currentHistory?.rows || [];
  const confirmedHashes = new Set(confirmed.map(item => item.tx_hash.toLowerCase()));
  const history = browserMode
    ? [...confirmed, ...(state?.history || []).filter(item => !confirmedHashes.has(item.tx_hash.toLowerCase()))]
    : state?.history || [];
  const [pocketInput, setPocketInput] = useState('');
  const [invalidPocketInput, setInvalidPocketInput] = useState(false);
  const pudge = Boolean(state?.networkMode?.startsWith('pudge'));
  const pudgeReadOnly = state?.networkMode === 'pudge-readonly';
  const pudgePrepareOnly = state?.networkMode === 'pudge-prepare-only';
  const pudgeActionsDisabled = pudgeReadOnly || pudgePrepareOnly;
  const retryableIntent = Boolean(!browserMode && identity && pudge && !pudgeActionsDisabled && transactionNotice?.hash && history.some((item) => {
    if (item.tx_hash.toLowerCase() !== transactionNotice.hash?.toLowerCase() || !['uncertain', 'submitted'].includes(item.state) || item.phase?.startsWith('retry-')) return false;
    return item.operation === 'deposit'
      ? role === 'owner' && item.actor.toLowerCase() === identity.publicKey.toLowerCase()
      : item.operation === 'pay' && (role === 'alice' || role === 'ben') && item.actor.toLowerCase() === identity.publicKey.toLowerCase();
  }));
  const explorerEnabled = pudge;
  const noticeRecorded = Boolean(transactionNotice?.hash && history.some((item) => item.tx_hash.toLowerCase() === transactionNotice.hash?.toLowerCase()));
  const clientTransactionUnresolved = Boolean(!browserMode && transactionNotice?.hash && (
    ['uncertain', 'pending', 'proposed', 'submitted'].includes(transactionNotice.state) ||
    (transactionNotice.state === 'committed' && !noticeRecorded)
  ));
  const actionsBlocked = Boolean(stateStale || state?.unresolved || clientTransactionUnresolved);
  const depositBlocked = Boolean(stateStale || clientTransactionUnresolved || state?.unresolved && !state.depositMayPrepare);

  const labelFor = (publicKey: string | undefined, fallback: string) => metadata[publicKey || '']?.name?.trim() || fallback;
  const descriptionFor = (publicKey: string | undefined) => metadata[publicKey || '']?.description?.trim() || '';
  const recipientAddress = (args: string) => recipientAddresses[args] || args;
  const participants: Participant[] = [
    ...(state?.owner ? [{ publicKey: state.owner, fallback: t('owner'), role: 'owner' as const }] : []),
    ...delegates.filter((delegate) => Boolean(delegate.publicKey)).map((delegate, index) => ({ publicKey: delegate.publicKey, fallback: index === 0 ? t('delegateOne') : t('delegateTwo'), role: delegate.role })),
  ];

  useEffect(() => {
    if (!resumePayment || !identity || !state?.pocket || state.pocket.toLowerCase() !== resumePayment.pocket.toLowerCase()) return;
    const delegate = state.delegates?.find((item) => item.role === resumePayment.role);
    if (!delegate?.enabled || delegate.publicKey.toLowerCase() !== resumePayment.publicKey.toLowerCase()
      || delegate.recipient.toLowerCase() !== resumePayment.recipient.toLowerCase()
      || identity.publicKey.toLowerCase() !== resumePayment.publicKey.toLowerCase()) return;
    setIntent((current) => current || { operation: 'pay', role: resumePayment.role });
  }, [identity?.publicKey, resumePayment, state?.pocket, state?.delegates]);

  const connectWallet = async () => {
    setWalletBusy(true); setIdentityError('');
    try {
      const connected = await wallet.connect();
      const context = await getPocketState();
      if (context.networkMode?.startsWith('pudge') && !isVerifiedPudgeContext(context, selectedPocketId)) throw new Error('Pudge testnet could not be verified.');
      setIdentity(connected); setLoadError('');
    }
    catch (cause) { setIdentityError(localizedConnectionError(cause, t)); if (!isTemporaryWalletError(cause)) setIdentity(null); }
    finally { setWalletBusy(false); }
  };
  const connectParticipant = async () => {
    wallet.disconnect(); setIdentity(null); setWalletBusy(true); setIdentityError(''); setLoadError('');
    try { const connected = await wallet.connect(); setIdentity(connected); return connected; }
    catch (cause) { const translated = localizedConnectionError(cause, t); setIdentityError(translated); wallet.disconnect(); throw new Error(translated); }
    finally { setWalletBusy(false); }
  };
  const connectExpectedSigner = async (expectedPublicKey: string) => {
    wallet.disconnect(); setIdentity(null); setWalletBusy(true); setIdentityError(''); setLoadError('');
    try {
      const connected = await wallet.connect();
      if (connected.publicKey.toLowerCase() !== expectedPublicKey.toLowerCase()) throw new Error(t('signerMismatch'));
      setIdentity(connected); setLoadError('');
    } catch (cause) {
      wallet.disconnect();
      throw new Error(localizedConnectionError(cause, t));
    } finally { setWalletBusy(false); }
  };
  const copyPocketId = async () => {
    if (!state?.pocket) return;
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ pocket: state.pocket }).toString();
    try { await navigator.clipboard.writeText(url.toString()); toast.success(t('pocketLinkCopied')); }
    catch { toast.error(t('clipboardWriteFailed')); setIdentityError(url.toString()); }
  };

  const beginOperation = (operation: Operation, selectedRole?: 'alice' | 'ben', displayName?: string) => {
    setOperationError(''); setPrepared(null); setIntent({ operation, role: selectedRole, displayName });
  };
  const prepareOperation = async (body: Record<string, unknown>) => {
    if (!intent || !identity) throw new Error(t('connect'));
    if (intent.operation === 'deposit' ? depositBlocked : actionsBlocked) throw new Error(t('unresolvedBody'));
    setWorking(true); setOperationError('');
    try {
      const request = intent.operation === 'pay' ? await preparePayment(body) : await prepareOwnerAction(body);
      setPrepared(request);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const localized = localizedError(message, t);
      setOperationError(cause instanceof ApiError && localized.startsWith(`${t('actionFailed')} `) ? t('preparationFailed') : localized);
    } finally { setWorking(false); }
  };

  const cancelPaymentPreparation = async (saved: SavedPaymentIntent) => {
    setWorking(true); setOperationError('');
    try {
      const result = await cancelPreparation(paymentRequestFromIntent(saved), 'payment');
      if (!['cancelled', 'expired', 'failed', 'not-found'].includes(result.state)) throw new Error(t('preparationCancelPending'));
      clearPaymentIntent();
      setResumePayment(null);
      setPrepared(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(localizedError(message, t));
    } finally { setWorking(false); }
  };

  const prepareCreation = async (body: unknown, people: People) => {
    if (stateStale) throw new Error(t('stateRefreshPaused'));
    if (state?.unresolved || clientTransactionUnresolved) throw new Error(t('unresolvedBody'));
    if (state?.multiPocket !== true) throw new Error(t('creationUnavailable'));
    if (pudgeReadOnly) throw new Error(t('readonlyAction'));
    setWorking(true); setOperationError('');
    try {
      const request = await prepareGenesis(body);
      setPendingPeople(people);
      setPrepared(request);
      setIntent({ operation: 'genesis' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const localized = localizedError(message, t);
      if (cause instanceof ApiError) throw new ApiError(localized, cause.retryable, cause.status, cause.timedOut);
      throw new Error(localized);
    } finally { setWorking(false); }
  };

  const openPocketList = async () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('pocket')) {
      url.searchParams.delete('pocket');
      window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setSelectedPocketId('');
    setSelectedPocketLoading(false);
    setSelectedPocketError(false);
    setStateStale(false);
    setShowCreation(false); setShowPocketList(true); setPocketListError('');
    if (browserMode) { setShowPocketList(false); void refresh(); return; }
    if (!identity) { setPocketListError(t('connectToSeeActions')); return; }
    setPocketListLoading(true);
    try {
      const result = await getActorPockets(identity.publicKey);
      setPocketChoices(result.discovery || []);
    } catch { setPocketListError(t('pocketListError')); }
    finally { setPocketListLoading(false); }
  };
  const startNewDraft = () => {
    if (!identity || !state?.genesis) { setIdentityError(t('connectToSeeActions')); return; }
    try {
      const indexKey = pocketDraftIndexKey(state.genesis, identity.publicKey);
      const id = createPocketDraft(indexKey);
      setActiveDraftId(id); setActiveDraftOwner(identity.publicKey.toLowerCase()); setShowPocketList(false); setShowCreation(true);
    } catch { setIdentityError(t('draftSaveError')); }
  };
  const resumeDraft = (draftId: string) => {
    if (!identity || !draftIndexKey || !savedDrafts.some((draft) => draft.id === draftId)) return;
    setActiveDraftId(draftId); setActiveDraftOwner(identity.publicKey.toLowerCase()); setShowPocketList(false); setShowCreation(true);
  };
  const discardDraft = (draftId: string) => {
    if (!draftIndexKey || !savedDrafts.some((draft) => draft.id === draftId)) return false;
    try { removePocketDraft(draftIndexKey, draftId); setDraftVersion((version) => version + 1); return true; }
    catch { toast.error(t('draftRemoveError')); return false; }
  };
  const openSelectedPocket = (pocket: string) => {
    if (!/^0x[0-9a-f]{64}$/i.test(pocket)) return;
    const params = new URLSearchParams(window.location.search);
    params.set('pocket', pocket);
    const nextUrl = `${window.location.pathname}?${params}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, '', nextUrl);
    setSelectedPocketId(pocket);
    setShowPocketList(false); setPocketListError(''); setLoadError('');
    setSelectedPocketLoading(true);
    setSelectedPocketError(false);
    setStateStale(false);
  };
  useEffect(() => {
    const onPopState = () => {
      const pocket = new URLSearchParams(window.location.search).get('pocket') || '';
      setSelectedPocketId(pocket);
      setSelectedPocketLoading(Boolean(pocket && identity));
      setSelectedPocketError(false);
      setStateStale(false);
      setShowCreation(false);
      setActiveDraftId('');
      if (pocket) {
        setShowPocketList(false);
        return;
      }
      if (browserMode) { setShowPocketList(false); void refresh(); return; }
      if (!identity) return;
      setShowPocketList(true);
      setPocketListError('');
      setPocketListLoading(true);
      void getActorPockets(identity.publicKey).then((result) => setPocketChoices(result.discovery || []))
        .catch(() => setPocketListError(t('pocketListError')))
        .finally(() => setPocketListLoading(false));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [identity?.publicKey, refresh, t]);
  useEffect(() => {
    if (!showCreation || !identity || !activeDraftOwner || identity.publicKey.toLowerCase() === activeDraftOwner) return;
    setShowCreation(false); setActiveDraftId(''); setShowPocketList(true); setPocketListError(t('draftOwnerChanged'));
    setPocketChoices([]); setPocketListLoading(true);
    void getActorPockets(identity.publicKey).then((result) => setPocketChoices(result.discovery || [])).catch(() => setPocketListError(t('pocketListError'))).finally(() => setPocketListLoading(false));
  }, [identity?.publicKey, showCreation, activeDraftOwner, t]);

  const submitSigned = async (transaction: string, hash?: string, reviewed = prepared, pocket = browserMode ? reviewed?.journalScope || requireBrowserPocket() : undefined) => {
    if (pudgePrepareOnly) { setOperationError(t('prepareOnlyNotice')); return; }
    if (!reviewed) return;
    if (browserMode) {
      try {
        const current = await wallet.identity();
        if (current.publicKey.toLowerCase() !== reviewed.publicKey.toLowerCase() || !isCreationScope(pocket) && pocket !== requireBrowserPocket()) throw new Error(t('signerMismatch'));
      } catch (cause) { setOperationError(localizedConnectionError(cause, t)); return; }
    }
    const draftReference = intent?.operation === 'genesis' && activeDraftId && draftIndexKey ? { draftIndexKey, draftId: activeDraftId } : {};
    if (pudge && hash) {
      const notice: TransactionNotice = { state: 'pending', hash, detail: t('submitting'), operation: intent?.operation, ...draftReference, actor: reviewed.publicKey.toLowerCase() };
      try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
      setTransactionNotice(notice);
      if (!browserMode) toast.loading(t('submitting'), { id: 'quotacell-transaction-submit' });
    }
    setWorking(true); setOperationError('');
    try {
      let result: TransactionResult;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await submitTransaction(reviewed.id, transaction, hash ? {
            hash, publicKey: reviewed.publicKey, verifySigner: async () => {
              if (!isCreationScope(pocket) && pocket !== requireBrowserPocket()) throw new Error(t('signerMismatch'));
              return (await wallet.identity()).publicKey;
            },
          } : undefined, pocket);
          break;
        } catch (cause) {
          if (!(cause instanceof ApiError) || !cause.retryable || attempt >= 1) throw cause;
          if (!browserMode) toast.loading(t('recoveringSubmission'), { id: 'quotacell-transaction-submit' });
          await new Promise<void>((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
        }
      }
      const resultHash = result.txHash || hash;
      let checkedOutcome: Awaited<ReturnType<typeof resolvePudgeTransaction>> | undefined;
      if (pudge && result.state === 'uncertain' && resultHash) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await new Promise<void>((resolve) => window.setTimeout(resolve, 800 * attempt));
          try {
            const checked = await resolvePudgeTransaction(resultHash, reviewed.publicKey);
            if (checked.status !== 'uncertain' && checked.status !== 'unknown') {
              checkedOutcome = checked;
              break;
            }
          } catch { /* Keep the journaled result visible when Pudge cannot answer yet. */ }
        }
      if (checkedOutcome) result = { ...result, state: checkedOutcome.status, reason: checkedOutcome.reason, notSent: checkedOutcome.status === 'not-sent', pocket: checkedOutcome.pocket || result.pocket };
      }
      const notSent = result.notSent === true || result.state === 'not-sent';
      const preBroadcastFailure = notSent || ['network-check', 'pocket-check', 'input-fee-check', 'dry-run', 'pool-admission'].includes(result.phase || '');
      const detail = notSent && result.phase === 'signing-request' ? t('signingRequestExpired')
        : preBroadcastFailure ? t('transactionNotSent')
        : result.state === 'committed' ? t('transactionConfirmed')
          : ['pending', 'proposed', 'submitted'].includes(result.state) ? t('transactionSubmitted')
            : result.state === 'rejected' ? t('transactionRejected') : t('submitUnknown');
      const notice: TransactionNotice = { state: notSent ? 'not-sent' : preBroadcastFailure ? 'error' : result.state, hash: notSent ? undefined : resultHash, phase: result.phase, detail, technicalError: result.error || result.reason, operation: intent?.operation, ...draftReference, actor: reviewed.publicKey.toLowerCase() };
      if (notice.state === 'committed' && !removeConfirmedGenesisDraft(notice)) toast.warning(t('draftCleanupError'));
      setTransactionNotice(notice);
      if (notSent) { try { sessionStorage.removeItem(PENDING_TRANSACTION_KEY); } catch { /* Session storage is optional. */ } }
      else if (notice.hash) try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
      const toastOptions = { id: 'quotacell-transaction-submit' };
      if (!browserMode) {
      if (notSent) toast.error(detail, toastOptions);
      else if (preBroadcastFailure) toast.error(t('transactionNotSent'), toastOptions);
      else if (result.state === 'committed') toast.success(t('transactionConfirmed'), toastOptions);
      else if (['pending', 'proposed', 'submitted'].includes(result.state)) toast.info(t('transactionSubmitted'), toastOptions);
      else if (result.state === 'rejected') toast.error(t('transactionRejected'), toastOptions);
      else toast.warning(t('submitUnknown'), toastOptions);
      }
      setPrepared(null); setIntent(null); setPendingSigned(null);
      if (intent?.operation === 'genesis' && result.state === 'committed' && result.pocket) {
        window.history.replaceState(null, '', `${window.location.pathname}?${new URLSearchParams({ pocket: result.pocket })}`);
        if (browserMode) setSelectedPocketId(result.pocket);
        setShowCreation(false); setActiveDraftId(''); setShowPocketList(false);
      }
      await refresh(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      let resolved: Awaited<ReturnType<typeof resolvePudgeTransaction>> | undefined;
      if (pudge && hash) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await new Promise<void>((resolve) => window.setTimeout(resolve, 800 * attempt));
          try {
            const checked = await resolvePudgeTransaction(hash, identity?.publicKey);
            if (checked.status !== 'uncertain' && checked.status !== 'unknown') { resolved = checked; break; }
          } catch { /* Leave the result unresolved if Pudge is temporarily unavailable. */ }
        }
      }
      if (resolved?.status === 'not-sent') {
        const notice: TransactionNotice = { state: 'not-sent', phase: 'signing-request', detail: t('transactionNotSent'), operation: intent?.operation };
        setTransactionNotice(notice);
        try { sessionStorage.removeItem(PENDING_TRANSACTION_KEY); } catch { /* Session storage is optional. */ }
        toast.info(t('transactionNotSent'), { id: 'quotacell-transaction-submit' });
        setPrepared(null); setIntent(null); setPendingSigned(null);
        await refresh(true);
        return;
      }
      if (resolved && hash) {
        const detail = resolved.status === 'committed' ? t('transactionConfirmed')
          : ['pending', 'proposed'].includes(resolved.status) ? t('transactionSubmitted')
            : t('transactionRejected');
        const notice: TransactionNotice = { state: resolved.status, hash, detail, technicalError: resolved.reason, operation: intent?.operation, ...draftReference, actor: reviewed.publicKey.toLowerCase() };
        if (notice.state === 'committed' && !removeConfirmedGenesisDraft(notice)) toast.warning(t('draftCleanupError'));
        setTransactionNotice(notice);
        try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
        if (!browserMode && resolved.status === 'committed') toast.success(detail, { id: 'quotacell-transaction-submit' });
        else if (!browserMode && resolved.status === 'rejected') toast.error(detail, { id: 'quotacell-transaction-submit' });
        else if (!browserMode) toast.info(detail, { id: 'quotacell-transaction-submit' });
        setPrepared(null); setIntent(null); setPendingSigned(null);
        await refresh(true);
        return;
      }
      const notice: TransactionNotice = { state: 'uncertain', hash, phase: 'submit', detail: t('submitUnknown'), technicalError: message, operation: intent?.operation, ...draftReference, actor: reviewed.publicKey.toLowerCase() };
      setTransactionNotice(notice);
      if (notice.hash) try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
      if (!browserMode) toast.warning(t('submitUnknown'), { id: 'quotacell-transaction-submit' });
      setOperationError(localizedError(message, t));
      setPrepared(null); setIntent(null); setPendingSigned(null);
      await refresh(true);
    } finally { setWorking(false); }
  };

  useEffect(() => {
    if (!browserMode || !state) return;
    const creation = !state.pocket && identity && readPendingCreation(identity.publicKey);
    if (creation && creation.ownerRequest?.draftId && creation.state === 'committed' && creation.targetPocket &&
        listPocketDrafts(draftIndexKey).some(draft => draft.id === creation.ownerRequest?.draftId)) {
      if (removeConfirmedGenesisDraft({ state: 'committed', operation: 'genesis', draftIndexKey, draftId: creation.ownerRequest.draftId })) {
        openSelectedPocket(creation.targetPocket);
        return;
      }
    }
    const stored = identity && readBrowserIntent(state.pocket || creationScope, identity.publicKey.toLowerCase());
    if (prepared?.journalScope && isCreationScope(prepared.journalScope) && prepared.publicKey !== identity?.publicKey.toLowerCase()) {
      setPrepared(null);
      setPendingSigned(null);
      setIntent(null);
      setShowCreation(false);
    }
    if (stored && stored.signed) {
      setIntent({ operation: stored.operation || 'pay', role: stored.ownerRequest?.role || stored.payment.role });
      setPrepared(stored.prepared);
      setPendingSigned({ transaction: stored.signed, hash: stored.hash });
    }
    const pending = state.history?.find(item => item.state === 'uncertain' && (item.operation !== 'genesis' || item.actor.toLowerCase() === identity?.publicKey.toLowerCase()));
    if (pending) setTransactionNotice(current => current?.hash === pending.tx_hash && current.actor === pending.actor.toLowerCase() ? current : {
      actor: pending.actor.toLowerCase(), state: 'uncertain', hash: pending.tx_hash, detail: t('statusUncertain'), operation: pending.operation,
      ...(creation && creation.hash === pending.tx_hash && creation.ownerRequest?.draftId ? { draftId: creation.ownerRequest.draftId, draftIndexKey } : {}),
    });
  }, [identity?.publicKey, state?.pocket, state?.unresolved, draftIndexKey]);

  const signPrepared = async (request: PreparedTransaction) => {
    if (stateStale) { setOperationError(t('stateRefreshPaused')); return; }
    if (pudgePrepareOnly) { setOperationError(t('prepareOnlyNotice')); return; }
    setWorking(true); setOperationError('');
    try {
      if (!identity || request.publicKey.toLowerCase() !== identity.publicKey.toLowerCase()) throw new Error(t('signerMismatch'));
      const pocket = browserMode ? request.journalScope || requireBrowserPocket() : undefined;
      const { Transaction } = await import('@ckb-ccc/connector');
      const approvedHash = Transaction.fromBytes(request.transaction).hash();
      if (pocket) await validateBeforeSigning(pocket, request);
      const signed = await wallet.sign(request.transaction, request.publicKey);
      const hash = Transaction.fromBytes(signed).hash();
      if (pocket) {
        if (approvedHash !== hash) throw new Error('Wallet altered transaction');
        await persistBrowserSignature(pocket, request.id, signed);
      }
      if (intent?.operation === 'pay') { clearPaymentIntent(); setResumePayment(null); }
      if (pocket) {
        await submitSigned(signed, approvedHash, request, pocket);
        return;
      }
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

  const discardPending = async () => {
    if (browserMode && prepared) await cancelBrowserIntent(prepared.journalScope || requireBrowserPocket(), prepared.id);
    setPendingSigned(null); setPrepared(null); setIntent(null); setOperationError('');
  };
  const closeDialog = () => { if (working || pendingSigned) return; setIntent(null); setPrepared(null); setOperationError(''); };

  const runReconcile = async () => {
    setReconcileBusy(true);
    try {
      const result = await reconcile(identity?.publicKey);
      const unresolved = result.outcomes.find((outcome) => outcome.state === 'uncertain' || outcome.status === 'unknown');
      const localOutcome = transactionNotice?.hash ? result.outcomes.find((outcome) => outcome.txHash.toLowerCase() === transactionNotice.hash?.toLowerCase()) : undefined;
      const remainsUnresolved = Boolean(unresolved || (transactionNotice?.hash && !localOutcome) || localOutcome?.state === 'uncertain' || localOutcome?.status === 'unknown');
      setTransactionNotice(localOutcome
        ? { state: localOutcome.state || localOutcome.status || 'uncertain', hash: localOutcome.txHash }
        : transactionNotice?.hash
          ? { ...transactionNotice, state: 'uncertain', detail: t('txNotInJournal') }
          : unresolved ? { state: 'uncertain', hash: unresolved.txHash } : { state: 'checked' });
      if (remainsUnresolved) toast.warning(t('submitUnknown'));
      else toast.success(t('checkedStatus'));
      await refresh(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTransactionNotice({ state: 'error', detail: t('statusCouldNotConfirm'), technicalError: message });
      toast.error(t('statusCouldNotConfirm'));
    } finally { setReconcileBusy(false); }
  };

  const checkNoticeStatus = async () => {
    if (!transactionNotice?.hash) return;
    setNoticeCheckBusy(true);
    try {
      const result = await resolvePudgeTransaction(transactionNotice.hash, identity?.publicKey);
      const status = result.status || 'unknown';
      if (status === 'not-sent') {
        const notice: TransactionNotice = { state: 'not-sent', phase: 'signing-request', detail: t('transactionNotSent'), operation: transactionNotice.operation };
        setTransactionNotice(notice);
        try { sessionStorage.removeItem(PENDING_TRANSACTION_KEY); } catch { /* Session storage is optional. */ }
        toast.info(t('transactionNotSent'));
        await refresh(true);
        return;
      }
      const detail = status === 'committed'
        ? `${t('statusCommitted')} · ${t('blockNumber')} ${result.blockNumber || '—'}`
        : status === 'pending' ? t('statusPending')
          : status === 'proposed' ? t('statusProposed')
            : status === 'rejected' ? t('transactionRejected')
              : status === 'uncertain' ? t('statusCouldNotConfirm')
                : t('txStillUnknown');
      const preBroadcastFailure = transactionNotice.phase && ['network-check', 'pocket-check', 'input-fee-check', 'dry-run', 'pool-admission'].includes(transactionNotice.phase);
      const notice: TransactionNotice = { state: status === 'unknown' && preBroadcastFailure ? 'error' : status, hash: transactionNotice.hash, phase: transactionNotice.phase, detail: status === 'unknown' && preBroadcastFailure ? t('transactionNotSent') : detail, technicalError: result.reason, operation: transactionNotice.operation, draftIndexKey: transactionNotice.draftIndexKey, draftId: transactionNotice.draftId, actor: transactionNotice.actor };
      if (notice.state === 'committed' && !removeConfirmedGenesisDraft(notice)) toast.warning(t('draftCleanupError'));
      setTransactionNotice(notice);
      if (notice.hash) try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
      if (!browserMode && status === 'committed') toast.success(t('transactionConfirmed'));
      else if (!browserMode && (status === 'pending' || status === 'proposed')) toast.info(t('transactionSubmitted'));
      else if (!browserMode && status === 'rejected') toast.error(t('transactionRejected'));
      else if (!browserMode) toast.warning(t('submitUnknown'));
      if (status === 'committed' && notice.operation === 'genesis' && result.pocket) {
        openSelectedPocket(result.pocket);
        setShowCreation(false);
        setActiveDraftId('');
      }
      if (status === 'committed') await refresh(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const notice: TransactionNotice = { ...transactionNotice, state: 'uncertain', hash: transactionNotice.hash, phase: transactionNotice.phase, detail: t('statusCouldNotConfirm'), technicalError: message };
      setTransactionNotice(notice);
      try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
      if (!browserMode) toast.error(t('statusCouldNotConfirm'));
    } finally { setNoticeCheckBusy(false); }
  };

  const retrySameIntent = async () => {
    if (!transactionNotice?.hash || !retryableIntent || !identity) return;
    setRetryBusy(true);
    try {
      const result = await retryJournaledTransaction(transactionNotice.hash, identity.publicKey);
      const preBroadcastFailure = ['dry-run', 'pool-admission'].includes(result.phase || '');
      setTransactionNotice({ state: preBroadcastFailure ? 'error' : result.state, hash: result.txHash || transactionNotice.hash, phase: result.phase, detail: preBroadcastFailure ? `${t('preBroadcastStopped')} ${result.reason || result.error || ''}`.trim() : result.reason || result.error || (result.state === 'submitted' ? t('sameTxSubmitted') : '') });
      await refresh(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTransactionNotice({ state: 'uncertain', hash: transactionNotice.hash, phase: 'submit', detail: `${t('statusCheckFailed')} ${message}` });
    } finally { setRetryBusy(false); setRetryDialogOpen(false); }
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
    const key = value === 'committed' ? 'statusCommitted' : value === 'pending' ? 'statusPending' : value === 'proposed' ? 'statusProposed' : value === 'submitted' ? 'statusSubmitted' : value === 'uncertain' || value === 'unknown' ? 'statusUncertain' : value === 'rejected' ? 'statusRejected' : value === 'failed' || value === 'error' ? 'statusFailed' : '';
    return key ? t(key) : value;
  };
  useEffect(() => {
    const current = transactionNotice;
    const hash = current?.hash;
    if (!pudge || !hash || !['uncertain', 'pending', 'proposed', 'submitted'].includes(current.state)) return;
    let active = true;
    let inFlight = false;
    let keepChecking = true;
    let attempt = 0;
    let timer = 0;
    const schedule = () => {
      const delay = Math.min(4_000 * 2 ** Math.min(attempt, 3), 30_000);
      attempt++;
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      setNoticeCheckBusy(true);
      try {
        const result = await resolvePudgeTransaction(hash, identity?.publicKey);
        if (!active) return;
        if (result.status === 'not-sent') {
          keepChecking = false;
          const notice: TransactionNotice = { state: 'not-sent', phase: 'signing-request', detail: t('transactionNotSent'), operation: current.operation };
          setTransactionNotice((latest) => latest?.hash === hash ? notice : latest);
          try { sessionStorage.removeItem(PENDING_TRANSACTION_KEY); } catch { /* Session storage is optional. */ }
          toast.info(t('transactionNotSent'), { id: 'quotacell-transaction-submit' });
          await refresh(true);
        } else if (['committed', 'pending', 'proposed', 'submitted', 'rejected'].includes(result.status)) {
          const terminal = ['committed', 'rejected'].includes(result.status);
          const operation = result.operation || current.operation;
          keepChecking = !terminal;
          const detail = result.status === 'committed' ? t('transactionConfirmed')
            : ['pending', 'proposed', 'submitted'].includes(result.status) ? t('transactionSubmitted')
              : t('transactionRejected');
          const notice: TransactionNotice = { state: result.status, hash, detail, technicalError: result.reason, operation, draftIndexKey: current.draftIndexKey, draftId: current.draftId, actor: current.actor };
          if (result.status === 'committed' && !removeConfirmedGenesisDraft(notice)) toast.warning(t('draftCleanupError'));
          setTransactionNotice((latest) => latest?.hash === hash ? notice : latest);
          try { sessionStorage.setItem(PENDING_TRANSACTION_KEY, JSON.stringify(notice)); } catch { /* Session storage is optional. */ }
          if (terminal) {
            if (result.status === 'committed' && operation === 'genesis' && result.pocket) {
              window.history.replaceState(null, '', `${window.location.pathname}?${new URLSearchParams({ pocket: result.pocket })}`);
              if (browserMode) setSelectedPocketId(result.pocket);
              setShowCreation(false); setActiveDraftId(''); setShowPocketList(false);
            }
            await refresh(true);
          }
        }
      } catch { /* Retry automatically while the transaction outcome remains unknown. */ }
      finally {
        inFlight = false;
        if (active) setNoticeCheckBusy(false);
        if (active && keepChecking) schedule();
      }
    };
    timer = window.setTimeout(() => void poll(), 1_200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [pudge, refresh, t, transactionNotice?.hash, transactionNotice?.operation, transactionNotice?.state]);
  const explorerUrl = (hash: string) => `https://pudge.explorer.nervos.org/transaction/${hash}`;
  const displayIdentityRole = role === 'owner' ? t('owner') : role === 'alice' ? labelFor(delegates.find((d) => d.role === 'alice')?.publicKey, t('delegateOne')) : role === 'ben' ? labelFor(delegates.find((d) => d.role === 'ben')?.publicKey, t('delegateTwo')) : role === 'unrecognized' ? t('unknownRole') : '';
  const identityDiscoveryLoading = Boolean(identity && !loadError && (stateActor !== identity.publicKey.toLowerCase() || (state?.empty && refreshing)));
  const noticeTitle = transactionNotice?.state === 'uncertain' ? t('statusUncertain') : transactionNotice?.state === 'not-sent' || transactionNotice?.state === 'error' && (transactionNotice.phase === 'signing-request' || ['network-check', 'pocket-check', 'input-fee-check', 'dry-run', 'pool-admission'].includes(transactionNotice.phase || '')) ? t('statusNotSent') : transactionNotice?.state === 'error' ? t('statusFailed') : transactionNotice?.state === 'checked' ? t('checkedStatus') : transactionNotice?.state === 'metadata' ? t('metadataLocal') : transactionNotice ? historyState(transactionNotice.state) : '';

  return <>
    <header className="topbar sticky top-0 z-40 flex h-16 w-full items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-[max(26px,calc((100vw-1160px)/2))]"><a className="brand inline-flex shrink-0 items-center gap-2.5 text-lg font-bold text-navy no-underline" href="#home" aria-label={t('brand')}><CellMark/><span>{t('brand')}</span></a>
      <div className="topbar-controls flex min-w-0 items-center justify-end gap-1.5 sm:gap-3">
        {state && <div className={`network-state ${pudgeActionsDisabled ? 'is-readonly' : ''}`} role="status" aria-label={`${pudge ? t('networkPudge') : t('networkLocal')}${pudgeReadOnly ? ` · ${t('readOnly')}` : pudgePrepareOnly ? ` · ${t('prepareOnly')}` : ''}`}><i aria-hidden="true"/><span className="network-full" aria-hidden="true">{pudge ? t('networkPudge') : t('networkLocal')}</span><span className="network-compact" aria-hidden="true">{pudge ? t('networkPudgeShort') : t('networkLocalShort')}</span>{pudgeReadOnly && <small>{t('readOnly')}</small>}{pudgePrepareOnly && <small>{t('prepareOnly')}</small>}</div>}
        <label className="language-control"><span className="sr-only">{t('language')}</span><select value={i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en'} onChange={(event) => void i18n.changeLanguage(event.target.value)} aria-label={t('language')}><option value="en">EN</option><option value="zh-Hans">ç®€</option></select></label>
        <button className="icon-button refresh-button" type="button" onClick={() => selectedPocketId ? void loadSelectedPocket(selectedPocketId) : void refresh()} disabled={refreshing || selectedPocketLoading} aria-label={refreshing || selectedPocketLoading ? t('refreshing') : t('refresh')} title={t('refresh')}>{refreshing || selectedPocketLoading ? '…' : '↻'}</button>
        {identity ? <div className="connected-account"><div><strong>{displayIdentityRole || t('connected')}</strong><code dir="ltr">{shortHash(identity.address, 12, 7)}</code></div><button className="text-button disconnect-button" onClick={() => { wallet.disconnect(); setIdentity(null); setIdentityError(''); }} type="button">×</button></div> : <button className="connect-button" type="button" disabled={walletBusy} onClick={() => void connectWallet()}>{walletBusy ? t('connectingWallet') : t('disconnected')}</button>}
      </div>
    </header>

    <Toaster position="top-right" theme="light" richColors closeButton visibleToasts={3} offset={72} toastOptions={{ className: 'quotacell-toast', duration: 5000 }}/>

    {identityError && <div className="wallet-connection-alert inline-alert mx-auto mt-4 w-[min(calc(100%-2rem),64rem)] rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-5 text-red-800" role="alert">{identityError}</div>}
    {stateStale && !selectedPocketLoading && !selectedPocketError && !showPocketList && <div className="mx-auto mt-3 w-[min(calc(100%-2rem),64rem)] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" role="status">{t(waitingForIndex ? 'confirmedIndexing' : 'stateRefreshPaused')}</div>}
    {(showCreation || browserMode && !selectedPocketId) && transactionNotice && <TransactionNoticePanel notice={transactionNotice} title={noticeTitle} pudge={pudge} explorerUrl={explorerUrl} t={t} className="mx-auto mt-3 w-[min(calc(100%-2rem),64rem)]" onCheckStatus={() => void checkNoticeStatus()} checkingStatus={noticeCheckBusy}/>}

    {showCreation && identity && state?.genesis && activeDraftId && activeDraftKey ? <CreationFlow key={`${state.genesis}:${activeDraftOwner}:${activeDraftId}`} draftId={activeDraftId} draftIndexKey={draftIndexKey} draftKey={activeDraftKey} pudgeReadOnly={pudgeReadOnly} prepareOnly={pudgePrepareOnly} canPrepareCreation={state.multiPocket === true && !pudgeReadOnly && !actionsBlocked} creationBlocked={Boolean(state.unresolved || clientTransactionUnresolved)} connectedIdentity={identity} onConnectParticipant={connectParticipant} onPrepare={prepareCreation} onCancel={() => { setActiveDraftId(''); setActiveDraftOwner(''); setShowCreation(false); setShowPocketList(false); setPocketListError(''); }}/> : state?.creationRecovery ? <main className="loading-page mx-auto grid min-h-[55vh] w-[min(100%-2rem,64rem)] place-items-center text-slate-600"><section className="load-error w-full max-w-xl rounded-lg border border-red-200 bg-white p-5 shadow-sm" role="alert"><h1 className="text-lg font-semibold text-red-900">{t('creationRecoveryTitle')}</h1><p className="text-sm leading-6 text-slate-700">{t('creationRecoveryBody', { state: state.creationRecovery.state })}</p><p className="break-all text-xs text-slate-600"><code dir="ltr">{state.creationRecovery.txHash}</code></p><button className="secondary-button" disabled={reconcileBusy} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button></section></main>
      : selectedPocketLoading ? <main className="mx-auto min-h-[min(66vh,620px)] w-[min(100%-2rem,64rem)] py-7 sm:py-10" aria-busy="true"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="m-0 text-2xl font-bold text-navy">{t('openingPocket')}</h1><p className="mt-1 text-sm text-slate-600" role="status">{t('verifyingPocket')}</p></div><button className="secondary-button" type="button" onClick={() => void openPocketList()}>{t('backToMyPockets')}</button></div><section className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-hidden="true"><div className="animate-pulse rounded-lg border border-line bg-white p-5"><div className="mb-4 h-3 w-28 rounded-sm bg-slate-200"/><div className="mb-3 h-9 w-40 rounded-sm bg-slate-100"/><div className="h-3 w-3/4 rounded-sm bg-slate-100"/></div><div className="animate-pulse rounded-lg border border-line bg-white p-5"><div className="mb-4 h-3 w-32 rounded-sm bg-slate-200"/><div className="mb-3 h-9 w-36 rounded-sm bg-slate-100"/><div className="h-3 w-2/3 rounded-sm bg-slate-100"/></div></section><div className="mt-7 divide-y divide-slate-200 border-y border-slate-200" aria-hidden="true">{[0, 1, 2].map((item) => <div key={item} className="flex items-center justify-between gap-4 py-4"><div className="animate-pulse space-y-2"><div className="h-3 w-32 rounded-sm bg-slate-200"/><div className="h-3 w-56 max-w-[70vw] rounded-sm bg-slate-100"/></div><div className="h-10 w-28 animate-pulse rounded-md bg-slate-100"/></div>)}</div></main>
      : selectedPocketError ? <main className="mx-auto grid min-h-[min(66vh,620px)] w-[min(100%-2rem,64rem)] place-items-center py-10"><section className="w-full max-w-xl rounded-md border border-red-200 bg-white p-5" role="alert"><h1 className="m-0 text-lg font-semibold text-navy">{t('pocketLoadFailed')}</h1><p className="my-2 text-sm leading-6 text-slate-600">{t('pocketCouldNotBeVerified')}</p><div className="mt-4 flex flex-wrap gap-2"><button className="primary-button" type="button" onClick={() => void loadSelectedPocket(selectedPocketId)}>{t('retry')}</button><button className="secondary-button" type="button" onClick={() => void openPocketList()}>{t('backToMyPockets')}</button></div></section></main>
      : state?.connectRequired ? <main className="empty-pocket-page mx-auto flex min-h-[min(66vh,620px)] w-[min(100%-2rem,64rem)] flex-col items-start justify-center py-10"><h1 className="mb-2 text-xl font-semibold text-navy">{t('activePocket')}</h1><p className="mb-5 text-sm text-slate-600">{t('pocketLinkConnect')}</p><button className="primary-button" type="button" onClick={() => void connectWallet()} disabled={walletBusy}>{walletBusy ? t('connectingWallet') : t('disconnected')}</button></main>
      : browserMode && !selectedPocketId ? <>
        <main className="mx-auto w-[min(100%-2rem,64rem)] py-10">
          <h1 className="mb-4 text-3xl font-semibold text-navy">QuotaCell</h1>
          {!identity && <button className="primary-button mb-5" disabled={walletBusy} onClick={() => void connectWallet()}>{t('disconnected')}</button>}
          <form className="mb-4 max-w-xl" onSubmit={event => {
            event.preventDefault();
            const value = pocketInput.trim();
            let pocket = value;
            try { pocket = new URL(value, window.location.href).searchParams.get('pocket') || value; }
            catch { /* Validate the raw value below. */ }
            const valid = /^0x[0-9a-f]{64}$/i.test(pocket);
            setInvalidPocketInput(!valid);
            if (valid) openSelectedPocket(pocket.toLowerCase());
          }}>
            <label className="field-block">{t('openByIdOrLink')}<input value={pocketInput} onChange={event => { setPocketInput(event.target.value); setInvalidPocketInput(false); }}/></label>
            {invalidPocketInput && <p role="alert">{t('invalidPocketLink')}</p>}
            <button className="secondary-button mt-2" type="submit">{t('openPocketEntry')}</button>
          </form>
          <button className="secondary-button" onClick={() => openSelectedPocket(demoPocket)}>{t('viewLiveDemoPocket')}</button>
        </main>
        {identity && <PocketPicker pockets={state?.discovery || []} drafts={savedDrafts} ownerCanCreate={Boolean(identity)} locale={i18n.language} loading={identityDiscoveryLoading} error={loadError ? t('pocketListError') : ''} t={key => t(key)} onOpen={openSelectedPocket} onCreate={startNewDraft} onResume={resumeDraft} onDiscard={discardDraft}/>}
      </> : showPocketList || state?.discovery || (state?.empty && identity) || identityDiscoveryLoading ? <PocketPicker pockets={showPocketList ? pocketChoices : state?.discovery || []} drafts={savedDrafts} ownerCanCreate={!browserMode && Boolean(identity)} locale={i18n.language} loading={showPocketList ? pocketListLoading : identityDiscoveryLoading} error={pocketListError} t={(key) => t(key)} onOpen={(pocket) => void openSelectedPocket(pocket)} onCreate={startNewDraft} onResume={resumeDraft} onDiscard={discardDraft}/>
      : state?.empty ? <main className="empty-pocket-page mx-auto flex min-h-[min(66vh,620px)] w-[min(100%-2rem,64rem)] flex-col items-start justify-center py-10"><div className="empty-cell-mark mb-5 grid size-14 place-items-center rounded-xl border border-blue-100 bg-blue-wash text-blue"><CellMark/></div><h1 className="mb-2 max-w-2xl text-3xl font-bold leading-tight text-navy sm:text-4xl">{t('emptyTitle')}</h1><p className="mb-5 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">{t('emptyBody')}</p><button className="primary-button" type="button" disabled={!identity} onClick={startNewDraft}>{t('createPocket')} <span aria-hidden="true">→</span></button></main>
      : state && !state.empty ? <main id="home" className="app-page mx-auto w-[min(100%-2rem,64rem)] py-6 sm:py-8">
        <div className="pocket-heading mb-5 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="m-0 text-2xl font-bold text-navy sm:text-[28px]">{state.pocket ? t('activePocket') : t('brand')}</h1><p className="mt-1 text-xs text-slate-600 sm:text-sm">{identity ? displayIdentityRole : t('connectToSeeActions')}</p></div><div className="flex max-w-full flex-wrap items-center justify-end gap-2"><button className="secondary-button" type="button" onClick={() => void openPocketList()}>{t('myPockets')}</button><button className="secondary-button" type="button" onClick={() => void copyPocketId()}>{t('sharePocketLink')}</button><span className={closed ? 'state-mark state-closed' : 'state-mark'}>{closed ? t('closedStatus') : t('active')}</span></div></div>

        {state.historicalTermsUnavailable && <p className="mb-5 border-l-2 border-amber-500 pl-3 text-sm leading-6 text-amber-900" role="status">{t('terminalHistoryUnavailable')}</p>}

        {transactionNotice && <TransactionNoticePanel notice={transactionNotice} title={noticeTitle} pudge={pudge} explorerUrl={explorerUrl} t={t} className="mb-4" onCheckStatus={() => void checkNoticeStatus()} checkingStatus={noticeCheckBusy} onRetry={retryableIntent && ['error', 'uncertain', 'unknown', 'submitted'].includes(transactionNotice.state) ? () => setRetryDialogOpen(true) : undefined} retryBusy={retryBusy} onDismiss={() => { setTransactionNotice(null); try { sessionStorage.removeItem(PENDING_TRANSACTION_KEY); } catch { /* Session storage is optional. */ } }}/>}

        {state.unresolved && (!browserMode || !transactionNotice) && <section className="unresolved-banner mb-4 flex flex-col items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center" role="alert"><div><strong className="text-sm font-semibold text-amber-950">{t('unresolvedTitle')}</strong><p className="mt-1 text-xs leading-5 text-amber-900">{t('unresolvedBody')}</p></div><button type="button" className="secondary-button shrink-0" disabled={reconcileBusy || pudgeReadOnly} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button></section>}

        <section className="metrics mb-7 grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('activePocket')}>
          <article className="metric min-w-0 rounded-lg border border-line bg-white p-4 sm:p-5"><span className="text-xs font-semibold text-slate-600">{t('protectedBalance')}</span><strong className="metric-value my-2 block break-words text-3xl font-bold leading-tight tabular-nums text-navy sm:text-4xl">{formatCkb(funds)} <i className="text-base font-medium not-italic text-slate-500">CKB</i></strong><p className="mb-2 text-xs text-slate-600">{t('availableSpend')}: <b className="font-semibold text-slate-800">{formatCkb(available)} CKB</b></p><div className="capacity-bar h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><span className="block h-full rounded-full bg-blue-bright" style={{ width: `${funds > 0n ? Number(available * 10000n / funds > 10000n ? 10000n : available * 10000n / funds) / 100 : 0}%` }}/></div><small className="mt-2 block text-[11px] leading-4 text-slate-500">{t('occupiedDisclosure')}</small></article>
          <article className="metric allowance-metric min-w-0 rounded-lg border border-line bg-white p-4 sm:p-5"><span className="text-xs font-semibold text-slate-600">{closed ? t('terminalCapacity') : t('sharedAllowance')}</span><strong className="metric-value my-2 block break-words text-3xl font-bold leading-tight tabular-nums text-navy sm:text-4xl">{closed ? <>{formatCkb(state.policyCapacity || '0')} <i className="text-base font-medium not-italic text-slate-500">CKB</i></> : <>{formatCkb(sharedRemaining)} <i className="text-base font-medium not-italic text-slate-500">CKB</i></>}</strong><p className="mb-2 text-xs text-slate-600">{closed ? t('terminalCapacityHint') : t('sharedUsedOf', { used: formatCkb(sharedUsed), total: formatCkb(sharedLimit) })}</p>{!closed && <div className="capacity-bar allowance-bar h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={t('sharedAllowance')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(sharedUsed.toString(), sharedLimit.toString())}><span className="block h-full rounded-full bg-blue" style={{ width: `${progressPercent(sharedUsed.toString(), sharedLimit.toString())}%` }}/></div>}{!closed && <small className="mt-2 block text-[11px] leading-4 text-slate-500">{t('allowanceExplanation')}</small>}</article>
        </section>

        {!identity && <section className="connect-prompt mb-6 flex flex-col items-start justify-between gap-4 rounded-lg border border-line bg-white p-4 sm:flex-row sm:items-center sm:p-5"><div><h2 className="mb-1 text-base font-semibold text-navy">{t('connectToContinue')}</h2><p className="m-0 max-w-xl text-xs leading-5 text-slate-600">{t(browserMode ? 'browserDisclosure' : 'localDisclosure')}</p></div><button className="primary-button w-full sm:w-auto" onClick={() => void connectWallet()} disabled={walletBusy}>{walletBusy ? t('connectingWallet') : t('disconnected')} <span aria-hidden="true">→</span></button></section>}
        {identity && role === 'unrecognized' && <p className="role-message" role="status">{t('unknownRole')}</p>}

        {identity && role === 'owner' && !closed && <section className="owner-actions mt-7 flex flex-col items-start justify-between gap-4 rounded-lg border border-line bg-white p-4 sm:flex-row sm:items-center sm:p-5"><div className="section-title"><div><h2 className="text-base font-semibold text-navy">{t('ownerControls')}</h2><p className="mt-1 text-xs text-slate-600">{t('ownerDescription')}</p></div></div><div className="owner-action-list flex w-full flex-wrap gap-2 sm:w-auto"><button className="secondary-button flex-1 sm:flex-none" disabled={pudgeActionsDisabled || depositBlocked} onClick={() => beginOperation('deposit')}>{t('fund')}</button>{browserMode && <button className="secondary-button" disabled={actionsBlocked} onClick={() => beginOperation('admin')}>{t('actionAdmin')}</button>}{state.hasFund && <button className="secondary-button flex-1 sm:flex-none" disabled={pudgeActionsDisabled || actionsBlocked} onClick={() => beginOperation('close')}>{t('closePocket')}</button>}</div></section>}
        {identity && role === 'owner' && closed && <section className="owner-actions late-funds mt-7 flex flex-col items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold text-amber-950">{state.hasFund ? t('lateFunds') : t('lateDepositTitle')}</h2><p className="mt-1 text-sm text-amber-900">{state.hasFund ? `${formatCkb(funds)} CKB` : t('lateDepositBody')}</p></div>{state.hasFund ? <button className="primary-button" disabled={pudgeActionsDisabled || actionsBlocked} onClick={() => beginOperation('sweep')}>{t('sweep')} <span aria-hidden="true">→</span></button> : <button className="primary-button" disabled={pudgeActionsDisabled || depositBlocked} onClick={() => beginOperation('deposit')}>{t('lateDepositTitle')} <span aria-hidden="true">→</span></button>}</section>}

        {identity && (role === 'alice' || role === 'ben') && activeDelegate && !closed && <section className="delegate-focus mb-7 rounded-lg border border-t-[3px] border-t-blue border-line bg-white p-4 sm:p-5">
          <div className="delegate-focus-heading flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5"><span className={`permission-dot mt-2 size-2 shrink-0 rounded-full ${activeDelegate.enabled ? 'bg-emerald-600' : 'is-revoked bg-red-600'}`} aria-hidden="true"/><div className="min-w-0"><h2 className="m-0 text-lg font-semibold text-navy">{labelFor(activeDelegate.publicKey, role === 'alice' ? t('delegateOne') : t('delegateTwo'))}</h2>{descriptionFor(activeDelegate.publicKey) && <p className="mt-1 text-xs text-slate-600">{descriptionFor(activeDelegate.publicKey)}</p>}</div></div><span className={activeDelegate.enabled ? 'permission-status' : 'permission-status is-revoked'}>{activeDelegate.enabled ? t('active') : t('revoked')}</span></div>
          <div className="delegate-summary mt-5 grid grid-cols-2 gap-3 border-y border-slate-100 py-4 sm:grid-cols-3 sm:gap-4"><div className="min-w-0"><span className="text-xs font-medium text-slate-600">{t('remaining')}</span><strong className="my-1 block break-words text-xl font-semibold tabular-nums text-navy">{formatCkb(BigInt(activeDelegate.limit) > BigInt(activeDelegate.used) ? BigInt(activeDelegate.limit) - BigInt(activeDelegate.used) : 0n)} <i className="text-xs font-normal not-italic text-slate-500">CKB</i></strong><small className="text-[11px] leading-4 text-slate-500">{formatCkb(activeDelegate.used)} {t('usedOf')} {formatCkb(activeDelegate.limit)} CKB</small></div><div className="min-w-0"><span className="text-xs font-medium text-slate-600">{t('maxPayment')}</span><strong className="my-1 block break-words text-xl font-semibold tabular-nums text-navy">{formatCkb(activeDelegate.perPayment)} <i className="text-xs font-normal not-italic text-slate-500">CKB</i></strong><small className="text-[11px] leading-4 text-slate-500">{t('perPaymentHint')}</small></div><div className="col-span-2 min-w-0 border-t border-slate-100 pt-3 sm:col-span-1 sm:border-0 sm:pt-0"><span className="text-xs font-medium text-slate-600">{t('sharedRemaining')}</span><strong className="my-1 block break-words text-xl font-semibold tabular-nums text-navy">{formatCkb(sharedRemaining)} <i className="text-xs font-normal not-italic text-slate-500">CKB</i></strong><small className="text-[11px] leading-4 text-slate-500">{t('sharedAuthorityHint')}</small></div></div>
          <div className="approved-recipient mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 sm:flex-row sm:justify-between sm:gap-4"><span className="text-xs font-medium text-slate-600">{t('recipient')}</span><code className="min-w-0 break-all text-left text-xs text-slate-700 sm:max-w-[70%] sm:text-right" dir="ltr" title={recipientAddress(activeDelegate.recipient)}>{recipientAddress(activeDelegate.recipient)}</code></div>
          {activeDelegate.enabled && <button className="primary-button pay-button mt-4 min-w-40" disabled={pudgeActionsDisabled || actionsBlocked || !state.hasFund} onClick={() => beginOperation('pay', activeDelegate.role)}>{t('pay')} <span aria-hidden="true">→</span></button>}
          {!activeDelegate.enabled && <p className="revoked-message" role="status">{t('permissionRevokedMessage')}</p>}
        </section>}

        {identity && role === 'owner' && !closed && <section className="permissions-section mt-7"><div className="section-title flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold text-navy">{t('delegatePermissions')}</h2><p className="mt-1 text-xs text-slate-600">{t('sharedRelationship')}</p></div><span className="two-person-count grid size-6 place-items-center rounded-full border border-slate-300 text-xs text-slate-600">2</span></div>
          <div className="permission-list">{delegates.map((delegate, index) => {
            const fallback = index === 0 ? t('delegateOne') : t('delegateTwo');
            const name = labelFor(delegate.publicKey, fallback);
            const remaining = BigInt(delegate.limit) > BigInt(delegate.used) ? BigInt(delegate.limit) - BigInt(delegate.used) : 0n;
            return <article key={delegate.role} className="permission-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-3 py-3 first:border-0 sm:grid-cols-[minmax(0,1.5fr)_minmax(120px,.8fr)_auto] sm:gap-4 sm:px-4">
              <div className="permission-person"><div className="participant-mark" aria-hidden="true">{index + 1}</div><div><div className="permission-name"><h3>{name}</h3><span className={delegate.enabled ? 'permission-status' : 'permission-status is-revoked'}>{delegate.enabled ? t('active') : t('revoked')}</span><button type="button" className="text-button edit-name" onClick={() => setEditPerson({ publicKey: delegate.publicKey, role: delegate.role, fallback: name })}>{t('rename')}</button></div>{descriptionFor(delegate.publicKey) && <p>{descriptionFor(delegate.publicKey)}</p>}<span className="permission-subline">{t('remaining')} {formatCkb(remaining)} / {formatCkb(delegate.limit)} CKB · {t('used')} {formatCkb(delegate.used)} CKB · {t('maxPayment')} {formatCkb(delegate.perPayment)} CKB</span></div></div>
              <div className="permission-recipient"><span>{t('recipient')}</span><code dir="ltr" title={recipientAddress(delegate.recipient)}>{shortHash(recipientAddress(delegate.recipient), 18, 8)}</code></div>
            <div className="permission-actions"><details className="participant-inspector"><summary>{t('details')}</summary><div><span>{t('publicKey')}</span><code dir="ltr">{delegate.publicKey}</code><span>{t('recipient')}</span><code dir="ltr">{recipientAddress(delegate.recipient)}</code><span>{t('used')}</span><code>{formatCkb(delegate.used)} CKB</code></div></details>{<button type="button" className="text-button revoke-button" disabled={!delegate.enabled || actionsBlocked || pudgeActionsDisabled || closed} onClick={() => beginOperation('revoke', delegate.role, name)}>{t('revoke')}</button>}</div>
            </article>;
          })}</div>
        </section>}

        {identity && role === 'unrecognized' && <section className="public-permissions"><h2>{t('delegatePermissions')}</h2><div className="permission-list">{delegates.map((delegate, index) => <div className="public-permission-row" key={delegate.role}><strong>{labelFor(delegate.publicKey, index === 0 ? t('delegateOne') : t('delegateTwo'))}</strong><span>{formatCkb(BigInt(delegate.limit) > BigInt(delegate.used) ? BigInt(delegate.limit) - BigInt(delegate.used) : 0n)} / {formatCkb(delegate.limit)} CKB</span><span>{delegate.enabled ? t('active') : t('revoked')}</span></div>)}</div></section>}

        {closed && <section className="closed-summary"><div className="closed-icon" aria-hidden="true">✓</div><div><h2>{t('closedTitle')}</h2><p>{t('closedBody')}</p>{history.filter((item) => item.operation === 'close' && item.state === 'committed').slice(-1).map((item) => <p key={item.id}>{t('recoveredAmount')}: <strong>{formatCkb(item.amount)} CKB</strong></p>)}{state.hasFund && <p>{t('lateFunds')}</p>}</div></section>}

        {unsupported.length > 0 && <section className="unsupported-section" role="status"><div className="unsupported-heading"><span aria-hidden="true">!</span><div><h2>{t('unsupportedTitle')}</h2><p>{t('unsupportedBody')}</p></div></div><details><summary>{t('details')}</summary><div className="unsupported-list">{unsupported.map((item) => { const outPoint = item.outPoint; const hash = outPoint.txHash || outPoint.tx_hash || ''; return <div className="unsupported-row" key={`${hash}:${outPoint.index}`}><strong>{formatCkb(item.capacity)} CKB</strong><span>{item.hasType ? t('typedCell') : t('dataCell')} · {item.dataBytes} {t('bytes')}</span><code dir="ltr">{shortHash(hash, 14, 8)}:{outPoint.index}</code></div>; })}</div></details></section>}

        {identity && <section className="metadata-tools"><details><summary>{t('participantNames')}</summary><p>{t('metadataNote')}</p><div className="metadata-actions"><button type="button" className="text-button" onClick={downloadNames}>{t('exportNames')}</button><label className="file-import">{t('importNames')}<input type="file" accept="application/json,.json" onChange={(event) => void loadNames(event.target.files?.[0])}/></label></div></details></section>}

        <section className="history-section mt-8"><div className="section-title mb-3 flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold text-navy">{t('history')}</h2></div>{history.some((item) => item.state === 'uncertain') && <button className="text-button" disabled={reconcileBusy || pudgeReadOnly} onClick={() => void runReconcile()}>{reconcileBusy ? t('preparing') : t('reconcile')}</button>}</div>
          {browserMode && (currentHistory?.failed || !currentHistory?.rows) && <p className="empty-history" role="status">{t(currentHistory?.failed ? 'chainHistoryRetrying' : 'chainHistoryLoading')}</p>}
          {history.length ? <ol className="history-list">{[...history].reverse().slice(0, 8).map((item) => <HistoryRow item={item} key={item.id} locale={i18n.language} label={item.actor ? labelFor(item.actor, item.actor === state.owner ? t('owner') : t(delegates[0]?.publicKey === item.actor ? 'delegateOne' : 'delegateTwo')) : ''} stateLabel={historyState(item.state)} explorer={explorerEnabled ? explorerUrl(item.tx_hash) : undefined} t={t}/>)}</ol> : (!browserMode || currentHistory?.rows && !currentHistory.failed) && <p className="empty-history">{t('noHistory')}</p>}
        </section>

        <details className="technical-footer"><summary>{t('technical')}</summary><div><p>{t(browserMode ? 'browserDisclosure' : 'localDisclosure')}</p><dl><div><dt>{t('appIdentity')}</dt><dd><code dir="ltr">{state.genesis}</code></dd></div>{state.pocket && <div><dt>{t('policyId')}</dt><dd><code dir="ltr">{state.pocket}</code></dd></div>}{state.indexedTip && <div><dt>{t('indexerTip')}</dt><dd><code dir="ltr">{state.indexedTip.block_number} · {state.indexedTip.block_hash}</code></dd></div>}</dl></div></details>
      </main>
      : <main id="home" className="loading-page">{loadError ? <section className="load-error" role="alert"><h1>{t('loadError')}</h1><p>{localizedError(loadError, t)}</p><button className="primary-button" onClick={() => void refresh()}>{t('retry')}</button><div className="mt-4 flex flex-wrap gap-4 text-sm"><a href={`${window.location.pathname}?register=1`}>{t('shareWalletIdentity')}</a><a href={`${window.location.pathname}?discover=1`}>{t('discoverMyPocket')}</a></div></section> : <p role="status">{t('loadingState')}</p>}</main>}

    {state && !state.empty && !state.discovery && !state.connectRequired && !showPocketList && !selectedPocketLoading && !selectedPocketError && <footer className="app-footer mx-auto flex w-[min(100%-2rem,64rem)] flex-col justify-between gap-2 pb-6 text-[11px] text-slate-500 sm:flex-row sm:gap-5"><span className="max-w-2xl">{t(browserMode ? 'browserDisclosure' : 'localDisclosure')}</span></footer>}

    {state && <OperationDialog intent={intent} prepared={prepared} pendingSigned={pendingSigned} state={state} identity={identity} delegates={delegates} history={history} recipientAddresses={recipientAddresses} working={working} error={operationError} resumePayment={resumePayment} onPrepare={prepareOperation} onCancelPreparation={cancelPaymentPreparation} onSign={signPrepared} onSubmitSigned={({ transaction, hash }) => submitSigned(transaction, hash)} onDiscardSigned={discardPending} canSubmitSigned={!pudgeActionsDisabled} onConnectSigner={connectExpectedSigner} onClose={closeDialog}/>}
    {editPerson && <EditParticipantDialog participant={editPerson} initial={metadata[editPerson.publicKey]} onClose={() => setEditPerson(null)} onSave={saveName} t={t}/>}

    <AlertDialog.Root open={retryDialogOpen} onOpenChange={(open) => { if (!retryBusy) setRetryDialogOpen(open); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-slate-950/55 backdrop-blur-[1px]"/><AlertDialog.Content className="dialog-content alert-dialog fixed left-1/2 top-1/2 z-[61] max-h-[min(88dvh,850px)] w-[min(500px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6" aria-modal="true">
        <span className="dialog-symbol warning-symbol mb-3 grid size-8 place-items-center rounded-lg border border-amber-200 bg-amber-50 font-bold text-amber-800" aria-hidden="true">!</span><AlertDialog.Title className="dialog-title text-xl font-semibold text-navy">{t('retrySameTransactionTitle')}</AlertDialog.Title><AlertDialog.Description className="dialog-description mb-4 mt-1.5 block text-xs leading-5 text-slate-600">{t('retrySameTransactionBody')}</AlertDialog.Description>
        {transactionNotice?.hash && <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><span className="text-[11px] text-slate-500">{t('txId')}</span><code className="mt-1 block break-all text-xs text-slate-700" dir="ltr">{transactionNotice.hash}</code></div>}
        <div className="dialog-actions mt-4 flex flex-wrap justify-end gap-2"><AlertDialog.Cancel asChild><button className="secondary-button" disabled={retryBusy}>{t('cancel')}</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="primary-button" disabled={retryBusy} onClick={(event) => { event.preventDefault(); void retrySameIntent(); }}>{retryBusy ? t('submitting') : t('retrySameTransaction')}</button></AlertDialog.Action></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}

function TransactionNoticePanel({ notice, title, pudge, explorerUrl, t, className = '', onCheckStatus, checkingStatus, onRetry, retryBusy, onDismiss }: {
  notice: TransactionNotice;
  title: string;
  pudge: boolean;
  explorerUrl: (hash: string) => string;
  t: (key: string) => string;
  className?: string;
  onCheckStatus?: () => void;
  checkingStatus?: boolean;
  onRetry?: () => void;
  retryBusy?: boolean;
  onDismiss?: () => void;
}) {
  const tone = notice.state === 'committed' || notice.state === 'checked' ? 'success'
    : ['uncertain', 'unknown'].includes(notice.state) ? 'warning'
      : ['error', 'rejected', 'failed'].includes(notice.state) ? 'error' : 'info';
  const canCheck = Boolean(pudge && notice.hash && onCheckStatus && ['uncertain', 'pending', 'proposed', 'submitted', 'unknown'].includes(notice.state));
  const message = notice.detail || (notice.hash ? notice.state : t('noUncertainTransactions'));
  const canDismiss = Boolean(onDismiss && ['committed', 'checked', 'not-sent', 'error', 'rejected', 'failed'].includes(notice.state));
  return <section className={`transaction-notice notice-${tone} ${className}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} aria-live={tone === 'error' || tone === 'warning' ? 'assertive' : 'polite'} aria-atomic="true">
    <span className="notice-marker" aria-hidden="true">{tone === 'success' ? '✓' : tone === 'info' ? 'i' : '!'}</span>
    <div className="notice-content"><strong>{title}</strong><p>{message}</p>{['uncertain', 'pending', 'proposed', 'submitted'].includes(notice.state) && <p className="mt-1 text-xs text-slate-600">{t('automaticTracking')}</p>}
      {notice.hash && <div className="notice-transaction"><code dir="ltr">{notice.hash}</code>{pudge && <a href={explorerUrl(notice.hash)} target="_blank" rel="noreferrer">{t('explorer')}</a>}</div>}
      {(notice.technicalError || notice.phase) && <details className="notice-technical"><summary>{t('technical')}</summary>{notice.phase && <p><code>{notice.phase}</code></p>}{notice.technicalError && <pre dir="ltr">{notice.technicalError}</pre>}</details>}
    </div>
    <div className="notice-actions">{canCheck && <button type="button" className="secondary-button" disabled={checkingStatus} onClick={onCheckStatus}>{checkingStatus ? t('checkingStatus') : t('checkStatus')}</button>}{onRetry && <button type="button" className="secondary-button" disabled={retryBusy} onClick={onRetry}>{t('retrySameTransaction')}</button>}{canDismiss && <button type="button" className="icon-button notice-dismiss" onClick={onDismiss} aria-label={t('close')}>×</button>}</div>
  </section>;
}

function HistoryRow({ item, locale, label, stateLabel, explorer, t }: { item: HistoryItem; locale: string; label: string; stateLabel: string; explorer?: string; t: (key: string) => string }) {
  const operationLabel = item.operation === 'genesis' ? t('actionGenesis') : item.operation === 'pay' ? t('actionPay') : item.operation === 'deposit' ? t('actionDeposit') : item.operation === 'admin' ? t('actionAdmin') : item.operation === 'revoke' ? t('actionRevoke') : item.operation === 'close' ? t('actionClose') : item.operation === 'sweep' ? t('actionSweep') : t('chainHistoryUnknown');
  return <li className="history-row grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-t border-slate-100 px-3 py-3 first:border-0 sm:px-4"><span className="history-symbol grid size-7 place-items-center rounded-md bg-blue-50 text-sm text-blue-800" aria-hidden="true">{item.operation === 'pay' ? '↗' : item.operation === 'deposit' ? '+' : item.operation === 'revoke' ? '−' : '◈'}</span><div className="history-description grid min-w-0 gap-1"><strong className="text-xs font-semibold text-slate-800">{operationLabel}{item.operation === 'pay' || item.operation === 'deposit' || item.operation === 'close' || item.operation === 'sweep' ? ` · ${formatCkb(item.amount)} CKB` : ''}</strong><span className="text-[10px] text-slate-500">{label && `${label} · `}{new Intl.DateTimeFormat(locale === 'zh-Hans' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created))}</span></div><span className={`history-state whitespace-nowrap px-1.5 py-0.5 text-[10px] ${item.state === 'uncertain' ? 'is-uncertain text-amber-800' : item.state === 'committed' ? 'is-confirmed text-emerald-800' : 'text-slate-600'}`}>{stateLabel}</span>{explorer ? <a className="history-link grid size-7 place-items-center rounded text-blue hover:bg-blue-wash" href={explorer} target="_blank" rel="noreferrer" aria-label={`${t('explorer')}: ${item.tx_hash}`}>↗</a> : <code className="history-hash whitespace-nowrap text-[10px] text-slate-500" title={item.tx_hash}>{shortHash(item.tx_hash, 10, 7)}</code>}</li>;
}

function EditParticipantDialog({ participant, initial, onClose, onSave, t }: { participant: Participant; initial?: { name: string; description?: string }; onClose: () => void; onSave: (participant: Participant, name: string, description: string) => void; t: (key: string) => string }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content name-dialog" aria-modal="true"><div className="dialog-top"><span className="dialog-symbol" aria-hidden="true"><CellMark/></span><Dialog.Close asChild><button className="icon-button" aria-label={t('close')}>×</button></Dialog.Close></div><Dialog.Title className="dialog-title">{t('rename')}</Dialog.Title><Dialog.Description className="dialog-description">{t('metadataNote')}</Dialog.Description><label className="field-block">{t('name')}<input autoFocus value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder={participant.fallback}/></label><label className="field-block">{t('description')}<input value={description} maxLength={72} onChange={(event) => setDescription(event.target.value)}/></label><div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button">{t('cancel')}</button></Dialog.Close><button className="primary-button" onClick={() => onSave(participant, name, description)}>{t('save')}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function CellMark() {
  return <svg viewBox="0 0 28 28" role="presentation"><path d="M14 2.5 25.5 9v10L14 25.5 2.5 19V9L14 2.5Z"/><path d="m14 8 5.5 3.2v5.6L14 20l-5.5-3.2v-5.6L14 8Z"/><path d="M14 8v12m5.5-8.8L8.5 16.8m0-5.6 11 5.6"/></svg>;
}

function AppRouter() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('register')) return <RegistrationPage/>;
  if (params.has('discover') || params.has('view')) return <PocketDiscoveryPage/>;
  return <App/>;
}

function CccSessionBridge() {
  const connection = useCcc();
  useLayoutEffect(() => {
    wallet.attachConnectorState({
      ready: true,
      signer: connection.signerInfo?.signer as any,
      walletName: connection.wallet?.name,
      open: connection.open,
      disconnect: connection.disconnect,
      isOpen: connection.isOpen,
    });
  }, [connection.signerInfo?.signer, connection.wallet?.name, connection.open, connection.disconnect, connection.isOpen]);
  return <AppRouter/>;
}

const cccClient = new ccc.ClientPublicTestnet({ url: 'https://testnet.ckb.dev/', fallbacks: [] });
createRoot(document.getElementById('root')!).render(
  <CccProvider name="QuotaCell" hideKhie defaultClient={cccClient}>
    <CccSessionBridge/>
  </CccProvider>,
);
