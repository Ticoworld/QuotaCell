import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as c from '@ckb-ccc/core';
import type { WalletIdentity } from './domain';

const CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const HASH_TYPE = 'type';
const NETWORK = 'ckb_testnet';
export type RegistrationProfile = {
  format: 'quotacell-registration';
  version: 1;
  network: typeof NETWORK;
  address: string;
  publicKey: string;
  lock: { codeHash: typeof CODE_HASH; hashType: typeof HASH_TYPE; args: string };
};

export async function createRegistrationProfile(identity: WalletIdentity): Promise<RegistrationProfile> {
  const bytes = c.bytesFrom(identity.publicKey);
  if (bytes.length !== 33 || !/^0x0[23][0-9a-f]{64}$/i.test(identity.publicKey)) throw new Error('Invalid compressed secp256k1 public key.');
  secp256k1.Point.fromBytes(bytes);
  const args = c.hashCkb(bytes).slice(0, 42);
  const client = new c.ClientPublicTestnet({ url: `${window.location.origin}/api/ckb`, fallbacks: [] });
  const address = await c.Address.fromString(identity.address, client);
  if (address.prefix !== 'ckt' || address.script.codeHash !== CODE_HASH || address.script.hashType !== HASH_TYPE || address.script.args !== args) throw new Error('Address does not match a standard CKB testnet lock for this key.');
  return { format: 'quotacell-registration', version: 1, network: NETWORK, address: identity.address, publicKey: identity.publicKey.toLowerCase(), lock: { codeHash: CODE_HASH, hashType: HASH_TYPE, args } };
}

export async function importRegistrationProfile(text: string): Promise<WalletIdentity> {
  if (text.length > 16_384) throw new Error('Registration profile is too large.');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid registration profile.');
  const profile = value as Partial<RegistrationProfile> & Record<string, unknown>;
  const allowed = new Set(['format', 'version', 'network', 'address', 'publicKey', 'lock']);
  if (Object.keys(profile).some((key) => !allowed.has(key)) || profile.format !== 'quotacell-registration' || profile.version !== 1 || profile.network !== NETWORK || typeof profile.address !== 'string' || typeof profile.publicKey !== 'string' || !profile.lock) throw new Error('Unsupported registration profile format or network.');
  const bytes = c.bytesFrom(profile.publicKey);
  if (!/^0x0[23][0-9a-f]{64}$/i.test(profile.publicKey) || bytes.length !== 33) throw new Error('Profile must contain a compressed secp256k1 public key.');
  secp256k1.Point.fromBytes(bytes);
  const args = c.hashCkb(bytes).slice(0, 42), lock = profile.lock;
  if (lock.codeHash !== CODE_HASH || lock.hashType !== HASH_TYPE || lock.args !== args) throw new Error('Profile lock does not match its public key.');
  const client = new c.ClientPublicTestnet({ url: `${window.location.origin}/api/ckb`, fallbacks: [] });
  const address = await c.Address.fromString(profile.address, client);
  if (address.prefix !== 'ckt' || address.script.codeHash !== CODE_HASH || address.script.hashType !== HASH_TYPE || address.script.args !== args) throw new Error('Profile address does not match the CKB testnet lock and public key.');
  return { publicKey: profile.publicKey.toLowerCase(), address: profile.address };
}
