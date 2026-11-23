import * as Dialog from '@radix-ui/react-dialog';
import { paymentUpperBound } from './pocketPayment';
import { Address, Script } from '@ckb-ccc/core';
import { useTranslation } from 'react-i18next';
import { formatCkb } from './amount';
import type { PocketState } from './domain';

export function PublicPolicyRules({ owner, delegates, liquidity }: Pick<PocketState, 'owner' | 'delegates'> & { liquidity?: { capacity: bigint; count: number; shared: bigint } }) {
  const { t } = useTranslation();
  if (!owner || !delegates?.length) return null;
  return <section className="public-permissions"><h2>{t('participantsPermissions')}</h2>
    <Dialog.Root><Dialog.Trigger asChild><button className="public-person" type="button"><span className="participant-mark">O</span><span><strong>{t('owner')}</strong></span><span aria-hidden="true">›</span></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{t('owner')}</Dialog.Title><Dialog.Description>{t('publicKey')}</Dialog.Description><code dir="ltr" className="break-all">{owner}</code><Dialog.Close asChild><button className="secondary-button dialog-close">{t('close')}</button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
    {delegates.map((delegate, index) => {
      const remaining = BigInt(delegate.limit) - BigInt(delegate.used);
      const address = new Address(Script.from({ codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: delegate.recipient }), 'ckt').toString();
      const name = t(index === 0 ? 'delegateOne' : 'delegateTwo');
      return <Dialog.Root key={delegate.role}><Dialog.Trigger asChild><button className="public-person" type="button"><span className="participant-mark">{index + 1}</span><span><strong>{name}</strong><small>{t('remaining')} {formatCkb(remaining > 0n ? remaining : 0n)} CKB · {t('maxPayment')} {formatCkb(delegate.perPayment)} CKB</small></span><span>{t(delegate.enabled ? 'active' : 'revoked')} ›</span></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{name}</Dialog.Title><Dialog.Description>{t(delegate.enabled ? 'active' : 'revoked')}</Dialog.Description><dl className="inspection-list"><dt>{t('publicKey')}</dt><dd><code dir="ltr">{delegate.publicKey}</code></dd><dt>{t('recipient')}</dt><dd><code dir="ltr">{address}</code></dd><dt>{t('personalAllowance')}</dt><dd>{t('sharedUsedOf', { used: formatCkb(delegate.used), total: formatCkb(delegate.limit) })}</dd><dt>{t('maxPayment')}</dt><dd>{formatCkb(delegate.perPayment)} CKB</dd>{liquidity && <><dt>{t('publicPaymentBound')}</dt><dd>{formatCkb(paymentUpperBound(liquidity.capacity, liquidity.count, delegate.enabled, liquidity.shared, remaining, BigInt(delegate.perPayment)))} CKB</dd></>}</dl>{liquidity && <p>{t('publicPaymentPrerequisites')}</p>}<Dialog.Close asChild><button className="secondary-button dialog-close">{t('close')}</button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
    })}
  </section>;
}
