import { describe, it, expect } from "vitest";
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
const BASE = "http://localhost";

const get = (path: string) => app.fetch(new Request(`${BASE}${path}`));

describe("HTTP route GET /profile/:address (via app.fetch)", () => {
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
  });

  it("MCP manifest exposes the getProfilePicture tool", async () => {
    const manifest = buildMCPManifest();
    const tool = manifest.tools.find((t: { name: string }) => t.name === "getProfilePicture");
    expect(tool).toBeDefined();
    expect(typeof tool!.description).toBe("string");
  });
});
