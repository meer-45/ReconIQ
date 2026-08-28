// src/mcp/server.test.ts — Unit and integration tests for ReconIQ MCP server.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, MCP_TOOLS } from "./server";

describe("ReconIQ MCP Server", () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;
  const server = createMcpServer();

  beforeAll(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      {
        name: "reconiq-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("tools/list returns all 4 registered ReconIQ reconciliation tools", async () => {
    const res = await client.listTools();
    expect(res.tools).toBeDefined();
    expect(res.tools.length).toBe(4);

    const toolNames = res.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      "reconiq_getAuditTrailForMatch",
      "reconiq_getExceptionsByClassification",
      "reconiq_getMatchRateByMethod",
      "reconiq_getTransactionById",
    ]);
  });

  it("reconiq_getTransactionById fetches a real transaction by ID", async () => {
    const res = await client.callTool({
      name: "reconiq_getTransactionById",
      arguments: { id: "tx_vyismk47bp" },
    });

    expect(res.isError).toBeFalsy();
    expect(res.content).toBeDefined();
    expect(res.content.length).toBe(1);

    const data = JSON.parse((res.content[0] as any).text);
    expect(data.requestId).toBeDefined();
    expect(data.found).toBe(true);
    expect(data.transaction.transactionRecordId).toBe("tx_vyismk47bp");
    expect(data.transaction.dataSource).toBe("BANK_STATEMENT");
  });

  it("reconiq_getExceptionsByClassification returns MISSING_COUNTERPART exceptions", async () => {
    const res = await client.callTool({
      name: "reconiq_getExceptionsByClassification",
      arguments: { classification: "MISSING_COUNTERPART" },
    });

    expect(res.isError).toBeFalsy();
    expect(res.content).toBeDefined();

    const data = JSON.parse((res.content[0] as any).text);
    expect(data.requestId).toBeDefined();
    expect(data.classification).toBe("MISSING_COUNTERPART");
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.exceptions.length).toBeGreaterThanOrEqual(1);
  });

  it("reconiq_getMatchRateByMethod returns metrics for EXACT and ALL", async () => {
    // 1. Single method
    const resExact = await client.callTool({
      name: "reconiq_getMatchRateByMethod",
      arguments: { method: "EXACT" },
    });
    expect(resExact.isError).toBeFalsy();
    const dataExact = JSON.parse((resExact.content[0] as any).text);
    expect(dataExact.method).toBe("EXACT");
    expect(dataExact.found).toBe(true);
    expect(dataExact.metric.method).toBe("EXACT");
    expect(dataExact.metric.matchedBankRecords).toBeGreaterThan(0);

    // 2. ALL methods
    const resAll = await client.callTool({
      name: "reconiq_getMatchRateByMethod",
      arguments: { method: "ALL" },
    });
    expect(resAll.isError).toBeFalsy();
    const dataAll = JSON.parse((resAll.content[0] as any).text);
    expect(dataAll.method).toBe("ALL");
    expect(dataAll.metrics.length).toBeGreaterThan(0);
  });

  it("reconiq_getAuditTrailForMatch returns hash-chained audit trail entries", async () => {
    const res = await client.callTool({
      name: "reconiq_getAuditTrailForMatch",
      arguments: { matchGroupId: "mg_exact_0" },
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.requestId).toBeDefined();
    expect(data.matchGroupId).toBe("mg_exact_0");
    expect(Array.isArray(data.auditEntries)).toBe(true);
  });

  it("returns isError: true on invalid tool arguments", async () => {
    const res = await client.callTool({
      name: "reconiq_getExceptionsByClassification",
      arguments: { classification: "INVALID_ENUM_VALUE" },
    });

    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.error).toBeDefined();
    expect(data.requestId).toBeDefined();
  });
});
