# Working Pocket browser-to-node evidence

On a fresh isolated CKB 0.210.0 dev node, the local browser app initiated Alice's 100 CKB payment after setup. The browser then showed 900 CKB protected, Alice's remaining allowance of 100 CKB and shared remaining allowance of 150 CKB. After a node and application restart, the journal restored that state. Ben paid 100 CKB through the same interface, after which the shared remaining allowance was 50 CKB. The owner then revoked Alice, closed and recovered 800 CKB, deposited 200 CKB after closure and swept it. The terminal policy retained 134 CKB.

`transactions.json` contains the transaction-bound journal records, signed public transaction bytes and node-confirmed canonical block headers. It contains no private keys, node configuration, database, or executable deployment payload. The run used disposable development keys and synthetic local CKB; it is not public-network or production evidence. The exported records were independently checked against `get_transaction` and canonical block hashes while the node was running.

The browser path exercised confirmed results and a restart. It did not simulate a dropped RPC response or independently deposited fund Cells, and it does not qualify distributed idempotency or reorg resistance. See [launch instructions](../../examples/local-chain/WORKING_POCKET.md).

After the final signer-witness checks were added, a second fresh pocket was tested through the browser: 101 CKB was refused before signing, then Alice's 100 CKB payment committed as `0x3f51ad6f5b980db2a6653991ad07469d39193057ab850726e4ebf3965c8da218`. Its canonical node record is in `fresh-payment.json`. Separately, the first run's already committed sweep journal entry was deliberately marked uncertain, then the Reconcile endpoint identified its original committed hash without creating another transaction. This exercises committed-hash reconciliation, not an actual dropped RPC response.

Run `node examples/local-chain/verify_working_pocket.mjs` for offline transaction-hash, signature and output checks on the six-transaction sequence.
