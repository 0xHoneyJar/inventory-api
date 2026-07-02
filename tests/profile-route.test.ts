import { describe, it, expect, vi, afterEach } from "vitest";
import { app, buildOpenAPI, buildMCPManifest } from "../src/app.js";

/**
 * HTTP + MCP route tests for GET /profile/:address (the getProfilePicture
 * over-the-wire surface). Same offline mechanism as service.test.ts: call the
 * app's Web-standard `fetch` handler directly (no port bind, no Bun runtime),
 * so the suite runs offline under vitest/Node against fixtures. The route is a
 * thin wrapper over the getProfilePicture domain fn (src/inventory.ts).
 */
const MIBERA = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
const HOLDER = "0x1111111111111111111111111111111111111111"; // fixture holder (owns NFTs)
const EMPTY = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; // holds nothing renderable
const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
const BASE = "http://localhost";

const get = (path: string) => app.fetch(new Request(`${BASE}${path}`));

describe("HTTP route GET /profile/:address (via app.fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy path: a holder returns a real imageUrl string in the envelope", async () => {
    const res = await get(`/profile/${HOLDER}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(HOLDER);
    expect(body.contract).toBe(MIBERA); // defaults to Mibera
    expect(typeof body.imageUrl).toBe("string");
    expect((body.imageUrl as string).length).toBeGreaterThan(0);
  });

  it("null case: a wallet with no holdings returns imageUrl: null (NOT a 404)", async () => {
    const res = await get(`/profile/${EMPTY}`);
    expect(res.status).toBe(200); // null is a valid "no pfp" answer, not an error
    const body = await res.json();
    expect(body.address).toBe(EMPTY);
    expect(body.imageUrl).toBeNull();
  });

  it("validation: a malformed address returns 400 with the errorBody shape", async () => {
    const res = await get("/profile/not-an-address");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVENTORY_INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
  });

  it("forwards the optional ?contract= query to the domain fn", async () => {
    const res = await get(`/profile/${HOLDER}?contract=${MIBERA}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe(MIBERA);
  });

  it("unknown (well-formed but unregistered) contract returns 400, not 500, with a safe message", async () => {
    const UNREGISTERED = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const res = await get(`/profile/${HOLDER}?contract=${UNREGISTERED}`);
    expect(res.status).toBe(400); // client supplied an unregistered contract
    const body = await res.json();
    expect(body.error.code).toBe("INVENTORY_INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    // No internal-state leakage: the old bare-Error message must not surface.
    expect(body.error.message).not.toMatch(/No collection meta/i);
  });

  it("empty-string ?contract= resolves to the default — the envelope must not lie", async () => {
    const res = await get(`/profile/${HOLDER}?contract=`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Envelope's contract MUST equal what the domain actually used (Mibera),
    // never the empty string that the raw query carried.
    expect(body.contract).toBe(MIBERA);
    expect(typeof body.imageUrl).toBe("string");
    expect((body.imageUrl as string).length).toBeGreaterThan(0);
  });

  it("pythenians: SVM holder + ?contract=pythians returns imageUrl when metadata resolves", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          name: "Pythenians #3180",
          description: "",
          image: "https://ipfs.pythenians.xyz/nft/example3180.png",
          attributes: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await get(`/profile/${PYTHIANS_HOLDER}?contract=pythians`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(PYTHIANS_HOLDER);
    expect(body.contract).toBe("pythians");
    expect(body.imageUrl).toBe("https://ipfs.pythenians.xyz/nft/example3180.png");
  });
});

describe("OpenAPI 3.1 + MCP surface for /profile/:address", () => {
  it("OpenAPI exposes /profile/{address} with operationId getProfilePicture", async () => {
    const doc = buildOpenAPI();
    const profile = doc.paths["/profile/{address}"]?.get;
    expect(profile).toBeDefined();
    expect(profile!.operationId).toBe("getProfilePicture");
    const paramNames = (profile!.parameters ?? []).map((p) => p.name);
    expect(paramNames).toContain("address"); // path param
    expect(paramNames).toContain("contract"); // query param (from zod)
    // The `address` path param MUST carry a `schema` (OAS 3.1 §4.8.12). Without
    // it a code-gen consumer infers the param as untyped/any.
    const addressParam = (profile!.parameters ?? []).find((p) => p.name === "address");
    expect(addressParam).toBeDefined();
    expect((addressParam as { schema?: { type?: unknown } }).schema?.type).toBe("string");
  });

  it("OpenAPI 200 declares imageUrl as string|null (the null variant is bound, not dropped)", async () => {
    const doc = buildOpenAPI();
    const ok200 = doc.paths["/profile/{address}"]?.get?.responses?.["200"];
    const schema = ok200?.content?.["application/json"]?.schema as
      | { properties?: Record<string, { type?: unknown }> }
      | undefined;
    expect(schema).toBeDefined();
    const imageUrlType = schema!.properties?.imageUrl?.type;
    // OpenAPI 3.1 nullable syntax — a code-gen consumer infers string|null.
    expect(imageUrlType).toEqual(["string", "null"]);
  });

  it("MCP manifest exposes the getProfilePicture tool", async () => {
    const manifest = buildMCPManifest();
    const tool = manifest.tools.find((t: { name: string }) => t.name === "getProfilePicture");
    expect(tool).toBeDefined();
    expect(typeof tool!.description).toBe("string");
  });

  it("MCP inputSchema declares the required `address` path param (agent gets the schema signal)", async () => {
    const manifest = buildMCPManifest();
    const tool = manifest.tools.find((t: { name: string }) => t.name === "getProfilePicture");
    const params = tool!.inputSchema.properties.params as {
      type?: string;
      properties?: Record<string, { type?: unknown }>;
      required?: readonly string[];
    };
    // The :address path segment is a REQUIRED string — not a bare {type:"object"}
    // stub an MCP agent can't read.
    expect(params?.type).toBe("object");
    expect(params?.properties?.address?.type).toBe("string");
    expect(params?.required).toContain("address");
    // The optional ?contract= query param must NOT be marked required.
    const query = tool!.inputSchema.properties.query as { required?: readonly string[] };
    expect(query?.required ?? []).not.toContain("contract");
  });
});
