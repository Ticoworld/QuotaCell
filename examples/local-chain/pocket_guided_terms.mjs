import {parseCkb} from './pocket_input.mjs';
// These checks supplement, and never replace, the genesis builder's key and policy checks.
export function guidedAmounts(shared,aliceLimit,aliceMax,benLimit,benMax){
 const values=[shared,aliceLimit,aliceMax,benLimit,benMax].map(parseCkb);
 const [s,a,ap,b,bp]=values;
 if(s<6100000000n||a>s||b>s||ap<6100000000n||bp<6100000000n||ap>a||bp>b)throw Error('Each payment maximum must be at least 61 CKB and no greater than its personal allowance; personal allowances cannot exceed the shared allowance.');
 return values.map(String);
}
