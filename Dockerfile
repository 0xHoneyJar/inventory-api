# inventory-api — Bun/Hyper HTTP+MCP service.
# Vendored src/hyper/ resolves via tsconfig paths at runtime (Bun reads them).
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install
EXPOSE 8787
CMD ["bun", "src/app.ts"]
