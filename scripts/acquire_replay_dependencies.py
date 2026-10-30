"""Prepare exact replay dependencies from a chosen node, without broadcasting.

Downloaded executables remain ignored local inputs; this is not redistribution
or a license grant. Existing differing files are never replaced.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = {
    "always-success": ("0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93", "0x0"),
    "proxy": ("0xb4f171c9c9caf7401f54a8e56225ae21d95032150a87a4678eac3f66a3137b93", "0x1"),
    "xudt": ("0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f", "0x0"),
}


def fetch(url, tx_hash, index):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1,
                          "method": "get_live_cell",
                          "params": [{"tx_hash": tx_hash, "index": index}, True]}).encode()
    request = urllib.request.Request(url, payload, {
        "Content-Type": "application/json", "User-Agent": "QuotaCell-replay/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(2_000_001)
    if len(body) > 2_000_000:
        raise ValueError("RPC response exceeds replay acquisition bound")
    result = json.loads(body)
    if result.get("error"):
        raise ValueError("get_live_cell failed; select a working RPC endpoint")
    cell = result.get("result") or {}
    if cell.get("status") != "live":
        raise ValueError("Pinned provider is not live; do not substitute other bytes")
    return bytes.fromhex(cell["cell"]["data"]["content"].removeprefix("0x"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc-url", required=True,
                        help="Chosen CKB testnet/node URL; read-only get_live_cell calls only")
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.rpc_url)
    if url.scheme not in ("http", "https") or not url.hostname:
        parser.error("--rpc-url must be an http(s) node endpoint")
    manifest = json.loads((ROOT / "test-support/manifest.json").read_text())
    target = ROOT / "test-support/binaries"
    prepared = []
    # Validate every fetched byte and existing destination before writing F/A/T.
    for name, (tx_hash, index) in PROVIDERS.items():
        raw = fetch(args.rpc_url, tx_hash, index)
        expected = manifest["binaries"][name]
        sha = hashlib.sha256(raw).hexdigest()
        ckb_hash = "0x" + hashlib.blake2b(raw, digest_size=32, person=b"ckb-default-hash").hexdigest()
        if (len(raw), sha, ckb_hash) != (expected["bytes"], expected["sha256"], expected["ckb_blake2b256"]):
            raise ValueError(f"Pinned byte identity mismatch for {name}; no substitutions accepted")
        destination = target / name
        if destination.exists() and destination.read_bytes() != raw:
            raise ValueError(f"Refusing to replace differing local dependency: {name}")
        prepared.append((name, raw, tx_hash, index, sha, ckb_hash))
    # Existing publisher helper obtains K and creates the externalized mutation.
    subprocess.run([sys.executable, str(ROOT / "scripts/acquire_dependencies.py"),
                    "--system-scripts-only"], check=True)
    target.mkdir(exist_ok=True)
    receipts = []
    for name, raw, tx_hash, index, sha, ckb_hash in prepared:
        destination = target / name
        if not destination.exists():
            with destination.open("xb") as output:
                output.write(raw)
        if destination.read_bytes() != raw:
            raise ValueError(f"Dependency changed during preparation: {name}")
        receipts.append({"name": name, "out_point": {"tx_hash": tx_hash, "index": index},
                         "bytes": len(raw), "sha256": sha, "ckb_data_hash": ckb_hash})
    print(json.dumps({"scope": "Read-only acquisition; no signing or broadcast",
                      "provider_host": url.hostname, "verified": receipts,
                      "distribution": "Ignored local dependencies only; upstream terms still apply"}, indent=2))


if __name__ == "__main__":
    main()
