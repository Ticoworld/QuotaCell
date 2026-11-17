import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getPocketState} from './api.ts';

globalThis.window={location:{search:''}};

test('an empty proxy error response is identified as a Pocket backend failure',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:500});
 try{await assert.rejects(()=>getPocketState(),/Pocket backend returned an empty response/);}
 finally{globalThis.fetch=originalFetch;}
});
