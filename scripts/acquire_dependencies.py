"""Acquire only the explicitly licensed system-script package; never fetch F/A."""
from pathlib import Path
import argparse, hashlib, io, json, tarfile, urllib.request
ROOT = Path(__file__).resolve().parents[1]
URL = "https://static.crates.io/crates/ckb-system-scripts/ckb-system-scripts-0.5.4.crate"
SHA = "fa5c59063142de7a68cfad4449c6b3863563856219a2925dfb8c5f019ec2aa47"
GROUP_HEX = "020000008f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f030000008f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f01000000"

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--system-scripts-only", action="store_true", help="Download MIT-declared ckb-system-scripts 0.5.4 directly from crates.io")
    args = p.parse_args()
    if not args.system_scripts_only:
        raise SystemExit("This helper obtains K only. Use --system-scripts-only. For the remaining exact dependencies and manual setup, see docs/DEPENDENCIES.md. No F/A/T binaries are distributed here.")
    request = urllib.request.Request(URL, headers={"User-Agent":"QuotaCell-reproduction/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(2_000_001)
    assert len(data) <= 2_000_000 and hashlib.sha256(data).hexdigest() == SHA, "Package identity mismatch"
    manifest = json.loads((ROOT / "test-support/manifest.json").read_text())
    target = ROOT / "test-support/binaries"
    target.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for role, member in [("secp-code","secp256k1_blake160_sighash_all"),("secp-data","secp256k1_data")]:
            raw = archive.extractfile("ckb-system-scripts-0.5.4/specs/cells/" + member).read()
            assert hashlib.sha256(raw).hexdigest() == manifest["binaries"][role]["sha256"]
            destination = target / role
            if destination.exists():
                assert destination.read_bytes() == raw, "Refusing to replace differing file"
            else:
                destination.write_bytes(raw)
    mutated = (target / "secp-code").read_bytes() + bytes([0])
    expected = json.loads((ROOT / "evidence/fixture-externalization.json").read_text())
    assert hashlib.sha256(mutated).hexdigest() == expected["sha256"]
    mutated_path = target / "secp-code-mutated"
    if mutated_path.exists():
        assert mutated_path.read_bytes() == mutated
    else:
        mutated_path.write_bytes(mutated)
    group = bytes.fromhex(GROUP_HEX)
    assert hashlib.sha256(group).hexdigest() == manifest["binaries"]["secp-dep-group"]["sha256"]
    destination = target / "secp-dep-group"
    if destination.exists():
        assert destination.read_bytes() == group
    else:
        destination.write_bytes(group)
    print(json.dumps({"source":URL,"archiveSHA256":SHA,"licenseMetadata":"MIT","obtained":["secp-code","secp-data","secp-dep-group"],"fullReproduction":"Requires external F/A/T setup; see docs/DEPENDENCIES.md"}, indent=2))

if __name__ == "__main__":
    main()
