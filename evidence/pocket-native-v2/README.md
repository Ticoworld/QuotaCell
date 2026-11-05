# Native pocket profile without token dependency

Experimental local-node evidence only. Do not use for real assets. The QCN4/QCT4 profile has a new immutable executable hash and fresh policy identity. It reserves the prior 85-byte token field as zero and removes the token executable dependency. It cannot upgrade existing v1, WO12 or WO13 policy identities or their fund locks in place.

The selected run `quotacell-pocket-native-v2-20261105-c` used a fresh isolated CKB 0.210.0 dev node, separate disposable owner and delegate keys, normal transaction validation, and no network access. It funded two proxy Cells with 1000 and 200 CKB. Alice consumed both in one 100 CKB payment, Ben paid 100 CKB, and the owner revoked Alice, closed, recovered the remaining 1000 CKB, and swept a later 200 CKB deposit. The policy contracted from 600 to 134 CKB, releasing 466 CKB. Fees in the recorded lifecycle are 2000 shannons each. The 23,600-byte executable requires 23,661 CKB in the tested code-cell layout, separate from policy and fund capacity.

Selected transaction hashes:

- Alice: `0x6998a963ad0f025c483acbcceaf753a5ccf6701606ef0862fb11318395b26c38`
- Ben: `0xc2ab09d79f30ec67873bdbfe37e827e90e5fe7627eb29cc7c20a410d48b182d8`
- Owner close: `0xffca0924d49e53fc09d1692dfc93ad848343855290a4a2d274a6696c6cac4d53`
- Late sweep: `0x5c3fbb8022040af5368bf95b5dba4ec9f5fddb165a564cfb6c91f4d012fff104`

The run rejected the prior WO13 cases plus a different fund output identity, nonzero reserved state, a fee over the cap, and a duplicate dependency. The duplicate-dependency proposal was rejected by the node as `DuplicateCellDeps` before Q executed. An earlier run wrongly expected Q12; its signed proposal is preserved as `failed-dupdep-expectation.json`. This does not establish all Q/F substitution, malformed-input, dependency, or fee-boundary cases. The proof is not an audit, not a general wallet, and does not qualify reorg recovery or multi-device payment idempotency. Lost owner keys still strand funds. The runner includes only disposable locally generated keys and enforces loopback RPC; private keys, chain databases and deployment payloads are excluded from these records.

```powershell
python -B policy/build_q_native_v2.py
python -B examples/local-chain/pocket_reproduce.py --run-dir "$env:TEMP\quotacell-pocket-fresh"
python -B evidence/pocket-native-v2/verify_records.py
```

Use a fresh run directory; it contains private disposable keys and must not be published. Pudge wallet compatibility and deployment dependencies have not been qualified.
