"""Compile only the experimental local Q; no chain or deployment operations."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent


def build():
    lib = ROOT / "deps" / "ckb-c-stdlib"
    assert (lib / "ckb_type_id.h").is_file(), "pinned local stdlib required"
    if os.name == "nt":
        prefix = ["wsl", "-d", "Ubuntu", "--exec"]
        clang = "/usr/bin/clang-18"
        sysroot = subprocess.run(prefix + ["/bin/bash", "-lc", "rustc +stable --print sysroot"], check=True, capture_output=True, text=True).stdout.strip()
        linker = sysroot + "/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld"
        def path(p):
            value = p.resolve().as_posix()
            return "/mnt/" + value[0].lower() + value[2:]
    else:
        prefix = []
        clang = shutil.which("clang")
        linker = shutil.which("ld.lld")
        if not linker:
            sysroot = subprocess.run(["rustc", "--print", "sysroot"], check=True, capture_output=True, text=True).stdout.strip()
            linker = sysroot + "/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld"
        def path(p):
            return str(p.resolve())
    out = ROOT / "build" / "allowance"
    out.parent.mkdir(parents=True, exist_ok=True)
    flags = ["--target=riscv64", "-march=rv64imc", "-mabi=lp64", "-O2", "-nostdlib", "-nostdinc",
             "-fdata-sections", "-ffunction-sections", "-fno-builtin-printf", "-fno-builtin-memcmp",
             "-fno-stack-protector", "-Werror", "-Wall", "-Wextra", "-Wno-unused-parameter",
             "-Wno-unused-function", "-I" + path(lib), "-I" + path(lib / "libc"), "-I" + path(lib / "molecule")]
    obj = ROOT / "build" / "allowance.o"
    commands = [prefix + [clang, *flags, "-c", "-o", path(obj), path(ROOT / "c" / "allowance.c")],
                prefix + [linker, *(["-flavor", "gnu"] if linker.endswith("rust-lld") else []), "-static", "--gc-sections", "--strip-all", "-o", path(out), path(obj)]]
    tick = time.perf_counter()
    log = ""
    for command in commands:
        proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        log += proc.stdout + proc.stderr
        (ROOT / "results" / "q-build.log").write_text(log, encoding="utf8")
        print(proc.stdout + proc.stderr, end="", flush=True)
        if proc.returncode:
            raise SystemExit(proc.returncode)
    raw = out.read_bytes()
    record = {"commands": commands, "clang": subprocess.run(prefix + [clang, "--version"], capture_output=True, text=True, check=True).stdout,
              "linker": subprocess.run(prefix + [linker, *(["-flavor", "gnu"] if linker.endswith("rust-lld") else []), "--version"], capture_output=True, text=True, check=True).stdout,
              "elapsed_seconds": time.perf_counter() - tick, "bytes": len(raw),
              "sha256": hashlib.sha256(raw).hexdigest(),
              "ckb_data_hash": "0x" + hashlib.blake2b(raw, digest_size=32, person=b"ckb-default-hash").hexdigest(),
              "source_sha256": hashlib.sha256((ROOT / "c" / "allowance.c").read_bytes()).hexdigest(),
              "profile_sha256": hashlib.sha256((ROOT / "c" / "profile.h").read_bytes()).hexdigest()}
    (ROOT / "build" / "q-build.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    print("Compiled Q:", len(raw), "bytes;", record["ckb_data_hash"])
    return record


if __name__ == "__main__":
    build()
