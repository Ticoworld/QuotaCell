# WO18 Public Closeout

Date: 2026-11-15
Branch baseline: `d0df1458953bfcf779d5a7c1288b3a9e6bc4b7a7`
Public audit RPC: `https://testnet.ckb.dev`
Result: public lifecycle and closeout checks passed; WO18 is qualified with the limitations below. No public transaction was broadcast during this audit.

## Public Lifecycle

All nine journal intents are committed on canonical Pudge blocks. The audit rehashes each journaled signed transaction in memory and verifies the result against its stored hash. It does not print or export signed bytes.

| Operation | Transaction hash | Canonical block (number / hash) | Fee | Relevant outputs and state |
| --- | --- | --- | ---: | --- |
| Pocket creation | `0xc034f9650ddbbd1c3a9d747ad1bff116c7c9e4dc3e8f4ac4f3d99dc2db175877` | `0x15fbb03` / `0xa2f1535e20c2bd2b30d78b72f8e937969ddf8c0bd46a6ede558d98cda4887304` | 0.00265776 CKB | Q policy 600 CKB; initial shared and personal limits 122 CKB each. |
| Fund Pocket | `0xeef1c6a86bc3edce6275bd623a026df959bf7c6ca75d0e9ef8affeae50440859` | `0x15fe096` / `0xac22e71037c1b9757263779649e41630d075bb20b0cc329f8bdc457c8165730b` | 0.00265776 CKB | F-locked protected funds 256 CKB. This is the original signed funding transaction. |
| Delegate 1 payment | `0x46305893ff76c8be4d9e5bcf904b562c6eec9ef3fab86b5b004961fe019a0ed7` | `0x15fe15c` / `0x7ed3d518a8cba74164c9adb1db8ec764906a592d010047f7edbdcb4e87de1a56` | 0.00016000 CKB | Recipient 61 CKB; protected fund 195 CKB; shared used 61/122; D1 used 61/122; D2 used 0/122. |
| Delegate 2 payment | `0x8bc138af8008ba65418630d411dbb25a5d2025c76f10e1b976b57dbee5b35b2b` | `0x15fe43e` / `0xd70e5ab5d060cd5ef238d8a04939055a8551e4a9b96b042ff9f1a1881e3610c0` | 0.00016000 CKB | Recipient 61 CKB; protected fund 134 CKB; shared used 122/122; D1 used 61/122; D2 used 61/122. Both personal allowances retain 61 CKB, but shared authority is exhausted. |
| Revoke Delegate 1 | `0x632f62c0f1a94b93b6d851b4cb09147c78af91e034f1297eba61bbe03e92a47d` | `0x15feaeb` / `0x3686cce364d05988246560e3dc38970ef150e7907834e713b20be1423151c8b6` | 0.00265776 CKB | Q capacity remains 600 CKB; D1 is disabled. |
| Revoke Delegate 2 | `0x033812e977e0807e6ada287f8ccc163dc1e3c8b425824915d01d83cae3031f61` | `0x15ff787` / `0x65004b51c59c8e5659739defa0804d9679c95f723e84f6a9e8570742ce6fa815` | 0.00265776 CKB | Q capacity remains 600 CKB; both delegates are disabled. |
| Close Pocket | `0x4dda72cc93e399dca7d037f5ce9cfd7ccad1b6742bc525a1ec0dccffb7da8ac2` | `0x15ff7e8` / `0xbebc3314b50010afaa8d197415a723879510843c5d014bca681d3ee312b6654d` | 0.00016000 CKB | Terminal Q capacity 134 CKB; supported funds 134 CKB returned to owner; owner change 100209.99186672 CKB. |
| Late deposit | `0xb9a99e7fe56e23acda89ec2424c7c35777461c318e91b45512d4febc3eb1c155` | `0x15ffa61` / `0x0dda0dbde7a3358d593a70ae214d3e7f08c86c0b0b81def0e7e7e869a58e7166` | 0.00265776 CKB | Closed Pocket received a separate supported F-locked 73 CKB deposit. |
| Recover late deposit | `0x34775985bfe6e3805ed9c16530f62b50d2caec94a5ab047bba6f86c67af3fc56` | `0x15ffabd` / `0xa8d4577e7839ef66c858c211a06dead4cb80605a80ff93dc282e915ef36ed5fe` | 0.00265776 CKB | Owner received 73 CKB; terminal Q remains 134 CKB; no protected fund remains. |

## Funding Input

The stored 256 CKB transaction hash matches its serialized signed transaction. Its only input is `0x1a2f6ba55e70400d20694c121065efa357062388d6401cb091858138e4b85bb1` index `0x0`. The parent transaction is committed in block `0x44d785ba97c7d9aecd7e659de0258495591c045a5f2c65136b6e4ec57f6b08a2`; that output held 100,000 CKB under the owner lock. Pudge `get_live_cell` now returns `unknown` for that outpoint. The child funding transaction itself is confirmed committed and canonical, so the input was consumed; it must not be retried or replaced.

Because the transaction is already committed, `test_tx_pool_accept` was not called and the transaction was not rebroadcast. A pool-admission result would not be the right diagnostic for a transaction already included in a canonical block.

The journal currently records the funding intent as `committed`, phase `after-submit`. This proves the exact signed transaction reached the submit phase at least once. The preserved log set does not distinguish the initial UI attempt from the later same-transaction retry, so the exact call boundary of that first attempt cannot be reconstructed. No replacement was created.

## Submission Ordering Finding

The suspected self-block is reproducible in the public-style external submission path. Before the correction, a signed intent was inserted as `uncertain`, then dry-run called `snapshot()`, which treated that same not-yet-broadcast row as an older unresolved conflict. This rejected the dry run before `send_transaction`. The isolated regression now exercises the HTTP submission path and verifies that the current intent does not conflict with itself, while older unresolved intents still block. A failing dry run produces zero send calls; a passing dry run sends once. It also covers timeout preservation, journal reopening, duplicate requests, wrong network, stale input, wrong signer, and altered outputs.

The correction in commit `2e03d7b` validates existing Pocket state and older intents before accepting a new intent, persists the exact signed transaction before public RPC submission, and excludes only the current intent from the post-persistence snapshot after strict transaction, network, Pocket, operation, and actor identity checks. Dry-run and submit phases are recorded separately. This reproduces and fixes the control-flow failure, but the historical logs do not prove which attempt first crossed the send boundary. The confirmed chain inclusion does prove the original signed hash eventually reached Pudge.

## Capacity And Fees

The active QCN4 policy output was 600 CKB with a calculated occupied capacity of 572 CKB. Closing replaced it with a 134 CKB QCT4 terminal output, exactly its calculated occupied capacity, releasing 466 CKB of policy output capacity. The owner's change increased by 465.99984 CKB because the close fee was 0.00016 CKB. Separately, the 134 CKB supported fund balance was returned to the owner.

The supported F-lock fund output has 73 CKB occupied capacity. The original 256 CKB fund therefore had 183 CKB above occupied capacity; after the two 61 CKB payments, its 134 CKB balance had 61 CKB above occupied capacity. The late 73 CKB deposit equaled its occupied capacity and was fully recovered to the owner. The nine transaction fees sum to 0.01642656 CKB.

The transactions use the Pudge secp256k1 dep-group at `0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37:0`. QCN4 transactions also reference code dependencies `0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93:0`, `0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93:1`, and `0xd6654da12e92d44a37b9c48a7b27db325fa3e68cc50f3e17ce74a791523c00d0:0`. The genesis transaction includes these dependencies; funding and late deposits use the secp dep-group only. Exact dependency references and per-output occupied-capacity calculations are emitted by the audit script.

The Pocket is closed, protected balance is zero, and 134 CKB terminal policy capacity remains occupied and locked by the contract. It is not spendable balance.

## Verification

- Public journal audit: nine signed-byte hashes matched journal hashes; all nine transactions and containing blocks were reported committed/canonical by `testnet.ckb.dev`; fees were calculated from input and output capacities; Q counters and delegate enabled bits were decoded.
- Output audit: lock/type script hashes, data byte lengths, occupied capacities, capacity above occupied capacity, and cell-dependency outpoints were calculated from the canonical serialized transactions. Every output met its occupied-capacity requirement; the terminal QCT4 output is exactly occupied at 134 CKB.
- Isolated CKB lifecycle regression: passed with the public terms (122 CKB shared, 122 CKB per delegate, 61 CKB maximum payment). An additional correctly signed 61 CKB payment, with the shared counter already 122/122 and D1 personal usage 61/122, failed `dry_run_transaction` with code `-302`, Q type-script `ValidationFailure`, program error code `10`. The transaction was not sent to `send_transaction`.
- Revocation negative tests: application checks and CKB-VM dry runs rejected payments by each revoked delegate with code `-302`, Q type-script program error code `17`.
- Persistent backend restart: same SQLite journal reopened in Pudge read-only mode with closed state, no funds, 134 CKB policy capacity, nine history rows, latest row the 73 CKB sweep, and no unresolved intent.
- Empty-journal discovery: a separate temporary Pudge read-only backend, using the saved public descriptor but no SQLite database, rediscovered the closed terminal Cell and zero protected funds from chain state. It returned no transaction history, confirming that history is journal-backed. The descriptor identifies which policy to query; this was not an unrestricted wallet scan.
- Transaction-safety regressions passed for RPC retry limits, SQLite creation recovery/restart, indexed discovery retry, and external HTTP submission/restart. The external path test confirmed one send after a passing dry run, zero sends after a failing dry run, rejection of wrong network/stale input/wrong signer/altered outputs, and conservative reopening of the same journal.

## Limits And Reproduction

The public audit used one configured Pudge RPC endpoint, `testnet.ckb.dev`; this report is not a two-provider independent audit. The original transaction has no pool-admission test because it is committed. The live-cell lookup for its consumed input returned `unknown`, not an explicit `dead` result.

Run the public audit and empty-journal rediscovery with the persistent runtime path:

```powershell
node --experimental-strip-types examples/local-chain/wo18_public_closeout_audit.mjs C:\Users\timot\Desktop\2026\CKB\QuotaCell\local-state\wo18-pudge-acceptance-20261111
node --experimental-strip-types examples/local-chain/wo18_public_discovery_test.mjs C:\Users\timot\Desktop\2026\CKB\QuotaCell\local-state\wo18-pudge-acceptance-20261111
node --experimental-strip-types examples/local-chain/working_pocket_external_submission_test.mjs
```

The isolated lifecycle regression requires the configured CKB 0.210.0 binary, Chrome, and Playwright Core; give it a new disposable directory. It only uses a local dev chain and disposable test signers.
