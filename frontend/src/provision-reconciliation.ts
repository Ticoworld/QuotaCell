export type RecordedTransaction={hash:string;signed:string};

// Only a previously persisted transaction may be submitted during recovery.
export async function reconcileRecordedTransaction<T>(intent:RecordedTransaction,adapter:{hash(bytes:string):string;lookup(hash:string):Promise<unknown>;send(bytes:string):Promise<string>;wait(hash:string):Promise<T>}) {
 if(adapter.hash(intent.signed)!==intent.hash)throw new Error('Saved transaction identity is invalid.');
 const observed=await adapter.lookup(intent.hash);
 if(!observed){
  try {await adapter.send(intent.signed);} catch { /* The original may already be in the pool. */ }
 }
 return adapter.wait(intent.hash);
}
