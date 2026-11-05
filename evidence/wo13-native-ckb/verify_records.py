"""Check selected public WO13 evidence; this does not execute a node."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

def read(name):
    return json.loads((HERE / (name + '.json')).read_text(encoding='utf-8'))

for name in ('02-policy-genesis', '03-fund-protected-treasury', 'pay-alice',
             'pay-ben', 'owner-revoke-alice', 'owner-close-recover',
             'late-deposit', 'owner-late-sweep'):
    item = read(name)
    assert item['submit']['result'] == item['txHash']
    assert item['inclusion']['status']['status'] == 'committed'
    assert int(item['feeShannon']) == 2000

for name, code in {'unauthorized-revoke': 15, 'reject-recipient': 28,
                   'reject-divert': 13, 'reject-extract': 23, 'reject-fee': 23,
                   'reject-split': 13, 'reject-shared': 20,
                   'reject-disabled': 17, 'delegate-after-close': 15}.items():
    error = read(name)['submit']['error']
    assert error['code'] == -302 and f'error code {code}' in error['message']

assert read('stale-policy')['error']['code'] == -301
close = read('owner-close-recover')['outputs']
assert int(close[0]['capacityShannon']) == 134 * 10**8
assert int(close[0]['occupiedShannon']) == 134 * 10**8
assert int(close[1]['capacityShannon']) == 800 * 10**8
fund = read('03-fund-protected-treasury')['outputs'][0]
assert int(fund['occupiedShannon']) == 73 * 10**8
print('PASS: selected recorded node outcomes and capacity accounting; no node rerun')
