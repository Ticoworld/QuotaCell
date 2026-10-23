"""Display the measured local proof; reproduce.py executes its compiled scripts first."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent


def main():
    cases = {c["id"]: c for c in json.loads((ROOT / "results/summary.json").read_text())["cases"]}
    steps = [
        ("00-genesis", "Owner authorizes root100 / Alice70,per60 / Ben50,per50"),
        ("01-fund200", "Deposit200; used0"),
        ("02-alice60", "Alice pays60; shared used60; token balance140"),
        ("03-ben40-shared100", "Ben pays40; shared used100; token balance100"),
        ("53-exhausted-positive-balance", "Another signed delegate payment1 rejects (Q20)"),
        ("04-refund50-exhausted", "Supplier A returns50 from actual receipt; token balance150"),
        ("77-refund-exhausted-still-rejects", "Another payment1 still rejects (Q20)"),
        ("05-owner-close-recover150", "Owner alone closes and recovers150; CLOSED state retained"),
        ("06-late-donation50", "Late deposit50 creates protected funds; CLOSED unchanged"),
        ("07-owner-closed-sweep50", "Owner alone sweeps50; still CLOSED"),
    ]
    print("QuotaCell P0 - compiled native Q, synthetic local cells, actual CKB VM")
    for case_id, label in steps:
        r = cases[case_id]
        assert r["accepted"] == r["expected_accept"]
        print(("ACCEPT " if r["accepted"] else "REJECT ") + label + (f" | {r['total_script_cycles']:,} cycles" if r["accepted"] else " | exact group error saved"))
    print("Local proof only. No chain deployment, production asset admission, app or independent audit.")


if __name__ == "__main__":
    main()
