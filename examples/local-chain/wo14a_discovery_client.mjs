// Fresh process receives only public configuration and a local RPC URL on stdin.
import readline from 'node:readline';
import {discoverPolicy} from './pocket_discovery.mjs';
const rl=readline.createInterface({input:process.stdin});
for await(const line of rl){
 try{const {url,policy,expected}=JSON.parse(line);if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw Error('Only isolated local node URLs are allowed');let id=0;const rpc=async(method,params=[])=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(result.error)throw Error(JSON.stringify(result.error));return result.result;};console.log(JSON.stringify({result:await discoverPolicy({rpc,policy,expected})}));}catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1;}break;
}
