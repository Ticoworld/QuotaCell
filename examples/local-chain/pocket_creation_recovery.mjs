export async function submitDurableCreation({persistIntent,dryRun,submit,checkpoint=async()=>{}}){
 await persistIntent();
 await checkpoint('after-intent');
 try{
  await checkpoint('before-dry-run');
  await dryRun();
  await checkpoint('after-dry-run');
 }catch(error){return {state:'uncertain',phase:'dry-run',error:error.message};}
 try{
  await checkpoint('before-submit');
  const result=await submit();
  await checkpoint('after-submit');
  return result;
 }catch(error){return {state:'uncertain',phase:'submit',error:error.message};}
}

export async function recoverCreation({item,observe,writeDescriptor,descriptorMatches=()=>true,operationInProgress=false}){
 if(operationInProgress)return {ready:false,outcome:{state:item.state,reason:'Creation operation is still in progress'}};
 let outcome=await observe(item);
 if(outcome.state!=='committed')return {ready:false,outcome};
 let recovery=null;
 try{recovery=item.recovery_json?JSON.parse(item.recovery_json):null;}catch{}
 if(!recovery)return {ready:false,outcome:{...outcome,state:'recovery-required',reason:'Committed creation has no recovery payload'}};
 if(!descriptorMatches(recovery))return {ready:false,outcome:{...outcome,state:'recovery-required',reason:'Pocket descriptor conflicts with durable creation intent'}};
 await writeDescriptor(recovery);
 return {ready:true,outcome,recovery};
}
