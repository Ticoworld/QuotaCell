import assert from 'node:assert/strict';
import { formatCkb } from './amount.ts';
import { minimumProtectedFundingShannons, REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS } from './funding.ts';

assert.equal(formatCkb(REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS), '73');
assert.equal(formatCkb(minimumProtectedFundingShannons('60000000000')), '673');
assert.equal(minimumProtectedFundingShannons('60000000000') < 1000n * 100_000_000n, true);
console.log('Funding guidance computes the 73 CKB reserve and 673 CKB protected minimum without capping larger deposits');
