# QuotaCell WO17 verification evidence

## Result

**PASS for the isolated local lifecycle and native React experience.** The React UI, its existing Node backend, the QCN4 builders and a fresh isolated CKB node completed the lifecycle below. This result does not qualify a real browser wallet extension or a public Pudge Pocket lifecycle.

## Reproduction

From the repository root, install dependencies and build/typecheck the React application:

```powershell
npm ci --prefix frontend
npm run build --prefix frontend
```

The finished build ran as part of the same work. To rerun the full fresh-node lifecycle, install the local backend dependencies and set the paths for the installed Playwright Core and Chrome:

```powershell
npm ci --prefix examples/local-chain
$env:PLAYWRIGHT_CORE = 'C:/Users/timot/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core'
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$run = 'examples/local-chain/.local/wo17-react-rerun'
node --experimental-strip-types examples/local-chain/wo14b_lifecycle_test.mjs $run
```

The recorded passing run used a fresh disposable directory named `wo17-react-run11` on 2026-11-11. Its machine-readable result is [wo14b-lifecycle.json](evidence/wo17/wo14b-lifecycle.json). The browser tests started Vite and the existing backend together, exercised `/api/state`, and verified the native app contains no iframe. `/legacy` remained available through Vite, and the existing HTML lifecycle also ran against the same backend/node.

## Verified local behavior

- TypeScript typecheck and Vite production build passed (`npm run build --prefix frontend`).
- Empty, creation, owner, delegate, payment review, close review, sweep review and closed views rendered in Chromium. English and Simplified Chinese screens were inspected; localized amount validation was asserted in Chinese.
- Three distinct disposable browser test wallets registered identities. Configured shared, personal, per-payment and approved-recipient terms fed the existing native transaction builders. The resulting creation transaction passed the existing signing checks and was submitted to the isolated node.
- Owner funding of 500 CKB and a separate 73 CKB deposit passed. The UI kept protected fund balance, Cell occupied capacity and shared spending authority separate.
- Operations and Research were each revoked separately. Each later payment attempt was rejected by the application with HTTP 400 (`delegate disabled`). Separately constructed revoked transactions for both delegate slots were rejected by the local CKB VM during `dry_run_transaction`, RPC `-302`, at `Inputs[0].Type` with Q type-script validation error 17. These are two distinct VM proofs; the application response is not being used as a substitute.
- The existing lifecycle completed delegate payments, supported-fund recovery, a late deposit and sweep, and node/server restart and Pocket rediscovery.
- The 101 CKB data-bearing Cell stayed visible after close and was explicitly identified as unsupported and unrecovered.
- Transaction reviews showed the backend-prepared fee, network, signer and payment recipient. Cancel/Escape did not sign. The dialog was modal to keyboard focus. No changes were made to signing verification or uncertain-transaction handling.
- Screenshots at 320 px show no horizontal overflow in empty, onboarding, active owner, active delegate, payment review, close review and closed recovery states. The closed screen distinguishes zero protected balance, 134 CKB of locked terminal capacity, 573.99999999 CKB returned, and the unresolved 101 CKB Cell.

The owner/delegate lifecycle uses the test-only simulated UTXO Global provider and an isolated node. It exercises the application wallet boundary with disposable keys; it is not evidence that a production UTXO Global extension account has been accepted. Browser inspection and screenshots are interface QA, not a user study.

## Pudge and deployment boundary

The existing Pudge deployment and required live code/dependency Cells were checked through read-only RPC calls. The deployed Q code Cell remains `0xd6654da12e92d44a37b9c48a7b27db325fa3e68cc50f3e17ce74a791523c00d0`. It was not spent or redeployed. The documented real-app startup uses `pudge-readonly`, disables the development signer and leaves Pudge broadcasting unset. Public transaction preparation, real-wallet acceptance and the three-real-wallet public Pocket lifecycle remain unqualified; no public transaction was sent.

For exact two-window Windows startup instructions, see [WO17_WINDOWS.md](WO17_WINDOWS.md). Implementation boundaries are listed in [WO17_IMPLEMENTATION_MAP.md](WO17_IMPLEMENTATION_MAP.md).

## Browser captures

These selected screenshots are copied from the passing isolated run. Names and addresses are test data.

- [Empty state, 320 px](evidence/wo17/screenshots/react-empty-320.png)
- [Simplified Chinese onboarding, 320 px](evidence/wo17/screenshots/react-onboarding-zh-320.png)
- [Owner workspace, 320 px](evidence/wo17/screenshots/react-active-owner-320.png)
- [Delegate workspace, 320 px](evidence/wo17/screenshots/react-active-delegate-320.png)
- [Delegate payment transaction review, 320 px](evidence/wo17/screenshots/react-payment-review-320.png)
- [Close and recovery review, 320 px](evidence/wo17/screenshots/react-close-review-320.png)
- [Closed Pocket and unsupported Cell disclosure, 320 px](evidence/wo17/screenshots/react-closed-320.png)
