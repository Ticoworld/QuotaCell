# Competing Payment and Recovery Evidence

Two runs against fresh isolated CKB v0.210.0 dev nodes are selected here.
Both used the unchanged Q binary and two independently launched builders with
separate generated Alice and Ben credentials. Each signed a 20-token payment
against the same policy and fund outpoints.

`response-lost-commit/` records a dropped Alice RPC response followed by
reconciliation to `committed`, Ben's RBF rejection, and the controlled second
payment to the same recipient after deliberately bypassing the journal.
`response-lost-rejected/` records a dropped Alice response followed by a
reconciled RBF rejection, Ben's committed payment, then exact stale resubmission
of Alice's saved bytes returning CKB `-301` for the consumed policy outpoint.

The intent reservation race admitted one of two independent processes and
refused the other for one invoice ID. Each run used new keys, genesis and
transaction hashes; the exact selected signed transactions and node responses
are retained. The JSON files contain public keys and signatures but no private
keys. The raw deployment transaction (which embeds executable dependency
bytes), node database, generated config, private keys and process logs are
intentionally excluded.

Reproduce both with the steps in [WO11 decision](../../docs/WO11_DECISION.md).
Results are synthetic local-chain evidence only. No public transaction, real
asset, audit, fairness, or reorg-resistance claim is made.
