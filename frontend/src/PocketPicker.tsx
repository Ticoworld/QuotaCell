import { useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
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
  onDiscard: (draftId: string) => boolean;
};

export function PocketPicker({ pockets, drafts, ownerCanCreate, locale, loading, error, t, onOpen, onCreate, onResume, onDiscard }: Props) {
  const [discardDraftId, setDiscardDraftId] = useState('');
  const discardDraft = drafts.find((draft) => draft.id === discardDraftId);
  const date = (value: number) => new Intl.DateTimeFormat(locale === 'zh-Hans' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  return <>
  <main className="mx-auto w-[min(100%-2rem,64rem)] py-7 sm:py-10">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="m-0 text-2xl font-bold text-navy">{t('myPockets')}</h1>
      {ownerCanCreate && <button className="primary-button" type="button" onClick={onCreate}>{t('newPocket')} <span aria-hidden="true">→</span></button>}
    </div>
    {loading && <section className="border-y border-slate-200" aria-busy="true" aria-label={t('checkingPocketList')}>
      <p className="py-3 text-sm text-slate-600" role="status">{t('checkingPocketList')}</p>
      {Array.from({ length: 2 }, (_, index) => <div key={index} className="flex flex-col justify-between gap-3 border-t border-slate-200 py-4 sm:flex-row sm:items-center" aria-hidden="true">
        <div className="min-w-0 flex-1 animate-pulse space-y-2"><div className="h-4 w-36 rounded-sm bg-slate-200"/><div className="h-3 w-[min(100%,28rem)] rounded-sm bg-slate-100"/><div className="h-3 w-48 rounded-sm bg-slate-100"/></div>
        <div className="h-10 w-32 animate-pulse rounded-md bg-slate-100"/>
      </div>)}
    </section>}
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
        <div className="flex shrink-0 items-center gap-3"><button className="text-button" type="button" onClick={() => setDiscardDraftId(draft.id)}>{t('removeDraft')}</button><button className="secondary-button" type="button" onClick={() => onResume(draft.id)}>{t('resumeDraft')}</button></div>
      </div>)}</div>
    </section>}
  </main>
    <AlertDialog.Root open={Boolean(discardDraft)} onOpenChange={(open) => { if (!open) setDiscardDraftId(''); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay"/><AlertDialog.Content className="dialog-content alert-dialog" aria-modal="true">
        <AlertDialog.Title className="dialog-title">{t('removeDraftTitle')}</AlertDialog.Title>
        <AlertDialog.Description className="dialog-description">{t('removeDraftBody')}</AlertDialog.Description>
        <div className="dialog-actions"><AlertDialog.Cancel asChild><button className="secondary-button" type="button">{t('cancel')}</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="secondary-button border-red-300 text-red-700 hover:bg-red-50" type="button" onClick={(event) => { event.preventDefault(); if (discardDraft && onDiscard(discardDraft.id)) setDiscardDraftId(''); }}>{t('removeDraft')}</button></AlertDialog.Action></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}
