# QuotaCell Project Handoff

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
