// src/mcp/server.ts — Model Context Protocol (MCP) server for ReconIQ.
// Exposes the 4 reconciliation Q&A tools to Claude Desktop and other MCP clients.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { getTransactionById } from "../agent/tools/getTransactionById";
import {
  getExceptionsByClassification,
  type ExceptionClassification,
} from "../agent/tools/getExceptionsByClassification";
import {
  getMatchRateByMethod,
  getAllMethodMetrics,
  type MatchMethod,
} from "../agent/tools/getMatchRateByMethod";
import {
  getAuditTrailForMatch,
  getAuditTrailForTransaction,
} from "../agent/tools/getAuditTrailForMatch";

// ── Zod Schemas for Tool Inputs ───────────────────────────────────────────────

export const GetTransactionByIdInputSchema = z.object({
  id: z.string().min(1, "Transaction ID is required"),
});

export const GetExceptionsByClassificationInputSchema = z.object({
  classification: z.enum([
    "DUPLICATE",
    "MISSING_COUNTERPART",
    "TIMING_LAG",
    "OTHER",
    "AMBIGUOUS_MATCH",
    "FUZZY_LOW_CONFIDENCE",
    "UNMATCHED",
  ]),
});

export const GetMatchRateByMethodInputSchema = z.object({
  method: z.enum([
    "EXACT",
    "SUBSET_SUM",
    "FEE_INFERENCE",
    "AI_FUZZY",
    "AI_CLASSIFIED",
    "MANUAL",
    "ALL",
  ]),
});

export const GetAuditTrailForMatchInputSchema = z.object({
  matchGroupId: z.string().min(1, "Match Group ID is required"),
});

// ── MCP Tool Definitions ──────────────────────────────────────────────────────

export const MCP_TOOLS: Tool[] = [
  {
    name: "reconiq_getTransactionById",
    description: "Look up a single transaction record by ID from the ingestion pool across Bank Statement and Gateway Settlement sources.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Transaction record ID (e.g. 'tx_vyismk47bp')",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reconiq_getExceptionsByClassification",
    description: "Retrieve all unresolved exceptions filtered by classification category (DUPLICATE, MISSING_COUNTERPART, TIMING_LAG, OTHER, AMBIGUOUS_MATCH, FUZZY_LOW_CONFIDENCE, UNMATCHED).",
    inputSchema: {
      type: "object",
      properties: {
        classification: {
          type: "string",
          enum: [
            "DUPLICATE",
            "MISSING_COUNTERPART",
            "TIMING_LAG",
            "OTHER",
            "AMBIGUOUS_MATCH",
            "FUZZY_LOW_CONFIDENCE",
            "UNMATCHED",
          ],
          description: "Classification category to filter exceptions by",
        },
      },
      required: ["classification"],
    },
  },
  {
    name: "reconiq_getMatchRateByMethod",
    description: "Retrieve reconciliation performance metrics and match rates by pipeline layer method (EXACT, SUBSET_SUM, FEE_INFERENCE, AI_FUZZY, AI_CLASSIFIED, or ALL).",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: [
            "EXACT",
            "SUBSET_SUM",
            "FEE_INFERENCE",
            "AI_FUZZY",
            "AI_CLASSIFIED",
            "MANUAL",
            "ALL",
          ],
          description: "Matching method to query metrics for, or 'ALL' for complete layer breakdown",
        },
      },
      required: ["method"],
    },
  },
  {
    name: "reconiq_getAuditTrailForMatch",
    description: "Fetch immutable SHA-256 hash-chained audit trail entries for a specific match group (e.g. 'mg_exact_0') or bank transaction ID.",
    inputSchema: {
      type: "object",
      properties: {
        matchGroupId: {
          type: "string",
          description: "MatchGroup ID (e.g. 'mg_exact_0') or bank transaction record ID",
        },
      },
      required: ["matchGroupId"],
    },
  },
];

// ── MCP Server Factory ────────────────────────────────────────────────────────

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "reconiq-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: MCP_TOOLS,
    };
  });

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestId = `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "reconiq_getTransactionById": {
          const parsed = GetTransactionByIdInputSchema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "Invalid arguments for reconiq_getTransactionById",
                    requestId,
                    issues: parsed.error.issues,
                  }),
                },
              ],
            };
          }

          const record = getTransactionById(parsed.data.id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  requestId,
                  found: record !== null,
                  transaction: record,
                }, null, 2),
              },
            ],
          };
        }

        case "reconiq_getExceptionsByClassification": {
          const parsed = GetExceptionsByClassificationInputSchema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "Invalid arguments for reconiq_getExceptionsByClassification",
                    requestId,
                    issues: parsed.error.issues,
                  }),
                },
              ],
            };
          }

          const exceptions = getExceptionsByClassification(
            parsed.data.classification as ExceptionClassification
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  requestId,
                  classification: parsed.data.classification,
                  total: exceptions.length,
                  exceptions,
                }, null, 2),
              },
            ],
          };
        }

        case "reconiq_getMatchRateByMethod": {
          const parsed = GetMatchRateByMethodInputSchema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "Invalid arguments for reconiq_getMatchRateByMethod",
                    requestId,
                    issues: parsed.error.issues,
                  }),
                },
              ],
            };
          }

          if (parsed.data.method === "ALL") {
            const metrics = getAllMethodMetrics();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    requestId,
                    method: "ALL",
                    totalMethods: metrics.length,
                    metrics,
                  }, null, 2),
                },
              ],
            };
          }

          const metric = getMatchRateByMethod(parsed.data.method as MatchMethod);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  requestId,
                  method: parsed.data.method,
                  found: metric !== null,
                  metric,
                }, null, 2),
              },
            ],
          };
        }

        case "reconiq_getAuditTrailForMatch": {
          const parsed = GetAuditTrailForMatchInputSchema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "Invalid arguments for reconiq_getAuditTrailForMatch",
                    requestId,
                    issues: parsed.error.issues,
                  }),
                },
              ],
            };
          }

          let entries = getAuditTrailForMatch(parsed.data.matchGroupId);
          if (entries.length === 0) {
            // Also try fallback by transaction ID
            entries = getAuditTrailForTransaction(parsed.data.matchGroupId);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  requestId,
                  matchGroupId: parsed.data.matchGroupId,
                  totalEntries: entries.length,
                  auditEntries: entries,
                }, null, 2),
              },
            ],
          };
        }

        default:
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `Unknown tool name: ${name}`,
                  requestId,
                }),
              },
            ],
          };
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Internal server error during MCP tool execution",
              requestId,
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  });

  return server;
}
