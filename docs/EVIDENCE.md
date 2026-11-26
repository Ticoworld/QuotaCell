# Evidence and verification scope

## Current native QCN4/QCT4 evidence (November 2026)

- **Repository-recorded canonical evidence:** [WO18 public closeout](../examples/local-chain/WO18_PUBLIC_CLOSEOUT_20261115.md) records nine committed canonical Pudge transactions, with transaction/block identities, capacity accounting and verification scope. [Pudge deployment manifest](../evidence/wo15/pudge-deployment.json) records deployment identities. This audit used one configured RPC endpoint and is not independent security qualification.
- **First-party browser observation/report:** the [November 20 Nervos Talk progress report](https://talk.nervos.org/t/quotacell-let-your-team-spend-without-handing-over-the-treasury/11002/23) describes a separate real-wallet hosted lifecycle, including payments, permission changes and closure. It reports 78 CKB returned funds and 466 CKB released policy capacity. The post is a first-party report, not a repository-preserved canonical audit bundle.
- **Independent community feedback:** feedback in the Nervos Talk discussion is external review and product feedback, not transaction verification or a security audit.
- **Independent security qualification:** none is claimed. No independent security audit or adversarial qualification has been completed.

The November 15 and November 20 runs are separate testnet lifecycles. Historical xUDT evidence below is for a separate profile and must not be conflated with native QCN4/QCT4 evidence. Preserve all historical records as-is.

**October 30 addition:** [owner-control evidence](../evidence/owner-control-2026-10-30/README.md)
contains a separate actual signed local-node revocation, disabled-delegate
rejection, closure/recovery and late sweep. Its [reproduction guide](../evidence/owner-control-2026-10-30/REPRODUCE.md)
includes offline record checks. The original October 16/23 history below stays
unchanged; its verifier-only owner-operation boundary is superseded for those
specific newly executed operations, but not renewal or independent recovery.

The original isolated-node run was recorded October 16, 2026. [local-node/](../evidence/local-node) contains the policy genesis, treasury funding, Alice60, signed Ben50 rejection, Ben40, final live-state response and metadata-only dependency-deployment summary. All are first-party historical records, not independent attestation. Local hashes cannot be checked in a public explorer.

Alice60 committed in block 15; Ben50 submission returned RPC -302 at `Inputs[0].Type`, native Q error 20; Ben40 committed in block 19. Final used 100 consists of Alice60 and Ben40, with 100 tokens protected. The offline checker reconstructs exact transaction serialization, signing preimages and signatures from the five full records.

The Ben50 control deliberately retains valid old successor-state bytes. Q derives payout 50 from actual outputs and rejects shared use 60+50 against limit 100 before exact successor equality. This proves an executed Q20 rejection, not that every later predicate passes.

The raw deployment record is deliberately omitted: its output data and serialization contain upstream F/A executables. The summary retains its hash, size, fees/cycles and recorded inclusion, labels the omission and records the original artifact hash. No executable was smuggled back in as JSON or hex.

[policy/results/summary.json](../policy/results/summary.json) records 89 local verifier outcomes: 33 accepted and 56 rejected; 55 Q-only failures and one multi-group failure. 88 [fixtures](../policy/fixtures) remain byte-identical. One fixture externalizes its inline secp executable plus appended zero byte into `secp-code-mutated`, generated from the external K dependency by the acquisition helper. [The identity and recipe](../evidence/fixture-externalization.json) preserve exactly the same resolved bytes and expected q:12 rejection. Owner renewal/revocation/recovery/close/late sweeps are verifier-only cases. The suite does not prove node conflicts, retries, reorg handling, a UI or production security.

[source-identities.json](../evidence/source-identities.json) records historical source/Q identities. First-party native C and profile are unchanged. Packaging-only changes update support/example file paths, create the build directory on demand, and compare a source-only checkout's Q build against its recorded hash instead of requiring a committed ELF. The current policy manifest records the corresponding packaging source hashes.

On October 23, a separate clean directory on the same physical machine rebuilt Q to the identical 22,240-byte ELF, installed exact CCC packages and checked saved signatures/evidence. This was not a second machine, independent reviewer or full fresh verifier/node run. The reorganized checkout rebuilt Q to the identical historical hash and reran offline evidence/signature checks. An initial compile selected Linux LLD22.1.2 via the host Rust pin; explicitly selecting the existing Linux stable sysroot restored the recorded LLD22.1.8 and byte identity. No full verifier/node replay was run. Missing external setup, no audit and no public deployment are stated limitations of this experimental source release.
