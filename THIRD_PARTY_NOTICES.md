# Third-party notices

Original QuotaCell code, test utilities, examples, scripts and documentation are licensed under Apache-2.0, Copyright 2026 Ticoworld. LICENSE and NOTICE do not relicense upstream material.

- **ckb-c-stdlib** is vendored at revision `6bf2bca668e0db5f9eb120eb78b31782899ef90d` with its original MIT license and Copyright 2019 Nervos Network notice: [LICENSE](policy/deps/ckb-c-stdlib/LICENSE). Its exact archive/tree is retained for reproducible Q compilation.
- **Input-type proxy lock F and always-success A** originate in [ckb-devrel/ckb-proxy-locks](https://github.com/ckb-devrel/ckb-proxy-locks), pinned to `2db0b21ff13d3cb0ab6d479593b5172dcbfaf239`. No redistribution grant was established for these exact artifacts. Their code and executable payloads are not distributed here. Public availability is not represented as a license grant.
- **xUDT T** originates in [nervosnetwork/ckb-production-scripts](https://github.com/nervosnetwork/ckb-production-scripts), reference revision `26b0b4f15bb6eeb268b70d7ae006e244b7c06649`. The source package declares MIT. No binary is bundled and source-build equivalence is not claimed.
- **CKB system scripts K**, verifier and VM packages have the recorded MIT package declarations. **Rust secp256k1/secp256k1-sys** declare CC0-1.0. Dependencies are referenced through exact manifests/locks, not vendored caches or host executables.
- **CCC core 1.23.0** declares MIT. The exact npm lock is retained; installed packages keep their publisher licenses. No node_modules is included.
- The optional local runner references the official **CKB v0.210.0** distribution, whose upstream COPYING is MIT. The distribution is not included.

[Dependency references](docs/DEPENDENCIES.md) identify exact known hashes and setup. Any later redistribution of omitted upstream binaries must retain applicable permissions/notices. The public source package makes no claim to own those scripts, to have maintainer endorsement, or to grant rights beyond its first-party implementation.
