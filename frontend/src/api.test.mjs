import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError,getActorPockets,getPocketState,prepareGenesis,prepareOwnerAction,preparePayment,resolvePudgeTransaction,submitTransaction} from './api.ts';

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

test('owner preparation resumes by status after a timeout without posting a duplicate request',async()=>{
 const originalFetch=globalThis.fetch;
 const originalTimeout=globalThis.window.setTimeout;
 const posted=[],statusRequests=[];
 const prepared={id:'request-id',transaction:'0x00',publicKey:'0x02'+'11'.repeat(32),genesis:'0x'+'22'.repeat(32),fee:'123'};
 globalThis.window.setTimeout=(callback)=>setTimeout(callback,0);
 globalThis.fetch=async(url,options)=>{
  if(url==='/api/external/preparation-status'){
   statusRequests.push(JSON.parse(options.body));
   return new Response(JSON.stringify(statusRequests.length===1?{state:'not-found'}:{state:'prepared',result:prepared}),{status:200});
  }
  assert.equal(url,'/api/external/owner');
  posted.push(JSON.parse(options.body));
  throw new DOMException('deadline exceeded','TimeoutError');
 };
 try{
  const result=await prepareOwnerAction({id:'request-id',publicKey:'0x02'+'11'.repeat(32),operation:'deposit',amount:'100000000000'});
  assert.equal(result.fee,'123');
  assert.equal(posted.length,1,'the operation is submitted once even when the browser deadline expires');
  assert.equal(statusRequests.length,2,'the stable request ID is recovered from the supervisor');
  assert.equal(statusRequests[1].endpoint,'owner');
  assert.equal(statusRequests[1].id,'request-id');
  assert.equal(posted[0].id,'request-id');
 }finally{globalThis.fetch=originalFetch;globalThis.window.setTimeout=originalTimeout;}
});

test('an in-flight payment preparation resumes from its existing reservation',async()=>{
 const originalFetch=globalThis.fetch;
 const originalTimeout=globalThis.window.setTimeout;
 let statusCalls=0,prepareCalls=0;
 const result={id:'payment-id',transaction:'0x01',publicKey:'0x02'+'11'.repeat(32),genesis:'0x'+'22'.repeat(32),fee:'456'};
 globalThis.window.setTimeout=(callback)=>setTimeout(callback,0);
 globalThis.fetch=async(url)=>{
  if(url==='/api/external/preparation-status'){
   statusCalls++;
   return new Response(JSON.stringify(statusCalls===1?{state:'preparing'}:{state:'prepared',result}),{status:200});
  }
  if(url==='/api/external/prepare')prepareCalls++;
  throw new Error(`unexpected request ${url}`);
 };
 try{
  const prepared=await preparePayment({id:'payment-id',publicKey:result.publicKey,role:'alice',amount:'100',recipient:'0x'+'33'.repeat(20)});
  assert.equal(prepared.transaction,'0x01');
  assert.equal(statusCalls,2);
  assert.equal(prepareCalls,0,'resume never starts a duplicate reservation');
 }finally{globalThis.fetch=originalFetch;globalThis.window.setTimeout=originalTimeout;}
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
