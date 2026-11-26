# Security model and limitations

## Current public Pudge beta: native QCN4/QCT4 (November 2026)

**Experimental and unaudited. Pudge testnet only. Do not use QuotaCell to secure real assets.**

QuotaCell's current public beta is a **native CKB spending policy**, not the historical synthetic xUDT prototype described below. An owner creates a Pocket with **two fixed, independently keyed delegates** and approved recipients fixed at creation. The contract enforces a shared **gross lifetime** spending allowance, personal limits, and per-payment ceilings; adding funds does not restore used allowance. The owner can change allowances without resetting spent counters, revoke or restore delegate authority, close the Pocket, and recover supported protected funds. A third delegate, post-creation identity/recipient rotation, and automatic keeper refills are not implemented in QCN4.

**Capacity and payment limits for the documented public profile:** the active QCN4 policy Cell held **600 CKB**. Closure released **466 CKB** of that policy capacity before the close transaction fee and left **134 CKB occupied and locked** in the QCT4 terminal Cell. The 134 CKB terminal is not spendable by the owner. Ordinary delegate payments require at least **61 CKB** under the current supported payment structure. Fund capacity and recoverable balance are separate from policy capacity.

**Public evidence:** the [November 15 WO18 closeout record](../examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) verifies **nine committed, canonical Pudge transactions**, including creation, protected funding, one 61 CKB payment by each delegate, both revocations, closure, a separate 73 CKB late deposit to the closed Pocket, and recovery of that deposit. The record distinguishes capacity accounting from protected fund recovery. The chain audit used one configured public RPC endpoint; it was not an independent security audit. A compatible Pudge wallet, including UTXO Global, has been used for the public testnet lifecycle.

The hosted browser path prepares transactions, validates wallet signatures, submits and reconciles through `frontend/src/api.ts` and `frontend/src/browserPudge.ts`. A separate real-wallet lifecycle was reported on November 20 in the [Nervos Talk progress update](https://talk.nervos.org/t/quotacell-let-your-team-spend-without-handing-over-the-treasury/11002/23); it is a first-party report, distinct from the repository-recorded WO18 canonical audit. Neither is independent security qualification.

**Known limitations:** two delegate slots and approved recipient identities are fixed at creation; the owner key is required for owner recovery and loss of that key may strand funds. Multi-fund consolidation, unsupported or malformed deposits, independent recovery, reorganization resilience, descriptor-free cross-device recovery, and adversarial public extra-deposit scenarios are not fully qualified. Uncertain broadcasts require reconciliation of the original signed transaction and chain state before any replacement is considered. Public RPC/indexer availability is variable. No mainnet or treasury-safety claim is made.

See the [current public beta guide](PUBLIC_BETA.md), the [deployment references](../evidence/wo15/pudge-deployment.json), and the [public transaction audit](../examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) for current evidence. Older statements below apply only to the **October 2026 synthetic xUDT prototype** and must not be used to describe native QCN4 behavior.

---

## Historical security assessment: October 2026 synthetic xUDT profile

**October 30 evidence update:** [owner-control node records](../evidence/owner-control-2026-10-30/README.md)
now demonstrate revocation, latest-state Q17 rejection, close/recovery and one
late sweep. Renewal remains verifier-only. The table below preserves the
earlier baseline assessment; its absence-of-node-evidence statements for
close/sweep are superseded only by this bounded local-node result. Recovery
returns owner-controlled typed capacity; all 600 CKB of policy remain retained.

Q relies on CKB consensus, Type ID lineage, exact admitted proxy/token/authentication bytes, correct signing keys and its own validation logic. The policy Cell's always-success lock relies on the mandatory type-validator successor rules; it is not an independent authorization mechanism. The full supported transaction layout is in [ABI.md](ABI.md).

The current profile has two fixed delegate keys, distinct approved recipients and fixed per-payment ceilings. The shared allowance is gross lifetime spending: refunds/deposits do not renew authority. Owner renewal increases limits without clearing used counters; revocation disables grants. Owner close and closed sweeps recover selected admitted fund Cells, but cannot bypass a Q/T defect or lost owner key.

| Boundary | Evidence and limitation |
| --- | --- |
| Shared and individual limits | Historical verifier cases and sequential node payments. No concurrency or full retry qualification. |
| Protected capacity | Verifier negatives reject policy/fund capacity extraction and excess fees. Normal node payments retain 600 CKB policy capacity and 154 CKB fund capacity. Not exhaustive security qualification. |
| Closure | Verifier tests cover close, late donations, partial inventory and repeated sweeps. CLOSED cannot reopen; all 600 CKB of policy capacity remains occupied (occupied minimum 572 CKB). No node close/sweep demonstration. |
| Payment funding | Each measured recipient needs 142 CKB, supplied by the delegate in addition to the 2,000-shannon historical fee. Protected treasury capacity cannot fund delegated recipients. No sponsor-input payment design is delivered. |
| Assets | Only an exact synthetic plain xUDT Script and 16-byte amounts. Fixture issuer key 3 is public test material, so the tokens have no credible scarcity/value. No real-token, native CKB or extension-token qualification. |
| Credentials | Real separate delegate signatures, but one machine/common builder. No OS key isolation, hardware wallet or autonomous-agent integration proof. |
| Submission reliability | Shared state can become stale. Refresh/revalidate/resign is needed after conflicts; uncertain submission must reconcile the original hash/state before rebuilding to avoid an unintended second payment. This flow is not implemented/qualified. |
| Recovery | No independent recovery application/discovery tooling. Unsupported or malformed donations, lost credentials and script defects can strand funds. |

Input0 is policy, input1 is acting untyped K, followed by admitted fund inputs. SPEND outputs are successor policy, protected change, approved recipient and optional actor capacity change. Unknown/duplicate dependencies, arbitrary sponsor groups, other assets, mixed external token inputs, header dependencies and nonzero since are outside the admitted shape. The 64-fund input bound is coded, not fully performance-qualified.

No audit, production deployment, independent security review, general wallet/application or service availability promise is made. Licensing and setup limitations for external dependencies do not alter the policy's tested boundary or imply their code belongs to QuotaCell.
