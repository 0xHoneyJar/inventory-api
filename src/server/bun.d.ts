/**
 * Minimal ambient declaration for the subset of the Bun global this server
 * uses. Avoids pulling the full `@types/bun` dependency into a Node library.
 * The runtime is Bun (server.ts is invoked via `bun src/server/server.ts`);
 * only `Bun.serve` is referenced.
 */
declare namespace Bun {
  interface ServeOptions {
    port?: number;
    hostname?: string;
    fetch: (req: Request) => Response | Promise<Response>;
  }
  interface Server {
    readonly port: number;
    readonly hostname: string;
    stop(closeActiveConnections?: boolean): void;
  }
  function serve(options: ServeOptions): Server;
}

interface ImportMeta {
  /** Bun: true when this module is the entrypoint (`bun file.ts`). */
  readonly main: boolean;
}
