//! Focused P0 transaction fixtures, reusing the F0 verifier/signing utilities.
#![allow(dead_code)]
include!(concat!(env!("OUT_DIR"), "/f0_support.rs"));

fn binary_path(root: &Path, n: &str) -> PathBuf {
    if n == "Q" {
        root.join("build/allowance")
    } else {
        root.join("../test-support/binaries").join(n)
    }
}
fn role(s: &Script) -> String {
    let code = hex::encode(s.code_hash().as_slice());
    match code.as_str() {
        K => "secp",
        X => "proxy",
        A => "always-success",
        T => "xudt",
        TYPE_ID => "type-id",
        _ => "q",
    }
    .into()
}
fn pk(n: u8) -> [u8; 33] {
    PublicKey::from_secret_key(&Secp256k1::new(), &key(n)).serialize()
}
fn put(v: &mut [u8], o: usize, n: u128) {
    v[o..o + 16].copy_from_slice(&n.to_le_bytes());
}
fn num(v: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(v[o..o + 16].try_into().unwrap())
}
fn act(op: u8, slot: u8, extra: &[u8]) -> Vec<u8> {
    let mut v = b"QCA1".to_vec();
    v.extend([op, slot, 0, 0]);
    v.extend(extra);
    v
}
fn actor_w(a: &[u8]) -> packed::Bytes {
    witness(a, Some(&[0u8; 65])).pack()
}
fn state() -> Vec<u8> {
    let mut v = vec![0u8; 466];
    v[..6].copy_from_slice(b"QCP1\x01\x00");
    v[7] = 3;
    put(&mut v, 8, 100);
    let token = script(
        T,
        ScriptHashType::Data1,
        actor(3).calc_script_hash().as_bytes(),
    );
    v[40..125].copy_from_slice(token.as_slice());
    v[125..158].copy_from_slice(&pk(2));
    for (o, k, r, l, p) in [(158, 1, 4, 70, 60), (312, 5, 6, 50, 50)] {
        v[o..o + 33].copy_from_slice(&pk(k));
        v[o + 33..o + 106].copy_from_slice(actor(r).as_slice());
        put(&mut v, o + 106, l);
        put(&mut v, o + 138, p);
    }
    v
}
struct Profile {
    base: Setup,
    q_hash: String,
}
fn profile(root: &Path) -> Profile {
    let mut base = setup(&root.join("../test-support"));
    let q = fs::read(root.join("build/allowance")).unwrap();
    let q_hash = hex::encode(blake2b_256(&q));
    let op = synthetic("local-Q-code-provider");
    base.cells.push(Cell {
        label: "compiled-Q".into(),
        out_point: op.clone().into(),
        output: output(100000 * CKB, base.a.clone(), None).into(),
        data: None,
        binary: Some("Q".into()),
    });
    base.deps.push(
        CellDep::new_builder()
            .out_point(op)
            .dep_type(DepType::Code)
            .build(),
    );
    Profile { base, q_hash }
}
fn result_cell(f: &Fixture, i: usize, label: &str) -> Cell {
    let tx = f.tx();
    Cell::make(
        label,
        OutPoint::new_builder()
            .tx_hash(tx.hash())
            .index(i as u32)
            .build(),
        tx.outputs().get(i).unwrap(),
        tx.outputs_data().get(i).unwrap().raw_data(),
    )
}
#[derive(Clone)]
struct World {
    policy: Cell,
    funds: Vec<Cell>,
    auth: HashMap<u8, Cell>,
}
fn world_state(w: &World) -> Vec<u8> {
    bytes(w.policy.data.as_ref().unwrap()).to_vec()
}
fn world_policy(w: &World) -> Script {
    w.policy.out().type_().to_opt().unwrap()
}
fn q_genesis(p: &Profile) -> (Fixture, World) {
    let own = Cell::make(
        "synthetic-owner",
        synthetic("P0-owner-genesis-input"),
        output(2000 * CKB, actor(2), None),
        Bytes::new(),
    );
    let first = input(own.op());
    let mut seed = first.as_slice().to_vec();
    seed.extend(0u64.to_le_bytes());
    let policy = script(
        &p.q_hash,
        ScriptHashType::Data2,
        Bytes::copy_from_slice(&blake2b_256(seed)),
    );
    let tx = TransactionBuilder::default()
        .set_cell_deps(p.base.deps.clone())
        .input(first)
        .outputs([
            output(600 * CKB, p.base.a.clone(), Some(policy)),
            output(1400 * CKB - FEE, actor(2), None),
        ])
        .outputs_data([Bytes::from(state()).pack(), Bytes::new().pack()])
        .witness(actor_w(&act(0, 255, &[])))
        .build();
    let mut cells = p.base.cells.clone();
    cells.push(own);
    let mut f = fixture(
        "00-genesis",
        "Real owner authorizes exact Q policy",
        tx,
        cells,
    );
    sign(&mut f, 0, 2);
    let mut auth = HashMap::new();
    auth.insert(2, result_cell(&f, 1, "owner-auth-change"));
    for n in [1, 5] {
        auth.insert(
            n,
            Cell::make(
                "synthetic-delegate-fees",
                synthetic(&format!("P0-delegate-{n}-fee-cell")),
                output(1000 * CKB, actor(n), None),
                Bytes::new(),
            ),
        );
    }
    let w = World {
        policy: result_cell(&f, 0, "canonical-Q-policy"),
        funds: Vec::new(),
        auth,
    };
    (f, w)
}
fn deposit(p: &Profile, w: &World, id: &str, q: u128) -> (Fixture, World) {
    let lock = f_for(&world_policy(w));
    let source = Cell::make(
        "synthetic-external-token-source",
        synthetic(&format!("{id}-source")),
        output(500 * CKB, actor(7), Some(p.base.t.clone())),
        amount(q),
    );
    let tx = TransactionBuilder::default()
        .set_cell_deps(p.base.deps.clone())
        .input(input(source.op()))
        .outputs([
            output(154 * CKB, lock, Some(p.base.t.clone())),
            output(346 * CKB - FEE, actor(7), None),
        ])
        .outputs_data([amount(q).pack(), Bytes::new().pack()])
        .witness(
            WitnessArgs::new_builder()
                .lock(Some(Bytes::from(vec![0u8; 65])).pack())
                .build()
                .as_bytes()
                .pack(),
        )
        .build();
    let mut cells = p.base.cells.clone();
    cells.push(source);
    let mut f = fixture(
        id,
        "External token deposit; Q not consumed and authority unchanged",
        tx,
        cells,
    );
    sign(&mut f, 0, 7);
    let mut next = w.clone();
    next.funds
        .push(result_cell(&f, 0, "external-protected-deposit"));
    (f, next)
}
fn refund(p: &Profile, w: &World, payment: &Fixture) -> (Fixture, World) {
    let receipt = result_cell(payment, 2, "actual-supplier-A-receipt");
    let fees = Cell::make(
        "synthetic-supplier-fees",
        synthetic("supplier-A-refund-fees"),
        output(1000 * CKB, actor(4), None),
        Bytes::new(),
    );
    let tx = TransactionBuilder::default()
        .set_cell_deps(p.base.deps.clone())
        .inputs([input(receipt.op()), input(fees.op())])
        .outputs([
            output(154 * CKB, f_for(&world_policy(w)), Some(p.base.t.clone())),
            output(142 * CKB, actor(4), Some(p.base.t.clone())),
            output(846 * CKB - FEE, actor(4), None),
        ])
        .outputs_data([amount(50).pack(), amount(10).pack(), Bytes::new().pack()])
        .witnesses([
            WitnessArgs::new_builder()
                .lock(Some(Bytes::from(vec![0u8; 65])).pack())
                .build()
                .as_bytes()
                .pack(),
            Bytes::new().pack(),
        ])
        .build();
    let mut cells = p.base.cells.clone();
    cells.extend([receipt, fees]);
    let mut f = fixture(
        "04-refund50-exhausted",
        "Supplier A returns50 from its actual60-token receipt; Q untouched",
        tx,
        cells,
    );
    sign(&mut f, 0, 4);
    let mut next = w.clone();
    next.funds.push(result_cell(&f, 0, "supplier-refund"));
    (f, next)
}
fn transition(
    p: &Profile,
    w: &World,
    id: &str,
    op: u8,
    who: u8,
    slot: u8,
    q: u128,
    extra: &[u8],
) -> (Fixture, World) {
    let old = world_state(w);
    let mut next_state = old.clone();
    let mut funds = w.funds.clone();
    if op == 2 || op == 3 {
        funds.clear();
    }
    let ac = w.auth.get(&who).cloned().unwrap_or_else(|| {
        Cell::make(
            "synthetic-other-actor",
            synthetic(&format!("other-{id}")),
            output(1000 * CKB, actor(who), None),
            Bytes::new(),
        )
    });
    let mut cells = p.base.cells.clone();
    cells.push(w.policy.clone());
    cells.push(ac.clone());
    cells.extend(funds.clone());
    let mut ins = vec![input(w.policy.op()), input(ac.op())];
    ins.extend(funds.iter().map(|c| input(c.op())));
    let token_total: u128 = funds
        .iter()
        .map(|c| num(&bytes(c.data.as_ref().unwrap()), 0))
        .sum();
    let protected: u64 = funds
        .iter()
        .map(|c| {
            let n: u64 = c.out().capacity().unpack();
            n
        })
        .sum();
    let mut os = vec![output(600 * CKB, p.base.a.clone(), Some(world_policy(w)))];
    let mut ds = vec![Bytes::new().pack()];
    let mut change: u64 = ac.out().capacity().unpack();
    match op {
        1 => {
            let o = 158 + 154 * (slot as usize);
            put(&mut next_state, 24, num(&old, 24).wrapping_add(q));
            put(&mut next_state, o + 122, num(&old, o + 122).wrapping_add(q));
            os.push(output(
                protected,
                f_for(&world_policy(w)),
                Some(p.base.t.clone()),
            ));
            ds.push(amount(token_total - q).pack());
            let recipient: Script = Script::from_slice(&old[o + 33..o + 106]).unwrap();
            os.push(output(142 * CKB, recipient, Some(p.base.t.clone())));
            ds.push(amount(q).pack());
            change -= 142 * CKB;
        }
        2 => {
            for (dst, src) in [(8, 0), (264, 16), (418, 32)] {
                put(
                    &mut next_state,
                    dst,
                    num(&old, dst).wrapping_add(num(extra, src)),
                );
            }
            next_state[7] |= extra[48];
        }
        3 => {
            next_state[7] &= !extra[0];
        }
        4 | 5 => {
            if op == 4 {
                next_state[6] = 1;
                next_state[7] = 0;
            }
            if !funds.is_empty() {
                os.push(output(protected, actor(who), Some(p.base.t.clone())));
                ds.push(amount(token_total).pack());
            }
        }
        _ => panic!("Unsupported fixture operation"),
    }
    os.push(output(change - FEE, actor(who), None));
    ds.push(Bytes::new().pack());
    ds[0] = Bytes::from(next_state).pack();
    let mut ws = vec![Bytes::new().pack(), actor_w(&act(op, slot, extra))];
    ws.extend(funds.iter().map(|_| Bytes::new().pack()));
    let tx = TransactionBuilder::default()
        .set_cell_deps(p.base.deps.clone())
        .set_inputs(ins)
        .set_outputs(os)
        .set_outputs_data(ds)
        .set_witnesses(ws)
        .build();
    let mut f = fixture(id, "Real Q transition", tx, cells);
    sign(&mut f, 1, who);
    let mut n = w.clone();
    n.policy = result_cell(&f, 0, "canonical-Q-successor");
    n.auth.insert(
        who,
        result_cell(&f, f.tx().outputs().len() - 1, "actor-auth-change"),
    );
    if op == 1 {
        n.funds = vec![result_cell(&f, 1, "protected-change")];
    } else if op == 4 || op == 5 {
        n.funds.clear();
    }
    (f, n)
}
fn patch_state(f: &mut Fixture, change: impl FnOnce(&mut Vec<u8>)) {
    let mut v = f.tx().outputs_data().get(0).unwrap().raw_data().to_vec();
    change(&mut v);
    replace_output_data(f, 0, Bytes::from(v));
}
fn bad(mut f: Fixture, id: &str, why: &str, code: u8, who: u8) -> Fixture {
    let ai = if f.tx().inputs().len() == 1 { 0 } else { 1 };
    sign(&mut f, ai, who);
    f.rename(id, why, false, Some(&format!("q:{code}")));
    f
}
fn hold_counters(f: &mut Fixture, w: &World) {
    replace_output_data(f, 0, Bytes::from(world_state(w)));
}
fn renewal_extra(l: u128, a: u128, b: u128, mask: u8) -> Vec<u8> {
    let mut v = Vec::new();
    for x in [l, a, b] {
        v.extend(x.to_le_bytes());
    }
    v.push(mask);
    v
}
fn generate(root: &Path, stage: u8) {
    let p = profile(root);
    let (g, unfunded) = q_genesis(&p);
    let (d, fresh) = deposit(&p, &unfunded, "01-fund200", 200);
    let (a, after_a) = transition(&p, &fresh, "02-alice60", 1, 1, 0, 60, &[]);
    let (b, exhausted) = transition(&p, &after_a, "03-ben40-shared100", 1, 5, 1, 40, &[]);
    let (bf, bfirst) = transition(&p, &fresh, "10-ben50-first", 1, 5, 1, 50, &[]);
    let (af, _) = transition(&p, &bfirst, "11-alice50-after-ben", 1, 1, 0, 50, &[]);
    let (dep_a, added_a) = deposit(&p, &after_a, "12-deposit50-after-alice", 50);
    let (ben_after_dep, _) = transition(&p, &added_a, "13-ben40-after-deposit", 1, 5, 1, 40, &[]);
    let mut all = vec![g.clone(), d, a.clone(), b, bf, af, dep_a, ben_after_dep];
    let (alice10, _) = transition(&p, &after_a, "14-alice10-after60", 1, 1, 0, 10, &[]);
    all.push(alice10);
    let (f, _) = transition(&p, &fresh, "unused", 1, 1, 0, 61, &[]);
    all.push(bad(
        f,
        "50-alice61-per-payment",
        "Correct signature; personal/root fields otherwise valid; q61 exceeds per-payment60",
        18,
        1,
    ));
    let (mut f, _) = transition(&p, &after_a, "unused", 1, 1, 0, 11, &[]);
    hold_counters(&mut f, &after_a);
    all.push(bad(
        f,
        "51-alice11-personal",
        "Keep successor state valid; actual q11 after60 exceeds personal70",
        19,
        1,
    ));
    let (mut f, _) = transition(&p, &after_a, "unused", 1, 5, 1, 41, &[]);
    hold_counters(&mut f, &after_a);
    all.push(bad(
        f,
        "52-ben41-shared",
        "Correct Ben signature and valid successor encoding; actual root charge exceeds100",
        20,
        5,
    ));
    let (mut f, _) = transition(&p, &exhausted, "unused", 1, 5, 1, 1, &[]);
    hold_counters(&mut f, &exhausted);
    all.push(bad(
        f,
        "53-exhausted-positive-balance",
        "Treasury100 remains, but common gross authority exhausted",
        20,
        5,
    ));
    let (mut f, _) = transition(&p, &added_a, "unused", 1, 5, 1, 41, &[]);
    hold_counters(&mut f, &added_a);
    all.push(bad(
        f,
        "54-deposit-does-not-renew",
        "Balance190 after deposit; root remaining40 still rejects41",
        20,
        5,
    ));
    let (f, _) = transition(&p, &fresh, "unused", 1, 7, 0, 60, &[]);
    all.push(bad(
        f,
        "55-charlie-actor",
        "Actual native signature from Charlie does not authenticate Alice grant",
        15,
        7,
    ));
    let (f, _) = transition(&p, &fresh, "unused", 1, 5, 0, 60, &[]);
    all.push(bad(
        f,
        "56-ben-invokes-alice",
        "Real Ben input/signature with declared Alice grant rejects before economic checks",
        15,
        5,
    ));
    let mut f = a.clone();
    replace_output(
        &mut f,
        2,
        output(142 * CKB, actor(7), Some(p.base.t.clone())),
    );
    all.push(bad(
        f,
        "57-wrong-recipient",
        "Correct Alice signature cannot change approved destination",
        28,
        1,
    ));
    let mut f = a.clone();
    hold_counters(&mut f, &fresh);
    all.push(bad(
        f,
        "58-unchanged-counters",
        "Same actual payout60 and valid state fields; unchanged used counters reject",
        21,
        1,
    ));
    let (mut f, _) = transition(&p, &after_a, "unused", 1, 1, 0, 1, &[]);
    patch_state(&mut f, |v| {
        put(v, 24, 59);
        put(v, 280, 59);
    });
    all.push(bad(
        f,
        "59-lowered-counters",
        "Individually valid lower counters cannot replace the required successor",
        21,
        1,
    ));
    let mut f = a.clone();
    patch_state(&mut f, |v| {
        put(v, 8, 120);
        put(v, 264, 100);
        put(v, 296, 100);
    });
    all.push(bad(
        f,
        "60-widened-terms",
        "Delegate signature cannot widen root/personal/per-payment restrictions",
        21,
        1,
    ));
    let mut f = a.clone();
    replace_output_data(&mut f, 1, amount(139));
    all.push(bad(
        f,
        "61-token-burn",
        "Existing xUDT accepts burn; Q must reject 200 versus199 outputs",
        22,
        1,
    ));
    let mut f = a.clone();
    replace_output_data(&mut f, 1, amount(135));
    let o = f.tx().outputs().get(3).unwrap();
    replace_output(
        &mut f,
        3,
        o.as_builder().type_(Some(p.base.t.clone()).pack()).build(),
    );
    replace_output_data(&mut f, 3, amount(5));
    all.push(bad(
        f,
        "62-uncharged-token-escape",
        "Conserving token transfer into typed actor change violates Q's accounted-token equality",
        22,
        1,
    ));
    let mut f = a.clone();
    let mut v = amount(60).to_vec();
    v.push(0);
    replace_output_data(&mut f, 2, Bytes::from(v));
    replace_output(
        &mut f,
        2,
        output(143 * CKB, actor(4), Some(p.base.t.clone())),
    );
    replace_output(&mut f, 3, output(857 * CKB - FEE, actor(1), None));
    all.push(bad(
        f,
        "63-token-data-tail",
        "Existing token accepts17 bytes; Q admits exact16 only",
        22,
        1,
    ));
    let mut f = a.clone();
    let fund_op = f.tx().inputs().get(2).unwrap().previous_output();
    let new_op = synthetic("P0-overfunded-native-fund");
    let c = f.cells.iter_mut().find(|c| c.op() == fund_op).unwrap();
    c.out_point = new_op.clone().into();
    c.output = output(
        300 * CKB,
        f_for(&world_policy(&fresh)),
        Some(p.base.t.clone()),
    )
    .into();
    let tx = f.tx();
    let mut ins: Vec<CellInput> = tx.inputs().into_iter().collect();
    ins[2] = input(new_op);
    f.set_tx(tx.as_advanced_builder().set_inputs(ins).build());
    replace_output(&mut f, 3, output(1004 * CKB - FEE, actor(1), None));
    all.push(bad(
        f,
        "64-protected-capacity-extraction",
        "300 protected CKB cannot become154 change plus146 to actor",
        23,
        1,
    ));
    let mut f = a.clone();
    replace_output(
        &mut f,
        0,
        output(599 * CKB, p.base.a.clone(), Some(world_policy(&fresh))),
    );
    replace_output(&mut f, 3, output(859 * CKB - FEE, actor(1), None));
    all.push(bad(
        f,
        "65-policy-capacity-extraction",
        "Delegate cannot take1 CKB from permanent policy capacity",
        23,
        1,
    ));
    let mut f = a.clone();
    let tx = f.tx();
    f.set_tx(
        tx.as_advanced_builder()
            .set_outputs(tx.outputs().into_iter().skip(1).collect())
            .set_outputs_data(tx.outputs_data().into_iter().skip(1).collect())
            .build(),
    );
    replace_output(&mut f, 2, output(1458 * CKB - FEE, actor(1), None));
    all.push(bad(
        f,
        "66-policy-deletion",
        "Actual Q input cannot be deleted, even though Type ID stand-in allowed it",
        11,
        1,
    ));
    let mut f = a.clone();
    let tx = f.tx();
    let mut os: Vec<CellOutput> = tx.outputs().into_iter().collect();
    let mut ds: Vec<packed::Bytes> = tx.outputs_data().into_iter().collect();
    os.push(os[0].clone());
    ds.push(ds[0].clone());
    f.set_tx(
        tx.as_advanced_builder()
            .set_outputs(os)
            .set_outputs_data(ds)
            .build(),
    );
    replace_output(&mut f, 3, output(258 * CKB - FEE, actor(1), None));
    all.push(bad(
        f,
        "67-duplicate-policy",
        "Two Q successors reject at Q group-cardinality check",
        13,
        1,
    ));
    let mut f = a.clone();
    replace_output(
        &mut f,
        0,
        output(600 * CKB, actor(1), Some(world_policy(&fresh))),
    );
    all.push(bad(
        f,
        "68-policy-lock-replacement",
        "A policy successor cannot move to a delegate-controlled state lock",
        11,
        1,
    ));
    let mut f = a.clone();
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws[0] = witness(&act(4, 255, &[]), None).pack();
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    all.push(bad(
        f,
        "69-unsigned-policy-witness",
        "Actor digest excludes W0; Q independently rejects nonempty W0",
        14,
        1,
    ));
    let mut f = a.clone();
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws[0] = witness(&act(1, 0, &[]), None).pack();
    ws[1] = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build()
        .as_bytes()
        .pack();
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    all.push(bad(
        f,
        "70-action-only-in-policy-witness",
        "Real actor signs without action; action in unsigned W0 cannot authorize Q",
        14,
        1,
    ));
    let mut f = g.clone();
    let oldp = f.tx().outputs().get(0).unwrap().type_().to_opt().unwrap();
    let mut args = oldp.args().raw_data().to_vec();
    args[0] ^= 1;
    replace_output(
        &mut f,
        0,
        output(
            600 * CKB,
            p.base.a.clone(),
            Some(oldp.as_builder().args(Bytes::from(args).pack()).build()),
        ),
    );
    all.push(bad(
        f,
        "71-fake-genesis-lineage",
        "Valid owner signature cannot create arbitrary chosen policy ID",
        11,
        2,
    ));
    let mut f = g.clone();
    patch_state(&mut f, |v| {
        put(v, 24, 1);
        put(v, 280, 1);
    });
    all.push(bad(
        f,
        "72-genesis-used-not-zero",
        "Valid state invariant but nonzero genesis usage is not admitted",
        26,
        2,
    ));
    let mut f = g.clone();
    let owner_op = f.tx().inputs().get(0).unwrap().previous_output();
    let c = f.cells.iter_mut().find(|c| c.op() == owner_op).unwrap();
    c.output = output(2000 * CKB, actor(1), None).into();
    all.push(bad(
        f,
        "73-genesis-wrong-owner",
        "Real Alice signature does not authorize the stated owner2 genesis",
        15,
        1,
    ));
    let mut f = a.clone();
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws.push(Bytes::from(vec![1, 2, 3]).pack());
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    all.push(bad(
        f,
        "74-extra-witness",
        "Correctly signed appended witness still violates Q's exact witness profile",
        14,
        1,
    ));
    let mut f = a.clone();
    let wrong = script(T, ScriptHashType::Data1, Bytes::from(vec![9u8; 32]));
    let old_op = f.tx().inputs().get(2).unwrap().previous_output();
    let op = synthetic("foreign-token-donation");
    let c = f.cells.iter_mut().find(|c| c.op() == old_op).unwrap();
    c.out_point = op.clone().into();
    c.output = output(154 * CKB, f_for(&world_policy(&fresh)), Some(wrong.clone())).into();
    let tx = f.tx();
    let mut ins: Vec<CellInput> = tx.inputs().into_iter().collect();
    ins[2] = input(op);
    f.set_tx(tx.as_advanced_builder().set_inputs(ins).build());
    for i in [1, 2] {
        let o = f.tx().outputs().get(i).unwrap();
        replace_output(
            &mut f,
            i,
            o.as_builder().type_(Some(wrong.clone()).pack()).build(),
        );
    }
    all.push(bad(
        f,
        "75-wrong-asset-instance",
        "Different conserving xUDT args at protected lock cannot use admitted policy",
        22,
        1,
    ));
    let mut f = a.clone();
    let extra = Cell::make(
        "external-same-token-input",
        synthetic("mixed-external-token"),
        output(154 * CKB, p.base.a.clone(), Some(p.base.t.clone())),
        amount(40),
    );
    let tx = f.tx();
    let mut ins: Vec<CellInput> = tx.inputs().into_iter().collect();
    ins.push(input(extra.op()));
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws.push(Bytes::new().pack());
    f.cells.push(extra);
    f.set_tx(
        tx.as_advanced_builder()
            .set_inputs(ins)
            .set_witnesses(ws)
            .build(),
    );
    replace_output_data(&mut f, 1, amount(160));
    replace_output_data(&mut f, 2, amount(80));
    replace_output(&mut f, 3, output(1012 * CKB - FEE, actor(1), None));
    all.push(bad(
        f,
        "76-mixed-external-token-netting",
        "Conserving payout80 plus external40 cannot masquerade as charged40",
        13,
        1,
    ));
    if stage >= 4 {
        let (dep_ex, after_dep_ex) = refund(&p, &exhausted, &a);
        all.push(dep_ex);
        let (mut f, _) = transition(&p, &after_dep_ex, "unused", 1, 5, 1, 1, &[]);
        hold_counters(&mut f, &after_dep_ex);
        all.push(bad(
            f,
            "77-refund-exhausted-still-rejects",
            "Returned funds150 do not restore exhausted authority",
            20,
            5,
        ));
        let (close, closed) = transition(
            &p,
            &after_dep_ex,
            "05-owner-close-recover150",
            4,
            2,
            255,
            0,
            &[],
        );
        all.push(close.clone());
        let (late, late_world) = deposit(&p, &closed, "06-late-donation50", 50);
        all.push(late);
        let (sweep, _) = transition(
            &p,
            &late_world,
            "07-owner-closed-sweep50",
            5,
            2,
            255,
            0,
            &[],
        );
        all.push(sweep);
        let (renew, renewed) = transition(
            &p,
            &after_a,
            "20-owner-renew",
            2,
            2,
            255,
            0,
            &renewal_extra(20, 30, 0, 0),
        );
        all.push(renew.clone());
        let (paid, _) = transition(&p, &renewed, "21-alice40-after-renew", 1, 1, 0, 40, &[]);
        all.push(paid);
        let (revoked, revoked_w) =
            transition(&p, &after_a, "22-owner-revoke-alice", 3, 2, 255, 0, &[1]);
        all.push(revoked);
        let (ben, _) = transition(
            &p,
            &revoked_w,
            "23-ben40-after-alice-revoked",
            1,
            5,
            1,
            40,
            &[],
        );
        all.push(ben);
        let (reenable, reenabled) = transition(
            &p,
            &revoked_w,
            "24-owner-reauthorize-alice",
            2,
            2,
            255,
            0,
            &renewal_extra(0, 0, 0, 1),
        );
        all.push(reenable);
        let (paid, _) = transition(
            &p,
            &reenabled,
            "25-alice10-after-reauthorize",
            1,
            1,
            0,
            10,
            &[],
        );
        all.push(paid);
        let (empty_close, _) =
            transition(&p, &unfunded, "26-owner-close-unfunded", 4, 2, 255, 0, &[]);
        all.push(empty_close);
        let (mut f, _) = transition(&p, &revoked_w, "unused", 1, 1, 0, 1, &[]);
        hold_counters(&mut f, &revoked_w);
        all.push(bad(
            f,
            "80-revoked-alice",
            "Correct Alice signature after owner revocation cannot spend",
            17,
            1,
        ));
        let (f, _) = transition(
            &p,
            &after_a,
            "unused",
            2,
            1,
            255,
            0,
            &renewal_extra(20, 30, 0, 0),
        );
        all.push(bad(
            f,
            "81-delegate-renew",
            "Alice cannot authenticate owner renewal",
            15,
            1,
        ));
        let (f, _) = transition(&p, &after_a, "unused", 3, 1, 255, 0, &[1]);
        all.push(bad(
            f,
            "82-delegate-revoke",
            "Alice cannot authenticate owner revocation",
            15,
            1,
        ));
        let (f, _) = transition(&p, &after_a, "unused", 4, 5, 255, 0, &[]);
        all.push(bad(
            f,
            "83-delegate-recover",
            "Ben cannot authenticate owner close/recovery",
            15,
            5,
        ));
        let mut f = renew.clone();
        patch_state(&mut f, |v| {
            put(v, 24, 0);
            put(v, 280, 0);
        });
        all.push(bad(
            f,
            "84-renew-cannot-reset-history",
            "Owner-authorized ceiling increase still cannot erase gross usage",
            21,
            2,
        ));
        let (f, _) = transition(
            &p,
            &closed,
            "unused",
            2,
            2,
            255,
            0,
            &renewal_extra(20, 0, 0, 0),
        );
        all.push(bad(
            f,
            "85-closed-renew",
            "Owner cannot reopen CLOSED by renewal",
            25,
            2,
        ));
        let (mut f, _) = transition(&p, &late_world, "unused", 1, 1, 0, 1, &[]);
        hold_counters(&mut f, &late_world);
        all.push(bad(
            f,
            "86-closed-delegate-spend",
            "Late donation does not reopen delegate authority",
            25,
            1,
        ));
        let (mut f, _) = transition(&p, &late_world, "unused", 5, 2, 255, 0, &[]);
        patch_state(&mut f, |v| {
            v[6] = 0;
            v[7] = 3;
        });
        all.push(bad(
            f,
            "87-closed-reopen-state",
            "Even valid owner-signed sweep cannot reopen closed state",
            21,
            2,
        ));
        let (mut f, _) = transition(
            &p,
            &after_a,
            "unused",
            2,
            2,
            255,
            0,
            &renewal_extra(0, 0, 0, 0),
        );
        hold_counters(&mut f, &after_a);
        all.push(bad(
            f,
            "88-renew-noop",
            "Meaningless renewal with no increase/reenable rejects",
            24,
            2,
        ));
        let (small_deposit, small) = deposit(&p, &unfunded, "27-fund60-zero-change-branch", 60);
        all.push(small_deposit);
        let (zero, zw) = transition(
            &p,
            &small,
            "28-alice60-zero-protected-change",
            1,
            1,
            0,
            60,
            &[],
        );
        all.push(zero);
        let (recover_zero, _) = transition(
            &p,
            &zw,
            "29-owner-recover-zero-token-cell",
            4,
            2,
            255,
            0,
            &[],
        );
        all.push(recover_zero);
        let (f, _) = transition(
            &p,
            &after_a,
            "unused",
            2,
            2,
            255,
            0,
            &renewal_extra(u128::MAX, 0, 0, 0),
        );
        all.push(bad(
            f,
            "89-renew-checked-overflow",
            "Valid wrapped successor encoding cannot authorize overflowing root addition",
            27,
            2,
        ));
        let (f, _) = transition(&p, &fresh, "unused", 1, 1, 0, 0, &[]);
        all.push(bad(
            f,
            "90-zero-payout",
            "A correctly authenticated zero payment is not a delegate action",
            22,
            1,
        ));
        let mut f = a.clone();
        replace_output(&mut f, 3, output(858 * CKB - 1_000_001, actor(1), None));
        all.push(bad(
            f,
            "91-excess-fee",
            "Even external fee funding must obey this narrow profile's fee ceiling",
            23,
            1,
        ));
        let mut f = a.clone();
        let tx = f.tx();
        let mut ins: Vec<CellInput> = tx.inputs().into_iter().collect();
        ins[1] = ins[1].clone().as_builder().since(1u64).build();
        f.set_tx(tx.as_advanced_builder().set_inputs(ins).build());
        all.push(bad(
            f,
            "92-nonzero-since",
            "Actual signed input since1 violates the fixed since0 profile",
            13,
            1,
        ));
        let mut f = a.clone();
        let tx = f.tx();
        let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
        ws[2] = WitnessArgs::new_builder().build().as_bytes().pack();
        f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
        all.push(bad(
            f,
            "93-nonempty-fund-witness",
            "Token-valid empty-fields WitnessArgs is still forbidden in unsigned fund slot",
            14,
            1,
        ));
        for (id, action) in [
            ("94-unknown-action", act(6, 0, &[])),
            ("95-action-trailing-byte", act(1, 0, &[0])),
            ("96-wrong-grant-slot", act(1, 2, &[])),
        ] {
            let mut f = a.clone();
            let tx = f.tx();
            let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
            ws[1] = actor_w(&action);
            f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
            all.push(bad(
                f,
                id,
                "Correct native signature over unsupported action encoding/actor slot",
                if id.starts_with("96") { 15 } else { 14 },
                1,
            ));
        }
        let mut f = a.clone();
        patch_state(&mut f, |v| v[4] = 2);
        all.push(bad(
            f,
            "97-unsupported-state-version",
            "A new state version cannot bypass the admitted immutable ABI",
            10,
            1,
        ));
        let mut f = a.clone();
        let op = synthetic("unknown-expanded-dependency");
        f.cells.push(Cell::make(
            "unknown-dependency",
            op.clone(),
            output(100 * CKB, p.base.a.clone(), None),
            Bytes::from(vec![1, 2, 3]),
        ));
        let tx = f.tx();
        f.set_tx(
            tx.as_advanced_builder()
                .cell_dep(
                    CellDep::new_builder()
                        .out_point(op)
                        .dep_type(DepType::Code)
                        .build(),
                )
                .build(),
        );
        all.push(bad(
            f,
            "98-extra-dependency",
            "All executable groups remain usable; Q rejects an unadmitted expanded provider",
            12,
            1,
        ));
        let mut f = a.clone();
        let original = f
            .cells
            .iter()
            .find(|c| c.binary.as_deref() == Some("proxy"))
            .unwrap()
            .clone();
        let op = synthetic("duplicate-F-provider");
        let mut copy = original;
        copy.out_point = op.clone().into();
        f.cells.push(copy);
        let tx = f.tx();
        f.set_tx(
            tx.as_advanced_builder()
                .cell_dep(
                    CellDep::new_builder()
                        .out_point(op)
                        .dep_type(DepType::Code)
                        .build(),
                )
                .build(),
        );
        all.push(bad(
            f,
            "99-duplicate-provider",
            "Byte-identical duplicate F provider violates unambiguous dependency admission",
            12,
            1,
        ));
        let mut f = a.clone();
        let c = f
            .cells
            .iter_mut()
            .find(|c| c.binary.as_deref() == Some("Q"))
            .unwrap();
        let old = c.op();
        let new = synthetic("relocated-identical-Q");
        c.out_point = new.clone().into();
        let tx = f.tx();
        let deps = tx
            .cell_deps()
            .into_iter()
            .map(|d| {
                if d.out_point() == old {
                    d.as_builder().out_point(new.clone()).build()
                } else {
                    d
                }
            })
            .collect();
        f.set_tx(tx.as_advanced_builder().set_cell_deps(deps).build());
        sign(&mut f, 1, 1);
        f.rename(
            "30-identical-Q-relocated",
            "Identical Q bytes at another provider outpoint remain usable",
            true,
            None,
        );
        all.push(f);
        let mut f = a.clone();
        let c = f
            .cells
            .iter_mut()
            .find(|c| c.binary.as_deref() == Some("secp-code"))
            .unwrap();
        let mut data = fs::read(root.join("../test-support/binaries/secp-code")).unwrap();
        data.push(0);
        c.binary = None;
        c.data = Some(format!("0x{}", hex::encode(&data)));
        all.push(bad(f,"100-changed-K-bytes-same-type","K's type identity and executable behavior remain; Q rejects changed admitted code bytes",12,1));
        let mut f = renew.clone();
        let tx = f.tx();
        let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
        ws[1] = witness(
            &act(2, 255, &renewal_extra(21, 30, 0, 0)),
            Some(
                &WitnessArgs::from_slice(&ws[1].raw_data())
                    .unwrap()
                    .lock()
                    .to_opt()
                    .unwrap()
                    .raw_data(),
            ),
        )
        .pack();
        f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
        f.rename(
            "101-renew-action-mutated-after-sign",
            "No re-sign: native K rejects changed action; Q also rejects the mismatched successor",
            false,
            Some("secp:-31+q:21"),
        );
        all.push(f);
        let mut f = close.clone();
        let tx = f.tx();
        f.set_tx(
            tx.as_advanced_builder()
                .set_outputs(tx.outputs().into_iter().skip(1).collect())
                .set_outputs_data(tx.outputs_data().into_iter().skip(1).collect())
                .build(),
        );
        let old_cap: u64 = f.tx().outputs().get(1).unwrap().capacity().unpack();
        replace_output(&mut f, 1, output(old_cap + 600 * CKB, actor(2), None));
        all.push(bad(
            f,
            "104-owner-policy-deletion",
            "Even authenticated owner recovery cannot delete the permanent CLOSED policy",
            11,
            2,
        ));
        let (f, _) = transition(
            &p,
            &after_a,
            "unused",
            2,
            2,
            255,
            0,
            &renewal_extra(0, 0, 0, 1),
        );
        all.push(bad(
            f,
            "105-renew-already-enabled",
            "Reenable mask cannot silently repeat enabled-grant authorization",
            24,
            2,
        ));
        let (f, _) = transition(&p, &after_a, "unused", 3, 2, 255, 0, &[4]);
        all.push(bad(
            f,
            "106-revoke-unknown-mask",
            "Unknown grant bits cannot pass an owner action",
            24,
            2,
        ));
        let mut f = g.clone();
        patch_state(&mut f, |v| v[125..158].copy_from_slice(&pk(3)));
        let old_op = f.tx().inputs().get(0).unwrap().previous_output();
        let c = f.cells.iter_mut().find(|c| c.op() == old_op).unwrap();
        c.output = output(2000 * CKB, actor(3), None).into();
        replace_output(&mut f, 1, output(1400 * CKB - FEE, actor(3), None));
        all.push(bad(
            f,
            "107-issuer-is-owner",
            "Genuine issuer-owner signature cannot admit a token owner-mode input identity",
            22,
            3,
        ));
        let mut max_g = g.clone();
        patch_state(&mut max_g, |v| {
            put(v, 8, u128::MAX);
            put(v, 264, u128::MAX);
            put(v, 296, u128::MAX);
        });
        sign(&mut max_g, 0, 2);
        max_g.rename(
            "31-genesis-max-u128",
            "Maximum valid root/personal/per-payment ceilings with zero used",
            true,
            None,
        );
        let mut max_w = unfunded.clone();
        max_w.policy = result_cell(&max_g, 0, "max-policy");
        max_w
            .auth
            .insert(2, result_cell(&max_g, 1, "max-owner-change"));
        all.push(max_g);
        let (f, max_funded) = deposit(&p, &max_w, "32-fund-max-u128", u128::MAX);
        all.push(f);
        let (f, max_used) = transition(
            &p,
            &max_funded,
            "33-alice-spends-max-u128",
            1,
            1,
            0,
            u128::MAX,
            &[],
        );
        all.push(f);
        let (f, _) = transition(
            &p,
            &max_used,
            "34-owner-close-at-max-used",
            4,
            2,
            255,
            0,
            &[],
        );
        all.push(f);
        let (f, max_plus) = deposit(&p, &max_used, "35-deposit1-after-max-used", 1);
        all.push(f);
        let (mut f, _) = transition(&p, &max_plus, "unused", 1, 5, 1, 1, &[]);
        hold_counters(&mut f, &max_plus);
        all.push(bad(
            f,
            "102-shared-used-overflow",
            "Actual root max+1 must reject through checked addition",
            27,
            5,
        ));
        let (mut f, _) = transition(&p, &max_plus, "unused", 1, 1, 0, 1, &[]);
        hold_counters(&mut f, &max_plus);
        all.push(bad(
            f,
            "103-personal-used-overflow",
            "Actual personal max+1 must reject through checked addition",
            27,
            1,
        ));
        let mut partial = after_dep_ex.clone();
        partial.funds.truncate(1);
        let (f, mut partial_closed) = transition(
            &p,
            &partial,
            "36-close-partial-inventory",
            4,
            2,
            255,
            0,
            &[],
        );
        all.push(f);
        partial_closed.funds = after_dep_ex.funds[1..].to_vec();
        let (f, partial_swept) = transition(
            &p,
            &partial_closed,
            "37-sweep-omitted-inventory",
            5,
            2,
            255,
            0,
            &[],
        );
        all.push(f);
        let (f, late2) = deposit(&p, &partial_swept, "38-second-late-donation", 7);
        all.push(f);
        let (f, _) = transition(&p, &late2, "39-second-closed-sweep", 5, 2, 255, 0, &[]);
        all.push(f);
    }
    for f in &all {
        write_fixture(root, f);
    }
    println!("P0 stage{stage}: {} fixtures generated", all.len());
}
fn expected(r: &Value) -> bool {
    if r["accepted"] != r["expected_accept"]
        || r["non_contextual"] != "PASS"
        || r["capacity"] != "PASS"
        || !r["resolution_error"].is_null()
    {
        return false;
    }
    let bad: Vec<&Value> = r["groups"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|g| !g["error"].is_null())
        .collect();
    match r["expected_failure"].as_str() {
        None => bad.is_empty(),
        Some(e) => {
            let want: Vec<&str> = e.split('+').collect();
            bad.len() == want.len()
                && want.iter().all(|v| {
                    let (role, code) = v.split_once(':').unwrap_or((v, ""));
                    bad.iter().any(|g| {
                        g["role"] == role
                            && (code.is_empty()
                                || g["error"]
                                    .as_str()
                                    .unwrap()
                                    .ends_with(&format!(", {code})")))
                    })
                })
        }
    }
}
fn run(root: &Path) {
    let mut paths: Vec<PathBuf> = fs::read_dir(root.join("fixtures"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    let mut cases = Vec::new();
    for p in paths {
        let f: Fixture = serde_json::from_slice(&fs::read(p).unwrap()).unwrap();
        let r = run_one(root, &f);
        println!(
            "{} accepted={} cycles={} expected={}",
            f.id, r["accepted"], r["total_script_cycles"], f.expected_accept
        );
        fs::write(
            root.join("results").join(format!("{}.json", f.id)),
            serde_json::to_vec_pretty(&r).unwrap(),
        )
        .unwrap();
        let ok = expected(&r);
        cases.push(r);
        if !ok {
            fs::write(
                root.join("results/summary.json"),
                serde_json::to_vec_pretty(&json!({"mismatch":f.id,"cases":cases})).unwrap(),
            )
            .unwrap();
            panic!("Verifier outcome/attribution mismatch: {}", f.id);
        }
    }
    fs::write(
        root.join("results/summary.json"),
        serde_json::to_vec_pretty(&json!({"mismatch":null,"cases":cases})).unwrap(),
    )
    .unwrap();
}
fn main() {
    let a: Vec<String> = env::args().collect();
    let command = a.get(1).map(String::as_str).unwrap_or("run");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    match command {
        "generate3" => generate(&root, 3),
        "generate" | "generate4" => generate(&root, 4),
        "run" => run(&root),
        _ => panic!("Use generate3/generate4/run"),
    }
}
