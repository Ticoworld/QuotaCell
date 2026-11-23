import * as Dialog from '@radix-ui/react-dialog';
import type { FormEvent } from 'react';

type Props = { t: (key: string) => string; input: string; invalid: boolean; busy: boolean; connected: boolean; onInput: (value: string) => void; onSubmit: (event: FormEvent) => void; onExample: () => void; onConnect: () => void };
export function PocketEntrance({ t, input, invalid, busy, connected, onInput, onSubmit, onExample, onConnect }: Props) {
  return <main className="pocket-entrance"><h1>{t('entranceTitle')}</h1><p>{t('entranceIntro')}</p>
    <button className="example-entry" type="button" onClick={onExample}><span><strong>{t('examplePocket')}</strong><small>{t('exampleDescription')}</small></span><b>{t('openPocketEntry')} <span aria-hidden="true">→</span></b></button>
    <div className="entrance-options-label">{t('otherWays')}</div><div className="entrance-options">
      <Dialog.Root><Dialog.Trigger asChild><button className="secondary-button" type="button">{t('openByLink')}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{t('openByIdOrLink')}</Dialog.Title><Dialog.Description>{t('openByLinkHint')}</Dialog.Description><form onSubmit={onSubmit}><label className="field-block">{t('openByIdOrLink')}<input autoFocus value={input} onChange={event => onInput(event.target.value)}/></label>{invalid && <p role="alert">{t('invalidPocketLink')}</p>}<div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button" type="button">{t('cancel')}</button></Dialog.Close><button className="primary-button" type="submit">{t('openPocketEntry')}</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>
      {!connected && <button className="secondary-button" type="button" disabled={busy} onClick={onConnect}>{busy ? t('connectingWallet') : t('disconnected')}</button>}
    </div><small className="entrance-network">{t('networkPudge')}</small></main>;
}

export function PocketOpening({ t }: { t: (key: string) => string }) {
  return <main className="app-page pocket-opening" aria-busy="true"><div className="pocket-heading"><h1>{t('activePocket')}</h1><p role="status">{t('verifyingPocket')}</p></div><section className="metrics"><article className="metric"><h2>{t('protectedBalance')}</h2><div className="number-placeholder" aria-hidden="true"/><p role="status">{t('checkingFunds')}</p></article><article className="metric"><h2>{t('sharedAllowance')}</h2><div className="number-placeholder" aria-hidden="true"/><p>{t('checkingPolicy')}</p></article></section><div className="pocket-content-columns"><section className="loading-section"><h2>{t('delegatePermissions')}</h2><p>{t('checkingPolicy')}</p></section><section className="loading-section"><h2>{t('history')}</h2><p>{t('chainHistoryLoading')}</p></section></div></main>;
}
