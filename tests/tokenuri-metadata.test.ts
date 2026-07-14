import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchTokenUriMetadata,
  resolveIpfsUri,
  __clearTokenUriCacheForTests,
} from "../src/tokenuri-metadata.js";
import { NotFoundError, ValidationError } from "../src/errors.js";
import {
  AZUKI_CONTRACT,
  AZUKI_CHAIN_ID,
  AZUKI_4442_METADATA,
  AZUKI_TEST_IPFS_GATEWAY,
  installAzukiEnv,
  uninstallAzukiEnv,
  azukiRpcResponse,
  azukiGatewayResponse,
} from "./support/azuki-fixture-stub.js";

/** Compose the RPC + gateway matchers into one fetch stub, counting RPC calls. */
function stubWithRpcCounter(): { rpcCalls: () => number } {
  let rpcCalls = 0;
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes("eth_call")) rpcCalls += 1;
    const rpc = azukiRpcResponse(url, init);
    if (rpc) return rpc;
    const gw = azukiGatewayResponse(url);
    if (gw) return gw;
    throw new Error(`unexpected network fetch: ${url}`);
  });
  return { rpcCalls: () => rpcCalls };
}

describe("tokenuri-metadata — third-party (proxy) resolver, INV-A", () => {
  beforeEach(() => {
    installAzukiEnv();
    __clearTokenUriCacheForTests();
  });
  afterEach(() => {
    uninstallAzukiEnv();
    __clearTokenUriCacheForTests();
    vi.unstubAllGlobals();
  });

  it("resolves real Azuki #4442 metadata via one RPC call + one gateway fetch", async () => {
    const { rpcCalls } = stubWithRpcCounter();

    const doc = await fetchTokenUriMetadata(AZUKI_CONTRACT, AZUKI_CHAIN_ID, "4442");

    expect(doc.name).toBe(AZUKI_4442_METADATA.name);
    expect(doc.image).toBe(
      `${AZUKI_TEST_IPFS_GATEWAY}QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/4442.png`
    );
    expect(doc.description).toBe(""); // real Azuki metadata carries no description field
    expect(doc.attributes).toHaveLength(AZUKI_4442_METADATA.attributes.length);
    expect(doc.attributes[0]).toEqual({ trait_type: "Type", value: "Human" });
    expect(rpcCalls()).toBe(1);
  });

  it("resolves a SECOND, different tokenId on the same contract with ZERO additional RPC calls", async () => {
    const { rpcCalls } = stubWithRpcCounter();

    await fetchTokenUriMetadata(AZUKI_CONTRACT, AZUKI_CHAIN_ID, "4442");
    expect(rpcCalls()).toBe(1);

    // baseURI is now cached — a different tokenId must be pure string concat
    // + one gateway fetch, NOT another eth_call.
    const doc2 = await fetchTokenUriMetadata(AZUKI_CONTRACT, AZUKI_CHAIN_ID, "1");
    expect(rpcCalls()).toBe(1);
    expect(doc2.name).toBe("Azuki #1");
    expect(doc2.image).toBe(
      `${AZUKI_TEST_IPFS_GATEWAY}QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/1.png`
    );
  });

  it("throws NotFoundError when the metadata gateway 404s", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      const rpc = azukiRpcResponse(url, init);
      if (rpc) return rpc;
      return new Response("", { status: 404 });
    });

    await expect(
      fetchTokenUriMetadata(AZUKI_CONTRACT, AZUKI_CHAIN_ID, "99999999")
    ).rejects.toThrow(NotFoundError);
  });

  it("throws a clear error (not silently wrong) when the tokenURI shape assumption is violated", async () => {
    vi.stubGlobal("fetch", async (_url: string, init?: { body?: string }) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (!body.includes("eth_call")) throw new Error("should not reach the gateway");
      // Return a tokenURI that does NOT end with the requested tokenId.
      const encoded = Buffer.from("ipfs://someCID/not-the-token").toString("hex");
      const lengthHex = (encoded.length / 2).toString(16).padStart(64, "0");
      const offsetHex = (32).toString(16).padStart(64, "0");
      const pad = (64 - (encoded.length % 64)) % 64;
      const result = `0x${offsetHex}${lengthHex}${encoded}${"0".repeat(pad)}`;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      fetchTokenUriMetadata(AZUKI_CONTRACT, AZUKI_CHAIN_ID, "4442")
    ).rejects.toThrow(/shape assumption violated/);
  });

  it("rejects a non-numeric tokenId", async () => {
    await expect(
      fetchTokenUriMetadata(AZUKI_CONTRACT, AZUKI_CHAIN_ID, "not-a-number")
    ).rejects.toThrow(ValidationError);
  });

  it("throws when no RPC endpoint is configured for the chain and no default exists", async () => {
    uninstallAzukiEnv(); // drop the RPC_URL_1 override
    await expect(fetchTokenUriMetadata(AZUKI_CONTRACT, 999999, "1")).rejects.toThrow(
      /no RPC endpoint configured for chain 999999/
    );
  });

  it("resolveIpfsUri rewrites ipfs:// through the configured gateway, passes through everything else", () => {
    expect(resolveIpfsUri("ipfs://someCID/1.png")).toBe(`${AZUKI_TEST_IPFS_GATEWAY}someCID/1.png`);
    expect(resolveIpfsUri("https://example.com/1.png")).toBe("https://example.com/1.png");
  });

  it("resolveIpfsUri defaults to ipfs.io when IPFS_GATEWAY_URL is unset", () => {
    uninstallAzukiEnv();
    expect(resolveIpfsUri("ipfs://someCID/1.png")).toBe("https://ipfs.io/ipfs/someCID/1.png");
  });
});
