import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getActorPockets,getPocketState} from './api.ts';

globalThis.window={location:{search:''}};

test('an empty proxy error response is identified as a Pocket backend failure',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:500});
 try{await assert.rejects(()=>getPocketState(),/Pocket backend returned an empty response/);}
 finally{globalThis.fetch=originalFetch;}
});

test('empty actor discovery is retried before it can be presented as no Pockets',async()=>{
 const originalFetch=globalThis.fetch;
 const originalTimeout=globalThis.window.setTimeout;
 let calls=0;
 globalThis.window.setTimeout=(callback)=>setTimeout(callback,0);
 globalThis.fetch=async()=>new Response(JSON.stringify(++calls<5?{empty:true}:{discovery:[{pocket:'0x'+'11'.repeat(32),role:'owner',closed:true}]}),{status:200});
 try{
  const result=await getActorPockets('0x02'+'11'.repeat(32));
  assert.equal(calls,5);
  assert.equal(result.discovery?.[0]?.role,'owner');
 }finally{globalThis.fetch=originalFetch;globalThis.window.setTimeout=originalTimeout;}
});

test('empty discovery is returned only after all bounded retries finish',async()=>{
 const originalFetch=globalThis.fetch;
 const originalTimeout=globalThis.window.setTimeout;
 let calls=0;
 globalThis.window.setTimeout=(callback)=>setTimeout(callback,0);
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({empty:true}),{status:200});};
 try{
  const result=await getActorPockets('0x02'+'22'.repeat(32));
  assert.equal(calls,5);
  assert.equal(result.empty,true);
 }finally{globalThis.fetch=originalFetch;globalThis.window.setTimeout=originalTimeout;}
});
