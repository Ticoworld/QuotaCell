# WO18A permanent workspace and creation recovery

Date: 2026-11-11
Result: **PARTIAL**
Source base: `0694c96f0ac166eae5e176df31787bbe1c9f53e` on `codex/wo15-pudge-qualification`

WO18A completed the permanent checkout migration, public creation recovery hardening, controlled failure tests, and a read-only Pudge startup/restart. It did not create or fund a public Pocket and did not test a real wallet.

## Gate status

| Gate | Status | Evidence |
| --- | --- | --- |
| A: public Pudge dependencies | PASS | Both configured endpoint origins returned the expected testnet and genesis. Full K/A/F/Q live-cell checks matched the manifest. Node and indexer tips matched on each endpoint. |
| B: permanent startup and restart | PASS | React/Vite and the existing Node server started from the permanent checkout. The backend was cleanly stopped and restarted with the same `local-state` directory. Vite proxy returned Pudge state; the write route was rejected in read-only mode. |
| C: real UTXO Global wallet | PARTIAL | Read-only wallet screen is available. No real extension account was connected in this run, so identity, account changes, rejection and disconnect remain unverified. |
| D: eligible funding | NOT STARTED | No wallet was connected and no account Cells were inspected. No funding sufficiency is claimed. |
| E: public Pocket creation | NOT STARTED | No signature, dry run, or public submission occurred. |
| F: real delegate payments | NOT STARTED | No public Pocket exists. |
| G: public revocation and recovery | NOT STARTED | No public Pocket exists. |
| H: public restart and rediscovery | NOT STARTED | No public Pocket exists. |

## Migration and runtime

- Original managed checkout remains at `C:\Users\timot\.codex\worktrees\wo14b-working-pocket\QuotaCell`, branch `codex/wo15-pudge-qualification`, HEAD `0694c96f0ac166eae5e176df31787bbe1c9f53e`, with no tracked changes.
- Permanent independent checkout: `C:\Users\timot\Desktop\2026\CKB\QuotaCell\app`. It has a real `.git` directory, the GitHub origin, no Git object alternates, and the same branch and starting HEAD. `main` was not modified.
- The Desktop path is outside `C:\Users\timot\OneDrive`; Windows Desktop is not redirected into that sync root.
- Existing Desktop archive directories were inventoried and left untouched. The HTML fallback and WO17 records remain in the permanent checkout.
- Persistent WO18 runtime: `C:\Users\timot\Desktop\2026\CKB\QuotaCell\local-state\wo18-pudge-acceptance-20261111`.
- The primary RPC runtime file is preserved as `runtime-primary-20261111.json` (SHA-256 `9b98cf55646ae21d06b81aa6452bfa1615072023aabf1e2bc00211d55abf8301`). The active `runtime.json` uses `https://testnet.ckbapp.dev/` (SHA-256 `26e9236e741cee0aaaaf99581e16e582a75b7cb13eaeaff28a527fcf475be1ad`) after repeated primary endpoint timeouts during application dependency checks.
- A consistent empty SQLite migration snapshot was created with SQLite backup semantics; its SHA-256 was `ee26b42e50e7ff9755d9328d57ace2f4d628cc5a8584b2d7a374bc8cefaad903`. Backend startup applied the journal schema migration. After startup and restart, `PRAGMA integrity_check` returned `ok` and the live database still contains zero intents. The source database, WAL and SHM files from the stopped original run are preserved in `migration-source/`; their hashes and the copied deployment/profile files are recorded in [verification.json](verification.json).
- No `pocket.json`, signed transaction, transaction hash, private key or seed phrase was created or added to the runtime. The original Q code Cell was not spent.

## Creation recovery correction

The prior creation path could send signed bytes to public `dry_run_transaction` before a durable intent existed, and it wrote the Pocket descriptor separately from the SQLite journal. A crash could therefore leave insufficient recovery state or make the app look empty.

The updated public path commits the exact signed transaction and provisional `{initial, actors}` recovery payload together in one SQLite intent transaction before any signed bytes leave the app. Dry run and public submission follow that durable write. The server never automatically resends. On startup or state refresh, a journaled creation is observed by hash; an unresolved, rejected, conflicting, missing-payload or descriptor-conflict state is shown as recovery-required rather than as an empty Pocket. A descriptor is materialized only after a canonical commit is observed. Even a previously committed creation is rechecked for canonical status before recovery completes. Reconciliation in either Pudge mode is observation-only. An in-progress creation is not concurrently reconciled, and an already committed creation does not block unrelated owner actions.

A creation row with a confirmed `rejected` outcome remains blocked from replacement creation. The app does not currently offer an explicit operator resolution flow to clear that known rejection; it fails closed and requires a separately reviewed recovery procedure. Unknown, pending and conflicting outcomes also remain blocked.

One bounded retry is applied only to idempotent RPC reads. `dry_run_transaction` and `send_transaction` remain single-attempt. `get_live_cell` has a 30-second timeout for the large standard-script dependency Cell.

The QCN4 contract bytes, deployed code Cell, signature verification checks and public broadcast approval boundary were not changed. `pudge-readonly`, disabled development signing and unset public broadcast remain enforced.

## Verification

- `node examples/local-chain/pocket_rpc_retry_test.mjs`: PASS. Read-only retry bound, JSON-RPC errors, and single-attempt dry-run/submission behavior.
- `node examples/local-chain/pocket_creation_recovery_test.mjs`: PASS. Uses a temporary SQLite database, a child process that exits immediately after durable intent commit, and close/reopen fault stages for intent persistence, before/during/after dry run, before/after submission, accepted submission with lost response, unknown/pending/rejected/conflicting outcomes, canonical revalidation, descriptor-write failure/retry and no-rebroadcast behavior. It tests the durable recovery helper and database behavior; it does not kill and restart the complete HTTP backend with a populated journal.
- `node examples/local-chain/pocket_creation_server_restart_test.mjs`: PASS. Starts the complete HTTP backend twice against a temporary runtime containing an uncertain genesis intent, checks both restarts continue to report recovery-required with the same transaction hash and recovery payload, verifies no `pocket.json` is fabricated, and confirms the read-only RPC bridge refuses `send_transaction`. The test performs only public read RPCs and never broadcasts or dry-runs signed bytes. This is controlled local restart evidence, not public lifecycle evidence.
- `node examples/local-chain/wo15d_public_tx_test.mjs`: PASS. Public submission opt-in and pending, committed, rejected, conflict, uncertain, interruption and reorganization outcomes.
- `npm run build` in `frontend`: PASS.
- `node --experimental-strip-types examples/local-chain/wo14b_lifecycle_test.mjs examples/local-chain/.local/wo18a-lifecycle-regression-11-20261111`: PASS on a fresh isolated CKB node after the recovery and RPC changes. Creation, funding, two simulated delegate payments, separate revocations, both Q VM error-17 rejections, recovery, late deposit/sweep, active and terminal restart, and React mobile checks passed. The machine result is in that ignored run directory; it is isolated-chain proof only.
- Pudge React/API startup: PASS. `GET /api/state` returned empty state, expected Pudge genesis and `developmentSigner: false`; proxied `get_consensus` returned `ckb_testnet`; the external creation route returned HTTP 400 in read-only mode. Backend stop/restart reused the same persistent runtime and healthy empty journal.
- Actual React read-only screen: [pudge-readonly-empty.png](screenshots/pudge-readonly-empty.png). It shows the application in `pudge-readonly`; no extension was connected.
- The follow-up full-backend restart test was run from the permanent checkout on 2026-11-12. It used a disposable temporary fixture and did not modify the persistent WO18 runtime or its empty journal.
- The source commit tested by these checks is recorded in `verification.json` as `testedCommit`; public acceptance remains unfinished.

## Pudge observations

Expected genesis: `0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606`.

On 2026-11-11, both `https://testnet.ckb.dev/` and `https://testnet.ckbapp.dev/` returned `ckb_testnet`, the expected genesis, and the same node/indexer tip at the paired observation: height `0x15f6668`, hash `0xe8ed8fb8d88b373a415e8cd0f2f1f24f95e18e333567c27ef0433fc60aa4d8e4`. Both reported fee median `0x81c6` (33,222 shannons per 1,000 bytes). A complete dependency probe verified the live K dep group and members, A, F and Q with exact expected hashes. Q is canonical in block `0xa04b7b4746537d9c7e6237caf81cbf15fff82f3e29fd4240dd7a479414b97b65`, height `0x15f33da`.

These are different RPC origins; independent operators or infrastructure have not been established. Earlier samples differed in height, and the backend experienced transient `get_live_cell` timeouts before bounded read retry and the larger read timeout were added. The exact observation records are in [verification.json](verification.json). No RPC received signed transaction bytes.

## Remaining action

Open `http://127.0.0.1:5173/` in the user's actual Chrome profile and manually connect UTXO Global. Confirm the selected extension and account on screen. This only qualifies connection and public identity discovery; it does not authorize a signature or transaction. No Pocket preparation, signing, dry run or broadcast is enabled in the current read-only process.
