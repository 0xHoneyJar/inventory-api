import { describe, it, expect } from "vitest";
import {
  validateWalletAddress,
  validateEvmAddress,
  toChecksumAddress,
} from "../src/address.js";

describe("validateWalletAddress", () => {
  it("checksum-normalizes valid EVM addresses", () => {
    const lower = "0x6666397dfe9a8c469bf65dc744cb1c733416c420";
    expect(validateWalletAddress("evm", lower, "address")).toBe(
      "0x6666397DFe9a8c469BF65dc744CB1C733416c420"
    );
    expect(validateEvmAddress(lower, "address")).toBe(toChecksumAddress(lower));
  });

  it("rejects malformed EVM addresses", () => {
    expect(() => validateWalletAddress("evm", "not-evm", "address")).toThrow();
  });

  it("accepts Solana base58 verbatim without case change", () => {
    const owner = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
    expect(validateWalletAddress("svm", owner, "address")).toBe(owner);
  });

  it("rejects invalid Solana owner strings", () => {
    expect(() => validateWalletAddress("svm", "not-a-solana-wallet", "address")).toThrow();
  });
});
