import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as c from '@ckb-ccc/core';
import { addressPayloadFromString, AddressFormat } from '@ckb-ccc/core/advanced';
import type { WalletIdentity } from './domain';

const CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const HASH_TYPE = 1;
const TESTNET = 1;
const RESPONSE_PREFIX = 'QCR1.';
const INVITATION_PREFIX = 'QCI1.';
const MAX_ADDRESS_BYTES = 128;
const zeroRequest = new Uint8Array(16);

// QCR1 = "QCR1." + unpadded base64url(payload || checksum). Payload bytes are
// version:u8, network:u8, slot:u8, requestId:16, addressLength:u16be,
// address:utf8, compressedKey:33, lockCodeHash:32, hashType:u8, lockArgs:20.
// QCI1 uses version:u8, network:u8, slot:u8, requestId:16. Both append the
// first four SHA-256 bytes of "QuotaCell <prefix>\0" || payload.

export type InviteSlot = 'delegate1' | 'delegate2';
export type RegistrationInvitation = { requestId: string; network: 'ckb_testnet'; slot: InviteSlot; code: string };
export type RegistrationResponse = { identity: WalletIdentity; requestId: string | null; slot: InviteSlot | null; code: string };

export function assertUniqueRegistrationIdentities(identities: Array<WalletIdentity | null | undefined>) {
  const keys = identities.flatMap((identity) => identity?.publicKey ? [identity.publicKey.toLowerCase()] : []);
  if (new Set(keys).size !== keys.length) throw new Error('Each participant must use a different wallet.');
}

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hexBytes(value: string) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) throw new Error('Malformed registration code.');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (toBase64Url(bytes) !== value) throw new Error('Malformed registration code.');
  return bytes;
}

async function checksum(prefix: string, payload: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(new TextEncoder().encode(`QuotaCell ${prefix}\0`), payload)));
  return digest.slice(0, 4);
}

async function encode(prefix: string, payload: Uint8Array) {
  return `${prefix}${toBase64Url(concat(payload, await checksum(prefix, payload)))}`;
}

async function decode(code: string, prefix: string, minimumLength: number) {
  const value = code.trim();
  if (!value.startsWith(prefix)) throw new Error('Unsupported registration code version.');
  const bytes = fromBase64Url(value.slice(prefix.length));
  if (bytes.length < minimumLength + 4) throw new Error('Registration code is truncated.');
  const payload = bytes.slice(0, -4), actual = bytes.slice(-4), expected = await checksum(prefix, payload);
  if (!sameBytes(actual, expected)) throw new Error('Registration code checksum does not match.');
  if (payload[0] !== 1 || payload[1] !== TESTNET) throw new Error('Registration code uses an unsupported version or network.');
  return payload;
}

function requestBytes(requestId: string) {
  if (!/^[0-9a-f]{32}$/i.test(requestId)) throw new Error('Invalid invitation request ID.');
  return hexBytes(requestId);
}

function decodeAddress(address: string) {
  if (!/^ckt1/i.test(address)) throw new Error('Registration address must be a CKB testnet address.');
  const parsed = addressPayloadFromString(address);
  if (parsed.prefix !== 'ckt') throw new Error('Registration address must be a CKB testnet address.');
  const payload = Uint8Array.from(parsed.payload);
  if (parsed.format === AddressFormat.Short) {
    if (payload.length !== 21 || payload[0] !== 1) throw new Error('Registration address must use the standard secp256k1 lock.');
    return payload.slice(1);
  }
  if (parsed.format === AddressFormat.Full) {
    if (payload.length !== 53 || payload[32] !== HASH_TYPE || !sameBytes(payload.slice(0, 32), hexBytes(CODE_HASH.slice(2)))) throw new Error('Registration address must use the standard secp256k1 lock.');
    return payload.slice(33);
  }
  throw new Error('Registration address format is unsupported.');
}

export async function createRegistrationProfile(identity: WalletIdentity, invitation?: RegistrationInvitation): Promise<string> {
  const bytes = c.bytesFrom(identity.publicKey);
  if (bytes.length !== 33 || !/^0x0[23][0-9a-f]{64}$/i.test(identity.publicKey)) throw new Error('Invalid compressed secp256k1 public key.');
  secp256k1.Point.fromBytes(bytes);
  const args = c.hashCkb(bytes).slice(0, 42);
  if (!sameBytes(decodeAddress(identity.address), hexBytes(args.slice(2)))) throw new Error('Address does not match the public key lock.');
  const address = new TextEncoder().encode(identity.address);
  if (!address.length || address.length > MAX_ADDRESS_BYTES) throw new Error('Registration address is too long.');
  const slot = invitation?.slot === 'delegate1' ? 1 : invitation?.slot === 'delegate2' ? 2 : 0;
  const request = invitation ? requestBytes(invitation.requestId) : zeroRequest;
  const size = new Uint8Array([address.length >> 8, address.length & 255]);
  const payload = concat(
    new Uint8Array([1, TESTNET, slot]), request, size, address, bytes,
    hexBytes(CODE_HASH.slice(2)), new Uint8Array([HASH_TYPE]), hexBytes(args.slice(2)),
  );
  return encode(RESPONSE_PREFIX, payload);
}

export async function createRegistrationInvitation(slot: InviteSlot): Promise<RegistrationInvitation> {
  const id = crypto.getRandomValues(new Uint8Array(16));
  const requestId = Array.from(id, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const payload = concat(new Uint8Array([1, TESTNET, slot === 'delegate1' ? 1 : 2]), id);
  return { requestId, network: 'ckb_testnet', slot, code: await encode(INVITATION_PREFIX, payload) };
}

export async function parseRegistrationInvitation(code: string): Promise<RegistrationInvitation> {
  const payload = await decode(code, INVITATION_PREFIX, 19);
  if (payload.length !== 19 || (payload[2] !== 1 && payload[2] !== 2)) throw new Error('Invitation must identify Delegate 1 or Delegate 2.');
  const requestId = Array.from(payload.slice(3), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { requestId, network: 'ckb_testnet', slot: payload[2] === 1 ? 'delegate1' : 'delegate2', code: code.trim() };
}

function registrationCodeFromInput(text: string) {
  const value = text.trim();
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.slice(1));
    const query = url.searchParams.get('response') || hash.get('response') || hash.get('registration');
    if (query) return decodeURIComponent(query);
  }
  return value;
}

export async function importRegistrationResponse(text: string, expectedInvitation?: RegistrationInvitation): Promise<RegistrationResponse> {
  const value = registrationCodeFromInput(text);
  if (value.length > 4096) throw new Error('Registration response is too large.');
  const payload = await decode(value, RESPONSE_PREFIX, 3 + 16 + 2 + 1 + 33 + 53);
  if (payload.length < 3 + 16 + 2 + 1 + 33 + 53) throw new Error('Registration response is truncated.');
  const slotByte = payload[2], request = payload.slice(3, 19);
  const addressLength = (payload[19] << 8) | payload[20];
  const expectedLength = 21 + addressLength + 33 + 53;
  if (addressLength < 1 || addressLength > MAX_ADDRESS_BYTES || payload.length !== expectedLength) throw new Error('Registration response has an invalid address length.');
  const address = new TextDecoder('utf-8', { fatal: true }).decode(payload.slice(21, 21 + addressLength));
  const offset = 21 + addressLength, publicKey = `0x${Array.from(payload.slice(offset, offset + 33), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  const lockOffset = offset + 33;
  if (!/^0x0[23][0-9a-f]{64}$/i.test(publicKey)) throw new Error('Registration response must contain a compressed secp256k1 public key.');
  secp256k1.Point.fromBytes(c.bytesFrom(publicKey));
  const lockHash = payload.slice(lockOffset, lockOffset + 32), lockHashType = payload[lockOffset + 32], lockArgs = payload.slice(lockOffset + 33, lockOffset + 53);
  const args = c.hashCkb(c.bytesFrom(publicKey)).slice(2, 42);
  if (!sameBytes(lockHash, hexBytes(CODE_HASH.slice(2))) || lockHashType !== HASH_TYPE || !sameBytes(lockArgs, hexBytes(args))) throw new Error('Registration lock does not match the public key.');
  if (!sameBytes(decodeAddress(address), lockArgs)) throw new Error('Registration address does not match the public key lock.');
  const hasRequest = !sameBytes(request, zeroRequest);
  const resultSlot = slotByte === 1 ? 'delegate1' : slotByte === 2 ? 'delegate2' : null;
  if ((slotByte !== 0 && !resultSlot) || (hasRequest !== Boolean(resultSlot))) throw new Error('Registration response has an invalid invitation binding.');
  if (expectedInvitation && (requestIdOf(request) !== expectedInvitation.requestId || resultSlot !== expectedInvitation.slot)) throw new Error('Response does not match this invitation and delegate slot.');
  return { identity: { publicKey, address }, requestId: hasRequest ? requestIdOf(request) : null, slot: resultSlot, code: value };
}

export async function importRegistrationProfile(text: string): Promise<RegistrationResponse> {
  const value = registrationCodeFromInput(text);
  return value.startsWith('{') ? importLegacyJson(value) : importRegistrationResponse(value);
}

function requestIdOf(bytes: Uint8Array) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }

async function importLegacyJson(text: string): Promise<RegistrationResponse> {
  if (text.length > 16_384) throw new Error('Registration profile is too large.');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid registration profile.');
  const profile = value as Record<string, any>;
  const allowed = new Set(['format', 'version', 'network', 'address', 'publicKey', 'lock']);
  if (Object.keys(profile).some((key) => !allowed.has(key)) || profile.format !== 'quotacell-registration' || profile.version !== 1 || profile.network !== 'ckb_testnet' || typeof profile.address !== 'string' || typeof profile.publicKey !== 'string' || !profile.lock) throw new Error('Unsupported registration profile format or network.');
  const identity = { publicKey: profile.publicKey, address: profile.address };
  const code = await createRegistrationProfile(identity);
  const response = await importRegistrationProfile(code);
  if (profile.lock.codeHash !== CODE_HASH || profile.lock.hashType !== 'type' || profile.lock.args !== c.hashCkb(c.bytesFrom(identity.publicKey)).slice(0, 42)) throw new Error('Profile lock does not match its public key.');
  return response;
}

export function registrationShareUrl(code: string, response = false) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('register', '1');
  url.hash = response ? new URLSearchParams({ response: code }).toString() : '';
  if (!response) url.searchParams.set('invite', code);
  return url.toString();
}

export function exportLegacyRegistrationJson(identity: WalletIdentity) {
  const args = c.hashCkb(c.bytesFrom(identity.publicKey)).slice(0, 42);
  return JSON.stringify({
    format: 'quotacell-registration', version: 1, network: 'ckb_testnet',
    address: identity.address, publicKey: identity.publicKey,
    lock: { codeHash: CODE_HASH, hashType: 'type', args },
  }, null, 2);
}
