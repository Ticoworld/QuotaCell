import { PublicPolicyRules } from './PublicPolicyRules';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WalletIdentity } from './domain';
import { formatCkb } from './amount';
import { isTemporaryWalletError, wallet, WalletProviderUnavailableError } from './wallet';
import { discoverPublicPocket, discoverPublicPockets, publicDiscoveryNetwork } from './publicDiscovery';

type FoundPocket = Awaited<ReturnType<typeof discoverPublicPockets>>[number];

export function PocketDiscoveryPage() {
  const { t, i18n } = useTranslation();
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [pockets, setPockets] = useState<FoundPocket[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanSequence, setScanSequence] = useState(0);
  const [pocketInput, setPocketInput] = useState(new URLSearchParams(window.location.search).get('pocket') || '');
  const directId = new URLSearchParams(window.location.search).get('pocket');

  useEffect(() => {
    let active = true;
    const restore = () => { void wallet.restore().then((restored) => { if (active && restored) setIdentity(restored); }); };
    const unsubscribe = wallet.subscribe(() => {
      if (wallet.hasSigner) restore();
      else if (active) { setIdentity(null); setPockets([]); }
    });
    restore();
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!directId) return;
    let canceled = false;
    setBusy(true); setError('');
    void discoverPublicPocket(directId).then((result) => { if (!canceled) { setPockets([result]); setSelected(result.pocket); } })
      .catch((cause) => { if (!canceled) { setPockets([]); setError(publicError(cause, t)); } })
      .finally(() => { if (!canceled) setBusy(false); });
    return () => { canceled = true; };
  }, [directId]);
  useEffect(() => {
    if (!identity) return;
    let canceled = false;
    setBusy(true); setError('');
    void discoverPublicPockets(identity.publicKey).then((result) => {
      if (canceled) return;
      setPockets(result);
      setSelected(result.length === 1 ? result[0].pocket : result[0]?.pocket || '');
    }).catch((cause) => { if (!canceled) { setPockets([]); setError(cause instanceof Error ? cause.message : String(cause)); } }).finally(() => { if (!canceled) setBusy(false); });
    return () => { canceled = true; };
  }, [identity?.publicKey, scanSequence]);

  useEffect(() => {
    if (!identity) return;
    let active = true;
    const sync = async () => {
      try {
        const current = await wallet.identity();
        if (active && (current.publicKey !== identity.publicKey || current.address !== identity.address)) setIdentity(current);
      } catch (cause) {
        if (active && isTemporaryWalletError(cause)) setError(t('walletCheckTemporary'));
        else if (active) { setIdentity(null); setPockets([]); setError(walletError(cause, t)); }
      }
    };
    const stop = wallet.onAccountOrNetworkChange(() => window.setTimeout(() => void sync(), 0));
    window.addEventListener('focus', sync);
    return () => { active = false; stop(); window.removeEventListener('focus', sync); };
  }, [identity?.publicKey, identity?.address]);

  const connect = async () => {
    setBusy(true); setError('');
    try { setIdentity(await wallet.connect()); }
    catch (cause) { setError(walletError(cause, t)); if (!isTemporaryWalletError(cause)) setIdentity(null); setBusy(false); }
  };
  const roleLabel = (role: FoundPocket['role']) => t(role === 'owner' ? 'owner' : role === 'alice' ? 'delegateOne' : 'delegateTwo');
  const chosen = pockets.find((pocket) => pocket.pocket === selected);
  const activeDelegate = chosen?.summary?.delegates.find((delegate) => delegate.role === chosen.role);

  return <>
    <header className="topbar flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 sm:px-6">
      <a className="brand inline-flex items-center gap-2.5 text-lg font-bold text-navy no-underline" href={window.location.pathname} aria-label={t('brand')}><span aria-hidden="true">◈</span><span>{t('brand')}</span></a>
      <label className="language-control"><span className="sr-only">{t('language')}</span><select value={i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en'} onChange={(event) => void i18n.changeLanguage(event.target.value)} aria-label={t('language')}><option value="en">EN</option><option value="zh-Hans">简</option></select></label>
    </header>
    <main className="mx-auto w-[min(100%-2rem,48rem)] py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-navy">{directId ? t('publicPocketTitle') : t('pocketChoices')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('publicPocketIntro')}</p>
      {!directId && <form className="mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const id = pocketInput.trim(); if (/^0x[0-9a-f]{64}$/i.test(id)) window.location.search = new URLSearchParams({ view: '1', pocket: id }).toString(); else setError(t('invalidPocketId')); }}><input className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm" aria-label={t('pocketId')} placeholder="0x…" value={pocketInput} onChange={(event) => setPocketInput(event.target.value)} dir="ltr"/><button className="primary-button" type="submit">{t('openPocket')}</button></form>}
      {directId && <section className="mt-6 border-y border-line py-5">
        {busy && <p className="text-sm text-slate-600" role="status">{t('discoveringPockets')}</p>}
        {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800" role="alert">{error}</p>}
        {chosen && !busy && <div className="grid gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="text-lg font-semibold text-navy">{chosen.closed ? t('closedPocket') : t('activePocket')}</strong><code className="mt-1 block break-all text-xs text-slate-600" dir="ltr">{chosen.pocket}</code></div><a className="secondary-button" href={`https://pudge.explorer.nervos.org/transaction/${chosen.outPoint.tx_hash}`} target="_blank" rel="noreferrer">{t('verifyOnChain')}</a></div>
          <div className="grid gap-3 sm:grid-cols-2"><article className="border border-line p-4"><span className="text-xs font-semibold text-slate-600">{chosen.closed ? t('terminalCapacity') : t('policyCapacity')}</span><strong className="mt-2 block text-2xl font-bold text-navy">{formatCkb(BigInt(chosen.capacity))} CKB</strong><p className="mt-1 text-xs leading-5 text-slate-600">{chosen.closed ? t('terminalCapacityHint') : t('policyCapacityDisclosure')}</p></article>{chosen.summary && <article className="border border-line p-4"><span className="text-xs font-semibold text-slate-600">{t('sharedAllowance')}</span><strong className="mt-2 block text-2xl font-bold text-navy">{formatCkb(BigInt(chosen.summary.sharedLimit) - BigInt(chosen.summary.sharedUsed))} CKB</strong><p className="mt-1 text-xs text-slate-600">{t('sharedUsedOf', { used: formatCkb(chosen.summary.sharedUsed), total: formatCkb(chosen.summary.sharedLimit) })}</p></article>}</div>
          {chosen.closed ? <p className="m-0 text-sm leading-6 text-slate-700">{t('terminalHistoryUnavailable')}</p> : chosen.summary && <PublicPolicyRules owner={chosen.summary.owner} delegates={chosen.summary.delegates}/>}
          <small className="text-xs text-slate-500">{t('publicVerificationTip')}: {BigInt(chosen.indexedTip.block_number).toString()}</small>{!identity && <button className="secondary-button w-fit" type="button" disabled={busy} onClick={() => void connect()}>{t('connectForActions')}</button>}
        </div>}
      </section>}
      {!identity && !directId && <button className="secondary-button mt-4" type="button" disabled={busy} onClick={() => void connect()}>{busy ? t('connectingWallet') : t('connect')}</button>}
      {!directId && identity && <section className="mt-6 border-y border-line py-5">
        <p className="text-xs font-semibold text-slate-600">{t('connectedIdentity')}</p><code className="mt-1 block break-all text-xs text-slate-700" dir="ltr">{identity.address}</code>
        {busy && <p className="mt-5 text-sm text-slate-600" role="status">{t('discoveringPockets')}</p>}
        {error && <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800" role="alert">{error}</p>}
        {!busy && !error && pockets.length === 0 && <p className="mt-5 text-sm text-slate-600" role="status">{t('noPocketsForIdentity')}</p>}
        {!busy && pockets.length > 1 && <label className="mt-5 grid max-w-md gap-1.5 text-xs font-semibold text-slate-700">{t('pocketChoices')}<select className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" value={selected} onChange={(event) => setSelected(event.target.value)}>{pockets.map((pocket) => <option value={pocket.pocket} key={pocket.pocket}>{pocket.closed ? t('closedPocket') : t('activePocket')} · {roleLabel(pocket.role)} · {pocket.pocket.slice(0, 12)}</option>)}</select></label>}
        {chosen && !busy && <div className="mt-5 grid gap-3 border-l-2 border-blue pl-4"><strong className="text-sm font-semibold text-navy">{chosen.closed ? t('closedPocket') : t('activePocket')} · {roleLabel(chosen.role)}</strong><code className="break-all text-xs text-slate-700" dir="ltr">{chosen.pocket}</code>
          {chosen.closed ? <p className="m-0 text-xs leading-5 text-slate-600">{t('terminalHistoryUnavailable')}</p> : chosen.role === 'owner' && chosen.summary ? <div className="grid gap-3"><p className="m-0 text-xs text-slate-600">{t('sharedRemaining')}: <strong className="text-slate-800">{formatCkb(BigInt(chosen.summary.sharedLimit) - BigInt(chosen.summary.sharedUsed))} / {formatCkb(chosen.summary.sharedLimit)} CKB</strong></p><div className="divide-y divide-slate-200 border-y border-slate-200">{chosen.summary.delegates.map((delegate) => <div className="grid gap-1 py-3" key={delegate.role}><strong className="text-xs text-slate-800">{roleLabel(delegate.role)} · {delegate.enabled ? t('active') : t('revoked')}</strong><span className="text-xs text-slate-600">{t('remaining')}: {formatCkb(BigInt(delegate.limit) - BigInt(delegate.used))} / {formatCkb(delegate.limit)} CKB · {t('maxPayment')}: {formatCkb(delegate.perPayment)} CKB</span><code className="break-all text-[11px] text-slate-500" dir="ltr">{delegate.recipient}</code></div>)}</div></div> : activeDelegate ? <div className="grid gap-2 text-xs text-slate-600"><span>{activeDelegate.enabled ? t('active') : t('revoked')}</span><span>{t('remaining')}: <strong className="text-slate-800">{formatCkb(BigInt(activeDelegate.limit) - BigInt(activeDelegate.used))} / {formatCkb(activeDelegate.limit)} CKB</strong></span><span>{t('maxPayment')}: <strong className="text-slate-800">{formatCkb(activeDelegate.perPayment)} CKB</strong></span><code className="break-all text-[11px] text-slate-500" dir="ltr">{activeDelegate.recipient}</code></div> : <p className="m-0 text-xs leading-5 text-slate-600">{t('publicReadOnlyResult')}</p>}
          <small className="text-[11px] text-slate-500">{t('indexerTip')}: {BigInt(chosen.indexedTip.block_number).toString()}</small></div>}
        <button className="secondary-button mt-5" type="button" disabled={busy} onClick={() => setScanSequence((value) => value + 1)}>{t('refresh')}</button>
      </section>}
      <details className="mt-6"><summary className="cursor-pointer text-xs font-medium text-slate-600">{t('technical')}</summary><div className="mt-3 grid gap-1 text-xs text-slate-500"><span>{t('publicRpcEndpoint')}: {publicDiscoveryNetwork.rpc}</span><span>{t('expectedGenesis')}: <code className="break-all" dir="ltr">{publicDiscoveryNetwork.genesis}</code></span></div></details>
    </main>
  </>;
}

function walletError(cause: unknown, t: (key: string) => string) {
  return cause instanceof WalletProviderUnavailableError ? t('walletProviderMissing') : cause instanceof Error ? cause.message : String(cause);
}

function publicError(cause: unknown, t: (key: string) => string) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/invalid Pocket ID/i.test(message)) return t('invalidPocketId');
  if (/not found on Pudge/i.test(message)) return t('publicPocketNotFound');
  if (/not the verified Pudge|wrong network/i.test(message)) return t('publicWrongNetwork');
  if (/indexer is too far behind|indexer.*lag/i.test(message)) return t('publicIndexerLag');
  if (/canonical|changed during discovery|changed during/i.test(message)) return t('publicStaleState');
  if (/fetch|failed|timeout|network|RPC/i.test(message)) return t('publicRpcUnavailable');
  return t('publicStateInvalid');
}
