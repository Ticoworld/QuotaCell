# WO18A permanent Windows startup

The project checkout and WO18 acceptance runtime are separate from the Codex worktree:

- Checkout: `C:\Users\timot\Desktop\2026\CKB\QuotaCell\app`
- Runtime: `C:\Users\timot\Desktop\2026\CKB\QuotaCell\local-state\wo18-pudge-acceptance-20261111`

Keep this runtime path for every restart. Do not create a new run directory or replace its journal.

## Backend

```powershell
Set-Location 'C:\Users\timot\Desktop\2026\CKB\QuotaCell\app'
$run = 'C:\Users\timot\Desktop\2026\CKB\QuotaCell\local-state\wo18-pudge-acceptance-20261111'
$env:QUOTACELL_NETWORK = 'pudge-readonly'
$env:QUOTACELL_DEV_SIGNER = '0'
Remove-Item Env:QUOTACELL_PUDGE_BROADCAST -ErrorAction SilentlyContinue
node --experimental-strip-types examples/local-chain/working_pocket_server.mjs $run 4173
```

## React

```powershell
Set-Location 'C:\Users\timot\Desktop\2026\CKB\QuotaCell\app\frontend'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/`. In `pudge-readonly`, the backend verifies Pudge dependencies and genesis, serves live state, and refuses transaction preparation and submission. `/api/reconcile` is observation-only. Every actual public signature and broadcast remains a separate user-approved action.
