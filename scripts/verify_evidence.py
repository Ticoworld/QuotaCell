"""Offline integrity checks of historical evidence; does not execute CKB VM or node."""
from pathlib import Path
import hashlib, json
ROOT = Path(__file__).resolve().parents[1]

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    manifest = json.loads((ROOT / "policy/manifest.json").read_text())
    # These source files and the Q baseline must stay byte-identical to P0.
    for name, expected in manifest["source_sha256"].items():
        assert digest(ROOT / "policy" / name) == expected, name
    if (ROOT / "policy/build/allowance").exists():
        assert digest(ROOT / "policy/build/allowance") == manifest["Q"]["sha256"]
    summary = json.loads((ROOT / "policy/results/summary.json").read_text())
    assert summary["mismatch"] is None
    cases = summary["cases"]
    assert len(cases) == 89 and sum(c["accepted"] for c in cases) == 33
    reproduction = json.loads((ROOT / "policy/results/reproduction.json").read_text())
    for case in cases:
        case_id = case["id"]
        fixture_path = ROOT / "policy/fixtures" / (case_id + ".json")
        fixture = json.loads(fixture_path.read_text())
        assert digest(fixture_path) == reproduction["fixture_sha256"][fixture_path.name], case_id
        assert case["accepted"] == case["expected_accept"] == fixture["expected_accept"], case_id
        assert case["expected_failure"] == fixture["expected_failure"], case_id
        assert case["non_contextual"] == case["capacity"] == "PASS", case_id
        assert case.get("resolution_error") is None, case_id
        actual = [g for g in case["groups"] if g["error"] is not None]
        wanted = [] if case["expected_failure"] is None else case["expected_failure"].split("+")
        assert len(actual) == len(wanted), case_id
        for item in wanted:
            role, code = item.split(":")
            assert any(g["role"] == role and g["error"].endswith(", " + code + ")") for g in actual), case_id
    run = ROOT / "evidence/local-node"
    records = {name: json.loads((run / (name + ".json")).read_text()) for name in ["04-alice60", "05-ben50-rejected", "06-ben40"]}
    a, rejected, b = [records[k] for k in records]
    assert a["inclusion"]["status"]["status"] == b["inclusion"]["status"]["status"] == "committed"
    assert rejected["submit"]["method"] == "send_transaction"
    error = rejected["submit"]["error"]
    assert error["code"] == -302 and "Inputs[0].Type" in error["message"]
    assert manifest["Q"]["ckb_data_hash"][2:] + ".html#20" in error["message"]
    assert a["signing"]["publicKey"] != b["signing"]["publicKey"] == rejected["signing"]["publicKey"]
    assert rejected["transaction"]["inputs"][0]["previous_output"]["tx_hash"] == a["txHash"]
    assert b["transaction"]["inputs"][0]["previous_output"]["tx_hash"] == a["txHash"]
    final = json.loads((run / "final-chain-state.json").read_text())
    state = bytes.fromhex(final["policyCell"]["cell"]["data"]["content"][2:])
    assert len(state) == 466
    assert [int.from_bytes(state[o:o+16], "little") for o in [24,280,434]] == [100,60,40]
    assert int.from_bytes(bytes.fromhex(final["protectedFund"]["cell"]["data"]["content"][2:]), "little") == 100
    assert final["policyCell"]["cell"]["data"]["content"] == b["transaction"]["outputs_data"][0]
    print(json.dumps({"scope":"Offline historical integrity only; no VM/node execution or independent attestation", "Q_SHA256":manifest["Q"]["sha256"], "cases":89,"accepted":33,"rejected":56,"node_sequence":"Alice60 committed / Ben50 Q20 rejected / Ben40 committed", "used":100,"protectedTokens":100}, indent=2))

if __name__ == "__main__":
    main()
