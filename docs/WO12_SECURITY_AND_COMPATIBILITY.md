# WO12 Security and Compatibility

## Experimental Qv2 Contract

`policy/c/allowance_v2.c` is a separately versioned derivative of Q. The v1 source, ABI and published proof remain unchanged. Qv2 uses `QCP2`/version 2 for its 466-byte ACTIVE state and `QCT2`/version 2 for its 28-byte terminal state. The terminal bytes contain a closed marker, zero delegate mask and the owner's 20-byte canonical K lock args. The owner signature still comes from the existing K script; Q does not implement cryptography.

ACTIVE-to-ACTIVE transitions preserve policy capacity. Only owner CLOSE can contract to the exact terminal marker and owner args, with a smaller but occupied-capacity-valid policy output. Afterward, only owner CLOSED_SWEEP is admitted; it preserves exact state and capacity. Other operations require ACTIVE state, and deletion remains rejected by the mandatory successor rule. Fund cells continue to use the existing input-type proxy code, instantiated with the **full v2 Q Script hash**.

The active record retains the v1 field layout and 466-byte size, with `QCP2` and version 2 replacing the v1 header. Qv2 reuses the profile's token, key, limits, counters and witness/action formats. The compact terminal is exactly 8 header bytes plus the 20-byte owner K args. It deliberately discards delegates and operational counters, and contains no field from which ACTIVE or re-enable state can be reconstructed.

## Verified and Unverified Boundaries

Node-verified on CKB 0.210.0: separate owner/Alice/Ben keys; one authorized Alice payment; Ben's over-ceiling negative; exact-owner CLOSE; rejection of a substituted owner, forged active close, post-close delegated use, post-close re-enable and terminal deletion; a new protected F cell after closure; and owner recovery of that late cell. Accepted transitions were submitted through normal `send_transaction` and included through normal block generation. The selected records include the exact signature witnesses and CKB replies.

Not exhaustively verified: malformed encodings, all dependency substitution/missing-dependency combinations, Type ID cloning across all layouts, multiple F inputs and partial recovery permutations, maximum input counts, fee-drain fuzzing, missing owner signatures, all incompatible Q/F combinations, reorgs, node crashes during the WO12 lifecycle, or cycle ceilings under production configurations. No independent audit or arbitrary-token/native-CKB claim is made. A failed/unknown owner key has no fallback: the terminal 134 CKB and any protected funds remain inaccessible. The 134 CKB terminal is intentionally permanent in v2.

The compact-state proof relies on Qv2 itself enforcing exact state transitions and on CKB validating the v2 type script on the input. The 20-byte owner K args do not reveal the public key and cannot sign; they only select the same canonical K lock that the owner must actually unlock. Substituting them at close is rejected. For a CLOSED sweep, a non-owner input cannot satisfy that stored K identity. The standard K dependency is still required.

## Capacity and Fees

The close transaction takes 600 CKB policy capacity to a 134 CKB terminal output, returning 466 CKB in owner-locked untyped change. The separate owner input paid 2,000 shannons. Selected F capacity is preserved in owner xUDT output; token-cell occupied capacity is not freely spendable. Late-deposit and sweep fees were also 2,000 shannons each in this node profile. The Qv2 binary was 24,328 bytes; a code cell at bytes-plus-61 uses 24,389 CKB if deployed separately. A shared deployment amortizes that dependency; deployment capacity is not treasury per-cell recovery.

The 134 CKB terminal output equals the measured occupied minimum (`CellOutput.occupiedSize` plus 28 data bytes). The tested 600 CKB ACTIVE state exceeds its 572 CKB occupied minimum by 28 CKB. The transaction returned all 466 CKB of capacity above the terminal output, including the active slack and the capacity required by bytes removed from state.

## Script Identity and Migration

CKB Script identity includes code hash, hash type and args. Qv2's executable data hash differs from Qv1 and its new policy gets a fresh Type ID lineage from the genesis input. Reusing a 32-byte Type ID argument alone would not make the Q Scripts equal. F's args are the full Q Script hash, so v1 and v2 protected funds are distinct F Script instances even though they use the same generic proxy code.

The immutable v1 Q binary requires its exact fixed-size state and equal-capacity successor. It cannot transition to Qv2's 28-byte state. Existing v1 F args cannot be rewritten in place. There is no atomic or automatic migration. An owner can recover supported assets under the v1 rules, hold them in an owner cell, then fund a new v2 treasury with its own Type ID and F args. That creates a temporary owner custody step and requires a separate transaction; it is not an upgrade of the old policy.

## Retirement Alternative

An independent owner path in F without Q must not treat a missing Q input as proof of closure. A permanent closure anchor solves that fact but retains policy-like occupied capacity. A higher-ceiling design would put an owner-only absolute block threshold into a new F Script instance. Before it, every supported spend must include the current Q input and pass Q. After it, only the committed owner K may recover without Q. Q retirement would separately require owner authorization and CLOSED state. Because the same immutable threshold remains in every F args, a deposit created after Q retirement is still recoverable immediately by the owner once that threshold has passed.

This design is not proven. Its lock args add an owner identity and threshold, raising minimum capacity for every F cell (straightforward representation: at least 28 CKB per F cell). It needs node tests for future `since` boundaries, early attempts, same-transaction layout confusion, late-created cells, Type ID lineage, fee/capacity extraction, replay, and lost owner keys. A timer does not recover from owner-key loss. Until those tests pass, v2 must keep the permanent tombstone.

CrowdCell's source uses an absolute block-number `since` compared against a deadline in immutable pledge args. Without the campaign dependency, pledge refund is allowed only after deadline plus 1,944,000 blocks; campaign destruction is also gated on that grace, and it rejects destruction in a transaction that spends a pledge. The fallback returns to each pledge's backer, not a treasury owner. Its late-created pledges can still carry the already-passed deadline; after campaign retirement, the lock-level fallback remains. These rules are coupled to CrowdCell's fundraiser model and do not authorize copying its interval or exit destination into QuotaCell.
