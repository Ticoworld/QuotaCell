"""Offline validation of recorded owner transitions; no RPC or VM execution."""
from pathlib import Path
import argparse
import hashlib
import json

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, default=HERE / 'evidence')
    args = parser.parse_args()
    load = lambda name: json.loads((args.evidence / (name + '.json')).read_text(encoding='utf-8'))
    amount = lambda data: int.from_bytes(bytes.fromhex(data[2:]), 'little')
    state = lambda data: bytes.fromhex(data[2:])
    point = lambda record, index: {'tx_hash': record['txHash'], 'index': hex(index)}
    records = {n: load(n) for n in ['03-fund-protected-treasury', '05-owner-revoke',
        '07-disabled-delegate-rejected', '08-enabled-delegate-dry-run',
        '09-owner-close-recover', '11-late-deposit', '13-owner-closed-sweep']}
    fund, revoke, rejected, control, close, deposit, sweep = records.values()
    before, after, closed, final = [load(n) for n in ['04-before-revoke',
        '06-after-revoke', '10-after-close', '14-final-node-state']]
    b = state(before['policy']['cell']['data']['content'])
    r = state(after['policy']['cell']['data']['content'])
    assert len(b) == len(r) == 466 and b[6:8] == bytes([0, 3]) and r[6:8] == bytes([0, 2])
    expected = bytearray(b); expected[7] = 2
    assert bytes(expected) == r
    assert rejected['transaction']['inputs'][0]['previous_output'] == point(revoke, 0)
    assert rejected['resolvedInputs'][0]['status'] == 'live'
    assert rejected['resolvedInputs'][0]['cell']['data']['content'] == revoke['transaction']['outputs_data'][0]
    assert rejected['submit']['method'] == 'send_transaction'
    error = rejected['submit']['error']
    assert error['code'] == -302 and 'Inputs[0].Type' in error['message']
    assert '4c02a05d3ec9723f742dbc1323efef3e094995f9e5ecb043243239d712a4d876.html#17' in error['message']
    for name, index in [('policyAfterRejection', 0), ('actorAfterRejection', 1), ('fundAfterRejection', 2)]:
        after_input, before_input = rejected[name], rejected['resolvedInputs'][index]
        assert after_input['status'] == before_input['status'] == 'live'
        assert after_input['cell'] == before_input['cell']
        assert after_input['outPoint']['txHash'] == before_input['outPoint']['txHash']
        assert int(after_input['outPoint']['index']) == int(before_input['outPoint']['index'])
    assert amount(rejected['transaction']['outputs_data'][2]) == 1
    assert amount(rejected['transaction']['outputs_data'][1]) == 199
    assert control['notSubmitted'] and int(control['dryRun']['cycles'], 16) > 0
    assert control['transaction']['inputs'][0]['previous_output'] == point(revoke, 0)
    assert close['transaction']['inputs'][0]['previous_output'] == point(revoke, 0)
    assert close['transaction']['inputs'][2]['previous_output'] == point(fund, 0)
    assert amount(close['transaction']['outputs_data'][1]) == 200
    assert amount(deposit['transaction']['outputs_data'][0]) == 50
    assert amount(deposit['transaction']['outputs_data'][1]) == 150
    assert deposit['transaction']['inputs'][1]['previous_output'] == point(close, 1)
    assert point(close, 0) not in [x['previous_output'] for x in deposit['transaction']['inputs']]
    assert sweep['transaction']['inputs'][0]['previous_output'] == point(close, 0)
    assert sweep['transaction']['inputs'][2]['previous_output'] == point(deposit, 0)
    assert amount(sweep['transaction']['outputs_data'][1]) == 50
    c = state(closed['policy']['cell']['data']['content'])
    expected = bytearray(r); expected[6] = 1; expected[7] = 0
    assert c == bytes(expected)
    assert final['policy']['cell']['data']['content'] == sweep['transaction']['outputs_data'][0] == close['transaction']['outputs_data'][0]
    for record in [close, sweep]:
        assert record['signing']['role'] == 'owner'
        assert int(record['transaction']['outputs'][1]['capacity'], 16) == 154 * 10**8
        assert record['transaction']['outputs'][1]['lock'] == record['signing']['actorLock']
        assert int(record['transaction']['outputs'][0]['capacity'], 16) == 600 * 10**8
        assert int(record['outputs'][0]['occupiedShannon']) == 572 * 10**8
    assert all(x['status'] == 'live' for x in final['ownerTokenCells'])
    assert sum(amount(x['cell']['data']['content']) for x in final['ownerTokenCells']) == 200
    assert sum(int(x['cell']['output']['capacity'], 16) for x in final['ownerTokenCells']) == 296 * 10**8
    assert final['policy']['status'] == 'live' and not final['peers']
    for snapshot in [before, after, closed, final]:
        canonical = snapshot['canonical']
        assert canonical['transaction']['tx_status']['status'] == 'committed'
        assert canonical['transaction']['tx_status']['block_hash'] == canonical['header']['hash']
        assert snapshot['policy']['cell']['data']['content'] == canonical['transaction']['transaction']['outputs_data'][0]
    for record in [fund, revoke, close, deposit, sweep]:
        assert record['inclusion']['status']['status'] == 'committed'
        assert record['nodeTransaction']['tx_status']['block_hash'] == record['inclusion']['header']['hash']
        inputs = sum(int(x['cell']['output']['capacity'], 16) for x in record['resolvedInputs'])
        outputs = sum(int(x['capacity'], 16) for x in record['transaction']['outputs'])
        assert inputs - outputs == int(record['feeShannon'])
    fees = sum(int(x['feeShannon']) for x in [revoke, close, deposit, sweep])
    assert fees == 8000
    manifest_checked = False
    if args.evidence.resolve() == (HERE / 'evidence').resolve():
        manifest = json.loads((HERE / 'manifest.json').read_text())
        for name, item in manifest.items():
            data = (HERE / name).read_bytes()
            assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], name
        manifest_checked = True
    print(json.dumps({'scope': 'Offline recorded evidence only; no VM/node rerun',
        'result': 'PASS', 'manifest_checked': manifest_checked, 'rejection': 'latest-policy Q17',
        'closure_tokens': 200, 'closure_capacity_CKB': 154, 'late_sweep_tokens': 50,
        'final_owner_tokens': 200, 'retained_policy_CKB': 600, 'occupied_policy_CKB': 572,
        'owner_sequence_fees_shannons': fees}, indent=2))


if __name__ == '__main__':
    main()
