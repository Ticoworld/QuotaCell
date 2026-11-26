# Architecture

QuotaCell combines a native CKB policy with browser and local service components. The QCN4 contract enforces active Pocket spending rules; QCT4 represents a closed Pocket. The static React/Vite application is under `frontend/`. It queries Pudge for public discovery and calls the local Pocket service for transaction workflows.

## Entry points

- UI bootstrap: `frontend/src/main.tsx`; routes and screens are in `frontend/src/`.
- Pocket discovery and transaction state: `frontend/src/publicDiscovery.ts`, `frontend/src/pocketPayment.ts`, `frontend/src/pocketOwner.ts`.
- Backend: `examples/local-chain/working_pocket_server.mjs`; multi-Pocket orchestration: `examples/local-chain/pocket_supervisor.mjs`.
- Construction and signing: `examples/local-chain/pocket_genesis.mjs`, `pocket_payment.ts`, and `pocket_signing.mjs`.
- Policy source and profile: `policy/c/allowance_native_v2.c`, `policy/c/profile.h`.

Builders prepare unsigned transactions. Wallet signing is a separate explicit boundary; the browser or service does not hold owner/delegate private keys. Submission and uncertain-outcome reconciliation are implemented in the local service and require continued operational qualification.

See `docs/SECURITY.md` for the admitted contract behavior and limits, and `docs/EVIDENCE.md` for historical verification scope.
