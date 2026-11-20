# WO19A Local Pocket Discovery

Each contributor runs a loopback QuotaCell instance against Pudge. The runtime is rebuilt from the committed public deployment manifest; do not copy another person's runtime directory, Pocket descriptor, SQLite journal, or credentials.

Create a new runtime directory:

```powershell
node examples/local-chain/pocket_public_runtime.mjs C:\QuotaCell\wo19a-runtime
```

Start the local backend with external signing and broadcasting disabled by default:

```powershell
$env:QUOTACELL_NETWORK = 'pudge'
$env:QUOTACELL_DEV_SIGNER = '0'
Remove-Item Env:QUOTACELL_PUDGE_BROADCAST -ErrorAction SilentlyContinue
node --experimental-strip-types examples/local-chain/working_pocket_server.mjs C:\QuotaCell\wo19a-runtime 4173
```

In another terminal, run `npm run dev -- --port 5173` from `frontend`. Open `http://127.0.0.1:5173/`, connect the participant's compatible CKB testnet wallet, then select a discovered Pocket. To open an exact identity, append `?pocket=0x…` to that local app URL. Share the Pocket ID, not a loopback URL. Each participant's browser talks only to their own loopback backend; this release does not provide a hosted shared backend.

Connected participants can export their version 1 public registration profile. During creation, the owner can import profiles into the two fixed delegate slots. Profiles establish address/key consistency but do not prove possession; only the owner's signed on-chain QCN4 creation authorizes a delegate.

Terminal QCT4 discovery can identify the owner from the terminal lock hash. It cannot restore delegate keys, original policy terms, or transaction history. Such history remains unavailable unless separate canonical evidence is supplied. Supported late-deposit Cells are still discovered from current chain state.

`pudge-readonly` disables transaction actions. `pudge` with `QUOTACELL_PUDGE_BROADCAST` unset permits preparation but blocks submission after wallet signing. Enable broadcast only for an explicitly reviewed testnet transaction. The backend listens on loopback and must not be exposed publicly.
