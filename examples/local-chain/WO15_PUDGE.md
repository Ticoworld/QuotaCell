# WO15 Pudge qualification in progress

The application defaults to the original isolated profile. `QUOTACELL_NETWORK=pudge-readonly` explicitly selects a read-only Pudge profile. It requires HTTPS, consensus `ckb_testnet`, the published testnet genesis, the matching profile genesis, development signing disabled and the same verified live dependency identities as the local server. All application transaction and reconciliation POSTs are disabled in this profile. Mainnet is rejected. This is a fail-closed inspection profile, not a testnet transaction launcher. It still requires `runtime.json`, `evidence/node-profile.json` and public `deployment.json`; Q and K deployment information have not yet been qualified. The current canonical scan starts at genesis and refuses chains of 10,000 blocks or more, so opening a Pudge Pocket is not yet supported.

The local UI accepts standard `ckt1` secp256k1-blake160 recipient addresses and decimal CKB amounts with at most eight fractional digits. Existing local lock-argument entry is retained. Pocket creation takes two delegate public keys, recipient testnet addresses (or local lock arguments), shared limit, individual limits and per-payment ceilings as CKB decimal strings in the JSON form. The connected owner supplies the owner lock. Before a browser signature, a confirmation displays the signer, outputs and fee. A confirmed request still requires the wallet's own approval. The server verifies the returned signed transaction and never receives external signer secrets.

Run from the repository root after installing the existing locked npm dependencies:

```powershell
node examples/local-chain/wo15_inputs_test.mjs
node --experimental-strip-types examples/local-chain/pocket_genesis_test.mjs
node --experimental-strip-types examples/local-chain/pocket_payment_test.mjs
node --experimental-strip-types examples/local-chain/pocket_signing_test.mjs
# Set PLAYWRIGHT_CORE to the installed playwright-core module.
node --experimental-strip-types examples/local-chain/wo14b_lifecycle_test.mjs examples/local-chain/.local/wo15-fresh
```

The lifecycle test requires the exact isolated-node dependencies and Chrome described in [WO14B_WORKING_POCKET.md](WO14B_WORKING_POCKET.md). It uses a simulated provider, not a real extension. See [WO15 evidence](../../evidence/wo15/VALIDATION.md) for the public dependency inventory, budget and remaining gates.
