# WO14B validation

Fresh isolated-node Chromium run, 2026-11-06, Windows, CKB v0.210.0, Node v22.14.0, installed Google Chrome. Separate disposable browser contexts generated owner, Alice and Ben secrets in-browser. Server development signing was disabled. No actors.json, context.json or keys directory existed in the application run.

Command from repository root (PLAYWRIGHT_CORE selected the installed module):

```
node --experimental-strip-types examples/local-chain/wo14b_lifecycle_test.mjs examples/local-chain/.local/wo14b-life-final
```

Exit code: 0. Final public chain identities are in lifecycle.json.

Observed checkpoints: empty startup PASS; eight normally verified committed transactions; active node/server restart PASS (shared use 200 CKB, fund 300 CKB); revoked Alice preparation rejected with `delegate disabled`; terminal node/server restart PASS (closed, no remaining protected fund, eight journal entries).

Transactions, in order:

- Genesis: 0x3b589e6461e772a12ca4ae8d963f0c589ceb4c00f626c507659f0ea437e38594
- Funding: 0x42c241e114709a5a4fb0f3e6ccacba03bd39a39b5ed9234a517dd1ad9cd97ebb
- Alice payment: 0x5fbab37a3e945f92038de1b61254b5a735f2e5791dd20f91522a419bd82078d4
- Ben payment: 0x1e4dd39f6537a8153080a4080c7c0ab10581544025c35be9396cc2c9b0122d8a
- Revocation: 0x1d7c6dc301b06c04c5b435f07663ec77d49d92008158a966c3cfc680e62ac86a
- Close/recovery: 0xd6ec7c62e21ab4be0d2201ba5e4f3ee807410db0fbda348f89be55559458cf91
- Late deposit: 0x8579a99acfccbd9c9c1a873b9780a358addf9084b9759640252c7eec154a594b
- Sweep: 0xd967ec0fbb25241d32adeba02d1cd0d0beaf229a8a228f29726ad810a9243389

Existing pocket_payment_test.mjs, pocket_genesis_test.mjs and pocket_signing_test.mjs passed, along with git diff --check. The fresh startup checkpoint separately passed before the integration increment. These helper results alone are not the lifecycle qualification.

No generated deployment transaction, binary, secret or database is included. Earlier evidence and the source checkout's untracked docs/FRESH_REPLAY.md were not changed. Scope and reproduction instructions are in examples/local-chain/WO14B_WORKING_POCKET.md.
