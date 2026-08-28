# ReconIQ

ReconIQ is a high-throughput, deterministic multi-layered payment reconciliation engine with AI-assisted exception classification, interactive human-in-the-loop review, few-shot self-healing feedback loops, and an immutable SHA-256 hash-chained audit ledger.

## Quick Start

### 1. Install Dependencies
```bash
bun install
```

### 2. Database Migration & Seed
```bash
bunx prisma migrate dev
bun run src/persistence/seed.ts
```

### 3. Run API & Dev Server
```bash
# Start backend API (Port 3000, WS on /ws)
bun run src/api/server.ts

# Start Frontend UI (Port 5173)
cd web && bun run dev
```

### 4. Verification & Testing
```bash
# Verify cryptographic hash chain integrity
bun run verify-chain.ts

# Run test suite
bun test
```

---

## MCP Integration

ReconIQ exposes a Model Context Protocol (MCP) server over `stdio`, wrapping the deterministic reconciliation inspection tools for Claude Desktop or any MCP-compatible agent.

### Tools Exposed:
- `reconiq_getTransactionById(id: string)`: Look up single transaction records across Bank Statement and Gateway Settlement sources.
- `reconiq_getExceptionsByClassification(classification: enum)`: Retrieve unresolved exceptions filtered by category (`DUPLICATE`, `MISSING_COUNTERPART`, `TIMING_LAG`, `OTHER`, `AMBIGUOUS_MATCH`, `FUZZY_LOW_CONFIDENCE`, `UNMATCHED`).
- `reconiq_getMatchRateByMethod(method: enum)`: Retrieve performance metrics for specific pipeline layers or `ALL`.
- `reconiq_getAuditTrailForMatch(matchGroupId: string)`: Query immutable hash-chained audit entries for matches or transaction records.

### Claude Desktop Configuration

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reconiq": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/reconiq/src/mcp/runServer.ts"],
      "env": { "DATABASE_URL": "..." }
    }
  }
}
```

To run the MCP server directly from CLI:
```bash
bun run src/mcp/runServer.ts
```
