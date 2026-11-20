import { useEffect, useState } from 'react';
import './landing.css';

const pocketId = '0xfd76ec009d7ceeaf4ad1f49806dccb673cbc5530b07f270c28395112a7320898';
const creationHash = 'c034f9650ddbbd1c3a9d747ad1bff116c7c9e4dc3e8f4ac4f3d99dc2db175877';
const evidence = [
  ['Pocket created', '创建资金口袋', creationHash],
  ['First delegate payment', '第一位授权人付款', '46305893ff76c8be4d9e5bcf904b562c6eec9ef3fab86b5b004961fe019a0ed7'],
  ['Second delegate payment', '第二位授权人付款', '8bc138af8008ba65418630d411dbb25a5d2025c76f10e1b976b57dbee5b35b2b'],
  ['Delegate revoked', '撤销授权', '632f62c0f1a94b93b6d851b4cb09147c78af91e034f1297eba61bbe03e92a47d'],
  ['Pocket closed', '关闭资金口袋', '4dda72cc93e399dca7d037f5ce9cfd7ccad1b6742bc525a1ec0dccffb7da8ac2'],
  ['Historical late deposit recovered', '已追回历史迟到存款', '34775985bfe6e3805ed9c16530f62b50d2caec94a5ab047bba6f86c67af3fc56'],
];

export function Landing() {
  const [zh, setZh] = useState(() => {
    try { return localStorage.getItem('quotacell:locale') === 'zh-Hans'; }
    catch { return false; }
  });
  const t = (en: string, cn: string) => zh ? cn : en;
  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-Hans' : 'en';
    document.title = zh ? 'QuotaCell — 共享支出，保留控制权' : 'QuotaCell — Shared spending, owner control';
    try { localStorage.setItem('quotacell:locale', zh ? 'zh-Hans' : 'en'); }
    catch { /* Language remains available in this session. */ }
  }, [zh]);
  const [delegate, setDelegate] = useState(1);
  const app = t('Open wallet', '打开钱包');
  return <div className="landing">
    <a className="land-skip" href="#content">{t('Skip to content', '跳至内容')}</a>
    <header className="land-header land-wrap">
      <a className="land-brand" href="/"><img width="29" height="29" src="/quotacell.svg" alt=""/>QuotaCell</a>
      <nav aria-label={t('Main navigation', '主导航')}>
        <a className="land-nav-proof" href="#proof">{t('Testnet evidence', '测试网凭证')}</a>
        <button onClick={() => setZh(!zh)} lang={zh ? 'en' : 'zh-Hans'}>{zh ? 'English' : '简体中文'}</button>
        <a className="land-button land-outline" href="/app">{app} ↗</a>
      </nav>
    </header>
    <main id="content">
      <section className="land-hero land-wrap">
        <div className="land-hero-copy">
          <p className="land-label">{t('Public beta · Pudge testnet', '公开测试版 · Pudge 测试网')}</p>
          <h1>{t('Share spending', '共享支出')}<br/><span>{t('Keep control', '保留控制权')}</span></h1>
          <p>{t('Give two people room to pay from a shared Pocket, within limits you set. Each person uses their own wallet.', '让两位授权人在你设定的范围内使用同一资金口袋付款。每个人都使用自己的钱包。')}</p>
          <a className="land-button" href="/app">{app} ↗</a>
        </div>
        <figure className="land-hero-art"><img src="/field.webp" alt="" width="1536" height="1024" fetchPriority="high"/></figure>
      </section>
      <section className="land-wrap land-section land-relationship" id="pockets">
        <div>
          <h2>{t('One Pocket. Separate keys.', '同一资金口袋，各自持有密钥。')}</h2>
          <p>{t('The owner funds the Pocket and manages who can spend. Two delegates make approved payments from their own wallets.', '所有者为资金口袋充值并管理支出权限。两位授权人使用各自的钱包进行获准付款。')}</p>
          <a href={`/app?pocket=${pocketId}`}>{t('View the historical Pocket ↗', '查看已验证的资金口袋 ↗')}</a>
        </div>
        <div className="land-plan" data-delegate={delegate}>
          <div className="land-plan-owner">{t('Owner wallet', '所有者钱包')}</div>
          <div className="land-plan-center"><img src="/quotacell.svg" width="48" height="48" alt=""/>{t('Shared Pocket', '共享资金口袋')}</div>
          <div className="land-plan-keys" role="group" aria-label={t('Explore signing paths', '查看签名路径')}>
            {[1, 2].map(number => <button key={number} aria-pressed={delegate === number} onClick={() => setDelegate(number)}>{t(`Delegate ${number} wallet`, `授权人 ${number} 的钱包`)}</button>)}
          </div>
          <p className="land-path-note" aria-live="polite">{t(`Delegate ${delegate} signs with their own wallet. The Pocket applies the owner's rules.`, `授权人 ${delegate} 使用自己的钱包签名。资金口袋执行所有者设定的规则。`)}</p>
        </div>
      </section>
      <section className="land-rules">
        <div className="land-wrap land-section land-showcase">
          <div><h2>{t('Set the rules before anyone pays.', '付款前先设定规则。')}</h2><p>{t('Set a shared spending limit and a separate limit for each delegate. Choose approved recipients when you create the Pocket.', '设定共享支出限额和每位授权人的单独限额。创建资金口袋时选择获准收款人。')}</p></div>
          <div className="land-wallet"><header>QuotaCell <span>{t("Wallet preview", "钱包预览")}</span></header><img src={zh ? "/wallet-zh.webp" : "/wallet.webp"} width="1000" height="570" loading="lazy" alt={t("QuotaCell wallet interface", "QuotaCell 钱包界面")}/><dl><div><dt>{t('Delegate wallets', '授权人钱包')}</dt><dd>{t('Two, fixed at creation', '创建时固定两位')}</dd></div><div><dt>{t('Approved recipients', '获准收款人')}</dt><dd>{t('Fixed at creation', '创建时固定')}</dd></div><div><dt>{t('Ordinary payment minimum', '普通付款最低金额')}</dt><dd>61 CKB</dd></div></dl></div>
        </div>
      </section>
      <section className="land-control"><div className="land-wrap land-section">
        <div><h2>{t('Take back access at any time.', '随时收回支出权限。')}</h2><p>{t('The owner can revoke or restore a delegate’s access. Closing the Pocket ends delegate spending and returns supported Pocket funds to the owner.', '所有者可以撤销或恢复授权人的权限。关闭资金口袋后，授权人无法继续支出，受支持的口袋资金将退回所有者。')}</p></div>
        <img className="land-control-art" src="/control.webp" width="1536" height="1024" loading="lazy" alt=""/><dl><div><dt>{t('Active policy capacity', '启用时的规则容量')}</dt><dd>600 CKB</dd></div><div><dt>{t('Policy capacity released at closure', '关闭时释放的规则容量')}</dt><dd>466 CKB</dd></div><div><dt>{t('Permanently retained capacity', '永久保留的容量')}</dt><dd>134 CKB</dd></div></dl></div>
      </section>
      <section id="proof" className="land-proof">
        <div className="land-wrap land-section land-ledger">
          <div><h2>{t('Follow the Pocket on Pudge.', '在 Pudge 上查看资金口袋记录。')}</h2><p>{t('Canonical transactions from the verified November 15, 2026 lifecycle. Isolated verifier tests are documented separately.', '以下是 2026 年 11 月 15 日核验的生命周期链上交易。独立验证器测试另有记录。')}</p><a href="https://github.com/Ticoworld/QuotaCell/blob/codex/wo19a-remote-pocket-discovery/examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md">{t('Read the lifecycle record ↗', '阅读生命周期记录 ↗')}</a></div>
          <ul>{evidence.map(([en, cn, hash]) => <li key={hash}><a href={`https://pudge.explorer.nervos.org/transaction/0x${hash}`}><span>{t(en, cn)}</span><code>{hash.slice(0, 8)}…{hash.slice(-4)} ↗</code></a></li>)}</ul>
        </div>
      </section>
      <section className="land-wrap land-section land-end">
        <h2>{t('Try QuotaCell on testnet.', '在测试网上体验 QuotaCell。')}</h2>
        <p>{t('Use a compatible CKB wallet with Pudge test CKB. Public RPC response times vary. QuotaCell has no independent security audit and is available for testnet use only.', '请使用兼容的 CKB 钱包与 Pudge 测试币。公共 RPC 响应时间可能波动。QuotaCell 尚未接受独立安全审计，仅供测试网使用。')}</p>
        <a className="land-button" href="/app">{app} ↗</a>
      </section>
    </main>
    <footer className="land-wrap land-footer"><span>QuotaCell · Pudge</span><a href="https://github.com/Ticoworld/QuotaCell">GitHub ↗</a></footer>
  </div>;
}
