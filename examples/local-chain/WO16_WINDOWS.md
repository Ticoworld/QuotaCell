# Windows Pudge startup and manual acceptance

From a PowerShell window in the repository root, install the pinned dependencies with `npm ci --prefix examples/local-chain`. Node 22 with `--experimental-strip-types` is required. The current checkout must contain `evidence/wo15/pudge-deployment.json`; keep that file unchanged. No private keys are required by the server.

Check the public deployment outpoint using a read-only RPC request:

```powershell
$rpc = 'https://testnet.ckb.dev/'
$q = @{tx_hash='0xd6654da12e92d44a37b9c48a7b27db325fa3e68cc50f3e17ce74a791523c00d0';index='0x0'}
$body = @{jsonrpc='2.0';id=1;method='get_live_cell';params=@($q,$false)} | ConvertTo-Json -Depth 8 -Compress
Invoke-RestMethod $rpc -Method Post -ContentType 'application/json' -Body $body
```

The result must report `live`. Create a dedicated run directory and start read-only mode:

```powershell
$run = Join-Path (Get-Location) 'examples/local-chain/.local/wo16-pudge'
New-Item -ItemType Directory -Force (Join-Path $run 'evidence') | Out-Null
Copy-Item 'evidence/wo15/pudge-deployment.json' (Join-Path $run 'deployment.json')
[IO.File]::WriteAllText((Join-Path $run 'runtime.json'), '{"url":"https://testnet.ckb.dev/"}')
[IO.File]::WriteAllText((Join-Path $run 'evidence/node-profile.json'), '{"genesisHeader":{"hash":"0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606"}}')
$env:QUOTACELL_NETWORK = 'pudge-readonly'
$env:QUOTACELL_DEV_SIGNER = '0'
Remove-Item Env:QUOTACELL_PUDGE_BROADCAST -ErrorAction SilentlyContinue
node --experimental-strip-types examples/local-chain/working_pocket_server.mjs $run 4178
```

Open `http://127.0.0.1:4178/` in the Chrome profile containing UTXO Global to use the legacy HTML fallback. Read-only mode rejects transaction preparation. To inspect an unsigned creation review without submission, stop the server and start it with `QUOTACELL_NETWORK=pudge` and `QUOTACELL_PUDGE_BROADCAST` unset. Connect the owner and both separately controlled testnet accounts, register their public identities, choose supported recipients and review the terms. Do not approve a wallet signature merely to inspect the unsigned review.

## React interface with the Pudge backend

From the repository root, run these commands in two PowerShell windows. The first starts the existing Node backend in Pudge read-only mode; the second serves React and proxies API and wallet requests to it. The frontend uses `http://127.0.0.1:4173` by default.

PowerShell window 1:

```powershell
npm ci --prefix examples/local-chain
$run = Join-Path (Get-Location) 'examples/local-chain/.local/wo16-pudge'
New-Item -ItemType Directory -Force (Join-Path $run 'evidence') | Out-Null
Copy-Item 'evidence/wo15/pudge-deployment.json' (Join-Path $run 'deployment.json')
[IO.File]::WriteAllText((Join-Path $run 'runtime.json'), '{"url":"https://testnet.ckb.dev/"}')
[IO.File]::WriteAllText((Join-Path $run 'evidence/node-profile.json'), '{"genesisHeader":{"hash":"0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606"}}')
$env:QUOTACELL_NETWORK = 'pudge-readonly'
$env:QUOTACELL_DEV_SIGNER = '0'
Remove-Item Env:QUOTACELL_PUDGE_BROADCAST -ErrorAction SilentlyContinue
node --experimental-strip-types examples/local-chain/working_pocket_server.mjs $run 4173
```

PowerShell window 2:

```powershell
npm ci --prefix frontend
node frontend/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/` for React. Open `http://127.0.0.1:4173/` for the original HTML fallback, or use its direct link at the bottom of React. In Pudge read-only mode the dashboard can show discovered public state, but wallet transaction preparation is intentionally disabled. A public Pocket is still needed for the active owner and delegate screens.

Public submission additionally requires explicitly setting `QUOTACELL_PUDGE_BROADCAST=1` before starting the server. Enable it only after authorizing the specific testnet transaction; the user personally approves the wallet signature and separate broadcast. The signed bytes are sent to the configured RPC for dry run and the RPC could relay them. If an outcome is uncertain, reconcile the existing hash; do not replace or resend it automatically. The deployed Q code Cell is owner-controlled and must never be selected for spending.

The prior automated Pudge startup was rejected by the execution environment; these manual instructions have not yet been independently verified end to end. A public lifecycle, account switching and actual creation remain unqualified.
