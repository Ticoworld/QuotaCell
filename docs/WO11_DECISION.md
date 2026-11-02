# WO11: Contention, Recovery and Product Direction

**Date:** 2026-11-02
**Branch:** `wo11-competing-payments`, based on `ce8e50b` (`main` at start).
**Scope:** Local synthetic xUDT only. No contract ABI change, public deployment, or real funds.

## Decision

Keep QuotaCell as experimental reusable policy infrastructure. Do not build a
general agent wallet, Fiber payment workspace, payroll suite, or remittance
product. The most credible workflow to validate next is a project execution
wallet that has received a separately approved CKB budget and needs bounded
operator payments between milestone votes. The CKB Community Fund DAO V1.1
rules describe that job, but there is no evidence its operators want to replace
their deliberate 2-of-3 signing process with delegated spending.

The next engineering experiment should be a **compact, permanent CLOSED policy
successor** for a fresh policy version. It should preserve the policy Type ID
and a small tombstone that continues to gate fund Cells and recover late
deposits, while shrinking the 466-byte state after closure. This offers a
bounded capacity recovery path without deleting the state that the existing
input-type proxy lock needs. It would be an ABI/version change and migration
research, not a patch to the current immutable Q. Do not attempt time-gated
deletion until the fund lock has a proven post-retirement recovery path.

## Competing Payments

The additive runner used official CKB `0.210.0` (`2592ddf`, Windows binary
SHA-256 `77ff953e9dc3a03b36e38a3cab2b9b06f17be8254a15a23afa826c2d4aea98b0`)
on a fresh dev chain bound to loopback, with P2P disabled. Q rebuilt to the
historical 22,240-byte binary and data hash. The synthetic token, keys and
genesis were fresh. Alice and Ben ran as separate Node processes (different
process IDs and K credentials), and each independently built and signed a
20-token payment from the same policy and fund outpoints.

Two fresh runs are preserved under
`evidence/competing-payments-2026-11-02/` and can be reproduced with the
commands in [Reproduction](#reproduction). They use different generated keys,
genesis and transaction hashes.

The pool winner varied across those runs, which is expected. Exact results:

| Run | Alice | Ben |
| --- | --- | --- |
| First | Response dropped; `0xcf128d897ae97af184c6778c183ee4923fe95b01a6f8cacbc04a60f216a25551` later reconciled `committed` | RPC `-1111 PoolRejectedRBF`; 2,000-shannon fee below 4,536-shannon replacement minimum; reconciled `rejected` |
| Second | Response dropped; `0x3b669d873c94ccb8dacaac72aa607f0ac41f349e183bfb598b1decb48968fd7d` later reconciled `rejected` as RBF loser | RPC returned `0xe7551bff4b8d2750a65ff70fda4b74a2aba712ba371145e62676452f53a5bb8b`; reconciled `committed` |

In both runs Alice's RPC response was deliberately dropped by a local
forwarding proxy and her process exited before writing a submission receipt.
A fresh process queried the exact saved hash and original input outpoints. The
first run recovered a committed transaction; the second recovered a rejected
conflict. A durable intent record had been written before submission. Together
they exercise both sides of the uncertain outcome. The code keeps the exact
signed transaction/hash and does not blindly create another transaction.

The second run re-submitted Alice's exact signed transaction after the winner
committed. CKB returned `-301 TransactionFailedToResolve` naming the consumed
policy outpoint. This is stale-state behavior after confirmation; `-1111` is
mempool RBF behavior before confirmation.

Two additional independent processes attempted to reserve the same invoice
identifier in one SQLite journal. One succeeded and one returned
`ALREADY_RESERVED` (exit 3). The journal is bounded to 4,096 intents and one
megabyte per serialized transaction; it uses SQLite `WAL` and `synchronous=FULL`.
It refuses to rebuild any pinned uncertain intent, including one that the node
reports rejected. This favors duplicate prevention over automatic liveness.
It is a single-machine/shared-database mechanism, not distributed consensus or
a multi-host coordinator. The current prototype reserves an opaque invoice ID
and pins one transaction; it does not parse the application's invoice terms or
independently verify that the signed outputs match the requested amount and
recipient. The application must bind those terms before reservation in a real
integration.

The first run's explicit bypass control demonstrates the contract boundary.
After the journal records the first transaction `committed`, a duplicate
reservation is refused; when the runner deliberately bypassed the journal and
rebuilt from the latest policy state, unchanged Q accepted and committed a
second 20-token payment to the same recipient. Invoice identifiers are not in
Q's witness or state, so consensus cannot recognize that as a duplicate.

The pool result is not the consensus guarantee. CKB's pool applied RBF policy
to the competing same-input transactions. Once one transaction committed, its
inputs could not be spent again under consensus. Another transaction with
fresh inputs and the same recipient/invoice is a new valid spend unless an
application or contract carries an invoice identity. The experiment showed
one deterministic pool ordering and one committed winner, not fairness,
reorg recovery, or every possible pool configuration.

## Intent Journal Boundary

`examples/local-chain/payment_intents.py` records an invoice reservation and
pins the exact signed transaction before the caller submits it. `reconcile`
queries `get_transaction` and original input liveness. A committed hash is
marked committed; pending/proposed/unknown outcomes remain uncertain and block
rebuild. `retry-same` only returns the exact transaction bytes. The runner
exercises simultaneous reservation from two processes, response loss, process
exit and fresh-process recovery.

The local tool does not claim application-level exactly-once payment across
independent databases, operator machines or reorgs. A node's `unknown` response
does not prove non-inclusion; the transaction could have been dropped, indexed
elsewhere, or replaced. The tool intentionally leaves such an intent blocked.
Production use would need a canonical chain/indexer source, reorg-aware finality
policy, durable backups, idempotent invoice issuance and an explicit operator
resolution path. The on-chain ABI would need an invoice commitment only if
consensus-level duplicate invoice prevention is required.

## CrowdCell Comparison

I read the public [CrowdCell repository](https://github.com/alesfer001/CrowdCell)
and inspected its [pledge lock](https://github.com/alesfer001/CrowdCell/blob/main/contracts/pledge-lock/src/main.rs), [campaign type](https://github.com/alesfer001/CrowdCell/blob/main/contracts/campaign/src/main.rs), its exploit
tests and current review notes. The reviewed checkout was commit
`2fd13f6bae84b9beda0c5f67264c66cb7f89cd69`.

CrowdCell has two distinct timed paths. After the immutable campaign deadline,
anyone can settle a pledge using the finalized campaign status cell as a
dependency: Success routes it to the creator; Failed returns it to the pledge's
backer lock. If the campaign cell is absent, the pledge lock accepts a
permissionless refund only when the input's absolute `since` block is at least
`deadline + 1,944,000` blocks (about 180 days at the contract's assumed eight
seconds per block). Before then the campaign dependency is mandatory. The
refund destination is committed in that pledge's lock args. This is a
backer-specific escape, not an owner key or a campaign-wide withdrawal.

Campaign retirement is also explicit, not automatic: a terminal Success or
Failed campaign may be destroyed only after the same grace period, with its
capacity paid to the creator (within the contract's fee allowance). The
campaign script blocks destruction in a transaction that also spends a pledge
lock cell. It does not require all outstanding pledges to have been settled;
the pledge-level fallback is what prevents retirement from stranding them.

The design has meaningful limits. CKB has no native "not after" `since`, so a
pledge can still be created after the deadline unless the application/script
design adds another check. The CrowdCell proposal identifies that as an open
design change. Before the deadline, the time fallback is unavailable. The
180-day exit is tied to a pledge's own backer, not a treasury owner. An outpoint
can be spent only once, so pledge replay is prevented by CKB cell semantics.
The terminal campaign capacity eventually returns to the creator, while a
pledge not yet settled remains independently refundable. Script hashes are
pinned for live campaigns, so the changed rules require new deployments rather
than silently changing existing campaign terms. The public project says its
contracts have developer review but no independent audit.

| QuotaCell design | Early bypass | Late deposits | Owner access | Replay/capacity | Compatibility |
| --- | --- | --- | --- | --- | --- |
| Compact CLOSED successor | None if it stays under the same Type ID and delegates remain disabled | Q tombstone remains available for closed sweeps | Existing owner close/sweep | One spend per outpoint; saves capacity proportional to removed bytes; permanent small minimum remains | New Q ABI/version and migration work; existing F lock depends on the Q script hash |
| Independent owner recovery branch in F | Dangerous if the owner can use it while ACTIVE; it must prove CLOSED state | Can cover deposits only while its closing/anchor state survives | Strong recovery without delegate signature | No time wait needed, but per-fund owner paths and a durable closure anchor cost code/state | Requires compatible F lock and careful proxy-lock review |
| Time-gated Q retirement | Safe only if the close-created timer cannot be forged or bypassed | After Q deletion, current F cannot require Q; deposits can become stuck without an independent fallback | Delayed recovery | Could reclaim nearly all policy capacity, but not funds unless fallback survives | Changes Q and F together; existing deployments cannot inherit it |

The compact permanent successor is the strongest next experiment. CrowdCell's
fallback is a useful reference for explicit, permissionless, per-cell exits,
but copying its timeout does not solve QuotaCell's owner-sweep and post-closure
deposit problem. A time-gated Q deletion is premature until a new F lock can
recover every late deposit without creating an owner path that bypasses ACTIVE
policy limits.

## Product Use Cases

These are actual public workflows, not claimed customers. The evidence is
project code or public operating proposals. No one has asked for QuotaCell and
no product-market fit is established.

### 1. CKB Community Fund DAO Project Execution Wallets

The real job is paying an approved project team's start-up budget and later
milestones from a temporary project wallet. The published [V1.1 rules](https://v0-dao-v11-en.vercel.app/rules) specify a
2-of-3 project execution wallet, community milestone confirmation, public
verification reports and return of unused money on termination. The likely
operator is the project's finance/operator signer group.

Existing multisig deliberately gives the named signers a fresh approval point
on each spend; QuotaCell would trade that control for scoped delegated
execution. Session-kit is aimed at one user's short-lived browser key and
fixed-recipient repeat payments, not a governance-controlled project wallet.
Remit can route proposed actions through off-chain allow/queue/block policy,
but its current README identifies off-chain enforcement and a single server
executor as limitations. Native CKB is the required first asset because the
DAO rule example budgets and milestones are CKB. Usefulness would require
native CKB support, spend intents linked to approved milestone budgets,
changeable payees per approved invoice, public audit/reconciliation, and
governance-compatible revocation. Current fixed recipient, xUDT-only Q is not
usable here. Evidence of a real payment job is strong; evidence that stewards
want fewer signatures or QuotaCell specifically is absent.

### 2. NERVE Agent Marketplace

NERVE's [public repository](https://github.com/RobaireTH/NERVE) describes agents reserving and completing jobs, with
dispute-windowed escrow, agent identity, on-chain spending limits and an
epoch-based daily accumulator. The operator is the agent owner or marketplace
operator managing an autonomous worker. This is not an unserved generic
"agent needs limits" case: the repository already implements CKB consensus
spending caps and stateful daily accounting. Remit is off-chain proposal
routing; NERVE's CKB contracts enforce its job and capability rules.

Native CKB is the payment path in the README; Fiber can be used where repeated
agent micropayments need channel settlement. To contribute, QuotaCell would
need to demonstrate a treasury authorization primitive NERVE lacks, such as a
shared owner-renewed budget across independently keyed workers, without
duplicating NERVE's identity, epoch or escrow rules. Existing Q only has two
delegates, fixed recipients, plain synthetic xUDT, and a single contended
policy Cell. Public code is evidence of an implemented workflow, not demand for
QuotaCell; no integration request was found.

### 3. Fiber Link Community Tips and Withdrawals

Fiber Link's [public proposal](https://talk.nervos.org/t/dis-fiber-link-a-ckb-fiber-based-pay-layer-tipping-micropayments-for-communities/9845) describes a Discourse tip flow: the service creates
a Fiber invoice, credits an internal creator balance after payment, and later
makes an on-chain UDT withdrawal to the creator's address. The likely operator
is the custodial hub/service team. The proposal reports grant funding and a
public payout transaction, so there is evidence of project execution, but not
proof of sustained creator demand.

Fiber channels already handle the frequent micropayments; a CKB L1 policy cell
would not make tips settle faster. The withdrawal side uses a dynamic set of
creators and an internal balance ledger. xUDT is needed for payout; QuotaCell's
fixed two-recipient list and gross shared allowance cannot reflect each
creator's balance. Utility would require dynamic authenticated withdrawal
requests, per-user ledger reconciliation, native token compatibility and
explicit custody controls. Those additions would largely rebuild the hub's
own payment/accounting service, so this is a poor initial fit.

## Existing Products and Boundaries

- **Remit:** an application-level agent execution runtime that parses proposed
  actions and routes them to allow, approval queue or block. It is not
  consensus-enforced today. QuotaCell could be an optional enforcement adapter
  beneath Remit's executor; rebuilding its policy UI, natural-language flow or
  approval queue would duplicate [Remit](https://github.com/Ticoworld/remit).
- **ckb-session-kit:** a testnet session lock for browser-held keys, scoped
  native CKB and xUDT spending, per-payment/rate controls and owner recovery.
  Its strongest fit is one user authorizing recurring app payments. QuotaCell's
  only distinct hypothesis is a shared cumulative budget across separate
  delegates; prove a real buyer needs that difference before expanding. See
  [package notes](https://www.npmjs.com/package/ckb-session-kit).
- **NERVE:** already adds CKB-native agent identity, per-transaction spending
  and daily accumulators. QuotaCell should not recreate those rules.
- **Sluice:** a Fiber node-operator workspace for route probing, channel
  rebalancing and reconciliation. Its own description says rebalance requests
  carry idempotency keys and repeated requests return the existing job. This is
  a different layer ([project description](https://talk.nervos.org/t/introducing-sluice-a-liquidity-operations-workspace-for-ckb-fiber/10532)); QuotaCell must not become a Fiber route/liquidity dashboard.
- **ChainPay:** the [public CKB payroll/accounting project](https://github.com/toastmanAu/chain-pay) describes a CKB
  multisig treasury, invoice ingest, wallet-based co-signing and confirmed
  payment reconciliation. It already covers payroll operations. A safer
  sub-wallet could be explored only with its operators; replacing their
  multisig or accounting workflow would duplicate the product.
- **ChainPay name check:** the public CKB repository found is
  [toastmanAu/chain-pay](https://github.com/toastmanAu/chain-pay); other
  `ChainPay` search results refer to unrelated BSC or merchant gateways. No
  inference about the latter is applied to CKB.

## What to Build Next

1. Design and verifier-test the compact CLOSED successor on a new ABI branch.
   Quantify exact CKB unlocked, assert no transition can re-enable delegates,
   preserve owner sweeps after late deposits, and pin explicit migration
   requirements for Q and F. Do not change current Q or historical evidence.
2. Keep the intent journal experimental. Before calling it a reusable tool,
   add crash/restart cases around every durable write and node status, reorg
   tests, corruption/backup handling and multi-process invoice collision tests.
3. Interview project-wallet operators only after showing a concrete native-CKB
   prototype that preserves their milestone approval process. Record disconfirming
   evidence. Do not presume delegated spending is preferable to 2-of-3 approval.

Avoid a broad wallet UI, Fiber operations workspace, AI agent framework,
multisig replacement, arbitrary token adapter or timed contract retirement at
this stage. Do not claim invoice-level exactly-once safety from CKB input
conflict protection.

## Reproduction

Prerequisites are Python 3, Node/npm, WSL Clang 18 and the installed Rust
sysroot described in [BUILD_AND_TEST.md](BUILD_AND_TEST.md). Exact F/A/T bytes
were acquired read-only from the pinned testnet providers; Q was rebuilt to its
recorded hash. Then:

```powershell
python -B scripts/acquire_replay_dependencies.py --rpc-url https://testnet.ckb.dev/
python -B policy/build_q.py
Push-Location examples/local-chain
npm.cmd ci --ignore-scripts --no-audit --no-fund
Pop-Location
python -u -B examples/local-chain/reproduce.py --scenario race --run-dir "$env:TEMP\quotacell-wo11-race"
```

The runner refuses to reuse a run directory, starts a loopback-only isolated
dev node with networking deactivated, generates disposable synthetic keys and
saves private chain data under the chosen run directory. Review generated
evidence before sharing it. Historical WO07/WO10 records remain unmodified.
