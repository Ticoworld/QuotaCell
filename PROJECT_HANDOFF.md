# QuotaCell Project Handoff

## WO19C Pocket-First Ownership and Remote Collaboration

- Kept the existing Pocket as the primary workflow. Owners can view their discovered active and closed Pockets, open one by exact identity, copy its public link, and start or resume a separate creation draft.
- Creation drafts are independently identified and scoped in browser storage to the connected owner's public key and CKB genesis. Multiple drafts can be saved for one owner/network. Draft data contains public registration details, QCI1 invitation bindings, terms and navigation state; it stores no private keys, signatures or transactions.
- The owner and two contributors completed the invitation/response round trip in separate isolated browser contexts with simulated wallets. Wrong slot, stale request, duplicate identity, corrupted response, wrong network and account switching were rejected. QCI1/QCR1 codes are treated as structural identity consistency, not proof of private-key possession.
- The Review screen remains explicitly a draft. The browser acceptance harness verified that it invoked no genesis preparation, wallet signature or broadcast. The read-only Pudge runtime also keeps creation disabled.
- Added a loopback-only multi-Pocket supervisor. It gives each draft/Pocket its own existing transaction-engine process and SQLite journal, binds reservations to network/Pocket/request, prevents overlapping input reservations, recovers uncertain intents after restart, and locks a runtime against concurrent standalone/supervisor use. A disposable supervisor isolation test covered owner binding, cross-context requests, shared inputs, journal separation and delayed genesis recovery.
- Verification: frontend build passed (Vite reports one 535 kB chunk warning). Thirteen focused frontend, discovery, signing, payment, genesis, recovery and supervisor tests passed; guided-terms and RPC retry tests passed. The read-only WO18 discovery regression passed against a disposable copy of the persistent runtime. The Playwright workflow passed with simulated wallets, and the live WO18 QCT4 link passed in a fresh browser context without a wallet or local QuotaCell backend. Screens inspected covered closed Pocket, Pocket picker, draft people, spending rules, Review and public WO18 state across desktop/mobile and English/Simplified Chinese.
- Historical runtime integrity: `local-state/wo18-pudge-acceptance-20261111/working-pocket.sqlite` SHA-256 remained `EE26B42E50E7FF9755D9328D57ACE2F4D628CC5A8584B2D7A374BC8CEFAAD903`. No public transaction was created, signed or broadcast.
- Remaining execution gate: `working_pocket_external_submission_test.mjs` could not start because `test-support/binaries/always-success` is absent; its manifest pins SHA-256 `f4ba47fa9a540a74efcee48829dc0cf8b5b9dbba6950ea118aa5d47c42e60d30`. The harness also encountered the pre-existing `examples/local-chain/results/run` directory; it was left untouched. Therefore the supervisor's transaction path has not yet been exercised end-to-end against the real engine on a disposable CKB chain, and no new Pudge Pocket has been qualified with an owner wallet. Independent real-wallet acceptance remains outstanding.
- Hosted authorized spending remains a later milestone. Do not expose the loopback transaction service publicly.

## WO19B Public Pocket Viewer

- Added wallet-free direct Pocket lookup at `?view=1&pocket=<type-script-hash>`. Existing `?pocket=...` runtime routing remains unchanged; the public route is selected explicitly with `view=1`.
- The public viewer runs from the static React frontend and queries Pudge directly. It verifies the testnet genesis, bounded/canonical indexer snapshot, exact live Cell contents, terminal/active QCN4 state, and canonical creation transaction before rendering.
- Verified the historical closed WO18 Pocket in a fresh in-app browser context with no wallet provider and no QuotaCell backend listening on port 4173. Pocket ID: `0xfd76ec009d7ceeaf4ad1f49806dccb673cbc5530b07f270c28395112a7320898`.
- Browser showed closed status, 134 CKB terminal policy capacity, canonical indexer height and the disclosure that the terminal Cell does not contain delegate identities, original rules or transaction history. No public-fund amount or historical transaction list is inferred.
- Deterministic active QCN4 direct-lookup fixture, invalid ID, missing ID, RPC error, wrong-network, stale-tip and indexer-drift checks pass. Browser inspection covered English and Simplified Chinese at mobile and desktop widths; invalid IDs show a readable error.
- Copy Pocket Link now generates `?view=1&pocket=<type-script-hash>`. No transaction, signing or backend write path is used by public viewing.
- The pre-existing uncommitted WO19A draft edits were preserved and remain part of the checkout; they were not part of the public-viewer browser acceptance journey.
- Remaining limitation: public protected-fund discovery is not presented. Closed QCT4 state cannot reconstruct historical delegate details or transaction history. Hosted wallet actions still need a separately secured service; this viewer is read-only.

## Active Checkout

- Git root: `C:\Users\timot\Desktop\2026\CKB\QuotaCell`
- Branch: `codex/wo19a-remote-pocket-discovery`
- Verified WO19A source base: `8eb689b64e460a4360142b1be6f868cceda4ae77`
- Remote: `https://github.com/Ticoworld/QuotaCell.git`
- `707de8d` is an ancestor of the verified source base. This branch's housekeeping commit records only migration documentation and the runtime ignore rule; `main` was not changed.
- The WO18 recovery note is preserved at `examples/local-chain/WO18_SESSION_RECOVERY.md`.
- Persistent state remains at `local-state/wo18-pudge-acceptance-20261111`; `local-state/` is ignored by Git.

## Preserved Copies

- Full pre-consolidation backup: `C:\Users\timot\Desktop\2026\CKB\QuotaCell-backup-20261117`.
- Historical material archive: `C:\Users\timot\Desktop\2026\CKB\QuotaCell-history-archive-20261117`.
- Retired verified staging clone: `C:\Users\timot\Desktop\2026\CKB\QuotaCell-retired-staging-20261117`.
- The old publication checkout is in the historical archive. The full backup retains the original root, all nested Git metadata, runtime files, and dependencies. Keep the full backup until explicit deletion approval.

## Verification

- Remote clone and active root both resolve to the expected branch and HEAD. `707de8d` is in the active history; `git fsck --full` passed.
- Backup verification: 102,549 files and 13,884 directories, 2.222 GiB, zero mismatches or failures. SQLite, SHM, and WAL SHA-256 values match the active persistent state.
- Historical archive verification: 42,103 files, 1.511 GiB, zero missing or mismatched files.
- WO19A frontend tests, Pudge discovery retry, and backend recovery restart tests passed.
- React production build passed. Vite reported a chunk-size warning for chunks over 500 kB.
- `npm ci` reported 21 low-severity dependency advisories; no audit fix was run.
- Read-only Pudge smoke check returned the React page with HTTP 200 and `pudge-readonly` state. A transaction-preparation request was rejected with HTTP 400. No wallet or transaction action was used. Both temporary servers were stopped.
- The smoke check used a disposable runtime copy under `%TEMP%\QuotaCellPudgeReadonlyVerify20261117`; that copy was retained after the safety policy blocked recursive cleanup.
- No QCN4 source was changed. `main` was not altered.

## Commands

Run the React build from `frontend`:

```powershell
npm ci
npm run build
```

Run the focused WO19A and Pudge regressions from the repository root:

```powershell
node --experimental-strip-types --test frontend/src/publicDiscovery.test.mjs frontend/src/registration.test.mjs frontend/src/wallet.test.mjs
node --experimental-strip-types --test examples/local-chain/pocket_indexed_discovery_retry_test.mjs examples/local-chain/pocket_creation_server_restart_test.mjs
```

Start the Pudge backend from the repository root in read-only mode:

```powershell
$run = 'C:\Users\timot\Desktop\2026\CKB\QuotaCell\local-state\wo18-pudge-acceptance-20261111'
$env:QUOTACELL_NETWORK = 'pudge-readonly'
$env:QUOTACELL_DEV_SIGNER = '0'
Remove-Item Env:QUOTACELL_PUDGE_BROADCAST -ErrorAction SilentlyContinue
node --experimental-strip-types examples/local-chain/working_pocket_server.mjs $run 4173
```

In a second terminal, serve React from `frontend`:

```powershell
Set-Location 'C:\Users\timot\Desktop\2026\CKB\QuotaCell\frontend'
$env:QUOTACELL_BACKEND_URL = 'http://127.0.0.1:4173'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```
