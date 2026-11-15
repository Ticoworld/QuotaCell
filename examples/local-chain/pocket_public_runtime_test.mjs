import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPublicRuntime} from './pocket_public_runtime.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';

const parent=await fs.mkdtemp(path.join(os.tmpdir(),'quotacell-public-runtime-')),run=path.join(parent,'fresh');
try{
 await createPublicRuntime(run);
 const files=await fs.readdir(run);assert.deepEqual(files.sort(),['deployment.json','evidence','runtime.json']);
 const deployment=JSON.parse(await fs.readFile(path.join(run,'deployment.json'),'utf8'));
 const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
 const profile=JSON.parse(await fs.readFile(path.join(run,'evidence','node-profile.json'),'utf8'));
 assert.equal(deployment.genesis,PUDGE_GENESIS);assert.match(runtime.url,/^https:\/\//);assert.equal(profile.genesisHeader.hash,PUDGE_GENESIS);
 for(const name of ['pocket.json','working-pocket.sqlite','keys','actors.json','context.json'])assert.equal(await fs.access(path.join(run,name)).then(()=>true,()=>false),false,`${name} must not be required or copied`);
 await assert.rejects(createPublicRuntime(run),/already exists|EEXIST/i);
 await assert.rejects(createPublicRuntime(path.join(parent,'bad'),'http://127.0.0.1:8114'),/HTTPS/);
 console.log('Fresh public Pudge runtime uses only committed deployment identity and has no Pocket descriptor, journal or credentials');
}finally{await fs.rm(parent,{recursive:true,force:true});}
