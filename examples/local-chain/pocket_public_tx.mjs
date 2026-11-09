// Never resubmit or replace a transaction. RPC failures remain uncertain.
export async function observePublicTransaction({rpc,hash,signed,priorState}){
 try{
  const tx=await rpc('get_transaction',[hash]);const status=tx?.tx_status?.status||'unknown';
  if(status==='committed'){
   const header=await rpc('get_header',[tx.tx_status.block_hash]);
   if(!header||await rpc('get_block_hash',[header.number])!==header.hash)return {state:'uncertain',reason:'Noncanonical commit or reorganization'};
   return {state:'committed',blockHash:header.hash,blockNumber:header.number};
  }
  if(status==='pending'||status==='proposed')return {state:'pending'};
  if(status==='rejected')return {state:'rejected',reason:tx.tx_status.reason||'Node rejected transaction'};
  if(priorState==='committed')return {state:'uncertain',reason:'Previously committed transaction is no longer canonical'};
  for(const input of signed.inputs){const live=await rpc('get_live_cell',[input.previous_output,false]);if(live.status!=='live')return {state:'conflicting',reason:'An input is no longer live; transaction outcome is unconfirmed'};}
  return {state:'uncertain',reason:'Transaction not found'};
 }catch(e){return {state:'uncertain',reason:e.message};}
}
export async function submitPublicTransaction({rpc,hash,signed,enabled}){
 if(enabled!==true)throw Error('Pudge broadcast is not explicitly enabled');
 try{const accepted=await rpc('send_transaction',[signed]);if(accepted!==hash)return {state:'uncertain',reason:'Node returned a different transaction hash'};return {state:'submitted'};}
 catch(e){return {state:'uncertain',reason:e.message};}
}
