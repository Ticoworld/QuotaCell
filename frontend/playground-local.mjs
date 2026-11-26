import {readFile} from 'node:fs/promises';

// Development-only receiver. It never logs tickets, credentials or keys.
export function localPlaygroundReceiver() {
 return {name:'local-playground-receiver',apply:'serve',configureServer(server){
  if(process.env.QUOTACELL_PLAYGROUND_LOCAL!=='1')return;
  const issuer=process.env.QUOTACELL_PLAYGROUND_ISSUER;
  const secret=process.env.QUOTACELL_PLAYGROUND_SECRET;
  const file=process.env.QUOTACELL_PLAYGROUND_IDENTITIES;
  const appOrigin=process.env.QUOTACELL_PLAYGROUND_ORIGIN;
  const applicationId=process.env.QUOTACELL_PLAYGROUND_APPLICATION_ID || 'legacy';
  if(!issuer || !secret || secret.length<32 || !file || !/^http:\/\/127\.0\.0\.1:\d+$/.test(appOrigin || '') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(issuer))throw new Error('Local Playground configuration is invalid.');
  server.middlewares.use('/__playground/redeem',async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
   try {
    if(req.method!=='POST'||req.headers.origin!==appOrigin||req.headers['content-type']!=='application/json')throw new Error('unavailable');
    let body='';for await(const part of req){body+=part;if(body.length>512)throw new Error('unavailable');}
    const input=JSON.parse(body);if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))throw new Error('unavailable');
    const response=await fetch(`${issuer}/api/playground/redeem`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify({token:input.token,applicationId})});
    if(!response.ok)throw new Error('unavailable');
    const allocation=await response.json();
    const identities=JSON.parse(await readFile(file,'utf8'));
    const identity=identities[allocation.resourceId];
    if(!identity || !/^0x[0-9a-f]{64}$/i.test(identity.key)||!/^0x[0-9a-f]{64}$/i.test(identity.pocket)||Date.parse(allocation.expiresAt)<=Date.now())throw new Error('unavailable');
    res.statusCode=200;res.end(JSON.stringify({privateKey:identity.key,pocket:identity.pocket,expiresAt:allocation.expiresAt}));
   }catch{res.statusCode=404;res.end('{}');}
  });
 }};
}
