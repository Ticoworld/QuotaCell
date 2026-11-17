import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError,getActorPockets,getPocketState,prepareGenesis,resolvePudgeTransaction,submitTransaction} from './api.ts';

globalThis.window={location:{search:''}};

test('an empty proxy error response is identified as a Pocket backend failure',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:500});
 try{await assert.rejects(()=>getPocketState(),/Pocket backend returned an empty response/);}
 finally{globalThis.fetch=originalFetch;}
});

test('a transient submission response failure is marked safe to retry with the same request',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'supervisor restarting'}),{status:503});
 try{
  await assert.rejects(()=>submitTransaction('request-id','0x00'),(error)=>error instanceof ApiError&&error.retryable&&error.status===503);
 }finally{globalThis.fetch=originalFetch;}
});

test('a preparation timeout is distinguished from an offline backend and can be resumed',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw new DOMException('deadline exceeded','TimeoutError');};
 try{
  await assert.rejects(()=>prepareGenesis({id:'request-id'}),(error)=>error instanceof ApiError&&error.retryable&&error.timedOut&&/resume the same request/.test(error.message));
 }finally{globalThis.fetch=originalFetch;}
});

test('an absent journal entry and a Pudge miss resolve a transaction as not submitted',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>url==='/api/reconcile'
  ? new Response(JSON.stringify({outcomes:[]}),{status:200})
  : new Response(JSON.stringify({result:{tx_status:{status:'unknown'}}}),{status:200});
 try{
  const result=await resolvePudgeTransaction(`0x${'11'.repeat(32)}`);
  assert.equal(result.status,'not-sent');
  assert.equal(result.notSent,true);
 }finally{globalThis.fetch=originalFetch;}
});

test('a journaled transaction remains unresolved when Pudge has not returned it yet',async()=>{
 const originalFetch=globalThis.fetch;
 const hash=`0x${'22'.repeat(32)}`;
 globalThis.fetch=async(url)=>url==='/api/reconcile'
  ? new Response(JSON.stringify({outcomes:[{txHash:hash,state:'uncertain',reason:'Transaction not found'}]}),{status:200})
  : new Response(JSON.stringify({result:{tx_status:{status:'unknown'}}}),{status:200});
 try{
  const result=await resolvePudgeTransaction(hash);
  assert.equal(result.status,'uncertain');
 }finally{globalThis.fetch=originalFetch;}
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

test('selected Pocket state lookup keeps the URL identity and connected actor together',async()=>{
 const originalFetch=globalThis.fetch;
 const originalSearch=globalThis.window.location.search;
 const pocket='0x'+'33'.repeat(32);
 const actor='0x02'+'44'.repeat(32);
 let requestedUrl='';
 globalThis.window.location.search=`?pocket=${pocket}`;
 globalThis.fetch=async(url)=>{
  requestedUrl=String(url);
  return new Response(JSON.stringify({pocket,closed:true}),{status:200});
 };
 try{
  const result=await getPocketState(actor);
  const parsed=new URL(requestedUrl,'http://localhost');
  assert.equal(parsed.searchParams.get('pocket'),pocket);
  assert.equal(parsed.searchParams.get('actor'),actor);
  assert.equal(result.pocket,pocket);
 }finally{globalThis.fetch=originalFetch;globalThis.window.location.search=originalSearch;}
});
