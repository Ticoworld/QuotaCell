# QuotaCell Project Handoff

## WO19C Owner and Contributor UX Refinement

- Reworked the Pocket draft Participants step around one connected owner row and two separate delegate invitation journeys. The normal flow no longer begins with a global registration-code importer or shows redundant owner wallet actions.
- Each delegate now moves from not invited, to an invitation awaiting a manually returned response, to registered. The owner copies and sends each invitation, imports the response inside its matching delegate row, and sees a confirmation before replacing an invitation or accepted contributor identity. Existing QCI1/QCR1 validation remains in use; slot, request, duplicate identity and network failures are reported in the UI.
- Contributor invitation pages show the invited slot and Pudge network, connect the contributor's own wallet, and offer a response link to return to the owner. The flow states that registration does not grant on-chain spending permission and does not prove private-key possession. JSON import/export controls are no longer exposed in the owner or contributor UI; QCI1/QCR1 is the supported product flow.
- Drafts remain owner/network scoped in browser storage. The UI shows saved status only after both the draft and index writes succeed, provides a retry for write failures, and avoids overwriting unreadable saved data. No keys, signatures or transactions are stored.
- Review remains clearly marked as a draft. Genesis preparation stays disabled because this runtime has a single installed Pocket context. The work does not change QCN4, the supervisor, transaction recovery or public broadcasting.
- Verification for this UX continuation: frontend production build passed; 10 focused API, public discovery, registration, wallet, draft, actor discovery and indexer retry tests passed; `git diff --check` passed. Interactive browser acceptance and screenshots were left for the owner to inspect at `http://127.0.0.1:5173/`; this continuation does not claim that browser journey or real-wallet acceptance passed.

## WO19C Pudge Owner Acceptance (In Progress)

- On 2026-11-17, the owner completed the Main plus two-contributor invitation/response flow in real Chrome, entered the 600 CKB shared allowance, 300 CKB delegate allowances, 100 CKB payment maximums, and two distinct approved recipients, then reached Review. The three identities were selected through one UTXO Global profile, so this does not establish independent custody across different operators or computers.
- The owner prepared a live Pudge genesis review in `local-state/wo19c-owner-browser-20261117`. The review showed a 0.00265776 CKB fee, 600 CKB active policy capacity, a selected 10,000 CKB owner input, 9,399.99734224 CKB owner change, a 661.00265776 CKB minimum input including fee, and 134 CKB terminal capacity. The signing wallet shown was Main.
- The first review was in `pudge-prepare-only`, so the app correctly disabled wallet signing and broadcast. After the owner requested the creation acceptance, a genesis-only gate was added at both the supervisor and engine boundaries. With `QUOTACELL_NETWORK=pudge`, `QUOTACELL_PUDGE_GENESIS_ONLY=1`, and `QUOTACELL_PUDGE_BROADCAST=1`, this isolated runtime permits genesis preparation/submission and read-only chain checks; other Pocket transaction routes and non-genesis submissions are rejected. The service remains loopback-only on `127.0.0.1:4173`.
- The owner later approved a wallet signature and clicked `Send to Pudge`; the UI returned to Review with an `Outcome unknown` warning for `0x02649c45795b7b65fadf5ad60d2f7193b0bc653028d11af22789c9fa1a55a93b`. A direct read-only Pudge lookup returned `unknown`. Supervisor reconciliation returned no outcomes, its reservation table was empty, and the draft worker journal contained no intents. The transaction engine persists an intent before its only broadcast call, so this request was not submitted by QuotaCell and no Pocket was created.
- Recovery behavior now classifies a missing journal plus a Pudge miss as not submitted; a journaled transaction remains unresolved and blocks another genesis while the app automatically checks it with bounded backoff. Submission retries reuse the exact same request ID and signed bytes. The saved draft remains intact, and an unresolved transaction no longer asks the owner to investigate status before continuing.
- The app displays an optional manual refresh while it tracks status automatically. The owner can reload `http://127.0.0.1:5173/`; after the live frontend update, the stale hash should resolve to `Not submitted`, leaving the saved draft available for another owner-authorized attempt. Signing and broadcast still require the owner's actions in UTXO Global.
- Follow-up browser screenshots exposed a second issue: the UI reported that the local service was unavailable after Pocket preparation, while the supervisor stayed healthy. The WO19C supervisor journal contains one `prepared` Genesis reservation (`25f34acf-f96b-458c-bad1-ac1d26200d9f`) and the root/draft worker journals contain no intents. This is unsigned preparation only, not a submission. The frontend's 20-second API deadline was too short for this live preparation path and mapped an aborted request to the generic service-unavailable message.
- Genesis preparation now allows 120 seconds, distinguishes timeout from service-offline errors, retains its request ID in the current tab for resume after reload, and labels the next action `Resume preparation`. The supervisor coalesces concurrent requests and returns the exact same cached unsigned transaction for a retry with the same ID and payload. Reusing an ID with changed Pocket rules is rejected. Prepared requests still expire and hold no signing or broadcast authority.
- The stale unsigned reservation expired and the supervisor removed it. The live Pudge API still responds, reports the expected genesis and an empty Pocket set; the supervisor reservation table and all root/draft intent journals are empty. The historical WO18 runtime remains untouched.
- Focused re-verification passes: frontend API tests (8/8), real-engine supervisor integration including concurrent preparation replay and changed-rule rejection, frontend production build, JavaScript syntax checks, and `git diff --check`. Vite reports its existing large-chunk warning.
- The already-running supervisor process predates the idempotent-preparation source change. An automatic command review rejected the requested graceful restart as `blocked by policy`, so the supervisor remains healthy but has not loaded the new replay logic. The frontend dev server is still running and serves the updated frontend. No transaction was signed or broadcast by this recovery work.
- Focused regressions pass: frontend API tests (7/7), the disposable real-engine supervisor integration, JavaScript syntax checks, and `git diff --check`. The frontend production build passes; Vite still reports its existing large-chunk warning. No Pocket creation was broadcast or included on Pudge by this recovery work.
- API state still reports the expected Pudge genesis `0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606` and an empty installed Pocket state.
- The historical WO18 SQLite journal remains unchanged at SHA-256 `EE26B42E50E7FF9755D9328D57ACE2F4D628CC5A8584B2D7A374BC8CEFAAD903`.
- Remaining acceptance: owner wallet signature, explicit broadcast confirmation, canonical Pudge inclusion, exact Pocket identity, independent public discovery, and confirmation that the historical Pocket remains unchanged after inclusion.

## WO19C Pocket-First Ownership and Remote Collaboration

- Kept the existing Pocket as the primary workflow. Owners can view their discovered active and closed Pockets, open one by exact identity, copy its public link, and start or resume a separate creation draft.
- Creation drafts are independently identified and scoped in browser storage to the connected owner's public key and CKB genesis. Multiple drafts can be saved for one owner/network. Draft data contains public registration details, QCI1 invitation bindings, terms and navigation state; it stores no private keys, signatures or transactions.
- The owner and two contributors completed the invitation/response round trip in separate isolated browser contexts with simulated wallets. Wrong slot, stale request, duplicate identity, corrupted response, wrong network and account switching were rejected. QCI1/QCR1 codes are treated as structural identity consistency, not proof of private-key possession.
- The Review screen remains explicitly a draft. The browser acceptance harness verified that it invoked no genesis preparation, wallet signature or broadcast. The historical WO18 runtime remains read-only and untouched.
- My Pockets now keeps a localized skeleton/loading state through five bounded discovery attempts when Pudge initially returns an empty actor search. Discovery-only state no longer labels the connected owner as unrecognized while the Pocket list identifies their role. This uses the existing React/Tailwind stack and adds no notification dependency.
- Added a loopback-only multi-Pocket supervisor. It gives each draft/Pocket its own existing transaction-engine process and SQLite journal, binds reservations to network/Pocket/request, prevents overlapping input reservations, recovers uncertain intents after restart, and locks a runtime against concurrent standalone/supervisor use. A disposable supervisor isolation test covered owner binding, cross-context requests, shared inputs, journal separation and delayed genesis recovery.
- Verification: frontend build passed (Vite reports one 540 kB chunk warning). Focused frontend API, drafts, registration, wallet, public discovery, signing, payment, genesis, creation recovery, backend restart, actor discovery, indexer retry, and supervisor-isolation regressions passed. The original external-submission regression passed on a disposable CKB node. A new integration test passed against the actual `working_pocket_server.mjs` and multi-Pocket supervisor, including a local Genesis commit, two scoped Pocket contexts, shared-input refusal, independent deposits, wrong-signer and cross-context rejection, lost RPC replies, supervisor restart, exact signed-transaction recovery, and per-Pocket reconciliation. The read-only WO18 QCT4 discovery test passed against a disposable copy of the persistent runtime.
- Pinned fixture provenance: A and F were recovered from the canonical live Pudge code Cells in transaction `0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93`, indices 0 and 1, verified against two RPC endpoints. A is 1,216 bytes, SHA-256 `f4ba47fa9a540a74efcee48829dc0cf8b5b9dbba6950ea118aa5d47c42e60d30`, CKB data hash `0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1`. F is 27,360 bytes, SHA-256 `672b6d8bf809cbcf8e2ec440da4d6aae92241b7c298c3c45a33c3f179a032dba`, CKB data hash `0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a`. QCN4 bytecode remains the deployed 23,600-byte build with SHA-256 `f636bb5a9ddb7db41c73ab263a5b5483acae2e36c53afca2257a1cbc95d83997` and CKB data hash `0xd03e5921d5499f74ee734d48e51915a0b996840de1bcfc6a6703007ad810714e`.
- Historical runtime integrity: `local-state/wo18-pudge-acceptance-20261111/working-pocket.sqlite` SHA-256 was `EE26B42E50E7FF9755D9328D57ACE2F4D628CC5A8584B2D7A374BC8CEFAAD903` before and after the tests. The test-generated Genesis and deposits were signed and committed only on the isolated disposable CKB node. No public Pudge transaction was created, signed or broadcast.
- Owner-browser evidence from 2026-11-17: user-provided Chrome screenshots show the connected wallet on Pudge testnet and the historical closed Pocket discovered as owner at `0xfd76ec009d7ceeaf4ad1f49806dccb673cbc5530b07f270c28395112a7320898`. The earlier empty list and later Pocket indicate delayed actor discovery/indexer availability; the screenshots predate the new loading state and must be refreshed to inspect it.
- A separate qualification runtime is running at `local-state/wo19c-owner-browser-20261117`. It contains copies of `runtime.json`, `deployment.json` and `evidence/node-profile.json` only; it has no WO18 Pocket descriptor or journal. The supervisor and engine run in `pudge-prepare-only`, verify Pudge genesis `0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606`, and keep public broadcast disabled. Read-only Pudge checks confirmed live A/F/Q code Cells and both live K dependency-group members match pinned hashes and the expected secp256k1 script identity. Only genesis preparation and read-only reconciliation/RPC are admitted. Preparation, owner-action, submit and retry routes reject; the RPC proxy rejects `send_transaction`.
- This continuation's verification passed: frontend build, 8 focused API/discovery/registration/wallet/draft/genesis tests, JavaScript syntax checks, and preparation-only route/RPC write rejection checks. The Vite chunk-size warning remains. No actual genesis preparation was requested because the real contributor identities and spending rules still need owner input.
- The historical WO18 `working-pocket.sqlite` still has SHA-256 `EE26B42E50E7FF9755D9328D57ACE2F4D628CC5A8584B2D7A374BC8CEFAAD903`. No genesis preparation, wallet signing or broadcast has occurred in the qualification runtime.
- Remaining acceptance gate: refresh `http://127.0.0.1:5173/` in the owner's Chrome, open the closed Pocket, start a separate draft, complete the real contributor invitations and spending rules, then prepare and inspect the live capital/fee review. No new Pudge Pocket has been created. Owner-authorized signing/broadcast and canonical inclusion, independent remote-wallet acceptance, and hosted authorized spending remain outstanding; keep the transaction service loopback-only.
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
