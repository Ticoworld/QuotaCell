import type { PocketState } from './domain';
import type { SavedPocketDraft } from './drafts';

type Props = {
  pockets: NonNullable<PocketState['discovery']>;
  drafts: SavedPocketDraft[];
  ownerCanCreate: boolean;
  locale: string;
  loading: boolean;
  error: string;
  t: (key: string) => string;
  onOpen: (pocket: string) => void;
  onCreate: () => void;
  onResume: (draftId: string) => void;
};

export function PocketPicker({ pockets, drafts, ownerCanCreate, locale, loading, error, t, onOpen, onCreate, onResume }: Props) {
  const date = (value: number) => new Intl.DateTimeFormat(locale === 'zh-Hans' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  return <main className="mx-auto w-[min(100%-2rem,64rem)] py-7 sm:py-10">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="m-0 text-2xl font-bold text-navy">{t('myPockets')}</h1>
      {ownerCanCreate && <button className="primary-button" type="button" onClick={onCreate}>{t('newPocket')} <span aria-hidden="true">→</span></button>}
    </div>
    {loading && <p className="text-sm text-slate-600" role="status">{t('discoveringPockets')}</p>}
    {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800" role="alert">{error}</p>}
    {!loading && pockets.length > 0 && <section aria-label={t('myPockets')}>
      <div className="divide-y divide-slate-200 border-y border-slate-200">{pockets.map((item) => <div key={item.pocket} className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0"><strong className="text-sm text-navy">{item.closed ? t('closedPocket') : t('activePocket')}</strong><span className="ml-2 text-xs text-slate-600">{t(item.role === 'owner' ? 'owner' : item.role === 'alice' ? 'delegateOne' : 'delegateTwo')}</span><code className="mt-1 block break-all text-xs text-slate-600" dir="ltr">{item.pocket}</code>{item.closed && <small className="mt-1 block text-xs text-slate-500">{t('historicalPocketUnavailable')}</small>}</div>
        <button className="secondary-button shrink-0" type="button" onClick={() => onOpen(item.pocket)}>{t('openPocket')}</button>
      </div>)}</div>
    </section>}
    {!loading && pockets.length === 0 && <p className="border-y border-slate-200 py-4 text-sm text-slate-600" role="status">{t('noPocketsForWallet')}</p>}
    {drafts.length > 0 && <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold text-navy">{t('savedDrafts')}</h2>
      <div className="divide-y divide-slate-200 border-y border-slate-200">{drafts.map((draft) => <div key={draft.id} className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center">
        <div><strong className="text-sm font-medium text-navy">{t('draftTitle')}</strong><span className="ml-2 text-xs text-slate-500">{t('draftNotOnChain')} · {date(draft.updatedAt)}</span></div>
        <button className="secondary-button shrink-0" type="button" onClick={() => onResume(draft.id)}>{t('resumeDraft')}</button>
      </div>)}</div>
    </section>}
  </main>;
}
