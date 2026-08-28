#!/usr/bin/env bun
// src/mcp/runServer.ts — CLI entry point to run ReconIQ MCP server over stdio.

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error("ReconIQ MCP server running on stdio transport.");
}

main().catch((err) => {
  console.error("Failed to start ReconIQ MCP server:", err);
  process.exit(1);
});
