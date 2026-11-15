import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WalletIdentity } from './domain';
import { formatCkb } from './amount';
import { CkbWalletSession, WalletProviderUnavailableError } from './wallet';
import { discoverPublicPockets, publicDiscoveryNetwork } from './publicDiscovery';

const wallet = new CkbWalletSession();
type FoundPocket = Awaited<ReturnType<typeof discoverPublicPockets>>[number];

export function PocketDiscoveryPage() {
  const { t, i18n } = useTranslation();
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [pockets, setPockets] = useState<FoundPocket[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanSequence, setScanSequence] = useState(0);

  useEffect(() => () => wallet.disconnect(), []);
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
        if (active) { setIdentity(null); setPockets([]); setError(walletError(cause, t)); }
      }
    };
    const stop = wallet.onAccountOrNetworkChange(() => window.setTimeout(() => void sync(), 0));
    window.addEventListener('focus', sync);
    return () => { active = false; stop(); window.removeEventListener('focus', sync); };
  }, [identity?.publicKey, identity?.address]);

  const connect = async () => {
    setBusy(true); setError('');
    try { setIdentity(await wallet.connect()); }
    catch (cause) { wallet.disconnect(); setIdentity(null); setError(walletError(cause, t)); setBusy(false); }
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
      <h1 className="text-2xl font-bold text-navy">{t('pocketChoices')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('networkPudge')} · {t('readOnly')}</p>
      {!identity && <button className="primary-button mt-6" type="button" disabled={busy} onClick={() => void connect()}>{busy ? t('connectingWallet') : t('connect')}</button>}
      {identity && <section className="mt-6 border-y border-line py-5">
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
