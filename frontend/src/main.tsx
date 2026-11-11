import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Delegate = { role: string; limit: string; used: string; perPayment: string; enabled: boolean; recipient: string; publicKey: string };
type HistoryItem = { id: string; tx_hash: string; state: string; amount: string; recipient: string; created: string; actor: string; operation: string };
type State = { empty?: boolean; closed?: boolean; unresolved?: boolean; networkMode?: string; genesis?: string; pocket?: string; fundShannons?: string; fundOccupiedShannons?: string; sharedLimit?: string; sharedUsed?: string; delegates?: Delegate[]; unsupportedFunds?: { capacity: string; outPoint: { txHash?: string; tx_hash?: string; index: string } }[]; history?: HistoryItem[] };
type WalletIdentity = { role: 'owner' | 'alice' | 'ben' | 'unrecognized'; address: string };

const CKB = 100_000_000n;
function ckb(value: string | bigint) {
  const n = BigInt(value);
  const fractional = (n % CKB).toString().padStart(8, '0').replace(/0+$/, '');
  return `${n / CKB}${fractional ? `.${fractional}` : ''}`;
}
function short(value?: string) { return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : '—'; }

function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [selectedRole, setSelectedRole] = useState<'alice' | 'ben'>('alice');

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`);
      setState(data);
      setError('');
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 12000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'quotacell-wallet-identity') return;
      const role = ['owner', 'alice', 'ben'].includes(event.data.role) ? event.data.role : 'unrecognized';
      setIdentity({ role, address: String(event.data.address || '') } as WalletIdentity);
      if (role === 'alice' || role === 'ben') setSelectedRole(role);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const balances = useMemo(() => {
    const funds = BigInt(state?.fundShannons || 0);
    const occupied = BigInt(state?.fundOccupiedShannons || 0);
    const shared = BigInt(state?.sharedLimit || 0);
    const used = BigInt(state?.sharedUsed || 0);
    return { funds, available: funds > occupied ? funds - occupied : 0n, shared, used, remaining: shared > used ? shared - used : 0n };
  }, [state]);
  const delegates = state?.delegates || [];
  const selected = delegates.find((delegate) => delegate.role === selectedRole);
  const ownerView = identity?.role === 'owner';
  const network = state?.networkMode?.startsWith('pudge') ? 'Pudge testnet' : 'Isolated local chain';
  const explorer = (hash: string) => `https://pudge.explorer.nervos.org/transaction/${hash}`;

  return <>
    <header className="topbar"><a className="brand" href="#home" aria-label="QuotaCell home"><span className="mark">◈</span> QuotaCell</a><div className="top-meta"><span className="network"><i />{state ? network : 'Connecting to backend'}</span><button className="quiet" onClick={() => void refresh()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button></div></header>
    <main id="home">
      <section className="hero"><div className="hero-copy"><p className="eyebrow">A Pocket with shared authority</p><h1>Money stays protected.<br /><em>Spending stays clear.</em></h1><p className="intro">A shared allowance for two people, with separate limits and an owner who stays in control.</p></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="core">◈</div><span className="node node-a">A</span><span className="node node-b">B</span><span className="node node-owner">You</span></div></section>

      {error && <section className="panel alert" role="alert"><h2>Could not reach the Pocket backend</h2><p>{error}</p><p>Start the Working Pocket server, then refresh this page.</p></section>}
      {!error && !state && <section className="panel loading" aria-live="polite">Loading live Pocket state…</section>}
      {!error && state?.empty && <section className="panel empty"><div className="empty-icon">◈</div><div><p className="eyebrow">Start with your people</p><h2>Set up your Pocket</h2><p>Connect the owner and both delegates, choose a shared budget, then review the creation transaction in your wallet.</p><button className="primary" onClick={() => setWorkspaceOpen(true)}>Connect wallets and begin <span>→</span></button><p className="hint">You will need three separate CKB testnet wallets. Public identities are registered; private keys stay in each wallet.</p></div></section>}

      {state && !state.empty && <>
        <section className="summary-grid" aria-label="Pocket summary">
          <article className="panel balance-panel"><div className="panel-head"><span className="eyebrow">Protected in this Pocket</span><span className="pill">On chain</span></div><div className="big-number">{ckb(balances.funds)} <span>CKB</span></div><p>{ckb(balances.available)} CKB available above required Cell capacity</p><div className="balance-track"><span style={{ width: `${balances.funds ? Math.min(100, Number(balances.available * 100n / balances.funds)) : 0}%` }} /></div><small>Deposits add funds. They do not restore spent allowance.</small></article>
          <article className="panel allowance-panel"><div className="panel-head"><span className="eyebrow">Shared lifetime allowance</span><span className={`pill ${state.closed ? 'closed' : ''}`}>{state.closed ? 'Closed' : 'Shared by Alice + Ben'}</span></div><div className="big-number">{state.closed ? 'Closed' : <>{ckb(balances.remaining)} <span>CKB left</span></>}</div><p>{state.closed ? 'Owner recovery is complete for supported fund Cells.' : `${ckb(balances.used)} used of ${ckb(balances.shared)} CKB`}</p><progress max="100" value={balances.shared ? Number(balances.used * 10000n / balances.shared) / 100 : 0} aria-label="Shared lifetime allowance used"/><small>Personal limits fit inside this one shared total.</small></article>
        </section>

        {state.unresolved && <section className="panel alert" role="alert"><h2>Check the last transaction before continuing</h2><p>Its outcome is uncertain. Reconcile the existing transaction before preparing another action.</p><button className="secondary" onClick={() => setWorkspaceOpen(true)}>Open transaction recovery</button></section>}

        <section className="section-head"><div><p className="eyebrow">People and permissions</p><h2>Two delegates. One shared budget.</h2></div><span className="section-note">Authority is separate from protected balance.</span></section>
        <div className="delegate-grid">{delegates.map((delegate, index) => {
          const remaining = BigInt(delegate.limit) > BigInt(delegate.used) ? BigInt(delegate.limit) - BigInt(delegate.used) : 0n;
          return <button type="button" className={`panel delegate-card ${selectedRole === delegate.role ? 'selected' : ''}`} onClick={() => setSelectedRole(delegate.role as 'alice' | 'ben')} key={delegate.role} aria-pressed={selectedRole === delegate.role}>
            <div className="delegate-top"><div className={`avatar avatar-${index}`}>{delegate.role === 'alice' ? 'A' : 'B'}</div><span className={`pill ${delegate.enabled ? 'enabled' : 'closed'}`}>{delegate.enabled ? 'Active' : 'Revoked'}</span></div>
            <h3>{delegate.role === 'alice' ? 'Alice' : 'Ben'} <small>{selectedRole === delegate.role ? 'Selected' : 'View details'}</small></h3>
            <p className="delegate-used">{ckb(delegate.used)} <span>used</span><b>·</b> {ckb(delegate.limit)} CKB limit</p>
            <div className="mini-track"><span style={{ width: `${delegate.limit === '0' ? 0 : Math.min(100, Number(BigInt(delegate.used) * 10000n / BigInt(delegate.limit)) / 100)}%` }} /></div>
            <dl><div><dt>Remaining authority</dt><dd>{ckb(remaining)} CKB</dd></div><div><dt>Max per payment</dt><dd>{ckb(delegate.perPayment)} CKB</dd></div><div className="recipient-row"><dt>Approved recipient</dt><dd title={delegate.recipient}>{short(delegate.recipient)}</dd></div></dl>
          </button>;
        })}</div>

        <section className="action-panel"><div><p className="eyebrow">{identity ? `Connected as ${identity.role}` : 'Choose your next step'}</p><h2>{identity?.role === 'owner' ? 'Your Pocket controls' : identity?.role === 'alice' || identity?.role === 'ben' ? `Spend with ${identity.role === 'alice' ? 'Alice' : 'Ben'}’s authority` : 'Open your role-specific workspace'}</h2><p>{identity?.role === 'owner' ? 'Fund, revoke one delegate at a time, close, or recover supported funds.' : 'Review the selected delegate limit, recipient, current fee and transaction before wallet approval.'}</p></div><div className="action-buttons">{ownerView && <button className="primary" onClick={() => setWorkspaceOpen(true)}>Open owner controls <span>→</span></button>}<button className={ownerView ? 'secondary' : 'primary'} onClick={() => setWorkspaceOpen(true)}>{identity?.role === 'alice' || identity?.role === 'ben' ? 'Review a payment' : 'Connect wallet / open workspace'} <span>→</span></button></div></section>

        {state.unsupportedFunds?.length ? <section className="panel unsupported" role="alert"><div className="warning-mark">!</div><div><p className="eyebrow">Needs separate review</p><h2>Unsupported Cells are still on chain</h2><p>These data-bearing or typed Cells are excluded from the supported recovery total. QuotaCell has not recovered them.</p>{state.unsupportedFunds.map((fund) => <div className="unsupported-item" key={`${fund.outPoint.txHash || fund.outPoint.tx_hash}:${fund.outPoint.index}`}><span>{ckb(fund.capacity)} CKB</span><code>{fund.outPoint.txHash || fund.outPoint.tx_hash}:{fund.outPoint.index}</code></div>)}</div></section> : null}

        <section className="section-head history-heading"><div><p className="eyebrow">Recent activity</p><h2>Transaction history</h2></div><button className="quiet" onClick={() => setWorkspaceOpen(true)}>Reconcile transactions ↗</button></section>
        <section className="panel history-panel">{state.history?.length ? <div className="history-list">{[...state.history].reverse().slice(0, 6).map((item) => <article className="history-row" key={item.id}><div className="history-icon">{item.operation === 'pay' ? '↗' : item.operation === 'deposit' ? '+' : '◈'}</div><div className="history-main"><strong>{item.operation[0].toUpperCase() + item.operation.slice(1)}{item.operation === 'pay' ? ` · ${ckb(item.amount)} CKB` : ''}</strong><small>{new Date(item.created).toLocaleString()}</small></div><span className={`state-tag state-${item.state}`}>{item.state}</span>{state.networkMode?.startsWith('pudge') ? <a className="explorer" href={explorer(item.tx_hash)} target="_blank" rel="noreferrer">Explorer ↗</a> : <code className="history-hash" title={item.tx_hash}>{short(item.tx_hash)}</code>}</article>)}</div> : <p className="hint">No Pocket transactions yet. Completed activity will appear here with its current status.</p>}</section>
      </>}

      <footer><span>QuotaCell · Experimental CKB testnet application</span><a href="/legacy" target="_blank" rel="noreferrer">Open the existing Working Pocket directly ↗</a></footer>
    </main>
    {workspaceOpen && <div className="workspace-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceOpen(false); }}><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><div className="workspace-head"><div><p className="eyebrow">Wallet and transaction workspace</p><h2 id="workspace-title">Working Pocket</h2></div><button className="quiet close" onClick={() => setWorkspaceOpen(false)} aria-label="Close workspace">×</button></div><p className="workspace-help">Connect the wallet for your role. Every action is prepared by the existing backend and reviewed with its current fee before wallet approval.</p><iframe title="QuotaCell Working Pocket wallet and transaction workspace" src="/legacy" onLoad={(event) => { const frame = event.currentTarget; if (identity) frame.contentWindow?.postMessage({ type: 'quotacell-prefill-role', role: identity.role }, window.location.origin); }} /></section></div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
