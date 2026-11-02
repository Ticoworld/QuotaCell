"""Bounded local intent journal; uncertain invoices never get rebuilt."""
import argparse
import datetime as dt
import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

MAX_INTENTS = 4096
MAX_TX_BYTES = 1_000_000


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def connect(path):
    db = sqlite3.connect(path, timeout=30, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.execute("""CREATE TABLE IF NOT EXISTS intents (
      invoice TEXT PRIMARY KEY, state TEXT NOT NULL, tx_hash TEXT,
      transaction_json TEXT, input_points TEXT, created TEXT NOT NULL,
      updated TEXT NOT NULL, last_error TEXT)""")
    return db


def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                       "params": params}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as response:
        result = json.load(response)
    if result.get("error"):
        raise RuntimeError(json.dumps(result["error"]))
    return result.get("result")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("database", type=Path)
    sub = p.add_subparsers(dest="command", required=True)
    reserve = sub.add_parser("reserve"); reserve.add_argument("invoice")
    record = sub.add_parser("record"); record.add_argument("invoice"); record.add_argument("file", type=Path)
    mark = sub.add_parser("uncertain"); mark.add_argument("invoice"); mark.add_argument("error", nargs="?", default="")
    reconcile = sub.add_parser("reconcile"); reconcile.add_argument("invoice"); reconcile.add_argument("rpc_url")
    retry = sub.add_parser("retry-same"); retry.add_argument("invoice")
    args = p.parse_args(); args.database.parent.mkdir(parents=True, exist_ok=True)
    db = connect(args.database)
    try:
        if args.command == "reserve":
            db.execute("BEGIN IMMEDIATE")
            count = db.execute("SELECT count(*) FROM intents").fetchone()[0]
            if count >= MAX_INTENTS:
                db.execute("ROLLBACK"); raise RuntimeError("journal capacity reached")
            try:
                db.execute("INSERT INTO intents VALUES (?, 'reserved', NULL, NULL, NULL, ?, ?, NULL)",
                           (args.invoice, now(), now()))
            except sqlite3.IntegrityError:
                db.execute("ROLLBACK"); print("ALREADY_RESERVED: refuse new build", file=sys.stderr); return 3
            db.execute("COMMIT"); print("RESERVED", args.invoice)
        elif args.command == "record":
            raw = args.file.read_bytes()
            if len(raw) > MAX_TX_BYTES: raise ValueError("transaction record exceeds bound")
            tx = json.loads(raw); tx_hash = tx["hash"]; body = tx["transaction"]
            points = [i["previous_output"] for i in body["inputs"]]
            cur = db.execute("UPDATE intents SET state='uncertain', tx_hash=?, transaction_json=?, input_points=?, updated=? WHERE invoice=? AND state='reserved'",
                             (tx_hash, json.dumps(body, separators=(",", ":")), json.dumps(points), now(), args.invoice))
            if cur.rowcount != 1: raise RuntimeError("intent is absent or already has a pinned transaction")
            print("PINNED", tx_hash)
        elif args.command == "uncertain":
            cur = db.execute("UPDATE intents SET state='uncertain', last_error=?, updated=? WHERE invoice=? AND tx_hash IS NOT NULL",
                             (args.error, now(), args.invoice))
            if cur.rowcount != 1: raise RuntimeError("no pinned transaction to reconcile")
            print("UNCERTAIN; rebuild prohibited", args.invoice)
        elif args.command == "retry-same":
            row = db.execute("SELECT state, tx_hash, transaction_json FROM intents WHERE invoice=?", (args.invoice,)).fetchone()
            if not row or row[0] != "uncertain" or not row[1]: raise RuntimeError("intent is not uncertain with a pinned transaction")
            print(json.dumps({"txHash": row[1], "transaction": json.loads(row[2])}))
        else:
            row = db.execute("SELECT state, tx_hash, input_points FROM intents WHERE invoice=?", (args.invoice,)).fetchone()
            if not row or not row[1]: raise RuntimeError("no pinned transaction to reconcile")
            old_state, tx_hash, points_json = row
            tx = rpc(args.rpc_url, "get_transaction", [tx_hash])
            chain_state = (tx or {}).get("tx_status", {}).get("status", "unknown")
            points = json.loads(points_json); live = []
            for point in points:
                live.append(rpc(args.rpc_url, "get_live_cell", [point, True]).get("status") == "live")
            # A rejected payment can still correspond to an invoice paid by a
            # different transaction; spent inputs and unknown hashes also need
            # operator investigation. None permits an automatic rebuild.
            state = "committed" if chain_state == "committed" else "uncertain"
            db.execute("UPDATE intents SET state=?, updated=? WHERE invoice=?", (state, now(), args.invoice))
            print(json.dumps({"invoice": args.invoice, "txHash": tx_hash,
                              "nodeStatus": chain_state, "journalState": state,
                              "previousState": old_state, "inputLiveness": live,
                              "rebuildAllowed": False}))
    finally:
        db.close()


if __name__ == "__main__":
    try: sys.exit(main() or 0)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr); sys.exit(1)
