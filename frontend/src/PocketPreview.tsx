import { useState } from 'react';
import './pocket-preview.css';

type Translate = (english: string, chinese: string) => string;
type View = 'access' | 'payment' | 'closeout';

export function PocketPreview({ t, hashes }: { t: Translate; hashes: Record<View, string> }) {
  const [selected, select] = useState<View>('access');
  const views = [
    { id: 'access', title: t('Share spending access', '共享支出权限'), summary: t('Two wallets can spend from one Pocket, each within its own limit.', '两个钱包可在各自限额内从同一资金口袋付款。') },
    { id: 'payment', title: t('See a payment', '查看一笔付款'), summary: t('One payment reduces both the shared limit and the payer’s remaining allowance.', '一笔付款同时占用共享额度和付款人的剩余额度。') },
    { id: 'closeout', title: t('Close the Pocket', '关闭资金口袋'), summary: t('Spending ends and the remaining Pocket funds return to the owner.', '支出权限终止，剩余资金返还所有者。') },
  ] as const;

  function renderPreview(view: View) {
    return <div className={`pocket-preview pocket-preview--${view}`} key={view}>
      <div className="pocket-preview-scene">
      {view === 'access' && <div className="pocket-access-map">
        <strong className="pocket-access-hub">{t('Shared Pocket', '共享资金口袋')}</strong>
        <div className="pocket-access-branches" aria-hidden="true"/>
        <div className="pocket-access-wallets">
          {[1, 2].map(number => <div key={number}>
            <strong>{t(`Delegate ${number} wallet`, `授权人 ${number} 的钱包`)}</strong>
            <span>{t('Can pay', '可付款')}</span>
          </div>)}
        </div>
      </div>}
      {view === 'payment' && <div className="pocket-preview-card">
        <div className="pocket-preview-flow"><span>{t('Shared Pocket', '共享资金口袋')}</span><i aria-hidden="true"/><span>{t('Approved recipient', '获准收款人')}</span></div>
        <div className="pocket-preview-amount"><span>{t('Paid to approved recipient', '已支付给获准收款人')}</span><strong>61 <small>CKB</small></strong><small>{t('From Pocket · Approved by Delegate 1', '来自资金口袋 · 授权人 1 批准')}</small></div>
        <dl className="pocket-preview-limits">
          {[t('Shared allowance left', '共享剩余额度'), t('Delegate 1 allowance left', '授权人 1 剩余额度')].map(label => <div key={label}>
            <dt>{label}</dt><dd><b>61 CKB</b> <small>−61 CKB</small></dd>
            <div className="pocket-preview-meter" aria-hidden="true"><i/></div>
          </div>)}
        </dl>
      </div>}
      {view === 'closeout' && <div className="pocket-preview-card">
        <div className="pocket-preview-flow"><span>{t('Closed Pocket', '已关闭的资金口袋')}</span><i aria-hidden="true"/><span>{t('Owner wallet', '所有者钱包')}</span></div>
        <div className="pocket-preview-amount"><span>{t('Pocket funds returned to owner', '返还给所有者的资金')}</span><strong>134 <small>CKB</small></strong></div>
        <div className="pocket-preview-closed"><strong>{t('Pocket closed', '资金口袋已关闭')}</strong><span>{t('Delegate spending off', '授权支出已停用')}</span></div>
      </div>}
      </div>
      <a className="pocket-preview-proof" href={`https://pudge.explorer.nervos.org/transaction/0x${hashes[view]}`}>{t('View testnet transaction', '查看测试网交易')} ↗</a>
    </div>;
  }

  return <section className="land-wrap land-section pocket-product" id="pockets" aria-labelledby="pocket-product-title">
    <header className="pocket-product-header">
      <h2 id="pocket-product-title">{t('How a Pocket works', '资金口袋如何运作')}</h2>
      <p>{t('Share a budget with two wallets. You set the limits and decide when spending ends.', '与两个钱包共享预算。由你设定限额并决定何时终止支出。')}</p>
    </header>
    <div className="pocket-product-layout">
      {views.map((view, index) => <div key={view.id} className="pocket-product-row" data-active={view.id === selected}>
        <div className="pocket-choice" onPointerEnter={event => {
          if (event.pointerType === 'mouse') select(view.id);
        }}><span className="pocket-choice-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <h3><button type="button" id={`pocket-choice-${view.id}`} aria-expanded={view.id === selected} aria-controls={`pocket-panel-${view.id}`} onClick={() => select(view.id)}>
          {view.title}
        </button></h3>
        <div className="pocket-choice-detail" aria-hidden={view.id !== selected}><div><p>{view.summary}</p></div></div>
        </div>
        <div id={`pocket-panel-${view.id}`} className="pocket-product-panel" role="region" aria-labelledby={`pocket-choice-${view.id}`} hidden={view.id !== selected}>
          {view.id === selected && renderPreview(view.id)}
        </div>
      </div>)}
    </div>
    <span id="spending" className="pocket-preview-sr"/>
  </section>;
}
