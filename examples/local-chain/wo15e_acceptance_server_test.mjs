import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const app=spawn(process.execPath,['--experimental-strip-types',new URL('./wo15e_wallet_acceptance_server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],{env:{...process.env,QUOTACELL_ACCEPT_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';app.stderr.on('data',b=>errors+=b);
const base=`http://127.0.0.1:${port}`;let response;
try{
 for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(errors);try{response=await fetch(base+'/');if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(response?.ok,errors);const html=await response.text();assert.match(html,/Complete prepared transaction/);assert.match(html,/never broadcasts/);assert.match(await (await fetch(base+'/wallet.js')).text(),/signOnlyTransaction/);
 const post=async(path,body,origin=base)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 assert.equal((await post('/api/ckb',{method:'send_transaction'})).status,400);
 assert.equal((await post('/api/verify',{token:'no-request'})).status,400);
 assert.equal((await post('/api/prepare',{operation:'deployment',publicKey:'bad'})).status,400);
 const evidence=JSON.parse(await fs.readFile(new URL('../../evidence/working-pocket-local/transactions.json',import.meta.url),'utf8'));const blocked=await post('/api/prepare',{operation:'deployment',publicKey:evidence.records[0].actor});assert.equal(blocked.status,400);assert.match(blocked.data.error,/verified sign-only check/);
 assert.equal((await post('/api/prepare',{},'https://invalid.example')).status,400);
 assert.equal((await post('/api/submit',{})).status,400);
 console.log('PASS sign-only server routing, review screen, origin and broadcast denial; no wallet provider used');
}finally{app.kill();}
