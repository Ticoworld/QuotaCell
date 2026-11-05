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

This vertical slice tracks the fund Cells created by its own setup and deposit action; it does not discover independently deposited Cells. It cannot recover other late deposits, handle multiple independent devices, connect external wallets, create custom delegates or recipients, or operate on Pudge/mainnet. The owner key is required for recovery. The reusable CCC signing boundary validates a signer's recommended standard secp lock, exact transaction and witnesses, and recovered public key, but the browser wallet connector, external signing transport, and user-owned creation path do not exist yet. Q/F substitution, signer integration and full custody security remain unqualified. The 134 CKB terminal policy Cell remains occupied after closure; the executable deployment also requires capacity. Do not use this experiment to secure real assets.
