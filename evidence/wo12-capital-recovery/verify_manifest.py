"""Verify selected WO12 node records against their source/binary manifest."""
from pathlib import Path
import hashlib
import json
import struct

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = json.loads((HERE / "verification-manifest.json").read_text())
    policy = manifest["policyV2"]
    assert sha(ROOT / policy["source"]) == policy["sourceSha256"]
    assert sha(ROOT / "policy/c/profile.h") == policy["profileSha256"]
    binary = ROOT / "policy/build/allowance-v2"
    assert binary.stat().st_size == policy["binaryBytes"]
    assert sha(binary) == policy["binarySha256"]
    data_hash = hashlib.blake2b(binary.read_bytes(), digest_size=32,
                                person=b"ckb-default-hash").hexdigest()
    assert "0x" + data_hash == policy["ckbDataHash"]
    sources = manifest["reproductionSources"]
    for name, digest in sources.items():
        assert sha(ROOT / name) == digest, name
    for name, digest in manifest["selectedEvidenceSha256"].items():
        assert sha(HERE / name) == digest, name

    def record(name):
        return json.loads((HERE / name).read_text())

    for name in ("01-authorized-v2-payment.json", "02-owner-close-compact.json",
                 "04-late-deposit-after-close.json", "07-owner-sweeps-late-deposit.json"):
        item = record(name)
        assert item["submit"]["result"] == item["txHash"]
        assert item["inclusion"]["status"]["status"] == "committed"
        assert int(item["feeShannon"]) == 2000

    payment = record("01-authorized-v2-payment.json")
    q = payment["resolvedInputs"][0]["cell"]["output"]["type"]
    f = payment["resolvedInputs"][2]["cell"]["output"]["lock"]
    assert q["code_hash"] == policy["ckbDataHash"] and q["hash_type"] == "data2"
    q_args = bytes.fromhex(q["args"][2:])
    assert len(q_args) == 32 and f["code_hash"] == "0x5123908965c711b0ffd8aec642f1ede329649bda1ebdca6bd24124d3796f768a"
    script = (struct.pack("<IIII", 85, 16, 48, 49) + bytes.fromhex(q["code_hash"][2:])
              + bytes([4]) + struct.pack("<I", len(q_args)) + q_args)
    q_script_hash = "0x" + hashlib.blake2b(script, digest_size=32,
                                          person=b"ckb-default-hash").hexdigest()
    assert f["args"] == q_script_hash

    close = record("02-owner-close-compact.json")
    assert int(close["transaction"]["outputs"][0]["capacity"], 16) == 13_400_000_000
    assert len(bytes.fromhex(close["transaction"]["outputs_data"][0][2:])) == 28
    assert int(close["outputs"][0]["occupiedShannon"]) == 13_400_000_000
    assert int(record("03-compact-closed-live.json")["accounting"]["ownerCapacityReleasedShannons"]) == 46_600_000_000
    for name, code in (("01-reject-v2-over-limit-payment.json", 18),
                       ("02-reject-wrong-terminal-owner.json", 10),
                       ("02-reject-forged-terminal-from-active.json", 25),
                       ("03-reject-reenable-after-close.json", 25),
                       ("06-reject-delegate-after-close.json", 15),
                       ("09-reject-terminal-deletion.json", 11)):
        error = record(name)["submit"]["error"]
        assert error["code"] == -302
        assert f"error code {code} " in error["message"]
        assert "Inputs[0].Type" in error["message"]

    print("PASS: source/binary/evidence hashes, four committed transitions, 466 CKB release, 134 CKB terminal, and six native rejections")


if __name__ == "__main__":
    main()
