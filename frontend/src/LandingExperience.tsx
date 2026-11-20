import { useState } from 'react';

type Translate = (english: string, chinese: string) => string;
type Delegate = 0 | 1;
const funding = 256;
const reserve = 73;
const personalLimit = 122;
const payment = 61;

export function SigningStage({ t }: { t: Translate }) {
  const [delegate, select] = useState<Delegate>(0);
  const [activity, replay] = useState(0);
  const branches = ['M 86 157 H 157 Q 176 157 176 138 V 102 Q 176 83 195 83 H 240', 'M 394 157 H 323 Q 304 157 304 138 V 102 Q 304 83 285 83 H 240'];
  return <div className="experience-signing">
    <div className="experience-network">
      <img src="/chamber.webp" width="640" height="640" loading="lazy" alt=""/>
      <svg viewBox="0 0 480 175" aria-hidden="true">
        <path className="experience-trace" d="M 240 28 V 83"/>
        {branches.map((path, index) => <path key={path} className={delegate === index ? 'experience-trace is-live' : 'experience-trace'} d={path}/>)}
        {activity > 0 && <path key={activity} className="experience-signal" pathLength="100" d={branches[delegate]}/>}
        <circle cx="240" cy="83" r="7" fill="#bdf5ff"/>
        <circle cx="86" cy="157" r="4" fill={delegate === 0 ? '#7beaff' : '#496683'}/>
        <circle cx="394" cy="157" r="4" fill={delegate === 1 ? '#7beaff' : '#496683'}/>
      </svg>
      <span className="experience-owner">{t('Owner sets the rules', '所有者设定规则')}</span>
      <strong className="experience-core">{t('Shared Pocket', '共享资金口袋')}</strong>
    </div>
    <p className="experience-instruction">{t("Choose a wallet to trace its signing path", "选择钱包，查看其签名路径")}</p>
    <div className="experience-delegates" role="group" aria-label={t('Explore signing paths', '查看签名路径')}>
      {([0, 1] as const).map(index => <button key={index} aria-pressed={delegate === index} onClick={() => {
        select(index);
        replay(value => value + 1);
      }}>{t(`Delegate ${index + 1}`, `授权人 ${index + 1}`)}</button>)}
    </div>
    <p className="experience-status" aria-live="polite">{t(
      `Delegate ${delegate + 1} signs with their own wallet. The Pocket applies the same spending rules to either wallet.`,
      `授权人 ${delegate + 1} 使用自己的钱包签名。两个钱包均须遵守资金口袋的支出规则。`,
    )}</p>
    <a className="experience-next" href="#spending">{t("Try a payment", "试用模拟付款")} <span aria-hidden="true">↓</span></a>
  </div>;
}

export function SpendingDemo({ t }: { t: Translate }) {
  const [limit, setLimit] = useState(122);
  const [spent, setSpent] = useState<readonly [number, number]>([0, 0]);
  const [revoked, setRevoked] = useState(false);
  const [selected, select] = useState<Delegate>(0);
  const [lastPayment, setLastPayment] = useState<Delegate | null>(null);
  const used = spent[0] + spent[1];
  const sharedRemaining = limit - used;
  const personalRemaining = personalLimit - spent[selected];
  const balance = funding - used;
  const revokedHere = selected === 0 && revoked;
  const reason = revokedHere ? t('This delegate is revoked.', '该授权人已被撤销。')
    : sharedRemaining < payment ? t('The shared allowance is too low.', '共享剩余额度不足。')
    : personalRemaining < payment ? t('This delegate’s allowance is too low.', '该授权人的剩余额度不足。')
    : balance - payment < reserve ? t('This payment would use the 73 CKB reserve.', '此付款将占用 73 CKB 的保留资金。')
    : '';
  function reset(nextLimit = 122) {
    setLimit(nextLimit);
    setSpent([0, 0]);
    setRevoked(false);
    select(0);
    setLastPayment(null);
  }
  return <div className="experience-demo">
    <div className="experience-demo-meter">
      <p className="land-label">{t('Local simulation', '本地模拟')}</p>
      <p className="experience-value">{sharedRemaining}<small> CKB</small></p>
      <strong>{t('Shared allowance remaining', '共享剩余额度')}</strong>
      <progress aria-label={t('Shared allowance remaining', '共享剩余额度')} max={limit} value={sharedRemaining}/>
      <p>{t(`Pocket balance ${balance} CKB · protected reserve ${reserve} CKB`, `资金口袋余额 ${balance} CKB · 保留资金 ${reserve} CKB`)}</p>
    </div>
    <div className="experience-demo-actions">
      <p className="experience-payer">{t(`Pay as Delegate ${selected + 1}`, `以授权人 ${selected + 1} 身份付款`)}</p>
      <p className="experience-payer-limit">{t(`${personalRemaining} CKB left in this wallet’s allowance`, `此钱包的剩余额度为 ${personalRemaining} CKB`)}</p>
      <div className="experience-actions">
        <button className="experience-primary" disabled={Boolean(reason)} onClick={() => {
          setSpent(([first, second]) => selected === 0 ? [first + payment, second] : [first, second + payment]);
          setLastPayment(selected);
        }}>{t('Simulate 61 CKB payment', '模拟支付 61 CKB')}</button>
      </div>
      <div className="experience-receipt" aria-live="polite" aria-atomic="true">
        {lastPayment === null ? <p>{t('Pay 61 CKB to see what changes', '支付 61 CKB，看看额度如何变化')}</p> :
          <div key={used} className="experience-payment">
            <strong>{t(`Delegate ${lastPayment + 1} paid ${payment} CKB · simulation`, `授权人 ${lastPayment + 1} 支付了 ${payment} CKB · 模拟`)}</strong>
            <dl>
              <div><dt>{t('Shared allowance', '共享额度')}</dt><dd>{sharedRemaining + payment} → {sharedRemaining} CKB</dd></div>
              <div><dt>{t('Payer’s allowance', '付款人额度')}</dt><dd>{personalLimit - spent[lastPayment] + payment} → {personalLimit - spent[lastPayment]} CKB</dd></div>
            </dl>
          </div>}
        {(reason || revoked) && <p>{reason || t('Delegate 1 is revoked. Delegate 2 can still pay within the remaining limits.', '授权人 1 已被撤销。授权人 2 仍可在剩余额度内付款。')}</p>}
      </div>
      {lastPayment !== null && <button
        className="experience-switch"
        onClick={() => select(selected === 0 ? 1 : 0)}
      >{t(selected === 0 ? 'Switch to Delegate 2' : 'Switch to Delegate 1', selected === 0 ? '切换至授权人 2' : '切换至授权人 1')} <span aria-hidden="true">→</span></button>}
      <details className="experience-options">
        <summary>{t('Change the example', '调整示例')}</summary>
        <label>{t('Starting shared limit', '初始共享限额')}
          <span className="experience-select">
          <select value={limit} onChange={event => reset(Number(event.target.value))}>
            {[61, 122, 183, 244].map(value => <option key={value} value={value}>{value} CKB</option>)}
          </select>
          </span>
        </label>
        <div className="experience-delegates" role="group" aria-label={t('Choose a simulated delegate', '选择模拟授权人')}>
          {([0, 1] as const).map(index => <button key={index} aria-pressed={selected === index} onClick={() => select(index)}>
            {t(`Delegate ${index + 1}`, `授权人 ${index + 1}`)}<small>{personalLimit - spent[index]} CKB {t('left', '剩余')}</small>
          </button>)}
        </div>
        <div className="experience-actions">
          <button onClick={() => setRevoked(!revoked)}>{revoked ? t('Restore delegate 1', '恢复授权人 1') : t('Revoke delegate 1', '撤销授权人 1')}</button>
          <button onClick={() => reset()}>{t('Reset', '重置')}</button>
        </div>
      </details>

    </div>
  </div>;
}

export function RecoveryStage({ t }: { t: Translate }) {
  const [step, setStep] = useState(0);
  return <div className="experience-recovery" data-step={step}>
    <svg viewBox="0 0 540 94" aria-hidden="true">
      <path className="experience-trace recovery-access" d="M 485 47 H 270"/>
      <path className="experience-trace recovery-return" d="M 270 47 H 55"/>
      {step === 2 && <path className="experience-signal" pathLength="100" d="M 270 47 H 55"/>}
      {[55, 270, 485].map(x => <circle key={x} cx={x} cy="47" r="8" fill="#bdf5ff"/>)}
    </svg>
    <div className="experience-recovery-labels">
      <span>{t('Returned to owner', '返还所有者')}<strong>{step === 2 ? '+600 CKB' : '0 CKB'}</strong></span>
      <span>{step === 2 ? t('Capacity retained', '保留容量') : t('Policy capacity', '规则容量')}<strong>{step === 2 ? '134 CKB' : '600 CKB'}</strong></span>
      <span>{t('Delegate access', '授权人访问权限')}<strong>{step ? t('Off', '已关闭') : t('On', '已开启')}</strong></span>
    </div>
    <div className="experience-actions">
      <button className="experience-primary" onClick={() => setStep((step + 1) % 3)}>
        {[t('Withdraw access', '收回权限'), t('Close and recover', '关闭并收回资金'), t('Reset example', '重置示例')][step]}
      </button>
    </div>
    <p className="experience-status" aria-live="polite">{[
      t('Historical closeout example. Start by withdrawing the delegates’ spending access.', '此示例基于历史关闭记录。先收回授权人的支出权限。'),
      t('Delegate access is off. The owner can still recover the Pocket funds.', '授权人权限已关闭。所有者仍可收回资金口袋中的资金。'),
      t('134 CKB in Pocket funds and 466 CKB in policy capacity return to the owner before fees. The closed policy retains 134 CKB.', '扣除手续费前，134 CKB 资金口袋资金及 466 CKB 规则容量返还所有者。关闭后的规则保留 134 CKB。'),
    ][step]}</p>
  </div>;
}
