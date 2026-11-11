import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidedAmounts} from './pocket_guided_terms.mjs';
test('converts the configured terms exactly',()=>assert.deepEqual(guidedAmounts('500','400','100','500','400'),['50000000000','40000000000','10000000000','50000000000','40000000000']));
test('rejects invalid precision, ineffective payment and inconsistent limits',()=>{for(const args of [['500.000000001','400','100','500','400'],['500','400','60','500','400'],['500','501','100','500','400'],['500','400','401','500','400']])assert.throws(()=>guidedAmounts(...args));});
