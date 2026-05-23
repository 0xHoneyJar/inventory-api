import { keccak256 } from "ethereum-cryptography/keccak.js";
import { utf8ToBytes } from "ethereum-cryptography/utils.js";
import { ValidationError } from "./errors.js";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export function toChecksumAddress(address: string): string {
  if (!ADDRESS_REGEX.test(address)) {
    throw new ValidationError("address", address, "0x-prefixed 40-char hex string");
  }
  const lower = address.toLowerCase().slice(2);
  const hashBytes = keccak256(utf8ToBytes(lower));
  let result = "0x";
  for (let i = 0; i < 40; i++) {
    const byteIndex = Math.floor(i / 2);
    const nibbleIndex = i % 2;
    const byteVal = hashBytes[byteIndex];
    const nibbleVal = nibbleIndex === 0 ? (byteVal >> 4) : (byteVal & 0x0f);
    result += nibbleVal >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return result;
}

export function addressesMatch(a: string, b: string): boolean {
  try {
    return toChecksumAddress(a) === toChecksumAddress(b);
  } catch {
    return false;
  }
}

export function isValidAddress(address: string): boolean {
  return ADDRESS_REGEX.test(address);
}
