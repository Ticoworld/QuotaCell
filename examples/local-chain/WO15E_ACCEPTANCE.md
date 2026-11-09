# WO15E Pudge wallet acceptance

This screen runs on loopback at `http://127.0.0.1:4175/` and never broadcasts. Use an existing Chrome profile with the real UTXO Global extension, and use a disposable CKB testnet account. It does not ask for, read or store seed phrases or private keys. Never paste a seed phrase, private key, or signed transaction into an issue or chat.

From the repository root, with the locked npm dependencies installed:

```powershell
node --experimental-strip-types examples/local-chain/wo15e_wallet_acceptance_server.mjs
```

Open `http://127.0.0.1:4175/` manually in that Chrome profile. Keep the server running. Click **Connect UTXO Global wallet**, select **CKB**, and personally approve the wallet connection and select CKB testnet if prompted. Confirm that the displayed `ckt1` address and compressed public key belong to the disposable account. The screen admits only the standard secp256k1-blake160 lock matching the public key.

Choose **Sign-only**, click **Prepare review**, and inspect the exact input outpoint and capacity, destination lock, output, fee, complete transaction and serialized bytes. This is a single-input transaction returning the balance minus the displayed fee to the same lock. A live plain Cell with at least 61 CKB plus the displayed fee is required. The lookup selects one eligible Cell and independently checks its current live status, transaction and canonical blocks. It can tolerate a normally advancing chain; it rejects lag, stale Cells and reorganizations. It does not claim to enumerate the entire wallet. If you choose to proceed, click **Sign reviewed transaction in wallet** and personally approve or reject it in the extension. The server compares all transaction fields and other witnesses, verifies the 65-byte secp256k1 signature and recovers the expected public key. It does not send the transaction to the chain. A locally ignored `.local/wo15e-signature-diagnostics.jsonl` records only the public key, transaction hash, operation, network and verification diagnostics; it does not store the signature or signed transaction. The server cannot independently prove that the provider was a genuine extension; record that observation separately.

A successful sign-only verification in the current server session unlocks **Q code-cell deployment review** for the same public key. It requires the exact 23,600-byte Q binary under `policy/build/allowance-native-v2` and one live, empty owner Cell with at least 23,722 CKB plus the current fee. The builder verifies both recorded hashes and shows the full code data, input, fee, owner lock, code capacity and change. The code Cell uses the owner's standard lock and is therefore **replaceable**, not permanently immutable: consuming it can break any Pocket that depends on its outpoint. The screen can verify a signature for this transaction, but it has no broadcast endpoint and does not authorize or carry out a deployment. Do not assume an empty policy-indexer query proves that no exact code Cell exists publicly.

For account change, wrong-network, refusal and disconnect checks, perform those actions yourself in the extension. The screen must reject a changed or disconnected account and a rejected request. Do not interpret controlled or simulated tests as real-extension acceptance. If a request expires or the account/network changes, prepare and review a new sign-only transaction; no transaction has been sent.

Validation from the repository root:

```powershell
node examples/local-chain/wo15e_acceptance_builder_test.mjs
node examples/local-chain/wo15e_acceptance_server_test.mjs
node --experimental-strip-types examples/local-chain/pocket_signing_test.mjs
```

See [WO15 evidence](../../evidence/wo15/VALIDATION.md) for historical results, dependency verification and public-chain limitations. The current Q binary, public code outpoint, exact current fees and disposable funding must be verified again before a deployment. Public broadcast requires a distinct, explicit user approval and an independently reviewed, qualified submission path; this screen deliberately provides none.
