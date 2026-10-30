# Owner revocation and recovery on an isolated CKB node

**Recorded October 30, 2026. Experimental synthetic xUDT only.**

The unchanged Q policy executed owner revocation, rejected a newly signed
disabled-delegate payment at **Q17**, closed and returned **200 tokens with
154 CKB to an owner-controlled typed Cell**, and swept a late 50-token deposit.
The final owner balance remained 200 tokens: the late deposit reused recovered
tokens. **All 600 CKB of the CLOSED policy remain retained**, including its
572-CKB occupied minimum. No untyped/free-capacity withdrawal is claimed.

These are saved actual signed local-node results, not public-testnet
transactions, independent-person reproduction or a security audit. The node
was isolated, its peers empty, and Q/source/profile and the original 89-case
tests and delegated-spending records were preserved unchanged.

## Inspect or reproduce

- [Reproduction instructions](REPRODUCE.md): exact commands and prerequisites.
- [Security and results](SECURITY_AND_RESULTS.md): accounting, controls and limitations.
- [Signed records and node responses](evidence): latest-policy revocation/rejection,
  closure, late deposit/sweep and final live-state queries.
- [Accounting](accounting.json), [recorded environment](environment.json),
  [source identities](source-identities.json), [signature results](signature-check.json).
- [Offline accounting validator](verify_accounting.py),
  [signature/serialization validator](verify_records.mjs),
  [additive runner](reproduce.py) and [owner test actions](owner_actions.mjs).
- [Manifest](manifest.json): selected bytes and SHA-256 values, excluding itself.

The disabled attempt uses the committed revocation's successor outpoint, not
stale state. Its actual RPC response names `Inputs[0].Type` and Q17. The
enabled-delegate paired control passes node dry-run but is not broadcast.
Canonical close/sweep inputs consume the selected funds; the node's literal
`unknown` responses for spent outputs are preserved rather than rewritten.

The raw executable-bearing dependency-deployment record is excluded; only
[deployment metadata](deployment-metadata.json) is included. Dependencies must
be acquired separately with exact hashes. No private keys, node database,
machine logs, private funding documents or conversation archives are included.

Four owner/deposit transactions paid 8,000 shannons (0.00008 synthetic CKB)
from external owner capacity. Recovery output capacity remains typed and
owner-controlled. This test does not deliver a standalone owner CLI, native
CKB payments, production security or reliable conflict/reorg handling.
