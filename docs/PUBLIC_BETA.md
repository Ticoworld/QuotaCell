# QuotaCell Pudge public beta

Open the [production site](https://quotacell.netlify.app/) or the [wallet](https://quotacell.netlify.app/app). The landing page is available in English and Simplified Chinese. Legacy Pocket query links continue to open the wallet.

QuotaCell lets an owner fund a shared Pocket, set a shared spending allowance and individual limits for two independent delegate wallets, and choose approved recipients at creation. Owners can revoke or restore access, close the Pocket, and recover supported funds. Funding does not reset spending authority.

## QCN4 deployment and evidence

The native CKB policy uses QCN4 for active Pockets and QCT4 for closed Pockets on Pudge. The [WO18 public closeout record](../examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) identifies the deployed code dependencies, audit endpoint, canonical transactions and blocks. Its nine recorded transactions cover creation, funding, two delegate payments, two revocations, closure, and receipt and recovery of a 73 CKB late deposit. The audit used one configured Pudge RPC endpoint.

The minimum ordinary payment is 61 CKB. The verified active policy held 600 CKB in policy capacity. Closure released 466 CKB of policy capacity before fees and left 134 CKB occupied in the terminal policy Cell. Separately, the closure returned the Pocket’s 134 CKB supported fund balance to the owner.

The hosted Netlify application uses browser execution (`VITE_QUOTACELL_BROWSER=1`): [`api.ts`](../frontend/src/api.ts) delegates to [`browserPudge.ts`](../frontend/src/browserPudge.ts) for preparation, signature validation, submission and reconciliation. The November 20 real-wallet lifecycle is reported separately in the [Nervos Talk progress update](https://talk.nervos.org/t/quotacell-let-your-team-spend-without-handing-over-the-treasury/11002/23); the [November 15 closeout](../examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) remains the repository's detailed canonical transaction record.

## Limits and testing

This beta is experimental, testnet-only and unaudited. Use test CKB only. The two delegate slots and approved recipients are fixed at creation. Public RPC response times vary. Reorganization handling, multi-fund consolidation, independent recovery and descriptor-free cross-device use remain limited. Owner recovery requires the owner key.

You can inspect public transactions before connecting a compatible wallet configured for Pudge. When reporting issues, include the URL, browser, language, role and visible status. Share public transaction IDs when relevant and keep wallet secrets private.
