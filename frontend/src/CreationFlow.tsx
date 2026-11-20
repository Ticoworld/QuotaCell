import { useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useTranslation } from 'react-i18next';
import { parseCkb } from './amount';
import { ApiError, resolveRecipient } from './api';
import type { WalletIdentity } from './domain';
import { assertUniqueRegistrationIdentities, createRegistrationInvitation, importRegistrationResponse, registrationShareUrl, type RegistrationInvitation } from './registration';
import { touchPocketDraft } from './drafts';

type Slot = 'owner' | 'alice' | 'ben';
type Person = WalletIdentity & { name: string; description: string };
type People = Record<Slot, Person | null>;
type Terms = { shared: string; firstLimit: string; firstMax: string; firstRecipient: string; secondLimit: string; secondMax: string; secondRecipient: string };
const emptyTerms: Terms = { shared: '', firstLimit: '', firstMax: '', firstRecipient: '', secondLimit: '', secondMax: '', secondRecipient: '' };
const initialPeople: People = { owner: null, alice: null, ben: null };
const keys: Slot[] = ['owner', 'alice', 'ben'];

function savedPerson(value: unknown): Person | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return {
    publicKey: typeof item.publicKey === 'string' ? item.publicKey.slice(0, 128) : '',
    address: typeof item.address === 'string' ? item.address.slice(0, 256) : '',
    name: typeof item.name === 'string' ? item.name.slice(0, 32) : '',
    description: typeof item.description === 'string' ? item.description.slice(0, 72) : '',
  };
}

function readDraft(key: string): { value: Record<string, unknown> | null; error: 'unavailable' | 'corrupt' | null } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { value: null, error: null };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value: null, error: 'corrupt' };
    return { value: value as Record<string, unknown>, error: null };
  } catch (cause) {
    return { value: null, error: cause instanceof SyntaxError ? 'corrupt' : 'unavailable' };
  }
}

function savedInvitations(value: unknown): Partial<Record<'alice' | 'ben', RegistrationInvitation>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return (['alice', 'ben'] as const).reduce<Partial<Record<'alice' | 'ben', RegistrationInvitation>>>((result, key) => {
    const item = source[key];
    const slot = key === 'alice' ? 'delegate1' : 'delegate2';
    if (!item || typeof item !== 'object' || Array.isArray(item)) return result;
    const invite = item as Record<string, unknown>;
    if (invite.network === 'ckb_testnet' && invite.slot === slot && typeof invite.requestId === 'string' && /^[0-9a-f]{32}$/i.test(invite.requestId) && typeof invite.code === 'string' && invite.code.length <= 2048) {
      result[key] = { network: 'ckb_testnet', slot, requestId: invite.requestId, code: invite.code };
    }
    return result;
  }, {});
}

type Props = {
  pudgeReadOnly: boolean;
  prepareOnly: boolean;
  canPrepareCreation: boolean;
  creationBlocked: boolean;
  connectedIdentity: WalletIdentity | null;
  onConnectParticipant: () => Promise<WalletIdentity>;
  onPrepare: (body: unknown, people: People, pocketName?: string) => Promise<void>;
  onCancel: () => void;
  draftId: string;
  draftIndexKey: string;
  draftKey: string;
};

export function CreationFlow({ pudgeReadOnly, prepareOnly, canPrepareCreation, creationBlocked, connectedIdentity, onConnectParticipant, onPrepare, onCancel, draftId, draftIndexKey, draftKey }: Props) {
  const { t } = useTranslation();
  const [pocketName, setPocketName] = useState('');
  const [initialDraft] = useState(() => readDraft(draftKey));
  const saved = initialDraft.value;
  const savedStep = typeof saved?.step === 'number' && saved.step >= 0 && saved.step <= 2 ? saved.step : 0;
  const restoredPeople = saved?.people && typeof saved.people === 'object' && !Array.isArray(saved.people) ? saved.people as Record<string, unknown> : {};
  const [step, setStep] = useState<number>(savedStep);
  const [people, setPeople] = useState<People>(() => {
    const owner = savedPerson(restoredPeople.owner);
    return {
      ...initialPeople,
      owner: connectedIdentity ? { ...(owner || { publicKey: '', address: '', name: '', description: '' }), ...connectedIdentity } : null,
      alice: savedPerson(restoredPeople.alice),
      ben: savedPerson(restoredPeople.ben),
    };
  });
  const [terms, setTerms] = useState<Terms>(() => {
    const restored = saved?.terms && typeof saved.terms === 'object' ? saved.terms as Record<string, unknown> : {};
    return Object.fromEntries(Object.keys(emptyTerms).map((key) => [key, typeof restored[key] === 'string' ? (restored[key] as string).slice(0, 256) : ''])) as Terms;
  });
  const [registering, setRegistering] = useState<Slot | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [inviteBySlot, setInviteBySlot] = useState<Partial<Record<Slot, RegistrationInvitation>>>(() => savedInvitations(saved?.inviteBySlot));
  const [responseTexts, setResponseTexts] = useState<Record<'alice' | 'ben', string>>({ alice: '', ben: '' });
  const [responseErrors, setResponseErrors] = useState<Partial<Record<'alice' | 'ben', string>>>({});
  const [copiedInvitation, setCopiedInvitation] = useState<Record<'alice' | 'ben', boolean>>({ alice: false, ben: false });
  const [linkFallback, setLinkFallback] = useState<Record<'alice' | 'ben', boolean>>({ alice: false, ben: false });
  const [replaceSlot, setReplaceSlot] = useState<'alice' | 'ben' | null>(null);
  const [creatingInvitation, setCreatingInvitation] = useState<'alice' | 'ben' | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error' | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [resumePreparation, setResumePreparation] = useState(() => {
    try { return Boolean(sessionStorage.getItem(`quotacell.genesis-preparation:${draftKey}`)); }
    catch { return false; }
  });
  const pendingGenesisRef = useRef<{ id: string; fingerprint: string } | null>(null);
  const saveBlocked = Boolean(initialDraft.error);
  const draftReadErrorKey = initialDraft.error === 'unavailable' ? 'draftStorageUnavailable' : 'draftCorruptError';
  useEffect(() => {
    if (saveBlocked) return;
    try {
      const publicPeople = Object.fromEntries(keys.map((slot) => {
        const person = people[slot];
        return [slot, person ? { publicKey: person.publicKey, address: person.address, name: person.name, description: person.description } : null];
      }));
      const publicInvitations = Object.fromEntries((['alice', 'ben'] as const).map((slot) => {
        const invite = inviteBySlot[slot];
        return [slot, invite ? { network: invite.network, slot: invite.slot, requestId: invite.requestId, code: invite.code } : null];
      }));
      localStorage.setItem(draftKey, JSON.stringify({ step, people: publicPeople, terms, inviteBySlot: publicInvitations }));
      touchPocketDraft(draftIndexKey, draftId);
      setSaveStatus('saved');
    } catch { setSaveStatus('error'); }
  }, [draftKey, draftIndexKey, draftId, step, people, terms, inviteBySlot, saveAttempt, saveBlocked]);

  const updatePerson = (slot: Slot, key: 'name' | 'description', value: string) => {
    setPeople((prev) => ({ ...prev, [slot]: { ...(prev[slot] || { publicKey: '', address: '', name: '', description: '' }), [key]: value } }));
  };
  const connect = async (slot: Slot) => {
    setError('');
    setRegistering(slot);
    try {
      const identity = await onConnectParticipant();
      assertUniqueRegistrationIdentities(keys.map((key) => key === slot ? identity : people[key]));
      setPeople((prev) => ({ ...prev, [slot]: { ...prev[slot], ...identity, name: prev[slot]?.name || '', description: prev[slot]?.description || '' } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setRegistering(null); }
  };
  const importProfileForSlot = async (slot: 'alice' | 'ben', text: string) => {
    setResponseErrors((previous) => ({ ...previous, [slot]: '' }));
    try {
      if (!inviteBySlot[slot]) throw new Error(t('invitationRequired'));
      const invitation = inviteBySlot[slot];
      const response = await importRegistrationResponse(text);
      const expectedSlot = slot === 'alice' ? 'delegate1' : 'delegate2';
      if (response.slot !== expectedSlot) throw new Error('This response belongs to a different delegate slot.');
      if (response.requestId !== invitation.requestId) throw new Error('This response uses a different invitation request.');
      const identity = response.identity;
      assertUniqueRegistrationIdentities(keys.map((key) => key === slot ? identity : people[key]));
      setPeople((previous) => ({ ...previous, [slot]: { ...identity, name: previous[slot]?.name || '', description: previous[slot]?.description || '' } }));
      setResponseTexts((previous) => ({ ...previous, [slot]: '' }));
      setResponseErrors((previous) => ({ ...previous, [slot]: '' }));
    } catch (cause) { setResponseErrors((previous) => ({ ...previous, [slot]: registrationError(cause, t) })); }
  };
  const createInvitation = async (slot: 'alice' | 'ben', replacing = false) => {
    if (creatingInvitation) return;
    setCreatingInvitation(slot);
    try {
      const invitation = await createRegistrationInvitation(slot === 'alice' ? 'delegate1' : 'delegate2');
      setInviteBySlot((previous) => ({ ...previous, [slot]: invitation }));
      if (replacing) {
        setPeople((previous) => ({ ...previous, [slot]: null }));
        setResponseTexts((previous) => ({ ...previous, [slot]: '' }));
        setResponseErrors((previous) => ({ ...previous, [slot]: '' }));
      }
      setCopiedInvitation((previous) => ({ ...previous, [slot]: false }));
      setLinkFallback((previous) => ({ ...previous, [slot]: false }));
      setReplaceSlot(null);
    } catch { setResponseErrors((previous) => ({ ...previous, [slot]: t('invitationCreateError') })); }
    finally { setCreatingInvitation(null); }
  };
  const requestInvitation = (slot: 'alice' | 'ben') => {
    if (people[slot] || inviteBySlot[slot]) setReplaceSlot(slot);
    else void createInvitation(slot);
  };
  const copyInvitation = async (slot: 'alice' | 'ben') => {
    const invite = inviteBySlot[slot];
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(registrationShareUrl(invite.code));
      setCopiedInvitation((previous) => ({ ...previous, [slot]: true }));
      setLinkFallback((previous) => ({ ...previous, [slot]: false }));
      setResponseErrors((previous) => ({ ...previous, [slot]: '' }));
    } catch {
      setCopiedInvitation((previous) => ({ ...previous, [slot]: false }));
      setLinkFallback((previous) => ({ ...previous, [slot]: true }));
      setResponseErrors((previous) => ({ ...previous, [slot]: t('clipboardUnavailable') }));
    }
  };
  const validatePeople = () => {
    if (!connectedIdentity || !people.owner || people.owner.publicKey.toLowerCase() !== connectedIdentity.publicKey.toLowerCase() || people.owner.address !== connectedIdentity.address) throw new Error(t('ownerIdentityConnectedOnly'));
    if (!people.alice?.publicKey || !people.ben?.publicKey) throw new Error(t('contributorsNotRegistered'));
    try { assertUniqueRegistrationIdentities(keys.map((slot) => people[slot])); }
    catch { throw new Error(t('differentWalletsError')); }
  };
  const validateTerms = async () => {
    const shared = parseCkb(terms.shared, t('minAmount'));
    const firstLimit = parseCkb(terms.firstLimit, t('minAmount'));
    const firstMax = parseCkb(terms.firstMax, t('minAmount'));
    const secondLimit = parseCkb(terms.secondLimit, t('minAmount'));
    const secondMax = parseCkb(terms.secondMax, t('minAmount'));
    const minimum = 61n * 100_000_000n;
    if (shared < minimum || firstLimit > shared || secondLimit > shared || firstMax < minimum || secondMax < minimum || firstMax > firstLimit || secondMax > secondLimit) {
      throw new Error(t('termsError'));
    }
    if (!terms.firstRecipient.trim() || !terms.secondRecipient.trim()) throw new Error(t('termsError'));
    const resolveTermRecipient = async (value: string) => {
      try { return await resolveRecipient(value); }
      catch { throw new Error(t('standardRecipientError')); }
    };
    const [firstArgs, secondArgs] = await Promise.all([resolveTermRecipient(terms.firstRecipient.trim()), resolveTermRecipient(terms.secondRecipient.trim())]);
    if (firstArgs === secondArgs) throw new Error(t('differentRecipientsError'));
    const connector = await import('@ckb-ccc/core');
    const participantArgs = keys.map((slot) => connector.hashCkb(connector.bytesFrom(people[slot]!.publicKey)).slice(0, 42));
    if ([firstArgs, secondArgs].some((args) => participantArgs.includes(args))) throw new Error(t('recipientMustBeDifferentError'));
    return { shared, firstLimit, firstMax, secondLimit, secondMax, firstArgs, secondArgs };
  };
  const next = async () => {
    setError('');
    try {
      if (step === 0) validatePeople();
      if (step === 1) await validateTerms();
      setStep((value) => Math.min(value + 1, 2));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const prepare = async () => {
    setError(''); setPreparing(true);
    try {
      validatePeople();
      const value = await validateTerms();
      const payload = {
        draftId, publicKey: people.owner!.publicKey,
        sharedLimit: value.shared.toString(),
        delegates: [
          { publicKey: people.alice!.publicKey, recipient: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: value.firstArgs }, limit: value.firstLimit.toString(), perPayment: value.firstMax.toString() },
          { publicKey: people.ben!.publicKey, recipient: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: value.secondArgs }, limit: value.secondLimit.toString(), perPayment: value.secondMax.toString() },
        ],
      };
      const fingerprint = JSON.stringify(payload);
      let pending = pendingGenesisRef.current;
      if (!pending || pending.fingerprint !== fingerprint) {
        try {
          const stored = JSON.parse(sessionStorage.getItem(`quotacell.genesis-preparation:${draftKey}`) || 'null') as { id?: unknown; fingerprint?: unknown } | null;
          if (stored && stored.fingerprint === fingerprint && typeof stored.id === 'string' && /^[0-9a-f-]{36}$/i.test(stored.id)) {
            pending = { id: stored.id, fingerprint };
          } else pending = null;
        } catch { pending = null; }
      }
      pending ||= { id: crypto.randomUUID(), fingerprint };
      pendingGenesisRef.current = pending;
      try { sessionStorage.setItem(`quotacell.genesis-preparation:${draftKey}`, JSON.stringify(pending)); } catch { /* The in-memory request ID still supports retry in this tab. */ }
      await onPrepare({ id: pending.id, ...payload }, people, pocketName.trim());
      pendingGenesisRef.current = null;
      setResumePreparation(false);
      try { sessionStorage.removeItem(`quotacell.genesis-preparation:${draftKey}`); } catch { /* Session storage is optional. */ }
    } catch (cause) {
      if (cause instanceof ApiError && cause.retryable) setResumePreparation(true);
      else {
        pendingGenesisRef.current = null;
        try { sessionStorage.removeItem(`quotacell.genesis-preparation:${draftKey}`); } catch { /* Session storage is optional. */ }
        setResumePreparation(false);
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally { setPreparing(false); }
  };
  const ownerIsConnected = Boolean(connectedIdentity && people.owner && people.owner.publicKey.toLowerCase() === connectedIdentity.publicKey.toLowerCase() && people.owner.address === connectedIdentity.address);
  return <main className="setup-page mx-auto w-[min(100%-2rem,64rem)] py-6 md:py-9">
    <button className="text-button setup-back mb-5 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-blue-700" type="button" onClick={onCancel}>← {t('returnPocket')}</button>
    <div className="setup-title flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold text-navy sm:text-[28px]">{t('draftTitle')}</h1><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="draft-state" aria-label={t('draftNotOnChain')}>{t('draftNotOnChain')}</span>{saveStatus === 'saved' && <span className="text-slate-600" role="status">{t('draftSavedOnDevice')}</span>}{(saveStatus === 'error' || saveBlocked) && <span className="flex flex-wrap items-center gap-2 text-red-800" role="alert">{t(saveBlocked ? draftReadErrorKey : 'draftSaveError')}{saveBlocked && initialDraft.error === 'unavailable' && <button className="text-button" type="button" onClick={() => window.location.reload()}>{t('reload')}</button>}{saveBlocked && initialDraft.error === 'corrupt' && <span>{t('draftCorruptAction')}</span>}{saveStatus === 'error' && !saveBlocked && <button className="text-button" type="button" onClick={() => setSaveAttempt((attempt) => attempt + 1)}>{t('retry')}</button>}</span>}</div></div><div className="steps flex items-center justify-between gap-2 sm:gap-5" aria-label={t('setup')}>
      {[t('participants'), t('spendingRules'), t('review')].map((label, index) => <span className={`step inline-flex items-center gap-2 text-xs ${index === step ? 'current font-semibold text-blue' : index < step ? 'done text-success' : 'text-slate-500'}`} key={label}><i className={`grid size-6 place-items-center rounded-full border text-[11px] not-italic ${index === step ? 'border-blue bg-blue text-white' : index < step ? 'border-success text-success' : 'border-slate-300 text-slate-500'}`}>{index + 1}</i>{label}</span>)}
    </div></div>

    {step === 0 && <section className="setup-section mx-auto mt-7 w-full max-w-[830px]">
      <h2 className="mb-1.5 text-xl font-semibold text-navy">{t('stepPeopleTitle')}</h2><p className="section-intro mb-5 text-sm leading-6 text-muted">{t('draftPeopleBody')}</p>
      <div className="people-list">
        <article className="person-row" aria-label={t('owner')}>
          <div className="person-index" aria-hidden="true">O</div>
          <div className="person-fields min-w-0"><div className="person-heading"><h3>{t('owner')}</h3><span className={`participant-state ${ownerIsConnected ? 'is-complete' : ''}`}>{ownerIsConnected ? t('connected') : t('ownerConnectionRequired')}</span></div>{ownerIsConnected && people.owner && <code className="participant-address" dir="ltr" title={people.owner.address}>{shortAddress(people.owner.address)}</code>}</div>
          {!ownerIsConnected && <button className="secondary-button" type="button" disabled={registering !== null} onClick={() => void connect('owner')}>{registering === 'owner' ? t('connectingWallet') : t('connectOwner')}</button>}
        </article>
        {(['alice', 'ben'] as const).map((slot) => {
          const person = people[slot];
          const invitation = inviteBySlot[slot];
          const heading = slot === 'alice' ? t('delegateOne') : t('delegateTwo');
          const registered = Boolean(person?.publicKey);
          const responseImportReady = Boolean(copiedInvitation[slot] || linkFallback[slot]);
          return <article className="person-row" key={slot} aria-label={heading}>
            <div className="person-index" aria-hidden="true">{slot === 'alice' ? '1' : '2'}</div>
            <div className="person-fields min-w-0">
              <div className="person-heading"><h3>{heading}</h3><span className={`participant-state ${registered ? 'is-complete' : ''}`}>{registered ? t('registered') : invitation ? t(responseImportReady ? 'awaitingContributorResponseShort' : 'invitationCreated') : t('notInvited')}</span></div>
              {registered && person && <code className="participant-address" dir="ltr" title={person.address}>{shortAddress(person.address)}</code>}
              {!registered && !invitation && <p className="participant-hint">{t('inviteContributorHint')}</p>}
              {invitation && !registered && <div className="delegate-invitation">
                {!responseImportReady && <p className="participant-hint">{t('sendInvitationHint')}</p>}
                <div className="flex flex-wrap items-center gap-2"><button className="secondary-button" type="button" onClick={() => void copyInvitation(slot)}>{copiedInvitation[slot] ? t('copied') : t('copyInvitation')}</button></div>
                {copiedInvitation[slot] && <p className="copy-status" role="status">{t('invitationCopied')}</p>}
                {linkFallback[slot] && <label className="mt-2 grid gap-1.5 text-xs font-medium text-slate-700">{t('invitationLink')}<input className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-xs" readOnly value={registrationShareUrl(invitation.code)} onFocus={(event) => event.currentTarget.select()}/></label>}
                {responseErrors[slot] && <p className="form-error" role="alert">{responseErrors[slot]}</p>}
                {responseImportReady && <>
                  <label className="mt-3 grid gap-1.5 text-xs font-medium text-slate-700">{t('responseFor', { delegate: heading })}<textarea className="min-h-20 rounded-md border border-slate-300 bg-white p-3 font-mono text-xs" value={responseTexts[slot]} onChange={(event) => { setResponseTexts((previous) => ({ ...previous, [slot]: event.target.value })); setResponseErrors((previous) => ({ ...previous, [slot]: '' })); }} placeholder={t('responsePlaceholder')} /></label>
                  <div className="mt-2 flex flex-wrap items-center gap-3"><button className="primary-button" type="button" disabled={!responseTexts[slot].trim()} onClick={() => void importProfileForSlot(slot, responseTexts[slot])}>{t('importResponse')}</button><details className="contextual-help"><summary>{t('registrationMeaning')}</summary><p>{t('profileTrustNote')}</p></details></div>
                </>}
              </div>}
              {registered && person && <details className="participant-details"><summary>{t('participantDetails')}</summary><div className="person-inputs"><label>{t('name')}<input value={person.name} maxLength={32} placeholder={heading} onChange={(event) => updatePerson(slot, 'name', event.target.value)}/></label><label>{t('description')}<input value={person.description} maxLength={72} onChange={(event) => updatePerson(slot, 'description', event.target.value)}/></label></div><p>{t('ownerAuthorizationRequired')}</p></details>}
            </div>
            {!registered && !invitation && <button className="primary-button" type="button" disabled={creatingInvitation === slot} onClick={() => requestInvitation(slot)}>{creatingInvitation === slot ? t('preparing') : t('inviteContributor')}</button>}
            {(invitation || registered) && <button className="text-button replacement-action" type="button" disabled={creatingInvitation !== null} onClick={() => requestInvitation(slot)}>{registered ? t('replaceContributor') : t('newInvitation')}</button>}
          </article>;
        })}
      </div>
    </section>}

    {step === 1 && <section className="setup-section mx-auto mt-7 w-full max-w-[830px]">
      <h2 className="mb-1.5 text-xl font-semibold text-navy">{t('stepRulesTitle')}</h2><p className="section-intro mb-5 text-sm leading-6 text-muted">{t('stepRulesBody')}</p>
      <label className="field-block shared-field">{t('sharedAllowance')}<span className="input-unit"><input inputMode="decimal" value={terms.shared} onChange={(event) => setTerms({ ...terms, shared: event.target.value })} placeholder="0"/><i>CKB</i></span></label>
      <div className="rule-grid grid gap-3 md:grid-cols-2">{(['alice', 'ben'] as const).map((slot, index) => {
        const prefix = index === 0 ? 'first' : 'second';
        const person = people[slot];
        const label = person?.name.trim() || (index === 0 ? t('delegateOne') : t('delegateTwo'));
        const limit = index === 0 ? terms.firstLimit : terms.secondLimit;
        const max = index === 0 ? terms.firstMax : terms.secondMax;
        const recipient = index === 0 ? terms.firstRecipient : terms.secondRecipient;
        return <section className="rule-section grid min-w-0 content-start gap-3 rounded-lg border border-line bg-white p-4" key={slot}><h3 className="mb-1 text-sm font-semibold text-navy">{label}</h3>
          <label className="field-block">{t('personalAllowance')}<span className="input-unit"><input inputMode="decimal" value={limit} onChange={(event) => setTerms({ ...terms, [prefix === 'first' ? 'firstLimit' : 'secondLimit']: event.target.value })} placeholder="0"/><i>CKB</i></span></label>
          <label className="field-block">{t('perPayment')}<span className="input-unit"><input inputMode="decimal" value={max} onChange={(event) => setTerms({ ...terms, [prefix === 'first' ? 'firstMax' : 'secondMax']: event.target.value })} placeholder="0"/><i>CKB</i></span></label>
          <label className="field-block">{t('approvedRecipient')}<input dir="ltr" className="address-input" value={recipient} onChange={(event) => setTerms({ ...terms, [prefix === 'first' ? 'firstRecipient' : 'secondRecipient']: event.target.value })} placeholder="ckt1…" autoCapitalize="off" autoCorrect="off" spellCheck={false}/></label>
        </section>;
      })}</div>
      <p className="quiet-note mt-3 text-xs leading-5 text-slate-500">{t('termsHint')}</p>
    </section>}

    {step === 2 && <section className="setup-section mx-auto mt-7 w-full max-w-[830px]">
      <h2 className="mb-1.5 text-xl font-semibold text-navy">{t('stepReviewTitle')}</h2><p className="section-intro mb-5 text-sm leading-6 text-muted">{t('draftReviewBody')}</p>
      <div className="review-sheet rounded-lg border border-line bg-white px-4 py-1 sm:px-5">
        <section><div className="review-heading"><h3>{t('participants')}</h3><button className="text-button" type="button" onClick={() => setStep(0)}>{t('edit')}</button></div>
          {keys.map((slot) => <div className="review-row" key={slot}><span>{people[slot]?.name.trim() || (slot === 'owner' ? t('owner') : slot === 'alice' ? t('delegateOne') : t('delegateTwo'))}{people[slot]?.description && <small>{people[slot]?.description}</small>}</span><code>{people[slot]?.address}</code></div>)}
        </section>
        <section><div className="review-heading"><h3>{t('spendingRules')}</h3><button className="text-button" type="button" onClick={() => setStep(1)}>{t('edit')}</button></div>
          <div className="review-row"><span>{t('sharedAllowance')}</span><strong>{terms.shared} CKB</strong></div>
          {(['alice', 'ben'] as const).map((slot, index) => { const isFirst = index === 0; const limit = isFirst ? terms.firstLimit : terms.secondLimit; const max = isFirst ? terms.firstMax : terms.secondMax; const recipient = isFirst ? terms.firstRecipient : terms.secondRecipient; return <div className="review-delegate" key={slot}><strong>{people[slot]?.name.trim() || (isFirst ? t('delegateOne') : t('delegateTwo'))}</strong><div className="review-row"><span>{t('personalAllowance')}</span><b>{limit} CKB</b></div><div className="review-row"><span>{t('perPayment')}</span><b>{max} CKB</b></div><div className="review-row recipient-review"><span>{t('approvedRecipient')}</span><code dir="ltr">{recipient}</code></div></div>; })}
        </section>
      </div>
      <label className="field-block">{t('pocketNameDefault')} ({t('optional')})
        <input maxLength={60} value={pocketName} onChange={event => setPocketName(event.target.value)}/>
        <small>{t('pocketNameLocal')}</small>
      </label>
      <p className="quiet-note mt-3 text-xs leading-5 text-slate-500">{t('draftCapacity')}</p>
      {!canPrepareCreation && <p className="quiet-note mt-3 text-sm text-slate-700" role="status">{pudgeReadOnly ? t('readonlyAction') : creationBlocked ? t('unresolvedBody') : t('creationUnavailable')}</p>}
    </section>}

    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="setup-actions mx-auto mt-6 flex w-full max-w-[830px] justify-end gap-2">{step > 0 && <button className="secondary-button" type="button" disabled={preparing} onClick={() => { setError(''); setStep(step - 1); }}>{t('back')}</button>}{step < 2 ? <button className="primary-button" type="button" disabled={preparing} onClick={() => void next()}>{t('continue')} <span aria-hidden="true">→</span></button> : <button className="primary-button" type="button" disabled={preparing || !canPrepareCreation} onClick={() => void prepare()}>{preparing ? t('preparing') : resumePreparation ? t('resumePreparation') : t(prepareOnly ? 'prepareForReview' : 'createAndSign')} <span aria-hidden="true">→</span></button>}</div>
    <AlertDialog.Root open={Boolean(replaceSlot)} onOpenChange={(open) => { if (!open) setReplaceSlot(null); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay"/><AlertDialog.Content className="dialog-content alert-dialog" aria-modal="true"><AlertDialog.Title className="dialog-title">{people[replaceSlot || 'alice']?.publicKey ? t('replaceContributorTitle') : t('replaceInvitationTitle')}</AlertDialog.Title><AlertDialog.Description className="dialog-description">{people[replaceSlot || 'alice']?.publicKey ? t('replaceContributorBody') : t('replaceInvitationBody')}</AlertDialog.Description><div className="dialog-actions"><AlertDialog.Cancel asChild><button className="secondary-button" type="button">{t('cancel')}</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="primary-button" type="button" onClick={() => { if (replaceSlot) void createInvitation(replaceSlot, true); }}>{t('confirmReplace')}</button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </main>;
}

export type { People, Slot };

function shortAddress(address: string) {
  return address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-10)}` : address;
}

function registrationError(cause: unknown, t: (key: string) => string) {
  const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  if (/different wallet|already assigned/.test(message)) return t('responseDuplicateIdentity');
  if (/network|unsupported version/.test(message)) return t('responseWrongNetwork');
  if (/invitation|request id|does not match/.test(message)) return t('responseWrongInvitation');
  if (/slot/.test(message)) return t('responseWrongSlot');
  return t('responseInvalid');
}
