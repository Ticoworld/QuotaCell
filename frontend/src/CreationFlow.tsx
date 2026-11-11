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

  return <main className="setup-page">
    <button className="text-button setup-back" type="button" onClick={onCancel}>← {t('back')} · {t('brand')}</button>
    <div className="setup-title"><h1>{t('setup')}</h1><div className="steps" aria-label={t('setup')}>
      {[t('participants'), t('spendingRules'), t('review')].map((label, index) => <span className={index === step ? 'step current' : index < step ? 'step done' : 'step'} key={label}><i>{index + 1}</i>{label}</span>)}
    </div></div>

    {step === 0 && <section className="setup-section">
      <h2>{t('stepPeopleTitle')}</h2><p className="section-intro">{t('stepPeopleBody')}</p>
      <div className="people-list">{keys.map((slot) => {
        const person = people[slot];
        const heading = slot === 'owner' ? t('owner') : slot === 'alice' ? t('delegateOne') : t('delegateTwo');
        return <article className="person-row" key={slot}>
          <div className="person-index" aria-hidden="true">{slot === 'owner' ? 'O' : slot === 'alice' ? '1' : '2'}</div>
          <div className="person-fields"><div className="person-heading"><h3>{heading}</h3>{person && <span className="registered-state">{t('registered')}</span>}</div>
            <div className="person-inputs"><label>{t('name')}<input value={person?.name || ''} maxLength={32} onChange={(event) => updatePerson(slot, 'name', event.target.value)} placeholder={heading}/></label><label>{t('description')}<input value={person?.description || ''} maxLength={72} onChange={(event) => updatePerson(slot, 'description', event.target.value)}/></label></div>
            {person && <div className="registered-address"><span title={person.address}>{shortAddress(person.address)}</span><details className="participant-inspector"><summary>{t('technical')}</summary><div><span>{t('publicKey')}</span><code dir="ltr">{person.publicKey}</code></div></details></div>}
          </div><button className="secondary-button connect-participant" type="button" disabled={registering !== null} onClick={() => void connect(slot)}>{registering === slot ? t('preparing') : person ? t('reconnect') : t('connect')}</button>
        </article>;
      })}</div>
      <p className="quiet-note">{t('nameLocal')}</p>
    </section>}

    {step === 1 && <section className="setup-section">
      <h2>{t('stepRulesTitle')}</h2><p className="section-intro">{t('stepRulesBody')}</p>
      <label className="field-block shared-field">{t('sharedAllowance')}<span className="input-unit"><input inputMode="decimal" value={terms.shared} onChange={(event) => setTerms({ ...terms, shared: event.target.value })} placeholder="0"/><i>CKB</i></span></label>
      <div className="rule-grid">{(['alice', 'ben'] as const).map((slot, index) => {
        const prefix = index === 0 ? 'first' : 'second';
        const person = people[slot];
        const label = person?.name.trim() || (index === 0 ? t('delegateOne') : t('delegateTwo'));
        const limit = index === 0 ? terms.firstLimit : terms.secondLimit;
        const max = index === 0 ? terms.firstMax : terms.secondMax;
        const recipient = index === 0 ? terms.firstRecipient : terms.secondRecipient;
        return <section className="rule-section" key={slot}><h3>{label}</h3>
          <label className="field-block">{t('personalAllowance')}<span className="input-unit"><input inputMode="decimal" value={limit} onChange={(event) => setTerms({ ...terms, [prefix === 'first' ? 'firstLimit' : 'secondLimit']: event.target.value })} placeholder="0"/><i>CKB</i></span></label>
          <label className="field-block">{t('perPayment')}<span className="input-unit"><input inputMode="decimal" value={max} onChange={(event) => setTerms({ ...terms, [prefix === 'first' ? 'firstMax' : 'secondMax']: event.target.value })} placeholder="0"/><i>CKB</i></span></label>
          <label className="field-block">{t('approvedRecipient')}<input dir="ltr" className="address-input" value={recipient} onChange={(event) => setTerms({ ...terms, [prefix === 'first' ? 'firstRecipient' : 'secondRecipient']: event.target.value })} placeholder="ckt1…" autoCapitalize="off" autoCorrect="off" spellCheck={false}/></label>
        </section>;
      })}</div>
      <p className="quiet-note">{t('termsHint')}</p>
    </section>}

    {step === 2 && <section className="setup-section">
      <h2>{t('stepReviewTitle')}</h2><p className="section-intro">{t('stepReviewBody')}</p>
      <div className="review-sheet">
        <section><div className="review-heading"><h3>{t('participants')}</h3><button className="text-button" type="button" onClick={() => setStep(0)}>{t('edit')}</button></div>
          {keys.map((slot) => <div className="review-row" key={slot}><span>{people[slot]?.name.trim() || (slot === 'owner' ? t('owner') : slot === 'alice' ? t('delegateOne') : t('delegateTwo'))}{people[slot]?.description && <small>{people[slot]?.description}</small>}</span><code>{people[slot]?.address}</code></div>)}
        </section>
        <section><div className="review-heading"><h3>{t('spendingRules')}</h3><button className="text-button" type="button" onClick={() => setStep(1)}>{t('edit')}</button></div>
          <div className="review-row"><span>{t('sharedAllowance')}</span><strong>{terms.shared} CKB</strong></div>
          {(['alice', 'ben'] as const).map((slot, index) => { const isFirst = index === 0; const limit = isFirst ? terms.firstLimit : terms.secondLimit; const max = isFirst ? terms.firstMax : terms.secondMax; const recipient = isFirst ? terms.firstRecipient : terms.secondRecipient; return <div className="review-delegate" key={slot}><strong>{people[slot]?.name.trim() || (isFirst ? t('delegateOne') : t('delegateTwo'))}</strong><div className="review-row"><span>{t('personalAllowance')}</span><b>{limit} CKB</b></div><div className="review-row"><span>{t('perPayment')}</span><b>{max} CKB</b></div><div className="review-row recipient-review"><span>{t('approvedRecipient')}</span><code dir="ltr">{recipient}</code></div></div>; })}
        </section>
      </div>
      <p className="quiet-note">{t('ownerInputNote')}</p>
    </section>}

    {error && <p className="form-error" role="alert">{error}</p>}
    {pudgeReadOnly && <p className="readonly-notice" role="status">{t('readonlyAction')}</p>}
    <div className="setup-actions">{step > 0 && <button className="secondary-button" type="button" disabled={preparing} onClick={() => { setError(''); setStep(step - 1); }}>{t('back')}</button>}{step < 2 ? <button className="primary-button" type="button" onClick={() => void next()}>{t('next')} <span aria-hidden="true">→</span></button> : <button className="primary-button" type="button" disabled={preparing || pudgeReadOnly} onClick={() => void prepare()}>{preparing ? t('preparing') : t('createAndSign')} <span aria-hidden="true">→</span></button>}</div>
  </main>;
}

export type { People, Slot };

function shortAddress(address: string) {
  return address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-10)}` : address;
}
