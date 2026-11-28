import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {getStore} from '@netlify/blobs';
import {importInventory} from './netlify/inventory-import.mjs';

// Authentication and the private file path are supplied through the process
// environment, never as command-line values or output.
async function main(){
 const {NETLIFY_AUTH_TOKEN:token,NETLIFY_SITE_ID:siteID,PG03B_SCENARIO_DIR:dir}=process.env;
 if(!token||!siteID||!dir)throw new Error('Set NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID and PG03B_SCENARIO_DIR in the local environment.');
 const siteResponse=await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteID)}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
 if(!siteResponse.ok)throw new Error('Could not verify the Netlify site.');
 const site=await siteResponse.json();
 if(site.url!=='https://trycove-quotacell-playground.netlify.app' && site.ssl_url!=='https://trycove-quotacell-playground.netlify.app')throw new Error('The selected site is not the dedicated Playground.');
 if(site.build_settings?.stop_builds!==true)throw new Error('Automatic builds must be stopped before importing identities.');
 const inventory=JSON.parse(await readFile(join(dir,'inventory.json'),'utf8'));
 const store=getStore({name:'playground-identities',siteID,token,consistency:'strong'});
 const resourceIds=await importInventory(inventory,store);
 console.log(JSON.stringify({imported:resourceIds.length,resourceIds}));
}
main().catch(()=>{console.error('Inventory import failed; verify the site, credentials, file, and immutable records.');process.exitCode=1});
