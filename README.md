# QuotaCell

QuotaCell is an experimental CKB spending policy for a shared Pocket: an owner sets a shared cumulative allowance and individual limits for two delegates, with approved recipients. This addresses the risk of separate wallets spending beyond a common budget. The CKB contract enforces the policy; deposits do not reset spent authority. The owner retains shared administrative authority while delegates have bounded, individual spending authority.

## Verified public Pudge Pocket

The current native QCN4/QCT4 policy runs in CKB transaction validation. The verified WO18 public lifecycle completed nine canonical Pudge transactions: Pocket creation, protected funding, two delegate payments, two revocations, closure, a late deposit, and its recovery. The active policy used **600 CKB** capacity. Closure released **466 CKB** of policy capacity and left **134 CKB** in the terminal policy Cell. That terminal capacity is occupied and locked by the contract; it is not spendable balance. The Pocket had two fixed delegate slots, with no ability to add a third delegate.

The public lifecycle is evidence of contract enforcement, not a production security claim. QuotaCell is experimental and unaudited. Do not use it to secure real value.

See the [WO18 public closeout and transaction evidence](examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) for canonical transaction and block identities, capacity accounting, verification results, limitations, and reproduction commands. The documented reproduction uses the preserved local runtime for audit inputs; that runtime, its SQLite journal, and any local credentials are not part of the public release and must not be shared.

## Current application

The public Pudge beta supports native QCN4/QCT4 Pocket lookup and role based owner/delegate workflows. The live wallet and static viewer are available at the links below. The tested public lifecycle is documented evidence, not evidence that every hosted action or every wallet configuration is qualified. Agent integration, multiple wallet/network profiles, and mainnet readiness are not delivered capabilities.

## Build and inspect

- [QCN4 contract source](policy/c/allowance_native_v2.c) and [policy profile](policy/c/profile.h).
- [Pocket genesis builder](examples/local-chain/pocket_genesis.mjs), [payment builder](examples/local-chain/pocket_payment.ts), and [wallet signing boundary](examples/local-chain/pocket_signing.mjs).
- [Working Pocket backend](examples/local-chain/working_pocket_server.mjs) and [WO18 public closeout](examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md).
- [Build and test instructions](docs/BUILD_AND_TEST.md), [dependencies](docs/DEPENDENCIES.md), and [security model](docs/SECURITY.md).
- [Architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and [project handoff](PROJECT_HANDOFF.md).
- The historical [xUDT prototype](evidence/local-node) is a separate profile and is not evidence for the native QCN4 public lifecycle.

## Limits

The interface remains developer-grade. Public lifecycle acceptance used one configured Pudge RPC endpoint; it is not an independent multi-provider audit or a security audit. The verified public lifecycle used UTXO Global Wallet. Reorganization handling, multi-fund consolidation, independent recovery, and descriptor-free cross-device Pocket operation remain limited. The owner key is required for owner recovery and its loss can strand funds. The public evidence records nine transactions, not broad production adoption.

QuotaCell is licensed under [Apache-2.0](LICENSE), Copyright 2026 Ticoworld. Upstream components retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Public Pudge beta

Open the [production site](https://quotacell.netlify.app/) or the [wallet](https://quotacell.netlify.app/app). The English and Simplified Chinese site explains the Pocket lifecycle and links to the public evidence. The wallet supports Pocket lookup and role-based flows with a compatible CKB wallet configured for Pudge. See the [release notes](docs/PUBLIC_BETA.md) for deployment details, capabilities and limitations. Use test CKB only. QuotaCell has no independent security audit.
