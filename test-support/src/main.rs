//! Synthetic fixtures and existing CKB verifiers only. There is no policy Q.
use ckb_chain_spec::consensus::ConsensusBuilder;
use ckb_hash::blake2b_256;
use ckb_jsonrpc_types as rpc;
use ckb_script::{TransactionScriptsVerifier, TxVerifyEnv};
use ckb_traits::{CellDataProvider, ExtensionProvider, HeaderProvider};
use ckb_types::{
    bytes::Bytes,
    core::{
        Capacity, DepType, EpochNumberWithFraction, HeaderView, ScriptHashType, TransactionBuilder,
        TransactionView,
        cell::{
            CellMeta, CellMetaBuilder, CellProvider, CellStatus, HeaderChecker, resolve_transaction,
        },
        error::OutPointError,
        hardfork::HardForks,
    },
    packed::{self, Byte32, CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
use ckb_verification::{CapacityVerifier, NonContextualTransactionVerifier};
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

const CKB: u64 = 100_000_000;
const FEE: u64 = 2_000;
const MAX_CYCLES: u64 = 70_000_000;
const K: &str = "9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";
const X: &str = "5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a";
const A: &str = "3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1";
const T: &str = "50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95";
const TYPE_ID: &str = "00000000000000000000000000000000000000000000000000545950455f4944";
const ACTION: &[u8] = b"QCA1\x01\x00\x00\x00";

fn bytes(s: &str) -> Bytes {
    Bytes::from(hex::decode(s.trim_start_matches("0x")).unwrap())
}
fn h(s: &str) -> Byte32 {
    Byte32::from_slice(&bytes(s)).unwrap()
}
fn hexbytes(b: &[u8]) -> String {
    format!("0x{}", hex::encode(b))
}
fn point(hash: &str, index: u32) -> OutPoint {
    OutPoint::new_builder()
        .tx_hash(h(hash))
        .index(index)
        .build()
}
fn synthetic(label: &str) -> OutPoint {
    OutPoint::new_builder()
        .tx_hash(blake2b_256(label).pack())
        .index(0u32)
        .build()
}
fn script(code: &str, mode: ScriptHashType, args: Bytes) -> Script {
    Script::new_builder()
        .code_hash(h(code))
        .hash_type(mode)
        .args(args.pack())
        .build()
}
fn key(n: u8) -> SecretKey {
    let mut b = [0u8; 32];
    b[31] = n;
    SecretKey::from_slice(&b).unwrap()
}
fn actor(n: u8) -> Script {
    let p = PublicKey::from_secret_key(&Secp256k1::new(), &key(n)).serialize();
    script(
        K,
        ScriptHashType::Type,
        Bytes::copy_from_slice(&blake2b_256(p)[..20]),
    )
}
fn input(p: OutPoint) -> CellInput {
    CellInput::new_builder()
        .previous_output(p)
        .since(0u64)
        .build()
}
fn output(cap: u64, lock: Script, ty: Option<Script>) -> CellOutput {
    CellOutput::new_builder()
        .capacity(cap)
        .lock(lock)
        .type_(ty.pack())
        .build()
}
fn state_data(used: u128) -> Bytes {
    let mut v = b"F0P1".to_vec();
    for n in [100u128, used, used, 0] {
        v.extend(n.to_le_bytes());
    }
    Bytes::from(v)
}
fn amount(n: u128) -> Bytes {
    Bytes::copy_from_slice(&n.to_le_bytes())
}
fn p_for(first: &CellInput) -> Script {
    let mut b = first.as_slice().to_vec();
    b.extend(0u64.to_le_bytes());
    script(
        TYPE_ID,
        ScriptHashType::Type,
        Bytes::copy_from_slice(&blake2b_256(b)),
    )
}
fn f_for(p: &Script) -> Script {
    script(X, ScriptHashType::Data1, p.calc_script_hash().as_bytes())
}
fn witness(action: &[u8], signature: Option<&[u8]>) -> Bytes {
    WitnessArgs::new_builder()
        .lock(signature.map(Bytes::copy_from_slice).pack())
        .input_type(Some(Bytes::copy_from_slice(action)).pack())
        .build()
        .as_bytes()
}

#[derive(Clone, Serialize, Deserialize)]
struct Cell {
    label: String,
    out_point: rpc::OutPoint,
    output: rpc::CellOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    binary: Option<String>,
}
impl Cell {
    fn make(label: &str, p: OutPoint, o: CellOutput, b: Bytes) -> Self {
        Self {
            label: label.into(),
            out_point: p.into(),
            output: o.into(),
            data: Some(hexbytes(&b)),
            binary: None,
        }
    }
    fn op(&self) -> OutPoint {
        self.out_point.clone().into()
    }
    fn out(&self) -> CellOutput {
        self.output.clone().into()
    }
    fn data(&self, root: &Path) -> Bytes {
        self.binary
            .as_ref()
            .map(|n| Bytes::from(fs::read(root.join("binaries").join(n)).unwrap()))
            .unwrap_or_else(|| bytes(self.data.as_ref().unwrap()))
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Fixture {
    id: String,
    purpose: String,
    expected_accept: bool,
    expected_failure: Option<String>,
    transaction: rpc::Transaction,
    cells: Vec<Cell>,
    signatures: Vec<Value>,
}
impl Fixture {
    fn tx(&self) -> TransactionView {
        let t: packed::Transaction = self.transaction.clone().into();
        t.into_view()
    }
    fn set_tx(&mut self, t: TransactionView) {
        self.transaction = t.data().into();
    }
    fn input_cell(&self, i: usize) -> &Cell {
        let p = self.tx().inputs().get(i).unwrap().previous_output();
        self.cells.iter().find(|c| c.op() == p).unwrap()
    }
    fn rename(&mut self, id: &str, purpose: &str, accept: bool, failure: Option<&str>) {
        self.id = id.into();
        self.purpose = purpose.into();
        self.expected_accept = accept;
        self.expected_failure = failure.map(str::to_owned);
    }
}
#[derive(Clone)]
struct Loader {
    cells: HashMap<OutPoint, CellMeta>,
}
impl CellProvider for Loader {
    fn cell(&self, p: &OutPoint, _: bool) -> CellStatus {
        self.cells
            .get(p)
            .cloned()
            .map(CellStatus::Live)
            .unwrap_or(CellStatus::Unknown)
    }
}
impl HeaderChecker for Loader {
    fn check_valid(&self, h: &Byte32) -> Result<(), OutPointError> {
        Err(OutPointError::InvalidHeader(h.clone()))
    }
}
impl CellDataProvider for Loader {
    fn get_cell_data(&self, p: &OutPoint) -> Option<Bytes> {
        self.cells.get(p).and_then(|c| c.mem_cell_data.clone())
    }
    fn get_cell_data_hash(&self, p: &OutPoint) -> Option<Byte32> {
        self.cells.get(p).and_then(|c| c.mem_cell_data_hash.clone())
    }
}
impl HeaderProvider for Loader {
    fn get_header(&self, _: &Byte32) -> Option<HeaderView> {
        None
    }
}
impl ExtensionProvider for Loader {
    fn get_block_extension(&self, _: &Byte32) -> Option<packed::Bytes> {
        None
    }
}
fn loader(f: &Fixture, root: &Path) -> Loader {
    Loader {
        cells: f
            .cells
            .iter()
            .map(|c| {
                (
                    c.op(),
                    CellMetaBuilder::from_cell_output(c.out(), c.data(root))
                        .out_point(c.op())
                        .build(),
                )
            })
            .collect(),
    }
}

fn digest(f: &Fixture, first: usize) -> (Vec<u8>, [u8; 32]) {
    let tx = f.tx();
    let mut pre = tx.hash().as_slice().to_vec();
    let lock = f.input_cell(first).out().lock();
    let mut ws: Vec<Bytes> = tx.witnesses().into_iter().map(|w| w.raw_data()).collect();
    let w = WitnessArgs::from_slice(&ws[first]).unwrap();
    ws[first] = w
        .as_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build()
        .as_bytes();
    let indexes = (first..tx.inputs().len())
        .filter(|&i| f.input_cell(i).out().lock() == lock)
        .chain(tx.inputs().len()..ws.len());
    for i in indexes {
        pre.extend((ws[i].len() as u64).to_le_bytes());
        pre.extend(&ws[i]);
    }
    let d = blake2b_256(&pre);
    (pre, d)
}
fn sign(f: &mut Fixture, first: usize, n: u8) {
    let tx = f.tx();
    let mut ws: Vec<Bytes> = tx.witnesses().into_iter().map(|w| w.raw_data()).collect();
    if ws[first].is_empty() {
        ws[first] = witness(ACTION, Some(&[0u8; 65]));
    }
    f.set_tx(
        tx.as_advanced_builder()
            .set_witnesses(ws.iter().map(|w| w.pack()).collect())
            .build(),
    );
    let (pre, d) = digest(f, first);
    let secp = Secp256k1::new();
    let sig = secp.sign_ecdsa_recoverable(&Message::from_digest(d), &key(n));
    let (rid, compact) = sig.serialize_compact();
    let mut b = compact.to_vec();
    b.push(i32::from(rid) as u8);
    let mut ws: Vec<Bytes> = f
        .tx()
        .witnesses()
        .into_iter()
        .map(|w| w.raw_data())
        .collect();
    ws[first] = WitnessArgs::from_slice(&ws[first])
        .unwrap()
        .as_builder()
        .lock(Some(Bytes::from(b.clone())).pack())
        .build()
        .as_bytes();
    f.set_tx(
        f.tx()
            .as_advanced_builder()
            .set_witnesses(ws.iter().map(|w| w.pack()).collect())
            .build(),
    );
    f.signatures.retain(|x| x["input_index"] != first);
    f.signatures.push(json!({"input_index":first,"test_secret_scalar":n,"public_key":hexbytes(&PublicKey::from_secret_key(&secp,&key(n)).serialize()),"preimage":hexbytes(&pre),"signed_digest":hexbytes(&d),"signature":hexbytes(&b)}));
}

struct Setup {
    deps: Vec<CellDep>,
    cells: Vec<Cell>,
    a: Script,
    t: Script,
}
fn setup(root: &Path) -> Setup {
    let m: Value = serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    let specs = [
        (
            "secp-code",
            "8f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f",
            1,
        ),
        (
            "secp-data",
            "8f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f",
            3,
        ),
        (
            "secp-dep-group",
            "f8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",
            0,
        ),
        (
            "always-success",
            "b4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93",
            0,
        ),
        (
            "proxy",
            "b4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93",
            1,
        ),
        (
            "xudt",
            "bf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f",
            0,
        ),
    ];
    let mut cells = Vec::new();
    let mut deps = Vec::new();
    for (role, hash, idx) in specs {
        let raw = fs::read(root.join("binaries").join(role)).unwrap();
        assert_eq!(
            hexbytes(&blake2b_256(&raw)),
            m["binaries"][role]["ckb_blake2b256"].as_str().unwrap()
        );
        let out: rpc::CellOutput =
            serde_json::from_value(m["binaries"][role]["observed_output"].clone()).unwrap();
        let op = point(hash, idx);
        cells.push(Cell {
            label: role.into(),
            out_point: op.clone().into(),
            output: out,
            data: None,
            binary: Some(role.into()),
        });
        if !["secp-code", "secp-data"].contains(&role) {
            deps.push(
                CellDep::new_builder()
                    .out_point(op)
                    .dep_type(if role == "secp-dep-group" {
                        DepType::DepGroup
                    } else {
                        DepType::Code
                    })
                    .build(),
            );
        }
    }
    assert_eq!(
        cells[0].out().type_().to_opt().unwrap().calc_script_hash(),
        h(K)
    );
    Setup {
        deps,
        cells,
        a: script(A, ScriptHashType::Data1, Bytes::new()),
        t: script(
            T,
            ScriptHashType::Data1,
            actor(3).calc_script_hash().as_bytes(),
        ),
    }
}
fn fixture(id: &str, purpose: &str, tx: TransactionView, cells: Vec<Cell>) -> Fixture {
    Fixture {
        id: id.into(),
        purpose: purpose.into(),
        expected_accept: true,
        expected_failure: None,
        transaction: tx.data().into(),
        cells,
        signatures: Vec::new(),
    }
}
fn genesis(s: &Setup, label: &str, id: &str) -> Fixture {
    let own = Cell::make(
        "synthetic-owner",
        synthetic(label),
        output(1000 * CKB, actor(2), None),
        Bytes::new(),
    );
    let ins = input(own.op());
    let p = p_for(&ins);
    let tx = TransactionBuilder::default()
        .set_cell_deps(s.deps.clone())
        .input(ins)
        .outputs([
            output(200 * CKB, s.a.clone(), Some(p)),
            output(800 * CKB - FEE, actor(2), None),
        ])
        .outputs_data([state_data(0).pack(), Bytes::new().pack()])
        .witness(witness(b"QCA1\x00\xff\x00\x00", Some(&[0u8; 65])).pack())
        .build();
    let mut cells = s.cells.clone();
    cells.push(own);
    let mut f = fixture(
        id,
        "Valid built-in Type ID genesis, real owner signature",
        tx,
        cells,
    );
    sign(&mut f, 0, 2);
    f
}
fn spend(
    s: &Setup,
    g: &Fixture,
    id: &str,
    q: u128,
    fund_amount: u128,
    fund_cap: u64,
    used: u128,
) -> Fixture {
    let gt = g.tx();
    let p = gt.outputs().get(0).unwrap().type_().to_opt().unwrap();
    let fund_lock = f_for(&p);
    let state = Cell::make(
        "synthetic-policy-stand-in",
        OutPoint::new_builder()
            .tx_hash(gt.hash())
            .index(0u32)
            .build(),
        gt.outputs().get(0).unwrap(),
        gt.outputs_data().get(0).unwrap().raw_data(),
    );
    let auth = Cell::make(
        "synthetic-alice",
        synthetic("alice-authentication-input"),
        output(1000 * CKB, actor(1), None),
        Bytes::new(),
    );
    let fund = Cell::make(
        "synthetic-protected-fund",
        synthetic(&format!("fund-{fund_amount}-{fund_cap}")),
        output(fund_cap, fund_lock.clone(), Some(s.t.clone())),
        amount(fund_amount),
    );
    let tx = TransactionBuilder::default()
        .set_cell_deps(s.deps.clone())
        .inputs([input(state.op()), input(auth.op()), input(fund.op())])
        .outputs([
            output(200 * CKB, s.a.clone(), Some(p)),
            output(fund_cap, fund_lock, Some(s.t.clone())),
            output(142 * CKB, actor(4), Some(s.t.clone())),
            output(858 * CKB - FEE, actor(1), None),
        ])
        .outputs_data([
            state_data(used).pack(),
            amount(fund_amount - q).pack(),
            amount(q).pack(),
            Bytes::new().pack(),
        ])
        .witnesses([
            Bytes::new().pack(),
            witness(ACTION, Some(&[0u8; 65])).pack(),
            Bytes::new().pack(),
        ])
        .build();
    let mut cells = s.cells.clone();
    cells.extend([state, auth, fund]);
    let mut f = fixture(id, "Real signed proxy/xUDT/Type ID composition", tx, cells);
    sign(&mut f, 1, 1);
    f
}
fn resign(f: &mut Fixture) {
    sign(f, 1, 1)
}
fn replace_output_data(f: &mut Fixture, index: usize, b: Bytes) {
    let tx = f.tx();
    let mut ds: Vec<packed::Bytes> = tx.outputs_data().into_iter().collect();
    ds[index] = b.pack();
    f.set_tx(tx.as_advanced_builder().set_outputs_data(ds).build());
}
fn replace_output(f: &mut Fixture, index: usize, o: CellOutput) {
    let tx = f.tx();
    let mut os: Vec<CellOutput> = tx.outputs().into_iter().collect();
    os[index] = o;
    f.set_tx(tx.as_advanced_builder().set_outputs(os).build());
}
fn write_fixture(root: &Path, f: &Fixture) {
    fs::write(
        root.join("fixtures").join(format!("{}.json", f.id)),
        serde_json::to_vec_pretty(f).unwrap(),
    )
    .unwrap();
}
fn generate(root: &Path) {
    let s = setup(root);
    let g = genesis(&s, "owner-genesis-input", "00-genesis");
    let other = genesis(&s, "other-owner-genesis-input", "01-unrelated-genesis");
    let base = spend(&s, &g, "02-positive", 60, 200, 154 * CKB, 60);
    let mut all = vec![g.clone(), other.clone(), base.clone()];
    // Omit policy entirely: re-sign, preserve valid token/CKB accounting.
    for (id, dep_only) in [
        ("03-no-policy-input", false),
        ("05-policy-dependency-only", true),
    ] {
        let mut f = base.clone();
        let tx = f.tx();
        let policy = f.input_cell(0).clone();
        let mut deps: Vec<CellDep> = tx.cell_deps().into_iter().collect();
        if dep_only {
            deps.push(
                CellDep::new_builder()
                    .out_point(policy.op())
                    .dep_type(DepType::Code)
                    .build(),
            );
        }
        f.set_tx(
            tx.as_advanced_builder()
                .set_cell_deps(deps)
                .set_inputs(tx.inputs().into_iter().skip(1).collect())
                .set_outputs(tx.outputs().into_iter().skip(1).collect())
                .set_outputs_data(tx.outputs_data().into_iter().skip(1).collect())
                .set_witnesses(tx.witnesses().into_iter().skip(1).collect())
                .build(),
        );
        f.signatures.clear();
        sign(&mut f, 0, 1);
        f.rename(
            id,
            "Matching policy absent from inputs; otherwise valid and re-signed",
            false,
            Some("proxy"),
        );
        all.push(f);
    }
    let mut f = base.clone();
    let tx = f.tx();
    let ot = other.tx();
    let op = OutPoint::new_builder()
        .tx_hash(ot.hash())
        .index(0u32)
        .build();
    let oc = Cell::make(
        "unrelated-policy",
        op.clone(),
        ot.outputs().get(0).unwrap(),
        ot.outputs_data().get(0).unwrap().raw_data(),
    );
    f.cells.push(oc);
    let mut ins: Vec<CellInput> = tx.inputs().into_iter().collect();
    ins[0] = input(op);
    f.set_tx(tx.as_advanced_builder().set_inputs(ins).build());
    replace_output(&mut f, 0, ot.outputs().get(0).unwrap());
    resign(&mut f);
    f.rename(
        "04-unrelated-policy",
        "Different valid Type ID lineage, same token payment",
        false,
        Some("proxy"),
    );
    all.push(f);
    // Fresh matching Type ID output is valid on its own; proxy still requires an input.
    let mut f = base.clone();
    let tx = f.tx();
    let ins: Vec<CellInput> = tx.inputs().into_iter().skip(1).collect();
    let fresh_p = p_for(&ins[0]);
    let fresh_f = f_for(&fresh_p);
    let fund_op = ins[1].previous_output();
    let c = f.cells.iter_mut().find(|c| c.op() == fund_op).unwrap();
    c.output = output(154 * CKB, fresh_f.clone(), Some(s.t.clone())).into();
    f.set_tx(
        tx.as_advanced_builder()
            .set_inputs(ins)
            .set_witnesses(tx.witnesses().into_iter().skip(1).collect())
            .build(),
    );
    replace_output(&mut f, 0, output(200 * CKB, s.a.clone(), Some(fresh_p)));
    replace_output(&mut f, 1, output(154 * CKB, fresh_f, Some(s.t.clone())));
    replace_output(&mut f, 3, output(658 * CKB - FEE, actor(1), None));
    f.signatures.clear();
    sign(&mut f, 0, 1);
    f.rename(
        "06-matching-policy-output-only",
        "Fresh matching policy output passes Type ID creation; input proxy rejects",
        false,
        Some("proxy"),
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws[1] = witness(
        b"QCA1\x01\x01\x00\x00",
        Some(&bytes(f.signatures[0]["signature"].as_str().unwrap())),
    )
    .pack();
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    f.rename(
        "07-actor-action-mutated",
        "Change only actor input_type after signing",
        false,
        Some("secp"),
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws[0] = witness(b"QCA1\x04\xff\x00\x00", None).pack();
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    f.rename(
        "08-policy-witness-mutated",
        "Only separate state-group witness changes; existing validators ignore it",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    replace_output_data(&mut f, 1, amount(139));
    replace_output_data(&mut f, 2, amount(61));
    f.rename(
        "09-signed-outputs-mutated",
        "Change token outputs after signing, retain conservation",
        false,
        Some("secp"),
    );
    all.push(f);
    let mut f = spend(&s, &g, "10-overspend-resigned", 101, 200, 154 * CKB, 101);
    f.rename(
        "10-overspend-resigned",
        "Real signature authorizes payout above hypothetical 100 allowance; Q absent",
        true,
        None,
    );
    all.push(f);
    let mut f = spend(
        &s,
        &g,
        "11-incorrect-accounting-resigned",
        60,
        200,
        154 * CKB,
        0,
    );
    f.rename(
        "11-incorrect-accounting-resigned",
        "Payout60 with unchanged used0, correctly signed; Type ID does not account",
        true,
        None,
    );
    all.push(f);
    let mut f = spend(&s, &g, "12-zero-token-change", 60, 60, 154 * CKB, 60);
    f.rename(
        "12-zero-token-change",
        "Real xUDT zero change and external recipient capacity funding",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    replace_output(&mut f, 2, output(141 * CKB, actor(4), Some(s.t.clone())));
    replace_output(&mut f, 3, output(859 * CKB - FEE, actor(1), None));
    resign(&mut f);
    f.rename(
        "13-recipient-under-capacity",
        "141 CKB output needs142; all scripts remain otherwise valid",
        false,
        Some("capacity"),
    );
    all.push(f);
    let mut f = base.clone();
    replace_output_data(&mut f, 1, amount(0));
    replace_output_data(&mut f, 2, amount(201));
    resign(&mut f);
    f.rename(
        "14-unauthorized-mint",
        "Normal xUDT mode rejects output201 above input200",
        false,
        Some("xudt"),
    );
    all.push(f);
    let mut f = base.clone();
    replace_output_data(&mut f, 2, amount(59));
    replace_output_data(&mut f, 0, state_data(59));
    resign(&mut f);
    f.rename(
        "15-burn-control",
        "Input200 to outputs140+59; xUDT permits burn, Q must enforce equality",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    replace_output_data(&mut f, 2, Bytes::from(vec![0u8; 15]));
    resign(&mut f);
    f.rename(
        "16-short-token-data",
        "Malformed 15-byte output amount",
        false,
        Some("xudt"),
    );
    all.push(f);
    let mut f = base.clone();
    let mut b = amount(60).to_vec();
    b.push(0);
    replace_output_data(&mut f, 2, Bytes::from(b));
    replace_output(&mut f, 2, output(143 * CKB, actor(4), Some(s.t.clone())));
    replace_output(&mut f, 3, output(857 * CKB - FEE, actor(1), None));
    resign(&mut f);
    f.rename(
        "17-token-data-tail",
        "17-byte data with sufficient capacity; outside proposed exact16 profile",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    f.set_tx(
        tx.as_advanced_builder()
            .set_cell_deps(
                tx.cell_deps()
                    .into_iter()
                    .filter(|d| d.out_point() != s.cells[5].op())
                    .collect(),
            )
            .build(),
    );
    resign(&mut f);
    f.rename(
        "18-token-dependency-missing",
        "No executable satisfying T's data hash",
        false,
        Some("xudt"),
    );
    all.push(f);
    let mut f = base.clone();
    let token_type = s.cells[5]
        .out()
        .type_()
        .to_opt()
        .unwrap()
        .calc_script_hash();
    let typed = script(
        &hex::encode(token_type.as_slice()),
        ScriptHashType::Type,
        s.t.args().raw_data(),
    );
    let fund_op = f.tx().inputs().get(2).unwrap().previous_output();
    let c = f.cells.iter_mut().find(|c| c.op() == fund_op).unwrap();
    c.output = output(
        154 * CKB,
        f_for(&g.tx().outputs().get(0).unwrap().type_().to_opt().unwrap()),
        Some(typed.clone()),
    )
    .into();
    for i in [1, 2] {
        let o = f.tx().outputs().get(i).unwrap();
        replace_output(
            &mut f,
            i,
            o.as_builder().type_(Some(typed.clone()).pack()).build(),
        );
    }
    resign(&mut f);
    f.rename(
        "19-type-addressed-token-control",
        "Same xUDT bytes resolve by actual code-cell type hash; not immutable asset admission",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let relocated = synthetic("relocated-identical-proxy-code");
    let mut c = s.cells[4].clone();
    c.out_point = relocated.clone().into();
    f.cells.push(c);
    let ds = tx
        .cell_deps()
        .into_iter()
        .map(|d| {
            if d.out_point() == s.cells[4].op() {
                d.as_builder().out_point(relocated.clone()).build()
            } else {
                d
            }
        })
        .collect();
    f.set_tx(tx.as_advanced_builder().set_cell_deps(ds).build());
    resign(&mut f);
    f.rename(
        "20-identical-proxy-relocation",
        "Identical-byte provider at another outpoint, correctly re-signed",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let wrong = synthetic("wrong-proxy-provider");
    let mut c = s.cells[3].clone();
    c.out_point = wrong.clone().into();
    f.cells.push(c);
    let ds = tx
        .cell_deps()
        .into_iter()
        .map(|d| {
            if d.out_point() == s.cells[4].op() {
                d.as_builder().out_point(wrong.clone()).build()
            } else {
                d
            }
        })
        .collect();
    f.set_tx(tx.as_advanced_builder().set_cell_deps(ds).build());
    resign(&mut f);
    f.rename(
        "21-wrong-proxy-bytes",
        "Dependency contains A rather than X bytes; no matching X executable",
        false,
        Some("proxy"),
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let op = synthetic("secp-group-without-data");
    let group = vec![s.cells[0].op()].pack();
    f.cells.push(Cell::make(
        "incomplete-secp-dep-group",
        op.clone(),
        output(100 * CKB, s.a.clone(), None),
        group.as_bytes(),
    ));
    let ds = tx
        .cell_deps()
        .into_iter()
        .map(|d| {
            if d.dep_type() == DepType::DepGroup.into() {
                d.as_builder().out_point(op.clone()).build()
            } else {
                d
            }
        })
        .collect();
    f.set_tx(tx.as_advanced_builder().set_cell_deps(ds).build());
    resign(&mut f);
    f.rename(
        "22-secp-data-member-missing",
        "Valid dep group omits required precomputed secp data member",
        false,
        Some("secp"),
    );
    all.push(f);
    let mut f = spend(
        &s,
        &g,
        "23-native-capacity-leak-control",
        60,
        200,
        300 * CKB,
        60,
    );
    replace_output(
        &mut f,
        1,
        output(
            154 * CKB,
            f_for(&g.tx().outputs().get(0).unwrap().type_().to_opt().unwrap()),
            Some(s.t.clone()),
        ),
    );
    replace_output(&mut f, 3, output(1004 * CKB - FEE, actor(1), None));
    resign(&mut f);
    f.rename(
        "23-native-capacity-leak-control",
        "Stand-in permits146 CKB from protected excess capacity to actor; Q must prohibit",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws.push(Bytes::from(vec![1, 2, 3]).pack());
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    resign(&mut f);
    f.rename(
        "24-signed-extra-witness",
        "Standard sighash covers witnesses beyond input count",
        true,
        None,
    );
    all.push(f.clone());
    let tx = f.tx();
    let mut ws: Vec<packed::Bytes> = tx.witnesses().into_iter().collect();
    ws[3] = Bytes::from(vec![1, 2, 4]).pack();
    f.set_tx(tx.as_advanced_builder().set_witnesses(ws).build());
    f.rename(
        "25-extra-witness-mutated",
        "Change signed extra witness after signing",
        false,
        Some("secp"),
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    f.set_tx(
        tx.as_advanced_builder()
            .set_outputs(tx.outputs().into_iter().skip(1).collect())
            .set_outputs_data(tx.outputs_data().into_iter().skip(1).collect())
            .build(),
    );
    replace_output(&mut f, 2, output(1058 * CKB - FEE, actor(1), None));
    resign(&mut f);
    f.rename(
        "26-type-id-deletion-control",
        "Type ID input authorizes proxy once but may be deleted; late donations could then strand",
        true,
        None,
    );
    all.push(f);
    let mut f = base.clone();
    let tx = f.tx();
    let mut os: Vec<CellOutput> = tx.outputs().into_iter().collect();
    os.push(os[0].clone());
    let mut ds: Vec<packed::Bytes> = tx.outputs_data().into_iter().collect();
    ds.push(ds[0].clone());
    f.set_tx(
        tx.as_advanced_builder()
            .set_outputs(os)
            .set_outputs_data(ds)
            .build(),
    );
    replace_output(&mut f, 3, output(658 * CKB - FEE, actor(1), None));
    resign(&mut f);
    f.rename(
        "27-duplicate-policy-output",
        "Two successors of the same Type ID reject",
        false,
        Some("type-id"),
    );
    all.push(f);
    for f in &all {
        write_fixture(root, f);
    }
    println!("Generated {} fixtures", all.len());
}

fn role(s: &Script) -> String {
    let code = hex::encode(s.code_hash().as_slice());
    match code.as_str() {
        K => "secp",
        X => "proxy",
        A => "always-success",
        TYPE_ID => "type-id",
        T => "xudt",
        _ => "xudt-type-addressed",
    }
    .into()
}
fn run_one(root: &Path, f: &Fixture) -> Value {
    let began = Instant::now();
    let tx = f.tx();
    let l = loader(f, root);
    let consensus = Arc::new(
        ConsensusBuilder::default()
            .hardfork_switch(HardForks::new_dev())
            .build(),
    );
    let nc = NonContextualTransactionVerifier::new(&tx, &consensus).verify();
    let mut result = json!({"id":f.id,"purpose":f.purpose,"expected_accept":f.expected_accept,"expected_failure":f.expected_failure,"tx_hash":hexbytes(tx.hash().as_slice()),"witness_hash":hexbytes(tx.witness_hash().as_slice()),"transaction_molecule":hexbytes(tx.data().as_slice()),"transaction_bytes":tx.data().as_slice().len(),"non_contextual":nc.as_ref().err().map(|e|format!("{e:?}")).unwrap_or_else(||"PASS".into())});
    let resolved = match resolve_transaction(tx.clone(), &mut HashSet::new(), &l, &l) {
        Ok(r) => Arc::new(r),
        Err(e) => {
            result["resolution_error"] = json!(format!("{e:?}"));
            result["accepted"] = json!(false);
            return result;
        }
    };
    let cap = CapacityVerifier::new(resolved.clone(), consensus.dao_type_hash()).verify();
    result["capacity"] = json!(
        cap.as_ref()
            .err()
            .map(|e| format!("{e:?}"))
            .unwrap_or_else(|| "PASS".into())
    );
    let inc = resolved.inputs_capacity().unwrap().as_u64();
    let outc = resolved.outputs_capacity().unwrap().as_u64();
    result["input_capacity_shannons"] = json!(inc);
    result["output_capacity_shannons"] = json!(outc);
    result["fee_shannons"] = json!(inc.checked_sub(outc));
    let occupied: Vec<u64> = tx
        .outputs_with_data_iter()
        .map(|(o, d)| {
            o.occupied_capacity(Capacity::bytes(d.len()).unwrap())
                .unwrap()
                .as_u64()
        })
        .collect();
    result["output_occupied_shannons"] = json!(occupied);
    result["resolved_dep_members"]=json!(resolved.resolved_cell_deps.iter().map(|c|json!({"out_point":rpc::OutPoint::from(c.out_point.clone()),"data_hash":hexbytes(c.mem_cell_data_hash.as_ref().unwrap().as_slice()),"bytes":c.data_bytes})).collect::<Vec<_>>());
    let header = HeaderView::new_advanced_builder()
        .epoch(EpochNumberWithFraction::new(1000, 0, 1).pack())
        .build();
    let verifier = TransactionScriptsVerifier::new(
        resolved,
        l,
        consensus,
        Arc::new(TxVerifyEnv::new_commit(&header)),
    );
    let full = verifier.verify(MAX_CYCLES);
    let mut groups = Vec::new();
    for (kind, hash, group) in verifier.groups_with_type() {
        let one = verifier.verify_single(kind, hash, MAX_CYCLES);
        groups.push(json!({"role":role(&group.script),"group_type":format!("{kind:?}"),"script":rpc::Script::from(group.script.clone()),"script_hash":hexbytes(hash.as_slice()),"input_indices":group.input_indices,"output_indices":group.output_indices,"version":format!("{:?}",verifier.select_version(&group.script)),"cycles":one.as_ref().ok(),"error":one.as_ref().err().map(|e|format!("{e:?}"))}));
    }
    groups.sort_by_key(|x| x["role"].as_str().unwrap().to_owned());
    result["groups"] = json!(groups);
    result["script_verification"] = json!(
        full.as_ref()
            .err()
            .map(|e| format!("{e:?}"))
            .unwrap_or_else(|| "PASS".into())
    );
    result["total_script_cycles"] = json!(full.as_ref().ok());
    result["accepted"] = json!(nc.is_ok() && cap.is_ok() && full.is_ok());
    result["signing"]=json!(f.signatures.iter().map(|s|{let i=s["input_index"].as_u64().unwrap() as usize;let (pre,d)=digest(f,i);json!({"input_index":i,"signed_digest":s["signed_digest"],"current_digest":hexbytes(&d),"current_preimage":hexbytes(&pre),"digest_unchanged":hexbytes(&d)==s["signed_digest"].as_str().unwrap()})}).collect::<Vec<_>>());
    result["elapsed_ms"] = json!(began.elapsed().as_millis());
    result
}
fn run(root: &Path) {
    let mut paths: Vec<PathBuf> = fs::read_dir(root.join("fixtures"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    let mut all = Vec::new();
    let began = Instant::now();
    for p in paths {
        let f: Fixture = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
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
        let baseline =
            f.id == "00-genesis" || f.id == "01-unrelated-genesis" || f.id == "02-positive";
        let matched = expectation_matches(&r);
        all.push(r);
        if baseline && !matched {
            fs::write(
                root.join("results/summary.json"),
                serde_json::to_vec_pretty(&json!({"baseline_failed":true,"cases":all})).unwrap(),
            )
            .unwrap();
            panic!("Positive gate failed; no negative conclusions permitted");
        }
    }
    let mismatches: Vec<String> = all
        .iter()
        .filter(|r| !expectation_matches(r))
        .map(|r| r["id"].as_str().unwrap().to_owned())
        .collect();
    let summary = json!({"verifier":"ckb-script 1.0.0 TransactionScriptsVerifier + ckb-verification 1.0.0 non-contextual/capacity","epoch":"1000(0/1)","hardforks":"HardForks::new_dev()","max_cycles":MAX_CYCLES,"elapsed_ms":began.elapsed().as_millis(),"expectation_mismatches":mismatches,"cases":all});
    fs::write(
        root.join("results/summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    assert!(
        mismatches.is_empty(),
        "Unexpected outcomes; inspect evidence"
    );
}
fn expectation_matches(r: &Value) -> bool {
    if r["accepted"] != r["expected_accept"]
        || r["non_contextual"] != "PASS"
        || !r["resolution_error"].is_null()
    {
        return false;
    }
    let failures: Vec<&str> = r["groups"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|g| !g["error"].is_null())
        .map(|g| g["role"].as_str().unwrap())
        .collect();
    match r["expected_failure"].as_str() {
        None => r["capacity"] == "PASS" && failures.is_empty(),
        Some("capacity") => r["capacity"] != "PASS" && failures.is_empty(),
        Some(role) => r["capacity"] == "PASS" && failures == vec![role],
    }
}
fn main() {
    let args: Vec<String> = env::args().collect();
    let command = args.get(1).map(String::as_str).unwrap_or("run");
    let root = args
        .get(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    match command {
        "generate" => generate(&root),
        "run" => run(&root),
        _ => panic!("Use generate or run"),
    }
}
