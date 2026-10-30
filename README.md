# QuotaCell

QuotaCell is an experimental native CKB policy for team spending. It lets delegates pay approved recipients without sharing an unrestricted treasury key or asking the owner to sign every payment.

Each delegate has a separate signing key, a personal spending limit and a per-payment ceiling. They also share one cumulative allowance. Deposits and refunds add funds, but do not reset spending authority.

## Alice and Ben

The treasury holds **200 synthetic tokens**. Alice has a personal limit of 70 and a per-payment ceiling of 60. Ben has a personal limit and ceiling of 50. Each has a fixed approved recipient, and together they may spend **100**.

| Attempt | Historical isolated CKB node result | Shared used | Protected tokens remaining |
| --- | --- | ---: | ---: |
| Alice pays 60 | Committed | 60 | 140 |
| Ben attempts 50 | Submitted; native shared-allowance policy rejects with Q error 20 | 60 | 140 |
| Ben pays 40 | Committed | 100 | 100 |

Alice and Ben signed separately. The owner did not approve each payment. Ben's rejected attempt reached the node; the transaction builder did not merely refuse to send it.

## Why CKB enforces it

The protected token Cells use an existing input-type proxy lock that requires the policy Cell as an input. QuotaCell's native validator Q checks the acting delegate, signed action, approved recipient, shared and individual limits, token conservation and capacity preservation. Every payment consumes and recreates one policy Cell with the updated counters. Standard CKB secp256k1 verifies the delegate's signature.

That means the restrictions also apply to a transaction built outside an application. The same shared Cell also creates contention: concurrent payments can conflict, and reliable retry handling remains future work.

## Inspect the code and evidence

- [Native Q source](policy/c/allowance.c), [fixed experimental profile](policy/c/profile.h), and [ABI](docs/ABI.md).
- [Verifier tests](policy/harness/src/main.rs), [89 fixtures](policy/fixtures), and [historical results](policy/results/summary.json): 33 accepted and 56 rejected as expected. These are alternative fixture branches, not 89 committed chain transactions.
- [CCC transaction example](examples/local-chain/proof.mjs), [Alice60](evidence/local-node/04-alice60.json), [Ben50 rejection](evidence/local-node/05-ben50-rejected.json), [Ben40](evidence/local-node/06-ben40.json), and [final live-state response](evidence/local-node/final-chain-state.json).
- [Evidence and verification notes](docs/EVIDENCE.md), [dependency setup](docs/DEPENDENCIES.md), and [security model and limitations](docs/SECURITY.md).

The node proof was recorded on an isolated dev chain on October 16, 2026. Its hashes have no public explorer records. Later offline checks verify preserved bytes and signatures; they do not create new node or VM results. A source rebuild on the same machine produced the identical Q binary. There is no independent audit or second-machine reproduction claim.

## Owner control milestone

The October 30 [owner-control node proof](evidence/owner-control-2026-10-30/README.md)
committed revocation, rejected a freshly signed latest-state payment at Q17,
closed and recovered 200 synthetic tokens with 154 CKB into an owner-controlled
typed Cell, and swept a late deposit. The final owner balance remained 200;
all 600 CKB of CLOSED policy capacity remain retained (572 CKB occupied minimum).
See [exact reproduction commands](evidence/owner-control-2026-10-30/REPRODUCE.md)
and [accounting/limitations](evidence/owner-control-2026-10-30/SECURITY_AND_RESULTS.md).
This is same-machine isolated-node evidence, not public-testnet or independent
security qualification. The original evidence and contract remain unchanged.

## Run the available checks

With Python 3, from the repository root:

```powershell
python scripts/verify_evidence.py
python policy/demo.py
```

These inspect historical evidence without downloading dependencies or running a node. The demo displays saved results.

To verify transaction serialization, signing preimages and signatures, install the exact CCC dependency lock with Node and npm:

```powershell
Push-Location examples/local-chain
npm.cmd ci --ignore-scripts --no-audit --no-fund
Pop-Location
node scripts/verify_signatures.mjs
```

See [building and testing](docs/BUILD_AND_TEST.md) for Q compilation and the original full verifier/node commands. Full replay requires exact external supporting binaries that are not bundled; their manual setup is documented and has not been automated end to end. This does not prevent inspecting our source and saved evidence.

## Experimental scope

Only the exact synthetic plain xUDT profile is supported. Native CKB payments and real assets are not qualified. Delegates supply CKB capacity for recipient Cells; closing retains the entire 600-CKB policy Cell. Owner revocation, close/recovery and one late sweep now have isolated-node evidence; renewal remains verifier-only. There is no finished UI, independent recovery tool or tested conflict/retry flow. Do not use this experiment to secure real value.

## License

Original QuotaCell material is [Apache-2.0](LICENSE), Copyright 2026 Ticoworld. Upstream code retains its own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
