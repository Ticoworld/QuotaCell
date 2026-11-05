# WO13 native CKB isolated-node experiment

Experimental code only. Do not use real assets or deploy this profile for custody.
This evidence is from fresh CKB 0.210.0 dev node `quotacell-wo13-native-20261105-e`, bound to loopback with networking disabled. Actors are disposable generated keys. Transactions use real K signatures and normal node validation. The records contain public signatures, not private keys. Node databases, keys, configurations, logs and the executable deployment transaction are excluded.

The native profile is a separate Q type script and fresh Type ID. It preserves the WO12 28-byte terminal model. It retains the v2 synthetic-token marker and requires the legacy token executable as a dependency even though protected funds are empty, untyped CKB cells. This is an experimental compatibility limitation, not support for that token by the native profile. Existing v1 and v2 fund locks cannot migrate in place.

| Operation | Transaction hash | Fee (shannons) | Dry-run cycles |
| --- | --- | ---: | ---: |
| Genesis | `0x6eb51db3a7a5210c42bd7679e5275c97b0680113b569bc243fe20c174afbddd8` | 2000 | see JSON |
| Fund 1000 CKB | `0xb9fb27b4d697ee1b3fab1c3feee781103887b28366b3ee3f06a93519bf17b6cb` | 2000 | see JSON |
| Alice 100 CKB | `0xa25957a87783712a151120de61fabf66bec768cbb84be1e264922cfeddede1ab` | 2000 | see JSON |
| Ben 100 CKB | `0x217a6294d79fee87326d3bbafbecb833547110a0314754702ca4498f5f9987d2` | 2000 | see JSON |
| Revoke Alice | `0x0f6b490a1db7010180de67a24d770aaf49232301d45f126d724eda7c34550edb` | 2000 | see JSON |
| Close and recover | `0x313724d423b8889243a7428123a9f0f7774ee6919639543a6d7c2150f932af77` | 2000 | see JSON |
| Late deposit | `0xcfed953f8cd74d6796176d53484770153a1e0fb4ae4df9952ac3d3d02222561e` | 2000 | see JSON |
| Late sweep | `0x8fe1fde1bcdf10c6e5f76b7d27da291210acb6d6f2309d38ecafd6e154100780` | 2000 | see JSON |

The 1000 CKB protected output occupied 73 CKB. The policy's 250 CKB shared cap, individual caps, 100 CKB per-payment limits and recipient output minimums also constrain what can be spent; 927 CKB is capacity above the fund's occupied minimum, not the delegated allowance. The two payments left 800 CKB, recovered in full to an owner-locked untyped output. The 600 CKB policy held 572 CKB occupied while active; closure released 466 CKB to an owner output, leaving the permanent 134 CKB terminal cell. A later 200 CKB deposit was swept to the owner. Each recorded lifecycle fee was 2000 shannons, funded by the separate actor input. The 24,272-byte policy code requires a 24,333 CKB code cell in this deployment shape; it can be shared but is additional to treasury capacity.

The node rejected wrong recipient (Q28), diverted protected change (Q13), protected capacity extraction and increased fee (Q23), split outputs (Q13), shared-cap overflow (Q20), revoked delegate (Q17), unauthorized revocation (Q15), and a delegate attempt after closure (Q15). Exact stale signed resubmission returned `-301`. These are selected tests, not an audit. Q preserves a singleton successor so payments contend on policy state. The WO11 journal remains local and experimental; invoice binding, distributed coordination and reorg safety are not proven. Owner key loss strands protected funds and terminal capacity. Identity substitution, malformed states, multiple fund cells, close fee boundaries, alternative signatures and dependencies require further adversarial qualification. No public testnet, mainnet or production custody claim is made.

First run `a` used a split recipient output below its occupied minimum and the node rejected it with `-1108` before Q; `failed-split-low-capacity.json` preserves the signed proposal. Run `c` correctly rejected the post-close delegate at Q15 rather than the harness's expected Q25; `failed-expected-error-code.json` preserves that proposal. The final run corrects the test inputs and expected code.

Reproduce with Windows, WSL Ubuntu/Clang 18 and the pinned local dependencies:

```powershell
python -B policy/build_q_native.py
python -B examples/local-chain/wo13_reproduce.py --run-dir "$env:TEMP\quotacell-wo13-fresh"
python -B evidence/wo13-native-ckb/verify_records.py
```

Use a new run directory each time. The runner generates keys and private node data in that directory; do not publish it. The existing journal is not used by this runner.
