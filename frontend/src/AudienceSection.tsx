import { useState } from 'react';

type Translate = (english: string, chinese: string) => string;

export function AudienceSection({ t, pocketId }: { t: Translate; pocketId: string }) {
  const [selected, select] = useState(0);
  const audiences = [
    {
      symbol: '▤',
      steps: [t('Fund the Pocket', '为资金口袋注资'), t('Set two limits', '设置两份限额'), t('Pay contributors’ expenses', '支付贡献者费用')],
      name: t('Project treasuries', '项目金库'),
      people: t('Founders and small CKB teams', '创始人和小型 CKB 团队'),
      title: t('Give contributors a budget of their own.', '为贡献者分配各自的预算。'),
      example: t('A small project sets aside test CKB for two contributors to pay approved recipients. The owner sets a shared budget and a separate cap for each wallet.', '小型项目可为两位贡献者预留测试 CKB，供他们向获准收款人付款。所有者设定共享预算及每个钱包的独立限额。'),
      action: t('Open the testnet wallet', '打开测试网钱包'),
      href: '/app',
    },
    {
      symbol: '⇄',
      steps: [t('Approve recipients', '批准收款人'), t('Delegate pays', '授权人付款'), t('Owner can revoke access', '所有者可撤销权限')],
      name: t('Operations teams', '运营团队'),
      people: t('Two trusted spending delegates', '两位受信任的支出授权人'),
      title: t('Let two operators handle routine payments.', '让两位运营人员处理日常付款。'),
      example: t('Two operators can pay pre-approved recipients from their own wallets. If responsibilities change, the owner can revoke one operator’s access.', '两位运营人员可使用各自的钱包向预先批准的收款人付款。职责变更时，所有者可撤销其中一人的权限。'),
      action: t('See how access works', '查看权限如何运作'),
      href: '#pockets',
    },
    {
      symbol: '⌘',
      steps: [t('Open a testnet Pocket', '打开测试网资金口袋'), t('Inspect a payment', '查看付款'), t('Verify the closeout', '验证关闭记录')],
      name: t('CKB builders', 'CKB 开发者'),
      people: t('Wallet developers and testers', '钱包开发者和测试人员'),
      title: t('Explore enforceable delegated spending on CKB.', '探索 CKB 上可强制执行的授权支出。'),
      example: t('Inspect a real testnet Pocket and trace its payments and closure. Use a compatible wallet to test signing and recovery flows with test CKB.', '查看真实的测试网资金口袋及其付款和关闭记录，并用兼容钱包和测试 CKB 测试签名与资金收回流程。'),
      action: t('Inspect the testnet Pocket', '查看测试网资金口袋'),
      href: '/app?pocket=' + pocketId,
    },
  ];
  const audience = audiences[selected];

  return <section className="land-audiences" id="use-cases" aria-labelledby="audience-title">
    <div className="land-wrap land-audience-body">
      <h2 id="audience-title">{t('Who QuotaCell is for', '谁适合使用 QuotaCell')}</h2>
      <div className="land-audience-layout">
        <div className="land-audience-options" role="group" aria-label={t('Choose an audience', '选择受众')}>
          {audiences.map(({ name, people, symbol }, index) => <button key={name} type="button"
            aria-pressed={index === selected} aria-controls="audience-example" onClick={() => select(index)}>
            <span className="land-audience-icon" aria-hidden="true">{symbol}</span><span><strong>{name}</strong><small>{people}</small></span>
          </button>)}
        </div>
        <article className="land-audience-example" id="audience-example" aria-live="polite">
          <div className="land-audience-copy" key={selected}>
            <h3>{audience.title}</h3>
            <p>{audience.example}</p>
            <ol className="land-audience-flow">{audience.steps.map(step => <li key={step}>{step}</li>)}</ol>
            <a href={audience.href}>{audience.action} <span aria-hidden="true">↗</span></a>
          </div>
        </article>
      </div>
      <p className="land-audience-note">{t('Experimental testnet beta · Two delegate slots fixed at creation · 61 CKB minimum per payment', '实验性测试网测试版 · 创建时固定两位授权人 · 单笔付款最低 61 CKB')}</p>
    </div>
  </section>;
}
