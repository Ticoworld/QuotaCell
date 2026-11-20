import assert from 'node:assert/strict';
import { createECDH, createHash } from 'node:crypto';
import * as c from '@ckb-ccc/core';
import { assertUniqueRegistrationIdentities, createRegistrationInvitation, createRegistrationProfile, exportLegacyRegistrationJson, importRegistrationProfile, importRegistrationResponse, parseRegistrationInvitation } from './registration.ts';

globalThis.window = { location: { href: 'https://quotacell.example/app?register=1', pathname: '/app' } };

function identityFrom(seed) {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(seed.padStart(64, '0'), 'hex'));
  const publicKey = `0x${ecdh.getPublicKey(null, 'compressed').toString('hex')}`;
  const args = c.hashCkb(Buffer.from(publicKey.slice(2), 'hex')).slice(0, 42);
  const lock = c.Script.from({ codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args });
  const client = new c.ClientPublicTestnet({ url: 'https://testnet.ckb.dev', fallbacks: [] });
  return { publicKey, address: c.Address.fromScript(lock, client).toString() };
}

function rewriteCodeByte(code, prefix, offset, value) {
  const bytes = Buffer.from(code.slice(prefix.length), 'base64url');
  bytes[offset] = value;
  const payload = bytes.subarray(0, -4);
  const checksum = createHash('sha256').update(Buffer.concat([Buffer.from(`QuotaCell ${prefix}\0`), payload])).digest().subarray(0, 4);
  return `${prefix}${Buffer.concat([payload, checksum]).toString('base64url')}`;
}

const one = identityFrom('01');
const two = identityFrom('02');
const invite = await createRegistrationInvitation('delegate2');
const parsedInvite = await parseRegistrationInvitation(invite.code);
assert.equal(parsedInvite.requestId, invite.requestId);
assert.equal(parsedInvite.slot, 'delegate2');
await assert.rejects(parseRegistrationInvitation(rewriteCodeByte(invite.code, 'QCI1.', 1, 2)), /version or network/);

const code = await createRegistrationProfile(two, invite);
assert.match(code, /^QCR1\.[A-Za-z0-9_-]+$/);
const imported = await importRegistrationResponse(code, invite);
assert.deepEqual(imported.identity, two);
assert.equal(imported.slot, 'delegate2');
await assert.rejects(importRegistrationResponse(rewriteCodeByte(code, 'QCR1.', 1, 2)), /version or network/);
await assert.rejects(importRegistrationResponse(code, { ...invite, slot: 'delegate1' }), /does not match this invitation/);
const encoded = Buffer.from(code.slice('QCR1.'.length), 'base64url');
encoded[encoded.length - 1] ^= 1;
await assert.rejects(importRegistrationResponse(`QCR1.${encoded.toString('base64url')}`), /checksum/i);
const base64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const body = code.slice('QCR1.'.length), last = base64url.indexOf(body.at(-1));
if (body.length % 4 === 2 || body.length % 4 === 3) {
  const noncanonical = `${body.slice(0, -1)}${base64url[last | 1]}`;
  await assert.rejects(importRegistrationResponse(`QCR1.${noncanonical}`), /Malformed/i);
}
await assert.rejects(createRegistrationProfile({ ...one, address: two.address }), /does not match/);
await assert.rejects(createRegistrationProfile({ ...two, address: two.address.replace(/^ckt/, 'ckb') }), /testnet|address format/i);
assertUniqueRegistrationIdentities([one, two, null]);
assert.throws(() => assertUniqueRegistrationIdentities([one, one, two]), /different wallet/);
await assert.rejects(importRegistrationResponse('QCR1.abc'), /Malformed|truncated/);
await assert.rejects(parseRegistrationInvitation('QCI1.abc'), /Malformed|truncated/);

const standalone = await createRegistrationProfile(one);
assert.equal((await importRegistrationResponse(standalone)).requestId, null);
const responseLink = `https://quotacell.example/app?register=1#response=${encodeURIComponent(code)}`;
assert.deepEqual((await importRegistrationResponse(responseLink)).identity, two);

const legacy = exportLegacyRegistrationJson(one);
assert.deepEqual((await importRegistrationProfile(legacy)).identity, one);
await assert.rejects(importRegistrationProfile(JSON.stringify({ ...JSON.parse(legacy), seedPhrase: 'not allowed' })), /format or network/);
await assert.rejects(importRegistrationProfile(JSON.stringify({ ...JSON.parse(legacy), network: 'ckb_mainnet' })), /format or network/);
console.log('QCR1 responses and QCI1 invitations validate offline, bind network/slot/request, reject malformed or mismatched identities, and preserve advanced JSON compatibility');
