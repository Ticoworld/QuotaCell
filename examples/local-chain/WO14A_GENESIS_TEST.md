# Independent QCN4 genesis test

On Windows, after completing the existing local-chain build and dependency setup in `WORKING_POCKET.md`, run from this directory:

```powershell
node wo14a_genesis_integration.mjs "$env:TEMP\quotacell-wo14a-fresh-unique"
```

The directory must not exist. The script checks the CKB executable hash, starts an isolated dev node, verifies and deploys the pinned code bytes with a separate bootstrap key, and provides a synthetic owner fee cell. A child process generates the disposable owner key and signs the prepared transaction; only its public key and signature leave that process. The parent verifies the unchanged transaction and signature, submits it, confirms canonical inclusion, and reads and checks the live policy output. The node and signer stop when the test exits. The test does not exercise browser wallets, policy discovery, a user-owned application service, or Pudge.

The same command also starts two fresh discovery-client processes after genesis. Each receives only the local RPC URL, the full QCN4 policy type script, and expected public policy configuration. It scans canonical blocks from genesis up to a fixed bound, resolves matching outpoints as live, validates the complete active state and expected identities/limits, and checks the scan tip for reorganization. The test checks both processes return the same policy and exercises missing, ambiguous, malformed, incorrect-identity and configuration-mismatch cases. This bounded scan assumes a trusted local node, rejects chains beyond its configured bound, and is not a production indexer or a guarantee against a subsequent spend or reorganization.

