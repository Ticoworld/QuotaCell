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
        <path key={activity} className="experience-signal" pathLength="100" d={branches[delegate]}/>
        <circle cx="240" cy="83" r="7" fill="#bdf5ff"/>
        <circle cx="86" cy="157" r="4" fill={delegate === 0 ? '#7beaff' : '#496683'}/>
        <circle cx="394" cy="157" r="4" fill={delegate === 1 ? '#7beaff' : '#496683'}/>
      </svg>
      <span className="experience-owner">{t('Owner sets the rules', '所有者设定规则')}</span>
      <strong className="experience-core">{t('Shared Pocket', '共享资金口袋')}</strong>
    </div>
    <div className="experience-delegates" role="group" aria-label={t('Explore signing paths', '查看签名路径')}>
      {([0, 1] as const).map(index => <button key={index} aria-pressed={delegate === index} onClick={() => {
        select(index);
        replay(value => value + 1);
      }}>{t(`Delegate ${index + 1}`, `授权人 ${index + 1}`)}</button>)}
    </div>
    <p className="experience-status" aria-live="polite">{t(
      `Delegate ${delegate + 1} signs with their own wallet. The shared Pocket checks the payment against the owner's rules.`,
      `授权人 ${delegate + 1} 使用自己的钱包签名。共享资金口袋按所有者设定的规则检查付款。`,
    )}</p>
  </div>;
}

export function SpendingDemo({ t }: { t: Translate }) {
  const [limit, setLimit] = useState(122);
  const [spent, setSpent] = useState<readonly [number, number]>([0, 0]);
  const [revoked, setRevoked] = useState(false);
  const [selected, select] = useState<Delegate>(0);
  const [message, setMessage] = useState<'paid' | 'reset' | null>(null);
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
    setMessage('reset');
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
      <label>{t('Shared limit for a new example', '新示例的共享限额')}
        <select value={limit} onChange={event => reset(Number(event.target.value))}>
          {[61, 122, 183, 244].map(value => <option key={value} value={value}>{value} CKB</option>)}
        </select>
      </label>
      <div className="experience-delegates" role="group" aria-label={t('Choose a simulated delegate', '选择模拟授权人')}>
        {([0, 1] as const).map(index => <button key={index} aria-pressed={selected === index} onClick={() => { select(index); setMessage(null); }}>
          {t(`Delegate ${index + 1}`, `授权人 ${index + 1}`)}<small>{personalLimit - spent[index]} CKB {t('left', '剩余')}</small>
        </button>)}
      </div>
      <p>{t('Both delegates share the same allowance. Each starts with 122 CKB of personal allowance and can pay 61 CKB per payment to the approved recipient.', '两位授权人共用共享额度。每人初始拥有 122 CKB 的个人额度，每笔可向获准收款人支付 61 CKB。')}</p>
      <div className="experience-actions">
        <button className="experience-primary" disabled={Boolean(reason)} onClick={() => {
          setSpent(([first, second]) => selected === 0 ? [first + payment, second] : [first, second + payment]);
          setMessage('paid');
        }}>{t('Simulate 61 CKB payment', '模拟支付 61 CKB')}</button>
        <button onClick={() => { setRevoked(!revoked); setMessage(null); }}>{revoked ? t('Restore delegate 1', '恢复授权人 1') : t('Revoke delegate 1', '撤销授权人 1')}</button>
        <button onClick={() => reset()}>{t('Reset', '重置')}</button>
      </div>
      <p className="experience-status" aria-live="polite">
        {message === 'paid' && <span className="experience-payment">{t('Simulated payment sent. ', '模拟付款已完成。')}</span>}
        {message === 'reset' && t('Example reset. ', '示例已重置。')}
        {reason || (revoked && t('Delegate 1 is revoked. Delegate 2 keeps their own access.', '授权人 1 已被撤销。授权人 2 仍保有自己的权限。'))}
      </p>
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
      <span>{t('Owner', '所有者')}<strong>{step === 2 ? '+600 CKB' : '—'}</strong></span>
      <span>{t('Policy capacity', '规则容量')}<strong>{step === 2 ? '134 CKB' : '600 CKB'}</strong></span>
      <span>{t('Delegate access', '授权人访问权限')}<strong>{step ? t('Off', '已关闭') : t('On', '已开启')}</strong></span>
    </div>
    <div className="experience-actions">
      <button className="experience-primary" onClick={() => setStep((step + 1) % 3)}>
        {[t('Withdraw access', '收回权限'), t('Close and recover', '关闭并收回资金'), t('Replay', '重播')][step]}
      </button>
    </div>
    <p className="experience-status" aria-live="polite">{[
      t('Example based on the historical closeout. The Pocket holds 134 CKB in protected funds plus 600 CKB in policy capacity.', '此示例基于历史关闭记录。资金口袋包含 134 CKB 受保护资金和 600 CKB 规则容量。'),
      t('Delegate access is off. The owner can still recover the Pocket funds.', '授权人权限已关闭。所有者仍可收回资金口袋中的资金。'),
      t('134 CKB in Pocket funds and 466 CKB in policy capacity return to the owner before fees. The closed policy retains 134 CKB.', '扣除手续费前，134 CKB 资金口袋资金及 466 CKB 规则容量返还所有者。关闭后的规则保留 134 CKB。'),
    ][step]}</p>
  </div>;
}
