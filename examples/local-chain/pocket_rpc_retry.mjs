const retryableReads=new Set(['get_consensus','get_block_hash','get_tip_header','get_indexer_tip','get_fee_rate_statistics','get_live_cell','get_transaction','get_header','get_cells']);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function callRpc(method,request){
 const attempts=retryableReads.has(method)?2:1;
 for(let attempt=1;attempt<=attempts;attempt++){
  try{return await request();}
  catch(error){
   if(error.retryable===false||attempt===attempts){const wrapped=new Error(`${method} RPC failed: ${error.message}`,{cause:error});if(error.rpc)wrapped.rpc=error.rpc;throw wrapped;}
   await delay(250);
  }
 }
}
