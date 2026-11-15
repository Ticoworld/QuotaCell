import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import * as c from '@ckb-ccc/core';
import { createRegistrationProfile, importRegistrationProfile } from './registration.ts';

globalThis.window = { location: { origin: 'http://127.0.0.1:4173' } };
const ecdh=createECDH('secp256k1');ecdh.setPrivateKey(Buffer.from('01'.padStart(64,'0'),'hex'));
const publicKey='0x'+ecdh.getPublicKey(null,'compressed').toString('hex');
const lock=c.Script.from({codeHash:'0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',hashType:'type',args:c.hashCkb(Buffer.from(publicKey.slice(2),'hex')).slice(0,42)});
const client=new c.ClientPublicTestnet({url:'http://127.0.0.1:4173/api/ckb',fallbacks:[]});
const address=c.Address.fromScript(lock,client).toString();
const profile=await createRegistrationProfile({publicKey,address});
assert.deepEqual(await importRegistrationProfile(JSON.stringify(profile)),{publicKey,address});
await assert.rejects(importRegistrationProfile(JSON.stringify({...profile,network:'ckb_mainnet'})),/format or network/);
await assert.rejects(importRegistrationProfile(JSON.stringify({...profile,lock:{...profile.lock,args:'0x'+'00'.repeat(20)}})),/lock does not match/);
await assert.rejects(importRegistrationProfile(JSON.stringify({...profile,seedPhrase:'not allowed'})),/format or network/);
await assert.rejects(importRegistrationProfile(JSON.stringify({...profile,address:'ckb1invalid'})),/address/i);
console.log('Registration profiles round-trip on testnet and reject wrong networks, keys, extra secret fields and addresses');
