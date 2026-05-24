/**
 * MCP tool manifest — derived from the single ROUTES table.
 *
 * Shape follows Hyper's `MCPManifest` (version "1.0" + tools[]), so the
 * manifest is recognizable to the same tooling and a future Hyper swap keeps
 * the contract. Each route becomes one tool; inputSchema is a JSON Schema
 * object over the route's params (path + query merged, since an MCP tool call
 * is flat). This is a static manifest, not a live MCP transport — server.ts
 * serves it at /.well-known/mcp.json for discovery.
 */
import { ROUTES } from "./routes.js";

export interface MCPTool {
  readonly name: string;
  readonly description: string;
  readonly method: string;
  readonly path: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };
}

export interface MCPManifest {
  readonly version: "1.0";
  readonly tools: readonly MCPTool[];
}

/** Build the MCP tool manifest from the ROUTES table. */
export function buildMCPManifest(): MCPManifest {
  const tools: MCPTool[] = ROUTES.map((r) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of r.params) {
      properties[p.name] = { ...p.schema, description: p.description };
      if (p.required) required.push(p.name);
    }
    return {
      name: r.operationId,
      description: r.mcpDescription,
      method: r.method,
      path: r.path,
      inputSchema: { type: "object" as const, properties, required },
    };
  });
  return { version: "1.0", tools };
}
