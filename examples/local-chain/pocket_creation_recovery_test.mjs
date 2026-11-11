import assert from 'node:assert/strict';
import {submitDurableCreation,recoverCreation} from './pocket_creation_recovery.mjs';

const stages=['after-intent','before-dry-run','after-dry-run','before-submit','after-submit'];
for(const stopAt of stages){
 const events=[];let durable=false,submitted=false;
 const run=()=>submitDurableCreation({
  persistIntent:async()=>{events.push('persist');durable=true;},
  dryRun:async()=>{assert(durable);events.push('dry-run');},
  submit:async()=>{assert(durable);submitted=true;events.push('submit');return {state:'submitted'};},
  checkpoint:async stage=>{events.push(stage);if(stage===stopAt)throw Error('injected interruption');}
 });
 const result=stopAt==='after-intent'?await assert.rejects(run):await run();
 assert(durable,`intent must be durable at ${stopAt}`);
 assert(!events.includes('dry-run')||events.indexOf('persist')<events.indexOf('dry-run'));
 assert(!events.includes('submit')||events.indexOf('persist')<events.indexOf('submit'));
 if(['after-intent','before-dry-run','after-dry-run','before-submit'].includes(stopAt))assert.equal(submitted,false);
 if(stopAt==='after-dry-run'||stopAt==='before-submit')assert.equal(result.state,'uncertain');
 if(stopAt==='after-submit')assert.equal(result.state,'uncertain');
}

for(const stage of ['intent-write','dry-run','submit']){
 const events=[];
 const run=()=>submitDurableCreation({
  persistIntent:async()=>{events.push('persist');if(stage==='intent-write')throw Error('disk failure');},
  dryRun:async()=>{events.push('dry-run');if(stage==='dry-run')throw Error('rpc interruption');},
  submit:async()=>{events.push('submit');if(stage==='submit')throw Error('rpc interruption');return {state:'submitted'};}
 });
 const result=stage==='intent-write'?await assert.rejects(run):await run();
 if(stage==='intent-write')assert.deepEqual(events,['persist']);
 if(stage==='dry-run'){assert.equal(result.state,'uncertain');assert.deepEqual(events,['persist','dry-run']);}
 if(stage==='submit'){assert.equal(result.state,'uncertain');assert.deepEqual(events,['persist','dry-run','submit']);}
}

const pending={id:'creation-1',state:'uncertain',recovery_json:JSON.stringify({initial:{pocket:'p'},actors:{owner:'o'}})};
{
 let observations=0,writes=0;
 const result=await recoverCreation({item:pending,operationInProgress:true,observe:async()=>{observations++;return {state:'committed'};},writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,false);assert.equal(observations,0);assert.equal(writes,0);
}
for(const state of ['pending','rejected','conflicting','uncertain']){
 let writes=0;
 const result=await recoverCreation({item:pending,observe:async()=>({state}),writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,false);assert.equal(result.outcome.state,state);assert.equal(writes,0);
}
{
 let writes=0;
 const result=await recoverCreation({item:pending,observe:async()=>({state:'committed'}),writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,true);assert.equal(writes,1);
}
{
 let writes=0;
 const item={...pending,recovery_json:null,state:'committed'};
 const result=await recoverCreation({item,observe:async()=>{throw Error('must not observe committed')},writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,false);assert.equal(result.outcome.state,'recovery-required');assert.equal(writes,0);
}
{
 const item={...pending,state:'committed'};
 const result=await recoverCreation({item,operationInProgress:true,observe:async()=>{throw Error('committed creation must not be observed again')},writeDescriptor:async()=>{}});
 assert.equal(result.ready,true);
}
{
 let writes=0;
 const result=await recoverCreation({item:pending,observe:async()=>({state:'committed'}),descriptorMatches:()=>false,writeDescriptor:async()=>{writes++;}});
 assert.equal(result.ready,false);assert.match(result.outcome.reason,/conflicts/);assert.equal(writes,0);
}
console.log('PASS creation durable-before-RPC fault injection and conservative restart recovery');
