import {timingSafeEqual} from 'node:crypto';
import {readIdentity,legacyMatches} from '../playground-inventory.mjs';

export function createHandler(read=readIdentity) { return async function handler(request,context) {
 const fail=()=>new Response('{}',{status:404,headers:{'cache-control':'no-store','content-type':'application/json'}});
 try {
  const secret=process.env.QUOTACELL_PLAYGROUND_SECRET;
  const given=request.headers.get('authorization')?.replace(/^Bearer /,'') ?? '';
  if(!secret || secret.length<32 || given.length!==secret.length || !timingSafeEqual(Buffer.from(given),Buffer.from(secret))) return fail();
  if(request.method!=='POST' || request.headers.get('content-type')!=='application/json' || Number(request.headers.get('content-length')||0)>512) return fail();
  const body=await request.text(); if(body.length>512)return fail();
  const {applicationId,resourceId}=JSON.parse(body);
  if(applicationId!==process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID)return fail();
  const identity=await read(resourceId,context);
  if(!identity || !legacyMatches(resourceId,identity))return fail();
  return Response.json({applicationId,resourceId,ready:true},{headers:{'cache-control':'no-store'}});
 } catch {return fail();}
}; }
export default createHandler();
export const config={path:'/__playground/readiness'};
