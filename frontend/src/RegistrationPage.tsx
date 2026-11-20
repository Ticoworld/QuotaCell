import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTemporaryWalletError, wallet, WalletProviderUnavailableError } from './wallet';
import type { WalletIdentity } from './domain';
import { createRegistrationProfile, parseRegistrationInvitation, registrationShareUrl, type RegistrationInvitation } from './registration';

export function RegistrationPage() {
  const { t, i18n } = useTranslation();
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [invitation, setInvitation] = useState<RegistrationInvitation | null>(null);
  const [invitationLoaded, setInvitationLoaded] = useState(false);
  const [invitationInvalid, setInvitationInvalid] = useState(false);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'response' | 'link' | null>(null);
  const [showResponseFallback, setShowResponseFallback] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite');
    if (!code) { setInvitationLoaded(true); return; }
    void parseRegistrationInvitation(code).then(setInvitation).catch(() => setInvitationInvalid(true)).finally(() => setInvitationLoaded(true));
  }, []);

  useEffect(() => {
    let active = true;
    const restore = () => { void wallet.restore().then((identity) => { if (active && identity) setIdentity(identity); }); };
    const unsubscribe = wallet.subscribe(() => {
      if (wallet.hasSigner) restore();
      else if (active) { setIdentity(null); setResponse(''); }
    });
    restore();
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let canceled = false;
    if (!identity || !invitationLoaded) { setResponse(''); return; }
    void createRegistrationProfile(identity, invitation || undefined).then((code) => { if (!canceled) setResponse(code); }).catch((cause) => { if (!canceled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { canceled = true; };
  }, [identity?.publicKey, identity?.address, invitation, invitationLoaded]);

  useEffect(() => {
    if (!identity) return;
    let active = true;
    let checking = false;
    const sync = async () => {
      if (checking) return;
      checking = true;
      try {
        const current = await wallet.identity();
        if (active && (current.publicKey !== identity.publicKey || current.address !== identity.address)) setIdentity(current);
      } catch (cause) {
        if (active && isTemporaryWalletError(cause)) setError(t('walletCheckTemporary'));
        else if (active) { setIdentity(null); setResponse(''); setError(walletError(cause, t)); }
      } finally { checking = false; }
    };
    const stop = wallet.onAccountOrNetworkChange(() => window.setTimeout(() => void sync(), 0));
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { active = false; stop(); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
  }, [identity?.publicKey, identity?.address]);

  const responseUrl = useMemo(() => response ? registrationShareUrl(response, true) : '', [response]);

  const connect = async () => {
    setBusy(true); setError(''); setCopied(null);
    try { setIdentity(await wallet.connect()); }
    catch (cause) { setError(walletError(cause, t)); if (!isTemporaryWalletError(cause)) setIdentity(null); }
    finally { setBusy(false); }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value === responseUrl ? 'link' : 'response'); setShowResponseFallback(false); setError(''); }
    catch { setCopied(null); setShowResponseFallback(true); setError(t('clipboardUnavailable')); }
  };
  const changeLanguage = (value: string) => { void i18n.changeLanguage(value); };

  return <>
    <header className="topbar flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 sm:px-6">
      <a className="brand inline-flex items-center gap-2.5 text-lg font-bold text-navy no-underline" href={window.location.pathname} aria-label={t('brand')}><span aria-hidden="true">◈</span><span>{t('brand')}</span></a>
      <label className="language-control"><span className="sr-only">{t('language')}</span><select value={i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en'} onChange={(event) => changeLanguage(event.target.value)} aria-label={t('language')}><option value="en">EN</option><option value="zh-Hans">简</option></select></label>
    </header>
    <main className="mx-auto w-[min(100%-2rem,42rem)] py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-navy">{invitation ? t('invitedContributorTitle', { delegate: t(invitation.slot === 'delegate1' ? 'delegateOne' : 'delegateTwo') }) : t('shareWalletIdentity')}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{invitation ? t('contributorInviteIntro') : t('shareIdentityBody')}</p>
      {!invitationLoaded && <p className="mt-5 text-sm text-slate-600" role="status">{t('checkingInvitation')}</p>}
      {new URLSearchParams(window.location.search).has('invite') && invitationLoaded && invitationInvalid && <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{t('invalidInvitation')}</p>}
      {invitation && <section className="mt-5 border-y border-line py-4"><p className="m-0 text-sm font-semibold text-navy">{t(invitation.slot === 'delegate1' ? 'delegateOne' : 'delegateTwo')}</p><p className="mt-1 text-xs text-slate-600">{t('invitationNetwork')}: {t('networkPudge')}</p><p className="mt-3 max-w-xl text-sm leading-5 text-slate-600">{t('ownerAuthorizationRequired')}</p></section>}
      {!identity && !new URLSearchParams(window.location.search).has('invite') && <button className="primary-button mt-6" type="button" onClick={() => void connect()} disabled={busy}>{busy ? t('connectingWallet') : t('connect') }</button>}
      {!identity && invitation && <button className="primary-button mt-6" type="button" onClick={() => void connect()} disabled={busy || !invitationLoaded}>{busy ? t('connectingWallet') : t('connect')}</button>}
      {identity && <section className="mt-6 border-y border-line py-5">
        <p className="text-xs font-semibold text-slate-600">{t('connectedIdentity')}</p>
        <code className="mt-1 block break-all text-sm text-slate-700" dir="ltr">{identity.address}</code>
        {response ? <p className="mt-4 text-sm font-medium text-emerald-700" role="status">{t('responseReady')}</p> : <p className="mt-4 text-sm text-slate-600" role="status">{t('preparingResponse')}</p>}
        <div className="mt-4 flex flex-wrap gap-2"><button className="primary-button" disabled={!response} onClick={() => void copy(responseUrl)} type="button">{copied === 'link' ? t('copied') : t('copyResponseLink')}</button><button className="secondary-button" disabled={!response} onClick={() => void copy(response)} type="button">{copied === 'response' ? t('copied') : t('copyRegistrationCode')}</button><button className="text-button" onClick={() => { wallet.disconnect(); setIdentity(null); setResponse(''); setCopied(null); setShowResponseFallback(false); }} type="button">{t('disconnect')}</button></div>
        <p className="mt-2 text-xs leading-5 text-slate-600">{t('sendResponseToOwner')}</p>
        <details className="contextual-help mt-3"><summary>{t('registrationMeaning')}</summary><p>{t('contributorResponseLimits')}</p></details>
        {showResponseFallback && response && <label className="mt-4 grid gap-2 text-xs font-semibold text-slate-700">{t('registrationResponse')}<textarea className="min-h-28 rounded-md border border-slate-300 bg-white p-3 font-mono text-xs" readOnly value={response} onFocus={(event) => event.currentTarget.select()} /></label>}
      </section>}
      {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800" role="alert">{error}</p>}
    </main>
  </>;
}

function walletError(cause: unknown, t: (key: string) => string) {
  return cause instanceof WalletProviderUnavailableError ? t('walletProviderMissing') : cause instanceof Error ? cause.message : String(cause);
}
