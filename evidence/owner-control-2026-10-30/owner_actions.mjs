// Appended by reproduce.py to the exact published proof helpers in a private
// generated module. This adds test actions, not a reusable owner wallet.
async function ownerProof(){
 const context=await load('context'),actors=await load('actors');
 const funded=JSON.parse(await fs.readFile(path.join(result,'03-fund-protected-treasury.json'),'utf8'));
 context.ownerFee=point(funded.txHash,1);
 const snapshot=async name=>{
  const policy=await live(context.policy);
  const tx=await rpc('get_transaction',[context.policy.txHash]);
  assert.equal(tx.tx_status.status,'committed');
  const header=await rpc('get_header',[tx.tx_status.block_hash]);
  assert.equal(await rpc('get_block_hash',[header.number]),header.hash);
  const value={policyOutPoint:context.policy,policy,decoded:decode(policy.cell.data.content),
   canonical:{transaction:tx,header},tip:await rpc('get_tip_header')};
  await save(name,value);return value;
 };
 await snapshot('04-before-revoke');
 const P=await live(context.policy),fee=await live(context.ownerFee);
 const revoked=Buffer.from(bytes(P.cell.data.content));revoked[7]&=~1;
 let tx=makeTx([context.policy,context.ownerFee],
  [fromRawOutput(P.cell.output),{capacity:BigInt(fee.cell.output.capacity)-FEE,lock:actors.owner.lock}],
  [hex(revoked),'0x'],context.allDeps,'0x5143413103ff000001',1);
 let signed=await sign(tx,'owner',1,context.kdep);
 const revoke=await commit('05-owner-revoke',signed.tx,signed.signing);
 context.policy=point(revoke.txHash,0);context.ownerFee=point(revoke.txHash,1);
 const after=await snapshot('06-after-revoke');assert.equal(after.decoded.mask,2);
 // Freshly resolved post-revocation input, correct successor counters, valid
 // recipient and fresh signature. This is not a stale-input demonstration.
 const current=await live(context.policy),fund=await live(context.fund),alice=await live(context.seeds.alice);
 const next=Buffer.from(bytes(current.cell.data.content));le128(1n).copy(next,24);le128(1n).copy(next,280);
 tx=makeTx([context.policy,context.seeds.alice,context.fund],
  [fromRawOutput(current.cell.output),fromRawOutput(fund.cell.output),
   {capacity:142n*CKB,lock:actors.aliceRecipient.lock,type:T},
   {capacity:BigInt(alice.cell.output.capacity)-142n*CKB-FEE,lock:actors.alice.lock}],
  [hex(next),hex(le128(199n)),hex(le128(1n)),'0x'],context.allDeps,'0x5143413101000000',1);
 signed=await sign(tx,'alice',1,context.kdep);
 const rejected=await record('07-disabled-delegate-rejected',signed.tx,signed.signing);
 assert.equal(rejected.transaction.inputs[0].previous_output.tx_hash,revoke.txHash);
 try{await rpc('send_transaction',[rejected.transaction,'passthrough']);throw Error('Disabled payment unexpectedly accepted');}
 catch(e){assert(e.rpc);assert.equal(e.rpc.code,-302);assert.match(e.rpc.message,/Inputs\[0\]\.Type/);
  assert(e.rpc.message.includes('by-data-hash/'+H.Q.slice(2)+'.html#17'));rejected.submit={method:'send_transaction',error:e.rpc};}
 rejected.policyAfterRejection=await live(context.policy);rejected.fundAfterRejection=await live(context.fund);
 rejected.actorAfterRejection=await live(context.seeds.alice);
 assert.deepEqual(rejected.policyAfterRejection,current);await save('07-disabled-delegate-rejected',rejected);
 // Positive paired control: same current policy/fund and amount, enabled Ben
 // actor/recipient. Native node dry-run (no broadcast) verifies the complete
 // admitted layout. No disabled bit or contract rule is relaxed.
 const ben=await live(context.seeds.ben),controlState=Buffer.from(bytes(current.cell.data.content));
 le128(1n).copy(controlState,24);le128(1n).copy(controlState,434);
 tx=makeTx([context.policy,context.seeds.ben,context.fund],
  [fromRawOutput(current.cell.output),fromRawOutput(fund.cell.output),
   {capacity:142n*CKB,lock:actors.benRecipient.lock,type:T},
   {capacity:BigInt(ben.cell.output.capacity)-142n*CKB-FEE,lock:actors.ben.lock}],
  [hex(controlState),hex(le128(199n)),hex(le128(1n)),'0x'],context.allDeps,'0x5143413101010000',1);
 signed=await sign(tx,'ben',1,context.kdep);const control=await record('08-enabled-delegate-dry-run',signed.tx,signed.signing);
 control.dryRun=await rpc('dry_run_transaction',[control.transaction]);control.notSubmitted=true;
 await save('08-enabled-delegate-dry-run',control);
 const recover=async(op,name)=>{
  const p=await live(context.policy),f=await live(context.fund),a=await live(context.ownerFee);
  const state=Buffer.from(bytes(p.cell.data.content));if(op===4){state[6]=1;state[7]=0;}
  const amount=read128(bytes(f.cell.data.content),0),capacity=BigInt(f.cell.output.capacity);
  const t=makeTx([context.policy,context.ownerFee,context.fund],
   [fromRawOutput(p.cell.output),{capacity,lock:actors.owner.lock,type:T},
    {capacity:BigInt(a.cell.output.capacity)-FEE,lock:actors.owner.lock}],
   [hex(state),hex(le128(amount)),'0x'],context.allDeps,hex(Buffer.from([81,67,65,49,op,255,0,0])),1);
  const s=await sign(t,'owner',1,context.kdep),e=await commit(name,s.tx,s.signing);
  context.policy=point(e.txHash,0);context.ownerFee=point(e.txHash,2);
  const returned=point(e.txHash,1);await live(returned);return {record:e,returned,amount,capacity};
 };
 const closed=await recover(4,'09-owner-close-recover');
 const closedState=await snapshot('10-after-close');assert.equal(closedState.decoded.phase,1);assert.equal(closedState.decoded.mask,0);
 const recovered=await live(closed.returned),ownerFee=await live(context.ownerFee);
 // Return 50 of the recovered 200 tokens as a normal owner-signed deposit;
 // the first typed input witness stays empty. CLOSED policy is not consumed.
 tx=makeTx([context.ownerFee,closed.returned],
  [{capacity:154n*CKB,lock:context.F,type:T},{capacity:142n*CKB,lock:actors.owner.lock,type:T},
   {capacity:BigInt(ownerFee.cell.output.capacity)+BigInt(recovered.cell.output.capacity)-296n*CKB-FEE,lock:actors.owner.lock}],
  [hex(le128(50n)),hex(le128(150n)),'0x'],[context.kdep,dep(context.deployed.T)],undefined,0);
 signed=await sign(tx,'owner',0,context.kdep);const deposit=await commit('11-late-deposit',signed.tx,signed.signing);
 const retainedOwnerTokens=point(deposit.txHash,1);context.fund=point(deposit.txHash,0);context.ownerFee=point(deposit.txHash,2);
 const policyAfterDeposit=await live(context.policy);assert.deepEqual(policyAfterDeposit,closedState.policy);
 await save('12-after-late-deposit',{policyOutPoint:context.policy,policy:policyAfterDeposit,fund:await live(context.fund)});
 const swept=await recover(5,'13-owner-closed-sweep');
 const final=await snapshot('14-final-node-state');assert.equal(final.decoded.phase,1);assert.equal(final.decoded.mask,0);
 assert.equal(final.policy.cell.data.content,closedState.policy.cell.data.content);
 final.ownerTokenCells=[await live(retainedOwnerTokens),await live(swept.returned)];
 assert.equal(final.ownerTokenCells.reduce((s,v)=>s+read128(bytes(v.cell.data.content),0),0n),200n);
 final.consumedProtectedCells={initial:await rpc('get_live_cell',[outpointJSON(point(funded.txHash,0)),true]),late:await rpc('get_live_cell',[outpointJSON(point(deposit.txHash,0)),true])};
 // This node returns unknown for spent outputs; do not manufacture a dead
 // response. Prove consumption from canonical committed transaction inputs.
 for(const value of Object.values(final.consumedProtectedCells))assert.notEqual(value.status,'live');
 assert.deepEqual(closed.record.transaction.inputs[2].previous_output,outpointJSON(point(funded.txHash,0)));
 assert.deepEqual(swept.record.transaction.inputs[2].previous_output,outpointJSON(point(deposit.txHash,0)));
 final.consumptionProof={initialSpentBy:closed.record.txHash,lateSpentBy:swept.record.txHash,
  method:'Committed canonical transaction inputs consume exact fund outpoints; get_live_cell statuses retained verbatim'};
 final.peers=await rpc('get_peers');assert.equal(final.peers.length,0);
 await save('14-final-node-state',final);
 const operations=[revoke,closed.record,deposit,swept.record];
 await save('owner-proof-summary',{verdict:'NEW OWNER-CONTROL PROOF PASSED',
  revocation:{maskBefore:3,maskAfter:2,txHash:revoke.txHash},disabledPayment:{txHash:rejected.txHash,error:17,latestPolicyInput:true,submitted:true,feeCharged:0},
  closure:{tokensReturned:closed.amount,capacityReturnedShannons:closed.capacity,txHash:closed.record.txHash},
  lateDeposit:{tokens:50,capacityShannons:154n*CKB,source:'50 of the recovered 200 tokens, not newly minted value',txHash:deposit.txHash},
  closedSweep:{tokensReturned:swept.amount,capacityReturnedShannons:swept.capacity,txHash:swept.record.txHash},
  final:{ownerTokens:200,ownerTokenCellCapacityShannons:296n*CKB,protectedTokens:0,phase:1,mask:0,used:0,
   retainedPolicyCapacityShannons:600n*CKB,occupiedPolicyCapacityShannons:572n*CKB,unreclaimablePolicySlackShannons:28n*CKB},
  fees:operations.map(e=>({name:e.name,shannons:e.feeShannon,bytes:e.bytes,cycles:e.dryRun.cycles})),
  ownerOperationFeesShannons:operations.reduce((s,e)=>s+BigInt(e.feeShannon),0n),
  caveat:'Returned treasury capacity stays in owner-controlled token Cells; this is custody recovery, not a transfer to freely spendable untyped CKB. The whole 600-CKB CLOSED policy remains retained.'});
 console.log('NEW OWNER-CONTROL PROOF PASSED: revoke committed; latest-state payment rejected Q17; recover200/154CKB; late50 sweep/154CKB; policy600 retained.');
}
await fs.mkdir(result,{recursive:true});
try{if(mode==='keys')await keys();else if(mode==='setup')await setup();else if(mode==='owner-proof')await ownerProof();else throw Error('Unknown WO10 mode');}
catch(e){console.error(e.stack??String(e));process.exitCode=1;}
