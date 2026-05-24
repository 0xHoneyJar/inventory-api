import { describe, it, expect } from 'vitest';
import { handle } from '../src/server/server.js';
import { buildOpenAPIDocument } from '../src/server/openapi.js';
import { buildMCPManifest } from '../src/server/mcp.js';

/**
 * Hermetic transport tests. We call the exported `handle(req)` fetch handler
 * directly with Web-standard Request/Response — no port binding, no Bun
 * runtime — so the offline vitest suite stays green. This validates the thin
 * HTTP transport over the library + the OpenAPI/MCP discovery docs.
 */
const MIBERA = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
const HOLDER = '0x1111111111111111111111111111111111111111';
const EMPTY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const BASE = 'http://localhost';

const get = (path: string) => handle(new Request(`${BASE}${path}`));

describe('server transport (hermetic, via handle())', () => {
  it('GET /health returns ok', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routes).toBe(3);
  });

  it('GET /holdings/:address wraps getHoldings', async () => {
    const res = await get(`/holdings/${HOLDER}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings[0].tokenCount).toBe(12);
    expect(body.holdings[0].tokenIds).toHaveLength(12);
    expect(body.completeness.source).toBe('sonar');
  });

  it('GET /holdings/:address forwards contracts query option', async () => {
    const res = await get(`/holdings/${HOLDER}?contracts=${MIBERA}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings[0].contractAddress).toBe(MIBERA);
  });

  it('GET /nfts/:contract/owner/:address wraps getNftsForOwner with pagination', async () => {
    const res = await get(`/nfts/${MIBERA}/owner/${HOLDER}?pageSize=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nfts).toHaveLength(5);
    expect(body.pageKey).toBeDefined();
    expect(body.name).toBe('Mibera');
  });

  it('GET /nfts/:contract/:tokenId wraps getNftMetadata', async () => {
    const res = await get(`/nfts/${MIBERA}/2769`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Air'); // pinned grail
  });

  it('maps ValidationError -> 400', async () => {
    const res = await get('/holdings/not-an-address');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVENTORY_INVALID_INPUT');
  });

  it('maps NotFoundError -> 404', async () => {
    const res = await get(`/nfts/${MIBERA}/99999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('INVENTORY_NOT_FOUND');
  });

  it('unknown route -> 404', async () => {
    const res = await get('/does/not/exist');
    expect(res.status).toBe(404);
  });

  it('empty holder returns empty holdings (graceful)', async () => {
    const res = await get(`/holdings/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toHaveLength(0);
  });

  it('serves the OpenAPI 3.1 document', async () => {
    const res = await get('/openapi.json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths)).toHaveLength(3);
  });

  it('serves the MCP manifest at /.well-known/mcp.json', async () => {
    const res = await get('/.well-known/mcp.json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('1.0');
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      'getHoldings',
      'getNftsForOwner',
      'getNftMetadata',
    ]);
  });

  it('CORS preflight (OPTIONS) returns 204', async () => {
    const res = await handle(new Request(`${BASE}/holdings/${HOLDER}`, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
  });
});

describe('OpenAPI / MCP generators (unit)', () => {
  it('OpenAPI doc has component schemas matching types.ts', () => {
    const doc = buildOpenAPIDocument();
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    expect(schemas).toHaveProperty('HoldingsResponse');
    expect(schemas).toHaveProperty('NFTCollection');
    expect(schemas).toHaveProperty('MetadataDocument');
    expect(schemas).toHaveProperty('CompletenessEnvelope');
  });

  it('every route 200 response references a defined component schema', () => {
    const doc = buildOpenAPIDocument();
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const paths = doc.paths as Record<string, Record<string, {
      responses: { '200': { content: { 'application/json': { schema: { $ref: string } } } } };
    }>>;
    for (const ops of Object.values(paths)) {
      for (const op of Object.values(ops)) {
        const ref = op.responses['200'].content['application/json'].schema.$ref;
        const name = ref.replace('#/components/schemas/', '');
        expect(schemas).toHaveProperty(name);
      }
    }
  });

  it('MCP manifest declares required path params', () => {
    const m = buildMCPManifest();
    const holdings = m.tools.find((t) => t.name === 'getHoldings');
    expect(holdings!.inputSchema.required).toContain('address');
  });
});
