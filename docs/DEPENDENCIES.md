# External dependencies

The first-party source and saved evidence can be inspected and checked without distributing upstream executables. Full historical replay needs the exact scripts below. Their references and identity hashes are recorded in [test-support/manifest.json](../test-support/manifest.json); they are **not** covered by QuotaCell's Apache-2.0 grant.

| Role / local filename | Upstream and identity | Setup |
| --- | --- | --- |
| F / `proxy` | [ckb-proxy-locks](https://github.com/ckb-devrel/ckb-proxy-locks/tree/2db0b21ff13d3cb0ab6d479593b5172dcbfaf239); SHA-256 `672b6d8bf809cbcf8e2ec440da4d6aae92241b7c298c3c45a33c3f179a032dba` | Exact deployed input-type proxy bytes; no redistribution grant established, not bundled |
| A / `always-success` | Same pinned repository; SHA-256 `f4ba47fa9a540a74efcee48829dc0cf8b5b9dbba6950ea118aa5d47c42e60d30` | Exact deployed always-success bytes; same omission |
| T / `xudt` | [ckb-production-scripts](https://github.com/nervosnetwork/ckb-production-scripts/tree/26b0b4f15bb6eeb268b70d7ae006e244b7c06649); SHA-256 `e9b92e5783f692f6ee99ca20eeda5f3da282e0f4010eb4fbd3db4e3058239349` | Exact deployment bytes; no tested source-to-binary recipe supplied |
| K / `secp-code`, `secp-data`, `secp-dep-group` | [ckb-system-scripts](https://github.com/nervosnetwork/ckb-system-scripts), publisher crate 0.5.4 | The helper below downloads the publisher crate, checks archive/code/data hashes and generates the factual dep-group bytes |
| Q / `policy/build/allowance` | Our unchanged [C source](../policy/c/allowance.c) | Build locally; output is ignored, not committed |

## Publisher package acquisition for K

```powershell
python scripts/acquire_dependencies.py --system-scripts-only
```

Source: `https://static.crates.io/crates/ckb-system-scripts/ckb-system-scripts-0.5.4.crate`; SHA-256 `fa5c59063142de7a68cfad4449c6b3863563856219a2925dfb8c5f019ec2aa47`. The helper writes three exact files plus the existing negative fixture's `secp-code-mutated` (the same code followed by one zero byte) under ignored `test-support/binaries/` and refuses to overwrite different content. This alone is not a complete replay setup.

## Manual F/A/T setup for full replay

The historical experiment obtained exact script data through read-only public deployment inspection. [Proxy deployment documentation](https://docs.nervos.org/docs/ecosystem-scripts/input-type-proxy-lock) lists testnet transaction `0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93`, F at index 1; the same transaction's index 0 supplied A in the recorded provenance. [xUDT deployment documentation](https://docs.nervos.org/docs/ecosystem-scripts/xudt) lists T at `0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f:0`.

To inspect one of these with a chosen CKB testnet RPC, use `get_live_cell` with parameters `[ { "tx_hash": "<transaction above>", "index": "0x0 or 0x1" }, true ]`. If live, its `cell.data.content` is hex-encoded script data. Decode it to the matching filename under `test-support/binaries/`, and compare SHA-256/CKB data hash against the manifest. This is read-only dependency retrieval, not a QuotaCell deployment or test transaction. A dead/missing code Cell is an unavailable dependency; do not substitute different bytes.

Reference upstream permissions before using or redistributing their artifacts. Public-chain access and matching checksums are not license grants. This repository neither redistributes F/A/T nor supplies an unverified automated acquisition route. Upstream source compilation is another possible source, but byte equivalence to these pinned artifacts has not been independently reproduced. There is no verified one-command full setup today; this is a replay limitation, not a barrier to publication of our source/evidence. No maintainer contact is required by these instructions.

After supplying all six external manifest entries, `python policy/verify_artifacts.py` verifies identities, the exact vendored stdlib archive/tree and saved result attribution. Compile Q first as described in [BUILD_AND_TEST.md](BUILD_AND_TEST.md). Never use public fixture keys or disposable test identities to secure real value.

## Build and runtime versions

The recorded environment used Python 3.13.14, Node 22.14.0/npm 11.7.0, Rust/Cargo 1.96.0 (Windows gnullvm), WSL Ubuntu Clang 18.1.3 and rust-lld 22.1.8. Cargo.lock pins CKB 1.0.0 verifier packages and ckb-vm 0.24.14; the CCC lock pins core 1.23.0. The local-node runner pins official CKB v0.210.0 and checks its archive/executable hashes. These are separate verifier/node environments, not a claim of current public-network compatibility.
