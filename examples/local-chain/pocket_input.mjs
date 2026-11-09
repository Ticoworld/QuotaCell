import * as c from '@ckb-ccc/core';
const K='0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
export function parseCkb(value){
 if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/.test(value))throw Error('Enter a CKB amount with at most 8 decimal places');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
}
export async function recipientArgs(value,client){
 if(/^0x[0-9a-f]{40}$/i.test(value))return value.toLowerCase(); // Existing development interface.
 if(typeof value!=='string'||!value.startsWith('ckt1'))throw Error('Expected a CKB testnet address');
 const address=await c.Address.fromString(value,client);
 if(address.prefix!=='ckt')throw Error('Expected a CKB testnet address');
 const lock=address.script;
 if(lock.codeHash!==K||lock.hashType!=='type'||!/^0x[0-9a-f]{40}$/i.test(lock.args))throw Error('Unsupported recipient lock');
 return lock.args.toLowerCase();
}
