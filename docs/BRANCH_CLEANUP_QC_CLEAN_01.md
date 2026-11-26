# Branch cleanup review (2026-11-26)

Compared fetched remote branch tips against `origin/main` at `b3f488e47359361ea5d2549c152b8c0b418ebead`. Ancestry means the candidate tip is an ancestor of main; unique commits are `origin/main..candidate`.

| Branch | Tip | Ancestor | Unique commits | Recommendation |
|---|---|---:|---:|---|
| `codex/pudge-pocket-discovery-repair` | `b11ab3da355d07cb87ac1575aca178695f327a83` | yes | 0 | eligible for separate deletion review |
| `codex/pudge-public-beta` | `83a9b0229eaed2bb2ce55c0500144835d9ab7d0a` | yes | 0 | eligible for separate deletion review |
| `codex/wo14b-working-pocket` | `b54f66b97a827200d676a2ec2abe396de5a9a780` | yes | 0 | eligible for separate deletion review |
| `codex/wo15-pudge-qualification` | `f8c2880f7b515f7f5d83239d6a1709cedc1436fe` | yes | 0 | eligible for separate deletion review |
| `codex/wo19a-remote-pocket-discovery` | `e4c865fa339101d5655e34543e1a45453436231c` | yes | 0 | eligible for separate deletion review |
| `codex/wo-read-02` | `fba181ff0e3776c01e77c5d3bd0dbb9dd5ec06e2` | yes | 0 | eligible for separate deletion review |
| `wo11-competing-payments` | `67bb8e3c7b2e292c0b04084050f3f58915cabb1d` | yes | 0 | eligible for separate deletion review |
| `wo12-capital-recovery` | `3365857fb8b995e32dcda9bd5f21b51f8f276410` | yes | 0 | eligible for separate deletion review |
| `codex/pg02-playground` | `99a0bfdce5803d40084ecb8b7db42f8ba9f45926` | no | 2 | preserve; has unique commits |
| `artifacts/quotacell-public-beta-screenshots-20261120` | `306407c8a23676737a6635113eb5225c45db62b1` | no | 7 | preserve; mandatory evidence branch and unique commits |

No remote branch was deleted. The mandatory PG02 and screenshot refs remain preserved. Re-run this comparison before any future deletion because remote tips may move.
