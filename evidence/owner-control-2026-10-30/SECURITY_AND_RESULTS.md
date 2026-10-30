# Owner control and capital recovery result

**NEW OWNER-CONTROL PROOF PASSED — October 30, 2026.**

The unchanged experimental Q ran on an isolated CKB v0.210.0 node with new
disposable owner/delegate keys. Owner-signed revocation committed. A fresh
delegate-A payment, built and signed after revocation using the actual newly
committed policy outpoint, reached `send_transaction` and was rejected at
`Inputs[0].Type`, Q error17 (`E_DISABLED`). The rejection was not a stale-input
failure. The record preserves the live policy, token fund and delegate auth
input both at signing/construction and after rejection.

The attempted payout was one token, within personal/per-payment/shared limits,
with correct recipient, conserving token outputs, preserved protected capacity,
correct successor counters and a freshly verified signature. An analogous
enabled-B transaction against the same policy/fund passed actual node dry-run.
That control was not broadcast. The node can stop at Q in the rejected case;
we do not claim its K group was separately observed succeeding inside that
failed transaction. Offline signature reconstruction verifies its fresh digest
and actor independently of the JavaScript signer’s self-report.

Owner CLOSE_AND_RECOVER then committed and returned 200 supported synthetic
tokens with all 154 CKB from the selected protected fund Cell to the owner's
standard-lock token Cell. No delegate signed or consented to recovery. A
normal signed deposit returned 50 of those same tokens to the protected lock
after closure. It did not consume the CLOSED policy. Owner CLOSED_SWEEP then
committed, recovering the 50 tokens and their 154 CKB; CLOSED bytes stayed exact.

Final live Cells, policy phase/mask/counters and canonical inclusion were read
directly from the node. Final phase is CLOSED, grant mask 0 and lifetime used 0
(no delegate payment committed in this proof). The owner holds 150 + 50 tokens,
and selected protected funds are consumed. `get_live_cell` on this node returns
`unknown` for those spent outputs; the evidence retains that literal response.
Consumption is established from the canonical committed close/sweep inputs,
not by pretending the response said `dead`. All owned node processes from
the completed attempts were stopped by cleanup.

## Exact capacity and token accounting

| Point | Protected tokens | Protected fund capacity | Owner token Cells | Retained policy capacity |
| --- | ---: | ---: | --- | ---: |
| Funded ACTIVE | 200 | 154 CKB | none | 600 CKB |
| After revoke / rejected payment | 200 | 154 CKB | none | 600 CKB |
| After CLOSE | 0 | 0 | 200 tokens /154 CKB | 600 CKB CLOSED |
| After late deposit | 50 | 154 CKB | 150 tokens /142 CKB | 600 CKB CLOSED |
| After CLOSED_SWEEP | 0 | 0 | 150/142 CKB +50/154 CKB | 600 CKB CLOSED |

The late deposit used 142 additional CKB from the owner's external untyped
capacity to create the extra token Cell. Final owner-token capacity is 296 CKB;
this is not 296 CKB of net newly recovered capital. Close and sweep each return
154 CKB from the selected protected Cell, but the second operation recovers
capacity deliberately re-deposited during the test. Likewise the two receipts
must not be summed as 250 newly recovered tokens: final net owner tokens 200.

The owner recovery output requires 142 CKB under the exact token/lock shape;
the close output carries 154 CKB and therefore has 12 CKB above its occupied
minimum. Returned capacity is under the owner's control but still carried in
typed token Cells. This test does not demonstrate conversion into freely
spendable untyped CKB or a generalized withdrawal builder.

The policy Cell has a measured occupied minimum of 572 CKB and carries 600 CKB.
**All 600 CKB remain permanently retained under this immutable policy**, including
28 CKB above the occupied minimum. No state deletion/capacity reclamation exists.
No contract change, lifecycle redesign or 600-CKB-release claim was attempted.

REVOKE, CLOSE, late deposit and SWEEP each paid 2,000 shannons from owner
external capacity: **8,000 shannons /0.00008 CKB total** for this new sequence.
Rejected delegate submission paid no fee; the enabled control dry-run paid no
fee. Setup fees are separate: deployment 200,000, genesis 2,000 and funding 5,000
shannons; total accepted run fees 215,000 shannons /0.00215 synthetic CKB.
Exact bytes, cycles, blocks, hashes and before/after outputs are in
`accounting.json` and the selected signed records. Dependency deployment
occupied capacity is infrastructure, not the treasury fund or a fee.

## Boundaries and preserved failures

The first attempt failed JavaScript syntax before setup because the additive
loader cut the helper at an inner marker; it was corrected and syntax checking
added. The next attempt committed the complete lifecycle but its final test
incorrectly expected `dead` for spent outputs. The final runner retains the
actual `unknown` response and verifies canonical consumption, and a new fresh
run passed. Failed attempts and full node/command logs remain private.

This is actual local-node evidence by the same operator/machine, not public
testnet, independent reproduction or an audit. It qualifies one revocation,
one selected fund, closure and one well-formed late deposit/sweep under the
exact synthetic xUDT profile. It does not establish completeness of discovery,
hostile-donation recovery, the 64-fund batch bound, owner priority, reorg/retry reliability,
production key isolation, real-value tokens or native-CKB asset payments.
Revocation only wins when committed first; an earlier competing spend can win.

Owner independence here means the chain path requires the owner credential
and not delegate consent. The test reuses the common builder; it is not the
funded standalone owner CLI or service-absent recovery product. Lost owner
keys and Q/token defects remain outside rescue guarantees. The xUDT issuer
fixture is public test material, so these tokens have no credible value.

Q, source/profile, original delegated-spending records, historical runners/locks and previously selected reproduction
evidence are hash-checked unchanged. Only the isolated test extension
and new records were added. The experiment sent no public-network transaction and incurred no paid expense.
This publication contains recorded local-node evidence. The evidence package contains no private role keys or
embedded upstream executables; raw deployment data remains private.
