# QuotaCell Project Handoff

Status as of November 26, 2026. This is the current-state handoff; the previous chronological handoff is preserved in Git at [`bc8d7e0e79851d0c8379418226bd54108ed674ab`](https://github.com/Ticoworld/QuotaCell/commit/bc8d7e0e79851d0c8379418226bd54108ed674ab).

## Product and current release

QuotaCell is experimental CKB-native shared spending infrastructure, currently offered as a public Pudge testnet wallet application. An owner configures one shared lifetime allowance, limits for two delegates, and approved recipients. Delegates use their own compatible human-controlled wallets. The contract, rather than the site, enforces spend limits. This is not audited and must not secure real assets.

The human-wallet hosted application supports discovery and Pocket lifecycle operations. Agent integration, unattended/headless delegate use, multiple wallet profiles, and mainnet deployment remain planned or under investigation.

## Native QCN4/QCT4 deployment

The current native profile uses QCN4 for active policy and QCT4 for closed terminal state on Pudge. Deployment identity and dependencies are recorded in [`evidence/wo15/pudge-deployment.json`](evidence/wo15/pudge-deployment.json) and the detailed public audit is [`examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md`](examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md). The documented profile has two fixed delegate slots and fixed approved recipients. Its active policy occupied 600 CKB; closure left 134 CKB in the terminal policy Cell, which is locked capacity, not spendable balance.

## Hosted browser execution

Netlify sets `VITE_QUOTACELL_BROWSER=1` in [`frontend/netlify.toml`](frontend/netlify.toml). [`frontend/src/api.ts`](frontend/src/api.ts) routes browser operations through [`frontend/src/browserPudge.ts`](frontend/src/browserPudge.ts), which handles transaction preparation, signing validation, submission, and reconciliation in the browser execution path. A compatible wallet signs after the user reviews the transaction; the app does not receive wallet private keys. Browser mode is a supported operating mode of the current application, not a universal restriction.

## Local execution engine

[`examples/local-chain/working_pocket_server.mjs`](examples/local-chain/working_pocket_server.mjs) implements transaction workflows. [`examples/local-chain/working_pocket_supervisor.mjs`](examples/local-chain/working_pocket_supervisor.mjs) isolates Pocket contexts and coordinates reservations. The local engine is another supported operating mode, useful for development and local deployments; it is not required for hosted browser execution.

## Verified lifecycle evidence

- The repository records nine canonical transactions in the November 15 WO18 lifecycle: creation, funding, two delegate payments, two revocations, close, late deposit, and its recovery. See the closeout record for identities, capacity accounting and audit scope.
- The November 20 Nervos Talk progress report records a subsequent real-wallet web-app lifecycle with delegate payments, permission changes and closure. It reports 78 CKB protected funds returned and 466 CKB policy capacity released, with 134 CKB terminal capacity remaining. This is a first-party public progress report; the detailed canonical record for the November 15 run remains the repository evidence.
- The preserved PG02 qualification branch, [`codex/pg02-playground`](https://github.com/Ticoworld/QuotaCell/tree/codex/pg02-playground), records native CCC signer qualification: a 61 CKB payment from a 256 CKB protected Pocket left 195 CKB protected and consumed 61 of 122 CKB allowance. This is signing qualification, not autonomous agent integration. Do not merge Playground credential-delivery code; its development-only key receiver is not a proposed custody model.

The November 20 report is [QuotaCell: Off localhost and running on public Pudge](https://talk.nervos.org/t/quotacell-let-your-team-spend-without-handing-over-the-treasury/11002/23). Repository-recorded canonical evidence, first-party browser observations, independent community feedback, and independent security qualification are distinct evidence classes; there is no independent security qualification or audit.

## Security and operational limitations

Use Pudge testnet only. The system is experimental and unaudited. Public RPC/indexer behavior varies; observed lifecycle evidence does not establish multi-provider reliability or reorganization safety. Two delegate identities and approved recipients are fixed at creation. Owner key loss can strand funds. Independent recovery, fragmented/multiple-fund handling, unsupported or malformed deposit recovery, cross-device descriptor-free recovery, and adversarial extra-deposit behavior remain incompletely qualified. Agent signing, credential custody, multi-wallet support and mainnet are not delivered.

## Developer entry points

- Policy: [`policy/c/allowance_native_v2.c`](policy/c/allowance_native_v2.c), [`policy/c/profile.h`](policy/c/profile.h).
- Frontend: [`frontend/src/main.tsx`](frontend/src/main.tsx), [`frontend/src/api.ts`](frontend/src/api.ts), [`frontend/src/browserPudge.ts`](frontend/src/browserPudge.ts).
- Shared payment builder: [`frontend/src/pocketPayment.ts`](frontend/src/pocketPayment.ts), re-exported by [`examples/local-chain/pocket_payment.ts`](examples/local-chain/pocket_payment.ts).
- Signing boundary: [`examples/local-chain/pocket_signing.mjs`](examples/local-chain/pocket_signing.mjs).
- Discovery and execution: [`examples/local-chain/pocket_indexed_discovery.mjs`](examples/local-chain/pocket_indexed_discovery.mjs), [`examples/local-chain/pocket_public_tx.mjs`](examples/local-chain/pocket_public_tx.mjs), and the local server/supervisor above.
- Build and regression commands: [`docs/BUILD_AND_TEST.md`](docs/BUILD_AND_TEST.md); security and evidence scope: [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

Existing external prepare, submit and reconciliation endpoints are the smallest initial headless integration candidate. First qualify policy rejection and executor reliability, then define any reusable boundary from actual consumers. No agent integration or speculative SDK is included here.

## Remaining development priorities

1. Headless delegate execution using existing QCN4.
2. Native policy rejection and executor reliability qualification.
3. Independent recovery and fragmented-fund handling.
4. Metatype feasibility investigation.
5. Authentication and multi-wallet feasibility.
6. Reusable integration boundary based on actual consumers.
7. Independent security review before mainnet consideration.
