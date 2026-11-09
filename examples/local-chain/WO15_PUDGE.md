# WO15 Pudge qualification in progress

The application defaults to the isolated profile. `QUOTACELL_NETWORK=pudge-readonly` selects read-only Pudge; `QUOTACELL_NETWORK=pudge` enables preparation and reconciliation, with submission additionally requiring `QUOTACELL_PUDGE_BROADCAST=1` and an externally signed transaction. Both require HTTPS, `ckb_testnet`, the published Pudge genesis, development signing disabled, and exact live K/A/F/Q dependency verification. Mainnet is rejected. No live transaction has qualified this path; do not enable broadcasting until the dependency, funding and wallet requirements in the evidence are satisfied.

Pudge discovery uses the node's integrated indexer, exact scripts, bounded pagination and independent node checks of every candidate. Each indexed snapshot must match the node tip and remain stable during its scan; concurrent Pocket scans must share one tip. Busy or lagging nodes may cause a safe failure requiring the user to retry the read. Multiple matching protected fund Cells are reported as unsupported rather than spent. Local development retains its original bounded-chain scanner.

Public submission records the exact verified signed transaction before a single send, never generates blocks or retries with new inputs, and reconciles the same hash after restart. Pending, committed, rejected, conflicting and uncertain results are tracked conservatively. A canonical commit is checked against the node's current canonical block, but this is not a finality guarantee. Genesis or operation failures and reorganizations may require manual investigation; the journal blocks new actions while outcomes remain unresolved.

The local UI accepts standard `ckt1` secp256k1-blake160 recipient addresses and decimal CKB amounts with at most eight fractional digits. Existing local lock-argument entry is retained. Pocket creation takes two delegate public keys, recipient testnet addresses (or local lock arguments), shared limit, individual limits and per-payment ceilings as CKB decimal strings in the JSON form. The connected owner supplies the owner lock. Before a browser signature, a confirmation displays the signer, outputs and fee. A confirmed request still requires the wallet's own approval. The server verifies the returned signed transaction and never receives external signer secrets.

Run from the repository root after installing the existing locked npm dependencies:

```powershell
node examples/local-chain/wo15_inputs_test.mjs
node examples/local-chain/wo15d_discovery_test.mjs
node examples/local-chain/wo15d_public_tx_test.mjs
node examples/local-chain/wo15d_probe.mjs
node --experimental-strip-types examples/local-chain/pocket_genesis_test.mjs
node --experimental-strip-types examples/local-chain/pocket_payment_test.mjs
node --experimental-strip-types examples/local-chain/pocket_signing_test.mjs
# Set PLAYWRIGHT_CORE to the installed playwright-core module.
node --experimental-strip-types examples/local-chain/wo14b_lifecycle_test.mjs examples/local-chain/.local/wo15-fresh
```

The lifecycle test requires the exact isolated-node dependencies and Chrome described in [WO14B_WORKING_POCKET.md](WO14B_WORKING_POCKET.md). It uses a simulated provider, not a real extension. See [WO15 evidence](../../evidence/wo15/VALIDATION.md) for the public dependency inventory, budget and remaining gates.
