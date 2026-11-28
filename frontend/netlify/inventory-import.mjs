import {validIdentity} from './playground-inventory.mjs';

export async function importInventory(inventory,store){
 if(!inventory || typeof inventory!=='object' || Array.isArray(inventory))throw new Error('Invalid local inventory.');
 const entries=Object.entries(inventory);
 if(!entries.length || entries.some(([id,value])=>!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!validIdentity(value)))throw new Error('Invalid inventory record.');
 for(const [id,value] of entries){
  const record={key:value.key,pocket:value.pocket};
  const result=await store.setJSON(id,record,{onlyIfNew:true});
  if(!result.modified){
   const old=await store.get(id,{type:'json',consistency:'strong'});
   if(!old || old.key!==record.key || old.pocket!==record.pocket)throw new Error(`Conflicting immutable resource: ${id}`);
  }
 }
 return entries.map(([id])=>id);
}
