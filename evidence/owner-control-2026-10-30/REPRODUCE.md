# Reproduce owner revocation and recovery

Use Windows and a **new disposable checkout**. Existing runners generate test
keys, a local chain and new results; do not run them in a preserved evidence
checkout. Prerequisites: Python 3, Node/npm and the WSL Ubuntu Clang 18 / Linux
LLD 22.1.8 setup in [BUILD_AND_TEST.md](../../docs/BUILD_AND_TEST.md). The
recorded runtime is in [environment.json](environment.json). Cargo is needed
for the optional full 89-case verifier replay, not this owner node test.

```powershell
git clone --config core.autocrlf=false https://github.com/Ticoworld/QuotaCell.git QuotaCell-owner-replay
Set-Location QuotaCell-owner-replay
python -B scripts/acquire_replay_dependencies.py --rpc-url https://testnet.ckb.dev/
if ($LASTEXITCODE -ne 0) { throw 'Dependency acquisition failed' }
python -B policy/build_q.py
if ($LASTEXITCODE -ne 0) { throw 'Q build failed' }
Push-Location examples/local-chain
npm.cmd ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Locked npm install failed' }
Pop-Location
python -u -B evidence/owner-control-2026-10-30/reproduce.py --repo .
if ($LASTEXITCODE -ne 0) { throw 'Owner node proof failed' }
```

There is no separate patch to apply: necessary reproduction helpers and
byte-preserving Git attributes are included in this checkout. For a stable
replay later, retain this checkout's commit using `git rev-parse HEAD`.
The recorded execution used baseline
`f34c10b933f19ca347a22189e625cf688e65e543` with the exact additive runner
provided here. Original source/helper hashes are checked before execution.

The dependency helper makes only read-only `get_live_cell` calls for pinned
F/A/T providers and downloads K from its pinned upstream publisher archive.
Length, SHA-256 and CKB data hashes must match the existing manifest; differing
local files are not overwritten. These are ignored local inputs, not bundled
executables or a license grant. See [dependency provenance](../../docs/DEPENDENCIES.md).
Public RPC availability varies; the documented root worked in the recorded
run while its `/rpc` suffix returned 403. Use another chosen node if necessary.

Q must build to SHA-256
`e3774c9b295e71ea4b2990cd61fb445647992e0f21e4f2bc0432d0278241e406`;
do not relax it. Exact Cargo/npm locks are unchanged. Offline npm requires
every locked package cached; ordinary `npm ci` may download missing packages.

The owner runner reuses pinned setup/serialization/signing/commit helpers in
a generated private module and adds only owner test actions. It obtains and
verifies official Windows CKB v0.210.0 or accepts its exact executable using
`--ckb C:/path/to/ckb.exe`. It permits only loopback RPC, disables networking,
uses normal script-verified submission/block processing and stops its node.
`passthrough` skips an additional output-policy filter, not script validation.

The default run is `evidence/owner-control-2026-10-30/.local/run`; subsequent
runs must choose a **new** location with `--run-dir C:/path/to/new-run`.
No existing chain data is deleted. Full raw logs/credentials remain private;
the runner also saves raw evidence under ignored `examples/local-chain/results/`.
Do not publish either directory wholesale: the deployment record embeds code.

## Validate saved public records without a node

After locked npm setup:

```powershell
python -B evidence/owner-control-2026-10-30/verify_accounting.py
node evidence/owner-control-2026-10-30/verify_records.mjs . evidence/owner-control-2026-10-30/evidence
```

These validate the committed package's manifest, actual state/transaction
links, accounting, serialization and signatures. They do not execute a new VM
or node. To check a fresh run, pass its `evidence` directory to both validators
(`verify_accounting.py --evidence C:/path/to/new-run/evidence`).

Expect owner revocation to commit, a newly signed latest-policy payment to
fail specifically at Q17, then owner CLOSE to return200 tokens/154 CKB.
A late deposit of50 previously recovered tokens and CLOSED_SWEEP commit.
Final owner tokens200; policy CLOSED/mask0 and600 CKB retained. Fresh keys,
hashes, blocks and timing differ. The enabled paired control is dry-run only.
See [results](SECURITY_AND_RESULTS.md) for the distinction between typed
recovered capacity, externally supplied capacity and retained policy capital.
