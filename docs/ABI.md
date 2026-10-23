# P0 ABI and security boundary â€” checkpoint 1

Experimental ABI implemented and verified locally on October 16, 2026. Only the admitted synthetic-token profile is supported.

Q is immutable `data2`; args exactly32 bytes, the existing Type ID creation identifier. Reuse `ckb-c-stdlib` Type ID helper and Blake2b/Molecule/syscalls; add mandatory one-successor/no-deletion validation. State uses existing A (`data1`), funds existing F (`data1`, args = full Q type hash), auth exact K (`type`) with the F0 executable/data bytes. T is the F0 immutable `data1` xUDT with exact synthetic issuer args `59297894bff4b8f7e1427bf4943b467ba168565d25fe75de207c146debaec14b`. No Q logic replaces cryptography, xUDT or F.

## State: exactly466 bytes

All integers little-endian. Canonical serialized Molecule scripts, exact lengths. No struct packing/alignment is assumed.

| Offset | Field |
| --- | --- |
| 0 | `QCP1` magic4; version u16=1 at4; phase byte6 (0 ACTIVE,1 CLOSED); grant mask byte7 (bits0/1 only). |
| 8 /24 | Shared limit L / used U, u128 each. |
| 40 | Exact T Script85 bytes, immutable. |
| 125 | Owner compressed secp public key33, immutable. |
| 158 /312 | Grant A / B records154 bytes each. |
| Grant +0/+33 | Compressed public key33 / canonical recipient K Script73. |
| Grant +106/+122/+138 | Lifetime limit / lifetime used / per-payment ceiling, u128 each. |

State requires checked `U=uA+uB`, `U<=L`, `ui<=li<=L`, `0<pi<=li`. CLOSED mask=0. Keys have compressed prefix2/3 and derive exact K identities using existing Blake2b; actual K signatures prove those identities. Owner/delegates are distinct; recipients are distinct canonical K locks and not actor identities. Initial keys/recipients/per-payment ceilings stay fixed. Profile token/script identities stay fixed. Issuer lock hash must differ from every admitted input-lock identity, including F/A and owner/delegates. No claim of distinct humans or full ECC point validation by Q.

## Inputs, outputs and witnesses

GENESIS: one untyped/empty owner K input at0; Q output0/A lock with zero used counters, ACTIVE/mask3, unique I computed by existing Type ID; optional owner untyped change. No combined funding. Real owner action/signature required.

Later actions: policy input0, one untyped/empty actor K input1, then0â€“64 exact F/T/16-byte fund inputs. Every since=0; no header deps. No external same-token inputs, other actors, other policy or arbitrary typed inputs. Policy output0 has unchanged capacity/A/Q script. Other outputs:

- SPEND: protected F/T change1 (including zero amount), recipient T payout2, optional actor untyped change3. At least one fund input.
- RENEW/REVOKE: optional owner untyped change1; no funds.
- CLOSE: zeroâ€“64 funds, optional required owner T output1 when funds consumed, then optional owner untyped change. ACTIVE becomes CLOSED/mask0.
- SWEEP: CLOSED, oneâ€“64 funds, same recovery outputs; policy bytes unchanged.

One witness per input; all empty except actor first-group witness (0 at genesis,1 later). Canonical WitnessArgs lock65-byte signature, input_type action, no output_type. Empty policy/fund witnesses and no appended witnesses required. Q reads the actor witness, not W0 on later transitions. K actually verifies signature and digest. A nonempty W0 is rejected even though F0 showed K does not cover it.

Actions: `QCA1` magic4, op byte4 (0 G,1 S,2 N,3 V,4 C,5 W), actor byte5 (0/1 delegates,255 owner), reserved u16 zero at6. G/S/C/W length8. N length57: addL/addlA/addlB u128 at8/24/40, reenable mask byte56. V length9: revoke mask byte8. Unknown/reserved/malformed encodings reject. Amount q is derived from actual payout, never witness-supplied.

## Economics and lifecycle

S: ACTIVE/enabled actual actor, exact recipient, positive q; checked `U'=U+q<=L`, `ud'=ud+q<=ld`, `q<=pd`; other terms/counters unchanged. Exact token equality `Qin=Qchange+q` prohibits burns/mints/hidden value. Selected protected CKB sum is preserved entirely in protected change; policy capacity preserved. Actor externally funds recipient occupied capacity and fee.

N: owner ACTIVE; checked nonnegative increases of root/personal ceilings, no counters reset, optional explicit disabled-grant reenable. At least one increase/reenable; no meaningless/invalid mask. Preserve per-payment ceilings and identities.

V: owner ACTIVE; nonzero subset of enabled grants disabled, all other state exact.

C/W: owner alone; selected tokens and native capacity returned exactly to owner. Fees external. C retains CLOSED successor even with zero selected funds; W can repeatedly sweep late donations. No reopen/delete/implicit migration. All token amounts exact16 bytes with checked u128 sums; capacity sums checked u64; fee <=1,000,000 shannons. Consensus also validates occupied capacity.

Deposit/refund: ordinary independent token transaction creates another F/T cell without consuming Q. Authority unchanged. Every later protected spend still requires current Q. Recovery selects admitted cells; arbitrary hostile/malformed foreign donations are not promised recoverable.

Resolved dependencies: exactly one provider of each admitted executable/data identity A/F/T/K-code/K-data/Q; type-addressed K provider must carry K's exact type hash and expected data hash. Provider outpoints may move with identical bytes. Reject unknown/duplicate expanded providers. Use normal consensus data-hash resolution; do not rewrite it. This strict dependency profile is experimental.

## Attacks reviewed before code

| Attack | Required rejection / boundary |
| --- | --- |
| Omit/substitute P, use dep/output only | Existing F requires the exact input; Q validates actual global input0 and one successor. |
| Fake genesis/copy/reset/delete | Existing Type ID creation hash + exact32 args; Q validates genesis owner/zero counters and prohibits deletion. |
| Unsigned W0 dispatch or weaker actor | Q accepts only signed actor witness and admitted K input; enforces exact actor identity/slot. |
| Another K executable under type hash | Resolve and check K bytes/type identity; standard VM verifies real signature. |
| Netting deposit with payout, hidden outputs, token burn/tails | Reject mixed inputs/unknown outputs; exact equality/data lengths and recipient/change scripts. |
| Excess fund CKB extracted as fee/change | Preserve protected sums and policy capacity; fee cap and external funding. |
| Administrative widening/reset | Only explicit owner N increments ceilings; preserve history/keys/recipients/per-payment ceilings. |
| Revoked/closed use; late donation reopening | Enabled/phase checks; permanent CLOSED state and owner W. |
| Arithmetic/encoding ambiguity | Checked u128/u64; fixed state/action sizes; canonical existing Molecule parsing; bounded cells. |

Common P serializes spends. No chain fairness/priority/finality promise. This experiment does not qualify reorgs, independent builders, production tokens, arbitrary signatures, native CKB asset spending or external security review. A future independent owner CLI cannot bypass a defective Q/T. Genesis/strict shape and lifecycle must succeed in the actual VM before P0 can pass.
