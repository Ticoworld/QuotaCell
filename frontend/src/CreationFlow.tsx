import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseCkb } from './amount';
import { resolveRecipient } from './api';
import type { WalletIdentity } from './domain';

type Slot = 'owner' | 'alice' | 'ben';
type Person = WalletIdentity & { name: string; description: string };
type People = Record<Slot, Person | null>;
type Terms = { shared: string; firstLimit: string; firstMax: string; firstRecipient: string; secondLimit: string; secondMax: string; secondRecipient: string };
const emptyTerms: Terms = { shared: '', firstLimit: '', firstMax: '', firstRecipient: '', secondLimit: '', secondMax: '', secondRecipient: '' };
const initialPeople: People = { owner: null, alice: null, ben: null };
const keys: Slot[] = ['owner', 'alice', 'ben'];

type Props = {
  pudgeReadOnly: boolean;
  onConnectParticipant: () => Promise<WalletIdentity>;
  onPrepare: (body: unknown, people: People) => Promise<void>;
  onCancel: () => void;
};

export function CreationFlow({ pudgeReadOnly, onConnectParticipant, onPrepare, onCancel }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [people, setPeople] = useState<People>(initialPeople);
  const [terms, setTerms] = useState<Terms>(emptyTerms);
  const [registering, setRegistering] = useState<Slot | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);

  const updatePerson = (slot: Slot, key: 'name' | 'description', value: string) => {
    setPeople((prev) => ({ ...prev, [slot]: { ...(prev[slot] || { publicKey: '', address: '', name: '', description: '' }), [key]: value } }));
  };
  const connect = async (slot: Slot) => {
    setError('');
    setRegistering(slot);
    try {
      const identity = await onConnectParticipant();
      const duplicate = keys.find((key) => key !== slot && people[key]?.publicKey.toLowerCase() === identity.publicKey.toLowerCase());
      if (duplicate) throw new Error(t('differentWalletsError'));
      setPeople((prev) => ({ ...prev, [slot]: { ...prev[slot], ...identity, name: prev[slot]?.name || '', description: prev[slot]?.description || '' } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setRegistering(null); }
  };
  const validatePeople = () => {
    if (keys.some((slot) => !people[slot]?.publicKey)) throw new Error(t('connectAllPeopleError'));
    const registered = keys.map((slot) => people[slot]!.publicKey.toLowerCase());
    if (new Set(registered).size !== 3) throw new Error(t('differentWalletsError'));
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
    setError('');
    setPreparing(true);
    try {
      validatePeople();
      const value = await validateTerms();
      await onPrepare({
        id: crypto.randomUUID(),
        publicKey: people.owner!.publicKey,
        sharedLimit: value.shared.toString(),
        delegates: [
          { publicKey: people.alice!.publicKey, recipient: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: value.firstArgs }, limit: value.firstLimit.toString(), perPayment: value.firstMax.toString() },
          { publicKey: people.ben!.publicKey, recipient: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: value.secondArgs }, limit: value.secondLimit.toString(), perPayment: value.secondMax.toString() },
        ],
      }, people);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPreparing(false); }
  };

  return <main className="setup-page mx-auto w-[min(100%-2rem,64rem)] py-6 md:py-9">
    <button className="text-button setup-back mb-5 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-blue-700" type="button" onClick={onCancel}>← {t('back')} · {t('brand')}</button>
    <div className="setup-title flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between"><h1 className="text-2xl font-bold text-navy sm:text-[28px]">{t('setup')}</h1><div className="steps flex items-center justify-between gap-2 sm:gap-5" aria-label={t('setup')}>
      {[t('participants'), t('spendingRules'), t('review')].map((label, index) => <span className={`step inline-flex items-center gap-2 text-xs ${index === step ? 'current font-semibold text-blue' : index < step ? 'done text-success' : 'text-slate-500'}`} key={label}><i className={`grid size-6 place-items-center rounded-full border text-[11px] not-italic ${index === step ? 'border-blue bg-blue text-white' : index < step ? 'border-success text-success' : 'border-slate-300 text-slate-500'}`}>{index + 1}</i>{label}</span>)}
    </div></div>

    {step === 0 && <section className="setup-section mx-auto mt-7 w-full max-w-[830px]">
      <h2 className="mb-1.5 text-xl font-semibold text-navy">{t('stepPeopleTitle')}</h2><p className="section-intro mb-5 text-sm leading-6 text-muted">{t('stepPeopleBody')}</p>
      <div className="people-list grid gap-3">{keys.map((slot) => {
        const person = people[slot];
        const heading = slot === 'owner' ? t('owner') : slot === 'alice' ? t('delegateOne') : t('delegateTwo');
        return <article className="person-row grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 rounded-lg border border-line bg-white p-3.5 shadow-sm sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:gap-4 sm:p-4" key={slot}>
          <div className="person-index grid size-8 place-items-center rounded-md border border-blue-100 bg-blue-wash text-sm font-bold text-blue-800 sm:size-9" aria-hidden="true">{slot === 'owner' ? 'O' : slot === 'alice' ? '1' : '2'}</div>
          <div className="person-fields min-w-0"><div className="person-heading mb-3 flex flex-wrap items-baseline gap-2"><h3 className="m-0 text-sm font-semibold text-navy">{heading}</h3>{person && <span className="registered-state text-xs font-medium text-success">{t('registered')}</span>}</div>
            <div className="person-inputs grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-semibold text-slate-700">{t('name')}<input className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-ink focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20" value={person?.name || ''} maxLength={32} onChange={(event) => updatePerson(slot, 'name', event.target.value)} placeholder={heading}/></label><label className="grid gap-1.5 text-xs font-semibold text-slate-700">{t('description')}<input className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-ink focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20" value={person?.description || ''} maxLength={72} onChange={(event) => updatePerson(slot, 'description', event.target.value)}/></label></div>
            {person && <div className="registered-address"><span title={person.address}>{shortAddress(person.address)}</span><details className="participant-inspector"><summary>{t('technical')}</summary><div><span>{t('publicKey')}</span><code dir="ltr">{person.publicKey}</code></div></details></div>}
          </div><button className="secondary-button connect-participant col-start-2 justify-self-start sm:col-auto" type="button" disabled={registering !== null} onClick={() => void connect(slot)}>{registering === slot ? t('preparing') : person ? t('reconnect') : t('connect')}</button>
        </article>;
      })}</div>
      <p className="quiet-note mt-3 text-xs leading-5 text-slate-500">{t('nameLocal')}</p>
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
      <h2 className="mb-1.5 text-xl font-semibold text-navy">{t('stepReviewTitle')}</h2><p className="section-intro mb-5 text-sm leading-6 text-muted">{t('stepReviewBody')}</p>
      <div className="review-sheet rounded-lg border border-line bg-white px-4 py-1 sm:px-5">
        <section><div className="review-heading"><h3>{t('participants')}</h3><button className="text-button" type="button" onClick={() => setStep(0)}>{t('edit')}</button></div>
          {keys.map((slot) => <div className="review-row" key={slot}><span>{people[slot]?.name.trim() || (slot === 'owner' ? t('owner') : slot === 'alice' ? t('delegateOne') : t('delegateTwo'))}{people[slot]?.description && <small>{people[slot]?.description}</small>}</span><code>{people[slot]?.address}</code></div>)}
        </section>
        <section><div className="review-heading"><h3>{t('spendingRules')}</h3><button className="text-button" type="button" onClick={() => setStep(1)}>{t('edit')}</button></div>
          <div className="review-row"><span>{t('sharedAllowance')}</span><strong>{terms.shared} CKB</strong></div>
          {(['alice', 'ben'] as const).map((slot, index) => { const isFirst = index === 0; const limit = isFirst ? terms.firstLimit : terms.secondLimit; const max = isFirst ? terms.firstMax : terms.secondMax; const recipient = isFirst ? terms.firstRecipient : terms.secondRecipient; return <div className="review-delegate" key={slot}><strong>{people[slot]?.name.trim() || (isFirst ? t('delegateOne') : t('delegateTwo'))}</strong><div className="review-row"><span>{t('personalAllowance')}</span><b>{limit} CKB</b></div><div className="review-row"><span>{t('perPayment')}</span><b>{max} CKB</b></div><div className="review-row recipient-review"><span>{t('approvedRecipient')}</span><code dir="ltr">{recipient}</code></div></div>; })}
        </section>
      </div>
      <p className="quiet-note mt-3 text-xs leading-5 text-slate-500">{t('ownerInputNote')}</p>
    </section>}

    {error && <p className="form-error" role="alert">{error}</p>}
    {pudgeReadOnly && <p className="readonly-notice" role="status">{t('readonlyAction')}</p>}
    <div className="setup-actions mx-auto mt-6 flex w-full max-w-[830px] justify-end gap-2">{step > 0 && <button className="secondary-button" type="button" disabled={preparing} onClick={() => { setError(''); setStep(step - 1); }}>{t('back')}</button>}{step < 2 ? <button className="primary-button" type="button" onClick={() => void next()}>{t('next')} <span aria-hidden="true">→</span></button> : <button className="primary-button" type="button" disabled={preparing || pudgeReadOnly} onClick={() => void prepare()}>{preparing ? t('preparing') : t('createAndSign')} <span aria-hidden="true">→</span></button>}</div>
  </main>;
}

export type { People, Slot };

function shortAddress(address: string) {
  return address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-10)}` : address;
}
