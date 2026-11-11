export const SHANNONS_PER_CKB = 100_000_000n;

export function parseCkb(input: string, errorMessage = 'Enter a CKB amount with at most 8 decimal places.'): bigint {
  if (!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/.test(input)) {
    throw new Error(errorMessage);
  }
  const [whole, fraction = ''] = input.split('.');
  return BigInt(whole) * SHANNONS_PER_CKB + BigInt(fraction.padEnd(8, '0'));
}

export function formatCkb(value: string | bigint): string {
  const amount = BigInt(value);
  const fraction = (amount % SHANNONS_PER_CKB).toString().padStart(8, '0').replace(/0+$/, '');
  return `${amount / SHANNONS_PER_CKB}${fraction ? `.${fraction}` : ''}`;
}

export function progressPercent(used: string, limit: string): number {
  const total = BigInt(limit);
  if (total <= 0n) return 0;
  const numerator = BigInt(used) * 10_000n / total;
  return Number(numerator > 10_000n ? 10_000n : numerator) / 100;
}

export function shortHash(value: string, start = 8, end = 6): string {
  return value.length > start + end + 1 ? `${value.slice(0, start)}…${value.slice(-end)}` : value;
}
