// Export synthetic local-chain evidence. Never include the run directory or keys.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=path.resolve(process.argv[2]||''),output=path.resolve(process.argv[3]||'');
assert(process.argv[2]&&process.argv[3]);
const runtime=JSON.parse(await fs.readFile(path.join(run,'runtime.json'),'utf8'));
const profile=JSON.parse(await fs.readFile(path.join(run,'evidence/node-profile.json'),'utf8'));
assert.match(runtime.url,/^http:\/\/127\.0\.0\.1:\d+$/);
async function rpc(method,params=[]){const r=await fetch(runtime.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const x=await r.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result;}
assert.equal((await rpc('get_consensus')).id,'ckb_dev');assert.equal(await rpc('get_block_hash',['0x0']),profile.genesisHeader.hash);
const db=new DatabaseSync(path.join(run,'working-pocket.sqlite'),{readOnly:true});
const intents=db.prepare('SELECT id,genesis,pocket,actor,recipient,amount,tx_hash,signed,state,created,operation FROM intents ORDER BY rowid').all();
const records=[];
for(const row of intents){const transaction=await rpc('get_transaction',[row.tx_hash]);assert.equal(transaction?.tx_status?.status,'committed');const header=await rpc('get_header',[transaction.tx_status.block_hash]);assert.equal(await rpc('get_block_hash',[header.number]),header.hash);assert.equal(transaction.transaction.hash,row.tx_hash);records.push({...row,signed:JSON.parse(row.signed),nodeStatus:transaction.tx_status,blockHeader:header});}
db.close();await fs.writeFile(output,JSON.stringify({scope:'Synthetic local dev chain; no audit or public network claim',genesis:profile.genesisHeader.hash,records},null,2)+'\n',{flag:'wx'});console.log('Captured',records.length,'canonical transactions');
