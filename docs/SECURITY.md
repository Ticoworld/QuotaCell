# Security model and limitations

This is an unaudited experiment. Do not use it to secure real assets.

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
