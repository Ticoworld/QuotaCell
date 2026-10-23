# Build and test

Run these commands from the checkout root. Python 3 is sufficient for offline checks; the signature check needs the locked npm dependencies. Windows/PowerShell is the executed path. Existing toolchains may be reused; there is no requirement to install duplicate toolchains or do a large fresh build for source review.

## Offline historical checks

```powershell
python scripts/verify_evidence.py
python policy/demo.py
```

The first command verifies source and fixture identities, historical acceptance/error attribution and saved node counters. The demo prints saved measured outcomes. Neither runs CKB consensus or a new node. If Q has been built locally, its ELF hash is checked too.

```powershell
Push-Location examples/local-chain
npm.cmd ci --ignore-scripts --no-audit --no-fund
Pop-Location
node scripts/verify_signatures.mjs
```

The final command reconstructs five retained transactions, signing preimages, hashes and signatures from saved evidence. It never calls RPC. `npm ci --offline` may be used when the exact packages are cached. `node --check examples/local-chain/proof.mjs` checks example syntax without running its CLI.

## Compile Q from source

Windows needs an existing WSL Ubuntu distribution with `/usr/bin/clang-18` and Linux Rust sysroot containing rust-lld. The script explicitly selects the existing Linux stable Rust sysroot (recorded LLD22.1.8), avoiding the host Rust pin selecting Linux LLD22.1.2, and creates its ignored output directory:

```powershell
python policy/build_q.py
if ($LASTEXITCODE -ne 0) { throw 'Q compilation failed' }
python scripts/verify_evidence.py
```

Expected ELF: 22,240 bytes; SHA-256 `e3774c9b295e71ea4b2990cd61fb445647992e0f21e4f2bc0432d0278241e406`; CKB data hash `0x4c02a05d3ec9723f742dbc1323efef3e094995f9e5ecb043243239d712a4d876`. Build products/metadata/logs stay ignored. Compilation does not execute the 89 verifier tests. A Linux fallback exists but has not been qualified.

## Full verifier replay â€” external setup required

Use a disposable checkout because the original reproduction scripts regenerate fixtures/results. First supply the exact supporting scripts from [DEPENDENCIES.md](DEPENDENCIES.md). This manual setup is not automated end to end here.

```powershell
python policy/build_q.py
python policy/verify_artifacts.py
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'quotacell-verifier-review'
python policy/reproduce.py --offline
```

`--offline` requires the exact Cargo packages cached; omit it for normal package downloads. The harness has 89 expected cases, 33 accepted and 56 rejected, with exact script failure attribution. Q must stay byte-identical. Fixtures represent alternative branches; they are not all commit-compatible with one chain. The harness reuses `test-support/src/main.rs` through its build script; relative paths have been updated for this layout. Contract rules and fixture expectations are unchanged.

## Original isolated-node sequence â€” external setup required

After the same dependency setup and Q build, in `examples/local-chain`:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
python reproduce.py
```

The Windows runner obtains/checks official CKB v0.210.0 or accepts `--ckb` pointing to the exact executable. Archive SHA-256:`a4f7300e5ed1753ab38fc9a9c234a3134589dc18ea66716acdd2b1d0474c7b83`; EXE SHA-256:`77ff953e9dc3a03b36e38a3cab2b9b06f17be8254a15a23afa826c2d4aea98b0`.

It creates a fresh ignored `.local/run-*`, refuses an existing run directory, binds loopback, disables network activity, generates random disposable role keys, and initializes synthetic CKB/token genesis issuance. No public RPC is accepted by the example. `send_transaction` uses `passthrough` to skip an extra output-policy filter, not script verification. Local Dummy-PoW blocks use normal block processing. The runner stops its node and copies its fresh evidence under ignored `examples/local-chain/results/`.

Expect Alice60 committed, signed Ben50 submitted and rejected by Q20, then Ben40 committed; final live state U100/A60/B40 and 100 protected tokens. Fresh hashes, keys and genesis differ. Owner lifecycle is not part of this node runner. Inspect fresh evidence for embedded dependency code, keys and private paths before sharing it: do not publish a raw deployment transaction automatically.

Fresh publication checks do not claim a new full verifier or node replay. [EVIDENCE.md](EVIDENCE.md) records what actually ran.
