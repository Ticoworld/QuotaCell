import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileRecordedTransaction} from './src/provision-reconciliation';

test('recovery submits only the recorded transaction and checks its original hash',async()=>{
 const sent:string[]=[],waited:string[]=[];
 const adapter={hash:(bytes:string)=>bytes==='original'?'hash-a':'hash-b',lookup:async()=>null,send:async(bytes:string)=>{sent.push(bytes);throw new Error('uncertain submission')},wait:async(hash:string)=>{waited.push(hash);return 'committed'}};
 assert.equal(await reconcileRecordedTransaction({hash:'hash-a',signed:'original'},adapter),'committed');
 assert.deepEqual(sent,['original']);assert.deepEqual(waited,['hash-a']);
 await assert.rejects(reconcileRecordedTransaction({hash:'hash-b',signed:'original'},adapter));
 assert.deepEqual(sent,['original']);
});
test('recovery does not resubmit an observed transaction',async()=>{
 let sent=false;
 const result=await reconcileRecordedTransaction({hash:'hash-a',signed:'original'},{hash:()=> 'hash-a',lookup:async()=>({status:'pending'}),send:async()=>{sent=true;return 'hash-a'},wait:async()=> 'committed'});
 assert.equal(result,'committed');assert.equal(sent,false);
});
