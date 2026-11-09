# QuotaCell

QuotaCell is an experimental CKB spending policy for two independent delegates drawing from one shared cumulative allowance. Each delegate signs with their own key and has an approved recipient, an individual limit and a per-payment ceiling. The owner can revoke a delegate and recover protected funds. Deposits do not reset the shared allowance.

The current QCN4/QCT4 profile protects native CKB in Cells and enforces the policy in CKB transaction validation. Each payment consumes and recreates the shared policy Cell, so concurrent payments contend for the same state. The earlier [synthetic xUDT prototype](evidence/local-node) is a separate historical profile; its results and [owner-control evidence](evidence/owner-control-2026-10-30/README.md) remain available.

## What has been demonstrated

WO14B ran a complete fresh isolated-node Chromium lifecycle: owner creation and funding, payments by two independently controlled disposable browser signers, revocation, recovery, late deposit and sweep. Eight transactions committed with normal node validation. The application restarted and reopened both active and terminal state, without server-held owner or delegate secrets. See the [validation record](evidence/wo14b/VALIDATION.md), [lifecycle test](examples/local-chain/wo14b_lifecycle_test.mjs) and [reproduction guide](examples/local-chain/WO14B_WORKING_POCKET.md). The browser signer was a disposable simulated provider; this is not qualification of a real wallet extension.

An active Pocket policy holds **600 CKB**. Closure returns **466 CKB** and retains a **134 CKB** terminal Cell for later recovery. A protected fund Cell requires at least 73 CKB, and actors need separate fee Cells. These per-Pocket amounts are separate from the capacity needed to deploy shared contract code Cells; the exact deployment capacity depends on the executable sizes and output locks. See the [native CKB evidence](evidence/wo13-native-ckb/README.md) and [capital-recovery evidence](evidence/wo12-capital-recovery/README.md).

## Build and inspect

- [QCN4 contract source](policy/c/allowance_native_v2.c) and [profile](policy/c/profile.h).
- [Genesis builder](examples/local-chain/pocket_genesis.mjs), [payment builder](examples/local-chain/pocket_payment.ts), [signing boundary](examples/local-chain/pocket_signing.mjs), and [Working Pocket application](examples/local-chain/working_pocket_server.mjs).
- [WO14B lifecycle evidence](evidence/wo14b/VALIDATION.md) and [fresh reproduction instructions](examples/local-chain/WO14B_WORKING_POCKET.md).
- [Native CKB isolated-node results](evidence/wo13-native-ckb/README.md), [build and test instructions](docs/BUILD_AND_TEST.md), [dependencies](docs/DEPENDENCIES.md), and [security model](docs/SECURITY.md).
- [Historical xUDT verifier results](policy/results/summary.json), [fixtures](policy/fixtures), and [local-node records](evidence/local-node).

The historical xUDT verifier includes 89 fixture expectations, not 89 committed transactions. Isolated-node hashes are not public explorer records. Reproduction requires exact external dependencies; see the linked guides.

## Experimental limits

The interface is developer-grade. A real wallet extension and a public Pudge lifecycle have not been qualified. There is no independent audit or production custody claim. Reorganization handling, multi-fund consolidation and independent recovery remain limited; loss of the owner key can strand funds. Do not use QuotaCell to secure real value.

Original QuotaCell material is [Apache-2.0](LICENSE), Copyright 2026 Ticoworld. Upstream components retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
