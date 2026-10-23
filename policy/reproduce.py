"""Compile Q and run only local synthetic P0 verification. No RPC/wallet/deployment."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import platform
import subprocess
import tempfile
import time

from build_q import build
from verify_artifacts import upstream, verify

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Use only already cached Cargo packages")
    options = parser.parse_args()
    upstream()
    began = datetime.datetime.now(datetime.timezone.utc)
    previous_q = json.loads((ROOT / "manifest.json").read_text())["Q"]["sha256"]
    previous = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / "fixtures").glob("*.json")}
    record = {"started_utc": began.isoformat(), "platform": platform.platform(), "python": platform.python_version(), "steps": [], "external_cash_expenditure": 0}
    for tool, args in [("rustc", ["-vV"]), ("cargo", ["--version"])]:
        record[tool] = subprocess.run([tool, *args], check=True, text=True, capture_output=True).stdout
    q = build()
    assert q["sha256"] == previous_q, "Q differs from saved build; inspect source/compiler/linker before claiming reproduction"
    record["Q_identical_to_previous_build"] = True
    target = Path(os.environ.get("CARGO_TARGET_DIR", str(Path(tempfile.gettempdir()) / "quotacell-wo04-build"))).resolve()
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(target)
    exe = target / "debug" / ("quotacell-p0.exe" if os.name == "nt" else "quotacell-p0")
    commands = [["cargo", "build", "--manifest-path", str(ROOT / "harness/Cargo.toml"), "--locked", *(["--offline"] if options.offline else [])],
                [str(exe), "generate4"], [str(exe), "run"]]
    for number, command in enumerate(commands):
        tick = time.perf_counter()
        proc = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
        log = proc.stdout + proc.stderr
        (ROOT / "results" / ["host-build.log", "generate.log", "run.log"][number]).write_text(log, encoding="utf8")
        record["steps"].append({"command": command, "returncode": proc.returncode, "elapsed_seconds": time.perf_counter() - tick})
        print(log, end="", flush=True)
        if proc.returncode:
            raise SystemExit(proc.returncode)
    record["checks"] = verify()
    current = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / "fixtures").glob("*.json")}
    record["fixture_sha256"] = current
    record["fixtures_identical_to_previous_generation"] = previous == current
    record["host_binary_sha256"] = hashlib.sha256(exe.read_bytes()).hexdigest()
    record["finished_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (ROOT / "results/reproduction.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    subprocess.run([os.sys.executable, str(ROOT / "demo.py")], check=True)


if __name__ == "__main__":
    main()
