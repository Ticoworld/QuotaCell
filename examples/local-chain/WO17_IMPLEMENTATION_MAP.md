# QuotaCell WO17 implementation map

The WO17 React application is a native client for the existing Working Pocket backend. It does not embed `/legacy`; that original HTML client remains available at the server root and through Vite’s `/legacy` proxy.

## Frontend

- `frontend/src/main.tsx` loads live state, derives owner/delegate/unrecognized roles from public keys, and renders state-specific screens. Role labels never authorize transactions.
- `frontend/src/CreationFlow.tsx` connects three distinct wallets, accepts configurable shared/personal/per-payment rules and approved recipients, and presents an editable review before intent preparation.
- `frontend/src/OperationDialog.tsx` handles payment, funding, revocation, close, sweep and transaction review. Reviews use the backend’s fee and built transaction details. The wallet picker temporarily releases the Radix modal focus boundary and returns to the same prepared review.
- `frontend/src/wallet.ts` connects through CCC and admits only the tested UTXO Global, CKB secp256k1, testnet and standard-lock profile. It rechecks identity around signing. The server still performs final signature and prepared-intent verification.
- `frontend/src/api.ts` is the typed fetch boundary for the existing routes. `frontend/src/domain.ts` describes returned state, transaction and annotation data. `frontend/src/amount.ts` handles exact shannons with `BigInt`.
- `frontend/src/metadata.ts` keeps names/descriptions in browser storage, scoped to genesis and Pocket ID, and validates import/export. Metadata is never sent as authorization.
- `frontend/src/i18n.ts` contains English and Simplified Chinese strings; `frontend/src/style.css` supplies the neutral/blue identity, compact layouts and mobile dialog treatment.

## Backend and route flow

Vite proxies `/api/*` to `http://127.0.0.1:4173` by default and supplies the origin expected by the existing server. `QUOTACELL_BACKEND_URL` can override that local target. `/legacy` rewrites to the HTML fallback.

| UI action | Existing backend route | Safety boundary |
| --- | --- | --- |
| Read Pocket and activity | `GET /api/state` | Current backend/indexer state only; no sample balance. |
| Create Pocket | `POST /api/external/genesis` | Backend builds intent; connected owner signs; backend verifies before local submission. |
| Pay | `POST /api/external/prepare` | Backend checks current QCN4 rules, approved recipient, live Cells and exact amount. |
| Fund/revoke/close/sweep | `POST /api/external/owner` | Backend builds the existing native operation. |
| Submit an externally signed transaction | `POST /api/external/submit` | Exact prepared transaction, signer and input intent are checked; uncertain outcomes are journaled, never blindly resent. |
| Observe unresolved transactions | `POST /api/reconcile` | Observation only; it does not resubmit. |
| Resolve/inspect CKB addresses | restricted `POST /api/ckb` | Read-only RPC allowlist. |

`working_pocket_server.mjs`, QCN4 builders, `pocket_signing.mjs`, deployed code and backend policy enforcement were not rewritten for WO17. Pudge read-only mode refuses transaction preparation; no transaction is broadcast by the runbook. The deployed Q code Cell remains `0xd6654da12e92d44a37b9c48a7b27db325fa3e68cc50f3e17ce74a791523c00d0` and is not a funding input.

## Boundaries and qualifications

- Exactly two delegate slots remain part of QCN4. Display names do not change that policy.
- Names are browser-local; users must export them to restore them on another device.
- Supported plain funding Cells can be recovered. Unsupported typed/data-bearing Cells stay visible and are not claimed as recovered.
- The browser lifecycle uses disposable local wallets and an isolated CKB node. It does not qualify real UTXO Global extension accounts or a public Pocket lifecycle.
- See [WO17_UX_RESEARCH.md](WO17_UX_RESEARCH.md), [WO17_WINDOWS.md](WO17_WINDOWS.md) and [WO17_EVIDENCE.md](WO17_EVIDENCE.md) for strategy, launch commands and measured results.
