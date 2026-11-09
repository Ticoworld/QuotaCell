import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCancellation} from './wo15e_cancellation_validation.mjs';
import {PUDGE_GENESIS} from './pocket_network.mjs';

const review=JSON.parse(await readFile(new URL('./wo15e-cancellation-test-fixture.json',import.meta.url)));
const key='0x0249ee3b9ddf23bc4f0ad9655151aaf66ad04110381e992d0742df1f54f231edca';
const rpc=(changes={})=>async(method)=>({get_consensus:{id:'ckb_testnet'},get_block_hash:PUDGE_GENESIS,get_transaction:{tx_status:{status:'unknown'}},get_live_cell:{status:'live',cell:{output:{capacity:'0x9184d9e8720',lock:{code_hash:review.ownerLock.codeHash,hash_type:review.ownerLock.hashType,args:review.ownerLock.args},type:null},data:{content:'0x'}}},...changes})[method];
const check=(rpcs=[rpc(),rpc()],transaction=review.unsignedTransaction,publicKey=key)=>validateCancellation({transaction,publicKey,rpcs});
test('accepts exact review with both independent live checks',async()=>assert.equal((await check()).tx.hash(),review.transactionHash));
test('rejects wrong genesis',async()=>assert.rejects(check([rpc(),rpc({get_block_hash:'0x00'})])));
test('rejects pending original',async()=>assert.rejects(check([rpc(),rpc({get_transaction:{tx_status:{status:'pending'}}})])));
test('rejects spent input',async()=>assert.rejects(check([rpc({get_live_cell:{status:'dead'}}),rpc()])));
test('rejects changed transaction',async()=>assert.rejects(check([rpc(),rpc()],review.unsignedTransaction.slice(0,-2)+'01')));
test('rejects wrong owner',async()=>assert.rejects(check([rpc(),rpc()],review.unsignedTransaction,'0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')));
test('fails closed on RPC timeout',async()=>assert.rejects(check([rpc(),async()=>{throw Error('RPC timeout');}]),/RPC timeout/));
