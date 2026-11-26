# Architecture

QuotaCell has two supported execution paths for the native QCN4/QCT4 policy.

## Hosted browser execution

Netlify enables browser mode with `VITE_QUOTACELL_BROWSER=1` in [`frontend/netlify.toml`](../frontend/netlify.toml). [`frontend/src/api.ts`](../frontend/src/api.ts) delegates browser operations to [`frontend/src/browserPudge.ts`](../frontend/src/browserPudge.ts), which handles preparation, signing validation, submission and reconciliation. The compatible wallet signs the reviewed transaction; QuotaCell does not receive the user's private key. Browser execution is the hosted public application path.

## Local engine execution

[`examples/local-chain/working_pocket_server.mjs`](../examples/local-chain/working_pocket_server.mjs) implements transaction workflows. [`examples/local-chain/working_pocket_supervisor.mjs`](../examples/local-chain/working_pocket_supervisor.mjs) provides isolated Pocket contexts and reservation coordination. This mode supports local development and deployments that choose a local engine; it is not a universal requirement for the hosted application.

## Reusable components

- Payment construction: [`frontend/src/pocketPayment.ts`](../frontend/src/pocketPayment.ts) exports `buildPayment`; [`examples/local-chain/pocket_payment.ts`](../examples/local-chain/pocket_payment.ts) re-exports it.
- Signing boundary: [`examples/local-chain/pocket_signing.mjs`](../examples/local-chain/pocket_signing.mjs) accepts a CCC signer and validates the resulting signature without exposing its private key.
- Pocket discovery: [`examples/local-chain/pocket_indexed_discovery.mjs`](../examples/local-chain/pocket_indexed_discovery.mjs).
- Public submission and transaction observation: [`examples/local-chain/pocket_public_tx.mjs`](../examples/local-chain/pocket_public_tx.mjs).
- Policy-state verification and transaction preparation/validation are in the browser and engine paths above; CKB consensus enforces QCN4/QCT4 policy rules.
- External prepare, submit and reconciliation endpoints are the initial headless integration candidate. PG02's [`codex/pg02-playground` qualification](https://github.com/Ticoworld/QuotaCell/tree/codex/pg02-playground) documents a native CCC signer making a 61 CKB payment from 256 CKB protected funds, leaving 195 CKB protected and using 61 of 122 CKB allowance. This is signing qualification, not an autonomous agent. Do not reuse its development-only key receiver as an agent custody design or merge that credential-delivery code.

The smallest credible headless path is to consume those existing endpoints, preserve explicit signer custody, validate policy state and signature before submit, and reconcile uncertain outcomes against the original signed transaction. No agent integration or speculative SDK is part of the current release.

See [`SECURITY.md`](SECURITY.md) for policy limits and [`EVIDENCE.md`](EVIDENCE.md) for evidence scope.
