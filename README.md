# QuotaCell

QuotaCell is an experimental CKB spending policy that lets two delegates draw from one shared cumulative allowance. Each delegate uses an independently controlled key and an approved recipient. The owner can revoke either delegate, close the Pocket, and recover supported protected funds. Deposits do not reset spent authority.

## Verified public Pudge Pocket

The current native QCN4/QCT4 policy runs in CKB transaction validation. The verified WO18 public lifecycle completed nine canonical Pudge transactions: Pocket creation, protected funding, two delegate payments, two revocations, closure, a late deposit, and its recovery. The active policy used **600 CKB** capacity. Closure released **466 CKB** of policy capacity and left **134 CKB** in the terminal policy Cell. That terminal capacity is occupied and locked by the contract; it is not spendable balance. The Pocket had two fixed delegate slots, with no ability to add a third delegate.

The public lifecycle is evidence of contract enforcement, not a production security claim. QuotaCell is experimental and unaudited. Do not use it to secure real value.

See the [WO18 public closeout and transaction evidence](examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) for canonical transaction and block identities, capacity accounting, verification results, limitations, and reproduction commands. The documented reproduction uses the preserved local runtime for audit inputs; that runtime, its SQLite journal, and any local credentials are not part of the public release and must not be shared.

## Build and inspect

- [QCN4 contract source](policy/c/allowance_native_v2.c) and [policy profile](policy/c/profile.h).
- [Pocket genesis builder](examples/local-chain/pocket_genesis.mjs), [payment builder](examples/local-chain/pocket_payment.ts), and [wallet signing boundary](examples/local-chain/pocket_signing.mjs).
- [Working Pocket backend](examples/local-chain/working_pocket_server.mjs) and [WO18 public closeout](examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md).
- [Build and test instructions](docs/BUILD_AND_TEST.md), [dependencies](docs/DEPENDENCIES.md), and [security model](docs/SECURITY.md).
- The historical [xUDT prototype](evidence/local-node) is a separate profile and is not evidence for the native QCN4 public lifecycle.

## Limits

The interface remains developer-grade. Public lifecycle acceptance used one configured Pudge RPC endpoint; it is not an independent multi-provider audit or a security audit. The verified public lifecycle used UTXO Global Wallet. Reorganization handling, multi-fund consolidation, independent recovery, and descriptor-free cross-device Pocket operation remain limited. The owner key is required for owner recovery and its loss can strand funds. The public evidence records nine transactions, not broad production adoption.

QuotaCell is licensed under [Apache-2.0](LICENSE), Copyright 2026 Ticoworld. Upstream components retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Public Pudge beta candidate

The public web application runs on [Netlify](https://quotacell.netlify.app/). The beta candidate serves the product site at / and the wallet at /app. Use a compatible CKB wallet configured for Pudge and test CKB. See the [release note and tester guide](docs/PUBLIC_BETA.md) for network, capacity and audit limitations and the [public lifecycle record](examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) for canonical transaction evidence.
