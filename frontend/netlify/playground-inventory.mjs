import {getStore} from '@netlify/blobs';

// The site-wide store is shared across deploys; never open it in preview contexts.
export function inventoryStore(context) {
 if (context?.deploy?.context !== 'production' || context.deploy.published !== true || context?.site?.id !== '9c6caa64-65d2-492f-bc6c-15edf1357ac2' || context.site.url !== process.env.QUOTACELL_PLAYGROUND_ORIGIN) throw new Error('Inventory unavailable');
 return getStore({name:'playground-identities',consistency:'strong'});
}
export function validIdentity(value) {
 return value && typeof value==='object' && /^0x[0-9a-f]{64}$/i.test(value.key) && /^0x[0-9a-f]{64}$/i.test(value.pocket);
}
export function legacyMatches(resourceId,identity) {
 try {
  const first=JSON.parse(process.env.QUOTACELL_PLAYGROUND_IDENTITIES || '{}');
  const second=JSON.parse(process.env.QUOTACELL_PLAYGROUND_IDENTITY_INVENTORY || '{}');
  if(!first || typeof first!=='object' || Array.isArray(first) || !second || typeof second!=='object' || Array.isArray(second))return false;
  if(Object.hasOwn(first,resourceId) && Object.hasOwn(second,resourceId))return false;
  const legacy=first[resourceId] ?? second[resourceId];
  return !legacy || (legacy.key===identity.key && legacy.pocket===identity.pocket);
 } catch {return false;}
}
export async function readIdentity(resourceId,context,store=inventoryStore(context)) {
 if(typeof resourceId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(resourceId)) return null;
 const identity=await store.get(resourceId,{type:'json',consistency:'strong'});
 return validIdentity(identity)?identity:null;
}
