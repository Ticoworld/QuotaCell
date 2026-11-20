// Create a fresh public-only Pudge runtime. It never copies owner-local files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUDGE_GENESIS} from './pocket_network.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export async function createPublicRuntime(directory,url='https://testnet.ckb.dev/'){
 assert.match(url,/^https:\/\/[^/]+\/?$/,'Pudge runtime requires one HTTPS RPC origin');
 const target=path.resolve(directory);assert(directory&&target!==path.parse(target).root,'Select a dedicated runtime directory');
 await fs.mkdir(target,{recursive:false});
 try{
  const deployment=JSON.parse(await fs.readFile(path.join(here,'../../evidence/wo15/pudge-deployment.json'),'utf8'));
  assert.equal(deployment.network,'pudge');assert.equal(deployment.genesis,PUDGE_GENESIS);assert(deployment.deployed&&deployment.kdep&&Array.isArray(deployment.allDeps));
  await fs.mkdir(path.join(target,'evidence'));
  await fs.writeFile(path.join(target,'runtime.json'),JSON.stringify({url},null,2));
  await fs.writeFile(path.join(target,'deployment.json'),JSON.stringify(deployment,null,2));
  await fs.writeFile(path.join(target,'evidence','node-profile.json'),JSON.stringify({genesisHeader:{hash:PUDGE_GENESIS}},null,2));
  return target;
 }catch(error){
  await fs.rm(target,{recursive:true,force:true});throw error;
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [, ,directory,url]=process.argv;
 try{assert(directory,'Usage: node pocket_public_runtime.mjs <new-runtime-directory> [https-rpc-url]');const created=await createPublicRuntime(directory,url);console.log(`Created public-only Pudge runtime at ${created}`);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
