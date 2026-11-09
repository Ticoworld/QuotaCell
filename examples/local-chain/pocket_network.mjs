import assert from 'node:assert/strict';
export const PUDGE_GENESIS='0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
export async function verifyNetwork({mode,url,rpc,expectedGenesis,developmentSigner}){
 assert(['isolated','pudge-readonly'].includes(mode),'Select isolated or pudge-readonly profile');
 if(mode==='isolated'){
  assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/,'Isolated RPC must be loopback');
  assert.equal((await rpc('get_consensus')).id,'ckb_dev','Only isolated CKB dev chains are allowed');
  assert.equal(await rpc('get_block_hash',['0x0']),expectedGenesis,'Unexpected genesis');
  await rpc('set_network_active',[false]);assert.equal((await rpc('get_peers')).length,0,'Node must have no peers');
 }else{
  assert(!developmentSigner,'Development signer is forbidden on Pudge');
  assert.match(url,/^https:\/\/[^/]+\/?$/,'Pudge requires an HTTPS RPC origin');
  assert.equal((await rpc('get_consensus')).id,'ckb_testnet','Not CKB testnet');
  assert.equal(await rpc('get_block_hash',['0x0']),PUDGE_GENESIS,'Not Pudge genesis');
  assert.equal(expectedGenesis,PUDGE_GENESIS,'Profile genesis mismatch');
 }
}
