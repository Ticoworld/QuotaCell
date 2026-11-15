import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CkbWalletSession } from './wallet';
import type { WalletIdentity } from './domain';
import { createRegistrationProfile, exportLegacyRegistrationJson, parseRegistrationInvitation, registrationShareUrl, type RegistrationInvitation } from './registration';

const wallet = new CkbWalletSession();

export function RegistrationPage() {
  const { t, i18n } = useTranslation();
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [invitation, setInvitation] = useState<RegistrationInvitation | null>(null);
  const [invitationLoaded, setInvitationLoaded] = useState(false);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite');
    if (!code) { setInvitationLoaded(true); return; }
    void parseRegistrationInvitation(code).then(setInvitation).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setInvitationLoaded(true));
    return () => wallet.disconnect();
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
        if (active) { setIdentity(null); setResponse(''); setError(cause instanceof Error ? cause.message : String(cause)); }
      } finally { checking = false; }
    };
    const stop = wallet.onAccountOrNetworkChange(() => window.setTimeout(() => void sync(), 0));
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { active = false; stop(); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
  }, [identity?.publicKey, identity?.address]);

  const responseUrl = useMemo(() => response ? registrationShareUrl(response, true) : '', [response]);

  const connect = async () => {
    setBusy(true); setError(''); setCopied(false);
    try { setIdentity(await wallet.connect()); }
    catch (cause) { wallet.disconnect(); setIdentity(null); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setError(''); }
    catch { setError(t('clipboardUnavailable')); }
  };
  const changeLanguage = (value: string) => { void i18n.changeLanguage(value); };

  return <>
    <header className="topbar flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 sm:px-6">
      <a className="brand inline-flex items-center gap-2.5 text-lg font-bold text-navy no-underline" href={window.location.pathname} aria-label={t('brand')}><span aria-hidden="true">◈</span><span>{t('brand')}</span></a>
      <label className="language-control"><span className="sr-only">{t('language')}</span><select value={i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en'} onChange={(event) => changeLanguage(event.target.value)} aria-label={t('language')}><option value="en">EN</option><option value="zh-Hans">简</option></select></label>
    </header>
    <main className="mx-auto w-[min(100%-2rem,42rem)] py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-navy">{t('shareWalletIdentity')}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{invitation ? t(invitation.slot === 'delegate1' ? 'invitationForOne' : 'invitationForTwo') : t('shareIdentityBody')}</p>
      <a className="mt-3 inline-block text-sm text-blue underline" href={`${window.location.pathname}?discover=1`}>{t('discoverMyPocket')}</a>
      {invitation && <p className="mt-4 border-l-2 border-blue pl-3 text-sm text-slate-700">{t('invitationNetwork')}: {t('networkPudge')} · {t(invitation.slot === 'delegate1' ? 'delegateOne' : 'delegateTwo')}</p>}
      {!identity && <button className="primary-button mt-6" type="button" onClick={() => void connect()} disabled={busy || !invitationLoaded || Boolean(new URLSearchParams(window.location.search).has('invite') && !invitation)}>{busy ? t('connectingWallet') : t('shareWalletIdentity')}</button>}
      {identity && <section className="mt-6 border-y border-line py-5">
        <p className="text-xs font-semibold text-slate-600">{t('connectedIdentity')}</p>
        <code className="mt-1 block break-all text-xs text-slate-700" dir="ltr">{identity.address}</code>
        <p className="mt-4 max-w-xl text-xs leading-5 text-slate-500">{t('profileTrustNote')}</p>
        {response && <label className="mt-5 grid gap-2 text-xs font-semibold text-slate-700">{t('registrationResponse')}<textarea className="min-h-28 rounded-md border border-slate-300 bg-white p-3 font-mono text-xs" readOnly value={response} /></label>}
        <div className="mt-3 flex flex-wrap gap-2"><button className="primary-button" disabled={!response} onClick={() => void copy(response)} type="button">{copied ? t('copied') : t('copyRegistrationCode')}</button><button className="secondary-button" disabled={!response} onClick={() => void copy(responseUrl)} type="button">{t('copyResponseLink')}</button><button className="text-button" onClick={() => { wallet.disconnect(); setIdentity(null); setResponse(''); setCopied(false); }} type="button">{t('disconnect')}</button></div>
      </section>}
      <details className="mt-6"><summary className="cursor-pointer text-xs font-medium text-slate-600">{t('advancedRegistration')}</summary><p className="mt-3 text-xs leading-5 text-slate-500">{t('legacyJsonNote')}</p>{identity && <button className="secondary-button mt-3" type="button" onClick={() => { const blob = new Blob([exportLegacyRegistrationJson(identity)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'quotacell-registration-v1.json'; anchor.click(); URL.revokeObjectURL(url); }}>{t('exportProfile')}</button>}</details>
      {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800" role="alert">{error}</p>}
    </main>
  </>;
}
