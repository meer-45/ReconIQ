# ReconIQ

> **One-Line Pitch:** ReconIQ turns chaotic multi-source payment discrepancies into mathematically proven matches and self-healing AI hypotheses backed by an unbroken SHA-256 cryptographic audit ledger.

ReconIQ is a high-throughput, deterministic multi-layered payment reconciliation engine featuring dynamic programming subset-sum bundle matching, automated fee schedule inference, character n-gram TF-IDF fuzzy matching, LLM root-cause hypothesis generation, interactive human-in-the-loop exception resolution, and continuous few-shot self-healing.

---

## 30-Second Demo Walkthrough

1. **Dashboard Overview (`http://localhost:5173/`):**
   - See the **Cost of Unmatched Cash** (₹34,85,984.06) count up smoothly over 800ms.
   - Inspect the 4-tile KPI grid showing Exact (100% precision), Subset-Sum, and AI disambiguation rates.
2. **Ambiguous Match Disambiguation (`/exceptions`):**
   - Filter by `AMBIGUOUS_MATCH` or click an unresolved exception.
   - Compare candidate payment bundles side-by-side with scoring breakdown (amount, date lag, bundle size).
   - Click **"Approve this match"** → instant optimistic toast + redirect to the new MatchGroup.
3. **Live WebSocket Stream & Self-Healing (`/example-bank`):**
   - Watch the new `MatchGroup` stream in real-time over the native WebSocket channel.
   - Navigate to `/example-bank` to see your approval converted into a canonical few-shot vector for future LLM classifications.
4. **Cryptographic Ledger Proof (`Footer` / `/api/verify-chain`):**
   - Click **"Verify audit chain"** in the footer of *any* page to execute cryptographic validation across the Postgres audit ledger.
   - Watch the green **`MAIN CHAIN OK (549 rows) · 0 link breaks`** pill verify ledger immutability in real time.

---

## Determinism Proof Evidence

ReconIQ guarantees 100% byte-identical determinism across independent pipeline executions. Every match group and cryptographic audit hash is fully reproducible:

```text
===============================================================
             ReconIQ Determinism Proof Validator              
===============================================================

Reading state from target database instance(s)…
Instance A: 787 audit rows, 221 match groups
Instance B: 787 audit rows, 221 match groups

===============================================================
                 Determinism Proof: PASSED                     
===============================================================
✓ MATCH GROUPS DETERMINISM: 100% (221/221 identical)
✓ AUDIT CHAIN DETERMINISM:  100% (787/787 byte-identical rowHashes)
✓ CRYPTOGRAPHIC REPRODUCIBILITY: Zero divergence across all deterministic and AI layers.
===============================================================
```

---

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

### 3. Run Pipeline & Servers
```bash
# Execute all matching layers
bun run src/matching/runExact.ts
bun run src/matching/runSubsetSum.ts
bun run src/matching/runFeeInference.ts
bun run src/matching/runFuzzyMatch.ts
bun run src/matching/runLlmClassify.ts

# Start backend API (Port 3000, WS on /ws)
bun run src/api/server.ts

# Start Frontend UI (Port 5173)
cd web && bun run dev
```

### 4. Verification & Testing
```bash
# Run End-to-End full integration test suite
bun run scripts/e2e.ts

# Run byte-identical determinism proof
bun run scripts/determinism.ts

# Verify cryptographic hash chain integrity
bun run verify-chain.ts

# Run unit and API tests
bun test
```

---

## MCP Integration

ReconIQ exposes a Model Context Protocol (MCP) server over `stdio`, wrapping the 4 core reconciliation inspection tools for Claude Desktop or any MCP client.

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
      "args": ["run", "/path/to/ReconIQ/src/mcp/runServer.ts"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@ep-host.region.aws.neon.tech/neondb?sslmode=require"
      }
    }
  }
}
```

---

## Architecture Overview

```mermaid
flowchart TD
    A[Raw Data Sources: Bank Statements & Gateway Settlements] --> B[Layer 1a: Exact Matching]
    B -->|278 Matched Records| C[Layer 1b: Subset-Sum DP Knapsack]
    C -->|55 Matched Records| D[Layer 1.5: Fee Schedule Inference]
    D -->|3.3646% Fitted Rate| E[Layer 2a: TF-IDF Fuzzy Match]
    E -->|Residual Disambiguation| F[Layer 2b: Gemini LLM Root-Cause Classify]
    F -->|417 Exception Hypotheses| G[(Postgres & Neon pgvector)]
    G --> H[Bun Native API & WS Server]
    H --> I[React + Vite + Tailwind Dashboard]
    I -->|Human Approval| J[ExampleBank Self-Heal Vector Loop]
    J -->|Few-Shot Injection| F
    G --> K[MCP Stdio Server]
```
