# WO14B independently owned Working Pocket

Start point: `6a6074e`. QCN4, genesis construction, bounded canonical-chain discovery, payment construction and the CCC signature verification boundary are reused. The development signer still requires `QUOTACELL_DEV_SIGNER=1`.

The normal server needs only `runtime.json`, `evidence/node-profile.json` and public `deployment.json` (deployed A/F/Q outpoints, K dep group and ordered allDeps). No actors, context or Pocket are required at startup. Connect the owner browser wallet, enter two delegate public keys, their distinct standard-lock recipient scripts, limits and shared limit in shannons, then create. Fund with the owner Deposit control. Delegate fee cells must already exist under each delegate lock.

`pocket.json` stores public identities, expected policy terms and policy identity. On reopening, canonical chain discovery resolves the current active or terminal policy, protected fund and actor fee cells. SQLite records signed transaction outcomes, rather than defining current cell locations. Owner close and late-deposit sweep retain the existing terminal contract behavior. Multiple protected fund cells are rejected explicitly; this isolated prototype does not consolidate them. Chain discovery remains bounded to 10,000 blocks.

## Fresh Chromium qualification

Prerequisites: Node supporting experimental type stripping, locked npm dependencies, Chrome, Playwright Core, the pinned Windows CKB v0.210.0 binary, and the existing exact A/F/Q build artifacts described by the earlier reproduction documentation. No public transactions or real funds are used.

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
# Set PLAYWRIGHT_CORE to an installed playwright-core module if it is not on Node resolution paths.
# CHROME_PATH and an optional third command argument can select Chrome and the pinned CKB executable.
New-Item -ItemType Directory -Force .local | Out-Null
node --experimental-strip-types wo14b_lifecycle_test.mjs .local/wo14b-fresh
```

The runner refuses an existing run directory. It creates an isolated chain and three separate browser contexts. Each disposable owner/delegate private key originates inside its browser context; only public keys are used to fund it from the runner's separate bootstrap identity. The application runs with development signing disabled and no keys directory, actors.json or context.json. Creation and all actions use the real browser connector and signing boundary. The node verifies transactions normally.

Assertions cover empty startup; owner creation and funding; Alice and Ben payments; active node/server restart with 200 CKB shared usage and 300 CKB protected; Alice revocation and rejected payment preparation; owner close/recovery; late deposit and sweep; terminal node/server restart/reopen; eight committed journal operations; and absence of generated actor/context/key files. The runner writes a public-only summary to its run evidence directory. Generated chain databases and full deployment transactions remain ignored.

This qualifies the disposable Chromium provider and local isolated chain. It does not qualify a production wallet extension, public deployment, reorg reconciliation or multi-fund consolidation. Historical evidence and docs/FRESH_REPLAY.md are preserved in the source checkout.
