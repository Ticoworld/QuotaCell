"""Read-only checks of P0 bytes, upstream provenance, fixtures and result attribution."""
from pathlib import Path
import hashlib
import json
import tarfile

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def upstream():
    f0 = ROOT.parent / "test-support"
    manifest = json.loads((f0 / "manifest.json").read_text(encoding="utf8"))
    for name, item in manifest["binaries"].items():
        raw = (f0 / item["file"]).read_bytes()
        assert len(raw) == item["bytes"], name
        assert hashlib.sha256(raw).hexdigest() == item["sha256"], name
        assert "0x" + hashlib.blake2b(raw, digest_size=32, person=b"ckb-default-hash").hexdigest() == item["ckb_blake2b256"], name
    meta = json.loads((ROOT / "provenance/stdlib.json").read_text(encoding="utf8"))
    archive = ROOT / "provenance/ckb-c-stdlib.tar.gz"
    assert sha(archive) == meta["archive_sha256"]
    count = 0
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            relative = Path(*Path(member.name).parts[1:])
            assert not relative.is_absolute() and ".." not in relative.parts
            local = ROOT / "deps/ckb-c-stdlib" / relative
            assert local.read_bytes() == tar.extractfile(member).read(), str(relative)
            count += 1
    return {"f0_binary_identities_checked": len(manifest["binaries"]), "stdlib_files_checked_against_pinned_archive": count}


def result_checks():
    summary = json.loads((ROOT / "results/summary.json").read_text(encoding="utf8"))
    assert summary["mismatch"] is None
    cases = summary["cases"]
    assert len(cases) == len(list((ROOT / "fixtures").glob("*.json")))
    for case in cases:
        fixture = json.loads((ROOT / "fixtures" / (case["id"] + ".json")).read_text(encoding="utf8"))
        assert fixture["expected_accept"] == case["expected_accept"] == case["accepted"], case["id"]
        assert fixture["expected_failure"] == case["expected_failure"]
        assert case["non_contextual"] == case["capacity"] == "PASS", case["id"]
        assert case.get("resolution_error") is None, case["id"]
        errors = [g for g in case["groups"] if g["error"] is not None]
        wanted = [] if case["expected_failure"] is None else case["expected_failure"].split("+")
        assert len(errors) == len(wanted), case["id"]
        for item in wanted:
            role, code = item.split(":")
            assert any(g["role"] == role and g["error"].endswith(", " + code + ")") for g in errors), case["id"]
        if case["accepted"]:
            assert sum(g["cycles"] for g in case["groups"]) == case["total_script_cycles"], case["id"]
        for sig in case["signing"]:
            assert sig["digest_unchanged"] == (case["id"] != "101-renew-action-mutated-after-sign"), case["id"]
    fixtures = {c["id"]: json.loads((ROOT / "fixtures" / (c["id"] + ".json")).read_text(encoding="utf8")) for c in cases}
    accepted = {c["tx_hash"]: fixtures[c["id"]] for c in cases if c["accepted"]}
    links = 0
    for case in cases:
        if not case["accepted"]:
            continue
        f = fixtures[case["id"]]
        inputs = {json.dumps(i["previous_output"], sort_keys=True) for i in f["transaction"]["inputs"]}
        for cell in f["cells"]:
            if json.dumps(cell["out_point"], sort_keys=True) not in inputs:
                continue
            prior = accepted.get(cell["out_point"]["tx_hash"])
            if prior:
                index = int(cell["out_point"]["index"], 16)
                assert prior["transaction"]["outputs"][index] == cell["output"], case["id"]
                assert prior["transaction"]["outputs_data"][index] == cell["data"], case["id"]
                links += 1
    return {"fixtures": len(cases), "accepted": sum(c["accepted"] for c in cases), "rejected": sum(not c["accepted"] for c in cases),
            "policy_only_rejections": sum(c["expected_failure"] is not None and c["expected_failure"].startswith("q:") for c in cases),
            "positive_input_links_to_actual_previous_outputs_checked": links}


def verify():
    check = upstream()
    if (ROOT / "manifest.json").exists():
        m = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
        assert sha(ROOT / "build/allowance") == m["Q"]["sha256"]
        for relative, digest in m["source_sha256"].items():
            assert sha(ROOT / relative) == digest, relative
    build = json.loads((ROOT / "build/q-build.json").read_text(encoding="utf8"))
    assert sha(ROOT / "build/allowance") == build["sha256"]
    assert sha(ROOT / "c/allowance.c") == build["source_sha256"]
    assert sha(ROOT / "c/profile.h") == build["profile_sha256"]
    check.update(result_checks())
    print(json.dumps(check, indent=2))
    return check


if __name__ == "__main__":
    verify()
