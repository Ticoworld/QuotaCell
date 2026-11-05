"""Check recorded native pocket outcomes without contacting a node."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

def read(name):
    return json.loads((HERE / (name + '.json')).read_text(encoding='utf8'))

for name in ('02-policy-genesis', '03-fund-protected-treasury', 'second-fund',
             'pay-alice', 'pay-ben', 'owner-revoke-alice', 'owner-close-recover',
             'late-deposit', 'owner-late-sweep'):
    record = read(name)
    assert record['submit']['result'] == record['txHash']
    assert record['inclusion']['status']['status'] == 'committed'
    assert int(record['feeShannon']) == 2000

for name, code in {'unauthorized-revoke': 15, 'reject-recipient': 28,
                   'reject-divert': 13, 'reject-identity': 13,
                   'reject-extract': 23, 'reject-fee': 23,
                   'reject-excessfee': 23, 'reject-malformed': 10,
                   'reject-split': 13, 'reject-shared': 20,
                   'reject-disabled': 17, 'delegate-after-close': 15}.items():
    error = read(name)['submit']['error']
    assert error['code'] == -302 and f'error code {code}' in error['message']

assert 'DuplicateCellDeps' in read('reject-dupdep')['submit']['error']['message']
assert read('stale-policy')['error']['code'] == -301
payment = read('pay-alice')
assert len(payment['transaction']['inputs']) == 4
close = read('owner-close-recover')['outputs']
assert int(close[0]['capacityShannon']) == 134 * 10**8
assert int(close[0]['occupiedShannon']) == 134 * 10**8
assert int(close[1]['capacityShannon']) == 1000 * 10**8
print('PASS: recorded pocket outcomes; no node rerun')
