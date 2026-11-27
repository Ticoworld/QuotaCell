import assert from 'node:assert/strict';
import {test} from 'node:test';
import handler from './netlify/functions/playground-redeem.mjs';
test('rejects untrusted origins and invalid tokens without contacting issuer', async()=>{
 process.env.QUOTACELL_PLAYGROUND_ORIGIN='https://play.example';process.env.QUOTACELL_PLAYGROUND_ISSUER='https://issuer.example';process.env.QUOTACELL_PLAYGROUND_SECRET='x'.repeat(40);process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID='fixture';
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected')};
 try {for(const [origin,token] of [['https://other.example','a'.repeat(43)],['https://play.example','bad']]) {const r=await handler(new Request('https://play.example/__playground/redeem',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})}));assert.equal(r.status,404)} assert.equal(calls,0)} finally {globalThis.fetch=old}
});
test('authorized redemption returns only the assigned scenario and original expiry',async()=>{
 process.env.QUOTACELL_PLAYGROUND_ORIGIN='https://play.example';process.env.QUOTACELL_PLAYGROUND_ISSUER='https://issuer.example';process.env.QUOTACELL_PLAYGROUND_SECRET='x'.repeat(40);process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID='fixture';
 const expiry=new Date(Date.now()+60000).toISOString(); const key='0x'+'a'.repeat(64), pocket='0x'+'b'.repeat(64);
 process.env.QUOTACELL_PLAYGROUND_IDENTITIES=JSON.stringify({chosen:{key,pocket},other:{key:'secret'}});
 const old=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://issuer.example/api/playground/redeem');assert.equal(JSON.parse(options.body).applicationId,'fixture');return Response.json({resourceId:'chosen',expiresAt:expiry})};
 try {const r=await handler(new Request('https://play.example/__playground/redeem',{method:'POST',headers:{origin:'https://play.example','content-type':'application/json'},body:JSON.stringify({token:'a'.repeat(43)})}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{privateKey:key,pocket,expiresAt:expiry});assert.equal(r.headers.get('cache-control'),'no-store')} finally {globalThis.fetch=old}
});
test('authorized redemption reads added inventory without replacing the existing identity map',async()=>{
 process.env.QUOTACELL_PLAYGROUND_ORIGIN='https://play.example';process.env.QUOTACELL_PLAYGROUND_ISSUER='https://issuer.example';process.env.QUOTACELL_PLAYGROUND_SECRET='x'.repeat(40);process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID='fixture';
 const expiry=new Date(Date.now()+60000).toISOString(),key='0x'+'c'.repeat(64),pocket='0x'+'d'.repeat(64);
 process.env.QUOTACELL_PLAYGROUND_IDENTITIES=JSON.stringify({existing:{key:'0x'+'a'.repeat(64),pocket:'0x'+'b'.repeat(64)}});
 process.env.QUOTACELL_PLAYGROUND_IDENTITY_INVENTORY=JSON.stringify({newResource:{key,pocket}});
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({resourceId:'newResource',expiresAt:expiry});
 try {const r=await handler(new Request('https://play.example/__playground/redeem',{method:'POST',headers:{origin:'https://play.example','content-type':'application/json'},body:JSON.stringify({token:'a'.repeat(43)})}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{privateKey:key,pocket,expiresAt:expiry})} finally {globalThis.fetch=old}
});
test('overlapping receiver maps fail closed',async()=>{
 process.env.QUOTACELL_PLAYGROUND_ORIGIN='https://play.example';process.env.QUOTACELL_PLAYGROUND_ISSUER='https://issuer.example';process.env.QUOTACELL_PLAYGROUND_SECRET='x'.repeat(40);process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID='fixture';
 process.env.QUOTACELL_PLAYGROUND_IDENTITIES=JSON.stringify({same:{key:'0x'+'a'.repeat(64),pocket:'0x'+'b'.repeat(64)}});process.env.QUOTACELL_PLAYGROUND_IDENTITY_INVENTORY=JSON.stringify({same:{key:'0x'+'c'.repeat(64),pocket:'0x'+'d'.repeat(64)}});
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({resourceId:'same',expiresAt:new Date(Date.now()+60000).toISOString()});
 try {const r=await handler(new Request('https://play.example/__playground/redeem',{method:'POST',headers:{origin:'https://play.example','content-type':'application/json'},body:JSON.stringify({token:'a'.repeat(43)})}));assert.equal(r.status,404)} finally {globalThis.fetch=old}
});
