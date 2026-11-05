# Working Pocket local development app

Experimental synthetic CKB on a disposable local node only. The development signer reads the generated owner, Alice and Ben keys from the run directory. The server refuses to start without the launcher's explicit development-signer opt-in, and also checks dev consensus, genesis and disabled P2P. Do not point it at real wallets or funds. The app binds to `127.0.0.1`, verifies the script dependencies, and checks the request origin. Other local processes and users are not isolated from this development signer.

Prerequisites: Windows, Node 22, Python 3, the repository's installed CCC dependencies, WSL Ubuntu with Clang 18 and the existing pinned policy build dependencies. The first node setup may download the hash-checked CKB 0.210.0 Windows archive. The run directory contains disposable private keys and chain data; do not publish it.

```powershell
cd examples/local-chain
npm ci
cd ../..
python -B policy/build_q_native_v2.py
python -B examples/local-chain/working_pocket_start.py --run-dir "$env:TEMP\quotacell-pocket-example" --port 4173
```

Open `http://127.0.0.1:4173`. Choose an unused run directory for each new pocket and an unused port. Setup creates and funds a fixed experimental QCN4 pocket with two generated delegates and fixed recipients; the app then submits the requested actions. Stop the launcher to stop the node. Restart the same pocket and its journal with:

```powershell
python -B examples/local-chain/working_pocket_start.py --resume --run-dir "$env:TEMP\quotacell-pocket-example" --port 4173
```

The app persists each signed transaction, genesis, policy identity, actor, operation, recipient and amount before broadcast. Reconcile queries the original hash and, for pending local transactions, generates blocks; it does not rebuild a transaction. A rejected, unknown or reorged outcome remains blocked for investigation. This is one local SQLite journal, not distributed exactly-once payment protection. A newly entered intent after a previous payment commits can pay the same recipient again. Reorg resistance and lost-response behavior have not been exhaustively tested.

This vertical slice tracks the fund Cells created by its own setup and deposit action; it does not discover independently deposited Cells. It cannot recover other late deposits, handle multiple independent devices, create custom delegates or recipients, or operate on Pudge/mainnet. The owner key is required for recovery. The reusable CCC signing boundary validates a signer's recommended standard secp lock, exact transaction and witnesses, and recovered public key, and the experimental browser transport described below now uses it; the user-owned creation path does not exist yet. Q/F substitution, signer integration and full custody security remain unqualified. The 134 CKB terminal policy Cell remains occupied after closure; the executable deployment also requires capacity. Do not use this experiment to secure real assets.

## Browser wallet experiment

The signing selector defaults to **External browser wallet**. Connect opens the CCC web component; the current experiment admits only the UTXO Global CKB adapter on its `nervos_testnet` setting, with a compressed public key, standard secp256k1 lock and `CkbSecp256k1` signing scheme. The application itself still runs against a disconnected dev chain, not public testnet. A wallet's testnet setting does not mean it can resolve or sign this private chain. The displayed role comes from the live policy; an unrecognized account cannot pay. No wallet private key is sent to the application.

For a delegate payment, the server resolves the policy, fund, fee input and pinned dependencies; builds an unsigned transaction; and keeps an independent signing snapshot for five minutes. The browser requests the wallet's explicit signature. The server rechecks the environment and live inputs, verifies the exact transaction and witnesses and the signature against the original preimage, dry-runs it, and journals the signed bytes before sending. Unknown submission outcomes retain the existing reconciliation block. External signing never falls back to the development key. Owner actions remain available only after explicitly selecting the local development signer.

This is a transport experiment using the existing generated Pocket, not a user-owned Pocket creation flow. A real extension has not been tested and the generated local identities do not correspond to independently controlled users. UTXO Global may be unable to sign transactions on the isolated node. Do not import production keys or use real funds; no Pudge support or public-chain authorization is provided. Real acceptance requires provisioning a Pocket with independently controlled identities and a wallet-compatible chain, then selecting the UTXO Global **CKB** account and approving a transaction after its terms are reviewed.

To run the automated browser test on Windows, install `playwright-core` outside the repository and set `PLAYWRIGHT_CORE` to its module directory, then run against a freshly started local Pocket:

```powershell
npm install --prefix "$env:TEMP\quotacell-playwright" playwright-core
$env:PLAYWRIGHT_CORE="$env:TEMP\quotacell-playwright\node_modules\playwright-core"
node wallet_browser_test.mjs "$env:TEMP\quotacell-pocket-example" http://127.0.0.1:4173
```

The test injects a **simulated UTXO Global provider** into Chromium using the disposable run's Alice and Ben keys. The keys remain in the browser test process; this is not evidence of a real extension. It tests rejection, account and network changes, disconnected and incompatible signers, mutation, and a local-node payment. Run it only on a fresh synthetic Pocket: it spends 61 CKB of its synthetic allowance. `CHROME_PATH` can override the default Windows Chrome executable.
