export const REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS = 7_300_000_000n;

export function minimumProtectedFundingShannons(sharedAllowanceShannons: string | bigint) {
  return BigInt(sharedAllowanceShannons) + REQUIRED_PROTECTED_CHANGE_RESERVE_SHANNONS;
}
