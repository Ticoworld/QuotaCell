# WO17 Windows launch instructions

These commands start the existing Node `.mjs` backend in Pudge **read-only** mode and serve the native React app through Vite. The API proxy points to the backend on port 4173. They do not enable public transaction preparation or broadcasting. A read-only Pudge backend can show live state but cannot create a Pocket or sign/send a transaction.

Use two PowerShell windows. The repository path below is the current working branch checkout; if the worktree moves, set the repository root to its new location.

## PowerShell window 1 — existing backend

```powershell
Set-Location 'C:\Users\timot\.codex\worktrees\wo14b-working-pocket\QuotaCell'
npm ci --prefix examples/local-chain

$run = Join-Path (Get-Location) ('examples/local-chain/.local/wo17-pudge-readonly-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force (Join-Path $run 'evidence') | Out-Null
Copy-Item 'evidence/wo15/pudge-deployment.json' (Join-Path $run 'deployment.json')
[IO.File]::WriteAllText((Join-Path $run 'runtime.json'), '{"url":"https://testnet.ckb.dev/"}')
[IO.File]::WriteAllText((Join-Path $run 'evidence/node-profile.json'), '{"genesisHeader":{"hash":"0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606"}}')

$env:QUOTACELL_NETWORK = 'pudge-readonly'
$env:QUOTACELL_DEV_SIGNER = '0'
Remove-Item Env:QUOTACELL_PUDGE_BROADCAST -ErrorAction SilentlyContinue
node --experimental-strip-types examples/local-chain/working_pocket_server.mjs $run 4173
```

Keep that window running. The unique run folder preserves its journal and runtime files without replacing an earlier run.

## PowerShell window 2 — React/Vite frontend

```powershell
Set-Location 'C:\Users\timot\.codex\worktrees\wo14b-working-pocket\QuotaCell'
npm ci --prefix frontend
node frontend/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/` for React. Its API calls go through Vite to the backend at `127.0.0.1:4173`. Open `http://127.0.0.1:4173/` for the original HTML fallback, or click “Open the original HTML fallback” in React. `/legacy` is also available at `http://127.0.0.1:5173/legacy`.

The same backend-plus-Vite startup was exercised together by the isolated Playwright lifecycle; see [WO17_EVIDENCE.md](WO17_EVIDENCE.md). Public Pudge UI interaction still requires an already discovered Pocket to display owner/delegate screens. Transaction creation remains disabled in read-only mode.

## Wallet and public transaction boundary

The React wallet flow currently qualifies only the simulated UTXO Global interface on an isolated node. It does not establish acceptance of a real browser extension. Do not set `QUOTACELL_PUDGE_BROADCAST=1`, provide private keys, or send a public transaction as part of startup. Each actual Pudge signature and broadcast requires separate user approval. If a later approved session prepares a write-mode Pudge transaction, its signed bytes go to the configured RPC and that RPC could relay them.

The deployment manifest remains `evidence/wo15/pudge-deployment.json`; the Q code Cell is `0xd6654da12e92d44a37b9c48a7b27db325fa3e68cc50f3e17ce74a791523c00d0`. Never spend that Cell.
