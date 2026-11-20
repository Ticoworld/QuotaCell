# QuotaCell Pudge public beta

QuotaCell lets the owner of a shared Pocket fund it, allocate spending to two independent delegate wallets, set spending limits, and restrict payments to approved recipients. The owner can revoke and restore access or close the Pocket and recover supported funds.

This release candidate introduces a bilingual product site and separates the wallet into /app. Legacy query links continue to use the wallet router. The historical November 15 public closeout documents committed creation, funding, delegate payments, revocations, closure and recovery of a 73 CKB late deposit. Any later sweep needs separate owner verification.

QCN4 supports two fixed delegates and fixed recipients. Ordinary payments start at 61 CKB. Active policy capacity is 600 CKB. Closure releases 466 CKB and permanently retains 134 CKB. Public Pudge RPC latency varies. This is testnet-only software. It has no independent security audit.

## External tester guide

Open /app with a compatible CKB wallet configured for Pudge. You can inspect the public Pocket and transaction receipts before connecting. To test roles, start with a disposable testnet wallet and compare the controls shown for owner, delegate and unrelated wallet. Report the URL, language, browser, role and visible status. Share public transaction IDs where relevant and keep wallet secrets private.
