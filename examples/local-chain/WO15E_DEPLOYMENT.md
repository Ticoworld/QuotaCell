# WO15E separate Pudge Q deployment surface

This is a separate experimental local application on `http://127.0.0.1:4176/`; it does not replace the existing sign-only screen. **It has not been exercised with the real extension or a public transaction.** The operator must complete review and obtain explicit user authorization for the exact deployment transaction before starting the broadcast step. This surface was developed and tested without sending a public transaction.

From the repository root, with locked npm dependencies, exact local Q executable and a Node version supporting `node:sqlite` and type stripping:

```powershell
node --experimental-strip-types examples/local-chain/wo15e_deployment_server.mjs
```

Open the loopback address manually in the existing Chrome profile. Select the real UTXO Global wallet and CKB testnet. The separate process requires a fresh sign-only review and independently verified extension signature for the same key before it permits deployment preparation. Select **Prepare Q deployment**, inspect all input/outpoint, capacity, owner lock, code hash, fee, change, transaction fields and complete serialized bytes, and personally authorize its signature. The server independently verifies the returned signed transaction and its signature and performs a Pudge dry run. This sends the signed bytes to the selected RPC for simulation; that RPC could technically relay them, so use a trusted operator. Before deployment signing, the page displays this risk and requires an acknowledgement. The signed transaction exists in browser/server memory and the dry-run RPC receives it; it is not written to the local journal.

Prepared signing requests expire after five minutes, and the separate broadcast approval expires five minutes after the dry run. After the dry run, the screen displays the transaction hash again. The human must separately enter that exact hash, click **Broadcast reviewed deployment**, and confirm the dialog. Broadcast sends once. The code Cell contains the exact 23,600-byte Q executable under the connected owner's standard lock: **the Cell is replaceable, not permanently immutable**, and consuming it can break dependent Pockets. Confirm the disposition of its 23,661 CKB capacity and the exact change and fee before authorizing broadcast. A single plain owner Cell must cover at least 23,722 CKB plus the shown fee. Funding and actual extension behavior must be verified interactively.

Before send the server rechecks Pudge identity, exact K/A/F dependencies, Q bytes, live input, exact transaction and signature, current fee, and dry run. It writes public transaction metadata to `.local/wo15e-deployment-journal.sqlite` with SQLite synchronous FULL before the one send; it never stores private keys, signatures or signed transaction bytes there. Network errors after send are **uncertain**, and no replacement or resend happens automatically. Reconcile a known hash using the page: it checks canonical commitment and the live code Cell's exact data hash, bytes, capacity and owner lock. A second distinct Pudge RPC independently repeats those checks and confirms the same block and live Cell. Only after both checks succeed does the server create `.local/wo15e-pudge/deployment.json`, containing the existing Working Pocket deployment schema (`kdep`, `deployed.A/F/Q`, `allDeps`) and network/genesis metadata. Set `QUOTACELL_DEPLOY_MANIFEST_DIR` to choose another output folder and `QUOTACELL_PUDGE_INDEPENDENT_RPC` to choose the second HTTPS RPC (default `https://testnet.ckbapp.dev/`; it must have a different origin from the primary). Distinct endpoints may share an operator or backend. An existing different or unreadable manifest is never overwritten. While the second check or manifest creation fails, the journal remains `verification-pending` and blocks another deployment. A committed transaction is not a finality guarantee. Any unresolved journal entry blocks preparing another deployment. A restart loses the signed transaction in memory, but the journal retains attempted hashes for reconciliation; do not reconstruct or resend uncertain transactions.

Tests, run without any live public send:

```powershell
node --experimental-test-module-mocks examples/local-chain/wo15e_deployment_submission_test.mjs
node --experimental-strip-types examples/local-chain/wo15e_deployment_server_test.mjs
node examples/local-chain/wo15e_deployment_manifest_test.mjs
node --experimental-strip-types examples/local-chain/pocket_signing_test.mjs
```

The submission test uses a mocked signature-verification boundary and fake RPC to exercise the state machine; the existing signing test checks real cryptographic verification on recorded local fixtures. The server test verifies routing and refusal of unprepared broadcasts, without connecting to the public RPC. These tests do not qualify a real extension, actual Pudge signing, public deployment, a funded wallet, an explorer record, or a complete Pocket. The exact Q public code-cell search remains inconclusive. See [WO15 evidence](../../evidence/wo15/VALIDATION.md) before using this surface.
