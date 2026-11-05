# Independent QCN4 genesis test

On Windows, after completing the existing local-chain build and dependency setup in `WORKING_POCKET.md`, run from this directory:

```powershell
node wo14a_genesis_integration.mjs "$env:TEMP\quotacell-wo14a-fresh-unique"
```

The directory must not exist. The script checks the CKB executable hash, starts an isolated dev node, verifies and deploys the pinned code bytes with a separate bootstrap key, and provides a synthetic owner fee cell. A child process generates the disposable owner key and signs the prepared transaction; only its public key and signature leave that process. The parent verifies the unchanged transaction and signature, submits it, confirms canonical inclusion, and reads and checks the live policy output. The node and signer stop when the test exits. The test does not exercise browser wallets, policy discovery, a user-owned application service, or Pudge.
