// Server-side receiver for the separate Playground site. No credentials are logged.
export default async function handler(request) {
 const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
 const fail=()=>new Response('{}',{status:404,headers});
 try {
  const origin=process.env.QUOTACELL_PLAYGROUND_ORIGIN;
  const issuer=process.env.QUOTACELL_PLAYGROUND_ISSUER;
  const secret=process.env.QUOTACELL_PLAYGROUND_SECRET;
  const appId=process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID;
  if(!origin || !issuer || !secret || secret.length<32 || !appId || new URL(origin).origin!==origin || new URL(issuer).origin!==issuer || !origin.startsWith('https://') || !issuer.startsWith('https://'))return fail();
  if(request.method!=='POST' || request.headers.get('origin')!==origin || request.headers.get('content-type')!=='application/json' || Number(request.headers.get('content-length')||0)>512)return fail();
  const body=await request.text(); if(body.length>512)return fail();
  const {token}=JSON.parse(body); if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return fail();
  const response=await fetch(`${issuer}/api/playground/redeem`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify({token,applicationId:appId}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)return fail();
  const allocation=await response.json();
  const identities=JSON.parse(process.env.QUOTACELL_PLAYGROUND_IDENTITIES || '{}');
  const identity=identities[allocation.resourceId];
  if(!identity || !/^0x[0-9a-f]{64}$/i.test(identity.key) || !/^0x[0-9a-f]{64}$/i.test(identity.pocket) || !Number.isFinite(Date.parse(allocation.expiresAt)) || Date.parse(allocation.expiresAt)<=Date.now())return fail();
  return new Response(JSON.stringify({privateKey:identity.key,pocket:identity.pocket,expiresAt:allocation.expiresAt}),{headers});
 } catch {return fail();}
}
export const config={path:'/__playground/redeem'};
