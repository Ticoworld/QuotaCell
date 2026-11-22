import { Address, Script } from '@ckb-ccc/core';
import { useTranslation } from 'react-i18next';
import { formatCkb } from './amount';
import type { PocketState } from './domain';

export function PublicPolicyRules({ owner, delegates }: Pick<PocketState, 'owner' | 'delegates'>) {
  const { t } = useTranslation();
  if (!owner || !delegates?.length) return null;
  return <section className="public-permissions my-5">
    <h2>{t('delegatePermissions')}</h2>
    <p>{t('owner')} <code className="break-all" dir="ltr">{owner}</code></p>
    {delegates.map((delegate, index) => {
      const remaining = BigInt(delegate.limit) - BigInt(delegate.used);
      const address = new Address(Script.from({
        codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
        hashType: 'type', args: delegate.recipient,
      }), 'ckt').toString();
      return <div key={delegate.role} className="my-3 grid gap-1 border-t border-line pt-3">
        <strong>{t(index === 0 ? 'delegateOne' : 'delegateTwo')} · {t(delegate.enabled ? 'active' : 'revoked')}</strong>
        <code className="break-all" dir="ltr">{delegate.publicKey}</code>
        <span>{t('sharedUsedOf', { used: formatCkb(delegate.used), total: formatCkb(delegate.limit) })}</span>
        <span>{t('remaining')} {formatCkb(remaining > 0n ? remaining : 0n)} CKB · {t('maxPayment')} {formatCkb(delegate.perPayment)} CKB</span>
        <span>{t('recipient')} <code className="break-all" dir="ltr">{address}</code></span>
      </div>;
    })}
  </section>;
}
