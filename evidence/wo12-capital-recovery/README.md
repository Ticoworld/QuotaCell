# WO12 Capital Recovery Evidence

This directory contains selected records from one fresh isolated CKB v0.210.0 dev-node run. The run used generated disposable owner, Alice, Ben and recipient keys; a synthetic xUDT; independent K signatures; a locally rebuilt Qv2; and normal transaction verification. The node bound RPC/P2P to loopback and disabled network activity. The final chain accepted the v2 authorized payment, compact owner closure, late protected deposit and owner late sweep. Rejected transactions returned CKB `-302 TransactionFailedToVerify` at `Inputs[0].Type` with Qv2 validation codes 18, 10, 25, 25, 15 and 11 for over-limit, wrong terminal owner, forged terminal, re-enable, delegate-after-close and deletion respectively.

The four accepted lifecycle transaction hashes are:

| Action | Transaction hash | Fee | Dry-run cycles |
| --- | --- | ---: | ---: |
| Alice 10-token authorized payment | `0xda80f3cee1fcfee6b1950535901e87369044820e3360c4dba1dd5d58afbb020a` | 2,000 shannons | 1,874,169 |
| Owner compact close | `0x2cc29de92a37c02015e7205395731cb811a5f97e87ba14dbe30fe46082b3d6ad` | 2,000 shannons | 1,822,632 |
| New 50-token F cell after closure | `0x8f07ae9dfb423dc72cde44e58ae34913ba99b4a734e686eff4132be211646846` | 2,000 shannons | 1,662,203 |
| Owner sweep of late F cell | `0x8a74dfce8e8c6e4ee00805a758c18046dcb62bc8a0355bc232b1b24444db2720` | 2,000 shannons | 1,732,132 |

The selected close live-cell record shows the terminal policy at exactly 134 CKB and 28 bytes. Its prior policy capacity was 600 CKB; 466 CKB was released to an owner-controlled **untyped** output. Fund and owner xUDT cells retain their required typed capacity. The close fee was paid from a separate owner fee cell. The same 28-byte terminal data and 134 CKB capacity remained live after late deposit and sweep.

Reproduce on Windows with Python 3, Node/npm, WSL Ubuntu with Clang 18 and the pinned Rust linker/sysroot, and the repository's installed `examples/local-chain` npm dependencies:

```powershell
python -B policy/build_q_v2.py
$run = Join-Path $env:TEMP 'quotacell-wo12-replay'
python -B examples/local-chain/wo12_reproduce.py --scenario wo12 --run-dir $run
```

The runner refuses to reuse a run directory. It pins the CKB v0.210.0 release archive and executable hashes, starts a fresh dev node with P2P disabled, uses normal `send_transaction` verification and normal generated blocks, and copies only the selected public transaction records into `examples/local-chain/results/`. The caller's run directory contains private keys and node data and must not be published. This evidence directory excludes them, along with generated config, process logs and the dependency deployment transaction that embeds executable bytes.

Two failures before the selected run are retained in [`failed-experiments.json`](failed-experiments.json). One was a stale harness fee-cell pointer. The other was a real v2 verifier rejection (`-302`, Q error 13) caused by terminal change-output validation trying to derive a lock from a public key intentionally absent from the compact state. The exact signed rejected transaction is retained. The terminal sweep now checks the exact K template and stored args, and the selected retry commits. This was a corrected experimental implementation defect. The selected run is synthetic local-chain evidence only; it does not prove reorg safety, owner-key-loss recovery, interoperability with arbitrary tokens or migration from Qv1.

The selected JSON contains public keys, transaction signatures, RPC replies and locally generated outpoints. It does not contain private keys. `node-profile.json` records the fresh local genesis and resolved dependency identities without executable payloads. `environment.json` records the tested node/runtime versions. See [the decision](../../docs/WO12_CAPITAL_RECOVERY_DECISION.md) and [security/compatibility note](../../docs/WO12_SECURITY_AND_COMPATIBILITY.md) for claims and limits.

After the build and node reproduction, validate the committed package and its exact hashes with:

```powershell
python -B evidence/wo12-capital-recovery/verify_manifest.py
```
