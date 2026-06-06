/**
 * Multi-protocol projection infrastructure.
 *
 * One route definition projects to many transports:
 *   HTTP              — always on (the route is HTTP-first).
 *   typed RPC client  — always on (shape is inferred from the route graph).
 *   MCP tool          — opt-in via `meta.mcp`.
 *   server action     — opt-in via `meta.action` or `.actionable()`.
 *   websocket/SSE     — opt-in via the handler return type.
 *
 * The functions in this file walk a route graph and produce serializable
 * manifests. The `app.invoke()` path is shared across protocols so
 * business logic runs exactly once.
 */

import type { Route, RouteMeta } from "./types.ts"

/** Minimal serializable schema descriptor — the full converter lives in @hyper/openapi. */
export interface SchemaDescriptor {
  readonly kind: "unknown" | "object" | "string" | "number" | "boolean" | "array"
  readonly properties?: Record<string, SchemaDescriptor>
}

/** A raw route as projected into any manifest. */
export interface ProjectedRoute {
  readonly method: string
  readonly path: string
  readonly name?: string
  readonly tags: readonly string[]
  readonly deprecated?: boolean
  readonly version?: string
  readonly mcp?: RouteMeta["mcp"]
  readonly action?: boolean
  readonly internal?: boolean
  readonly params?: SchemaDescriptor
  readonly query?: SchemaDescriptor
  readonly body?: SchemaDescriptor
  /** Thrown HTTP status codes declared via `.throws(status, schema)`. */
  readonly throws?: readonly number[]
  /** Named error codes declared via `.errors({ code: schema })`. */
  readonly errors?: readonly string[]
}

function descriptorOf(x: unknown): SchemaDescriptor | undefined {
  if (!x) return undefined
  return { kind: "unknown" }
}

export function projectRoute(r: Route): ProjectedRoute {
  const meta = r.meta
  const params = descriptorOf(r.params)
  const query = descriptorOf(r.query)
  const body = descriptorOf(r.body)
  const deprecated = meta.deprecated ? true : undefined
  const throws = r.throws
    ? Object.keys(r.throws)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : undefined
  const errors = r.errors ? Object.keys(r.errors) : undefined
  const base: ProjectedRoute = {
    method: r.method,
    path: r.path,
    tags: meta.tags ?? [],
    ...(meta.name !== undefined && { name: meta.name }),
    ...(meta.mcp !== undefined && { mcp: meta.mcp }),
    ...(meta.action !== undefined && { action: Boolean(meta.action) }),
    ...(meta.internal !== undefined && { internal: meta.internal }),
    ...(deprecated !== undefined && { deprecated }),
    ...(meta.version !== undefined && { version: meta.version }),
    ...(params && { params }),
    ...(query && { query }),
    ...(body && { body }),
    ...(throws && throws.length > 0 && { throws }),
    ...(errors && errors.length > 0 && { errors }),
  }
  return base
}

export function projectRoutes(routes: readonly Route[]): readonly ProjectedRoute[] {
  return routes.filter((r) => !r.meta.internal).map(projectRoute)
}

/** Minimal OpenAPI 3.1 manifest. @hyper/openapi adds schema conversion later. */
export interface OpenAPIManifest {
  readonly openapi: "3.1.0"
  readonly info: { title: string; version: string; description?: string }
  readonly paths: Record<string, Record<string, OpenAPIOperation>>
}

interface OpenAPIOperation {
  readonly operationId?: string
  readonly tags?: readonly string[]
  readonly deprecated?: boolean
  readonly parameters?: readonly OpenAPIParam[]
  readonly requestBody?: { readonly content: Record<string, unknown> }
  readonly responses: Record<string, { description: string }>
}

interface OpenAPIParam {
  readonly name: string
  readonly in: "path" | "query" | "header"
  readonly required: boolean
}

export interface OpenAPIManifestConfig {
  readonly title?: string
  readonly version?: string
  readonly description?: string
}

function openApiPath(path: string): string {
  // Convert Bun `:param` to OpenAPI `{param}`
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
}

export function toOpenAPI(
  routes: readonly Route[],
  cfg: OpenAPIManifestConfig = {},
): OpenAPIManifest {
  const paths: Record<string, Record<string, OpenAPIOperation>> = {}
  for (const r of routes) {
    if (r.meta.internal) continue
    const p = openApiPath(r.path)
    const operation: OpenAPIOperation = {
      ...(r.meta.name !== undefined && { operationId: r.meta.name }),
      ...(r.meta.tags !== undefined && { tags: r.meta.tags }),
      ...(r.meta.deprecated && { deprecated: true }),
      ...(r.body !== undefined && {
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Body" } } },
        },
      }),
      responses: {
        "200": { description: "success" },
      },
    }
    if (!paths[p]) paths[p] = {}
    paths[p][r.method.toLowerCase()] = operation
  }
  return {
    openapi: "3.1.0",
    info: {
      title: cfg.title ?? "Hyper API",
      version: cfg.version ?? "0.0.0",
      ...(cfg.description !== undefined && { description: cfg.description }),
    },
    paths,
  }
}

/** MCP manifest (JSON-RPC shaped). @hyper/mcp produces the transport. */
export interface MCPManifest {
  readonly version: "1.0"
  readonly tools: readonly MCPTool[]
}

export interface MCPTool {
  readonly name: string
  readonly description: string
  readonly method: string
  readonly path: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
  }
}

/**
 * Minimal converter contract — the core layer stays free of a hard
 * `@hyper/openapi` import (the schema converter lives there). A caller that
 * has a real converter (e.g. `zodConverter` from `@hyper/openapi-zod`) threads
 * it in so MCP `inputSchema` carries the route's actual param/query shape;
 * absent one, the manifest keeps the legacy bare `{ type: "object" }` stub.
 */
export interface MCPSchemaConverter {
  readonly canHandle: (s: unknown) => boolean
  readonly toJsonSchema: (s: unknown) => Record<string, unknown>
}

/**
 * Project a declared schema (path `params` or `query`) into a nested MCP
 * `inputSchema` group. With a converter, emits the real object schema — inner
 * property names + the `required` array — so an MCP agent sees that e.g. the
 * `:address` path segment is a required string. Without one (or when the
 * schema doesn't convert to an object), falls back to the bare
 * `{ type: "object" }` stub the manifest emitted historically.
 */
function mcpSchemaGroup(
  schema: unknown,
  converter: MCPSchemaConverter | undefined,
): Record<string, unknown> {
  if (converter?.canHandle(schema)) {
    const js = converter.toJsonSchema(schema)
    if (js && js.type === "object") return js
  }
  return { type: "object" }
}

export function toMCPManifest(
  routes: readonly Route[],
  converter?: MCPSchemaConverter,
): MCPManifest {
  const tools: MCPTool[] = []
  for (const r of routes) {
    if (r.meta.internal) continue
    if (!r.meta.mcp) continue
    const cfg = r.meta.mcp as { description: string }
    tools.push({
      name: r.meta.name ?? `${r.method.toLowerCase()}_${r.path.replace(/[^a-z0-9]+/gi, "_")}`,
      description: cfg.description,
      method: r.method,
      path: r.path,
      inputSchema: {
        type: "object",
        properties: {
          ...(r.params ? { params: mcpSchemaGroup(r.params, converter) } : {}),
          ...(r.query ? { query: mcpSchemaGroup(r.query, converter) } : {}),
          ...(r.body ? { body: mcpSchemaGroup(r.body, converter) } : {}),
        },
      },
    })
  }
  return { version: "1.0", tools }
}

/** Typed-client manifest — the serializable contract @hyper/client consumes. */
export interface ClientManifest {
  readonly version: "1.0"
  readonly routes: readonly ProjectedRoute[]
}

export function toClientManifest(routes: readonly Route[]): ClientManifest {
  return { version: "1.0", routes: projectRoutes(routes) }
}
