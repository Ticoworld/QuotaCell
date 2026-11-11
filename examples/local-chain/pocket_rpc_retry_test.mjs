import assert from 'node:assert/strict';
import {callRpc} from './pocket_rpc_retry.mjs';

{
 let calls=0;
 const result=await callRpc('get_live_cell',async()=>{if(++calls===1)throw Error('temporary reset');return 'live';});
 assert.equal(result,'live');assert.equal(calls,2);
}
{
 let calls=0;
 await assert.rejects(()=>callRpc('get_consensus',async()=>{calls++;throw Error('offline');}),/get_consensus RPC failed: offline/);
 assert.equal(calls,2);
}
for(const method of ['dry_run_transaction','send_transaction']){
 let calls=0;
 await assert.rejects(()=>callRpc(method,async()=>{calls++;throw Error('interrupted');}),new RegExp(`${method} RPC failed: interrupted`));
 assert.equal(calls,1,`${method} must never be retried`);
}
{
 let calls=0;
 await assert.rejects(()=>callRpc('get_tip_header',async()=>{calls++;throw Object.assign(Error('node rejected request'),{retryable:false,rpc:{code:-1}});}),error=>error.message.includes('get_tip_header RPC failed: node rejected request')&&error.rpc.code===-1);
 assert.equal(calls,1,'JSON-RPC errors are not retried');
}
console.log('PASS bounded retries apply only to idempotent reads; dry-run and submit are single-attempt');
