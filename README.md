# ReconIQ

**Payment reconciliation engine — deterministic core, AI for ambiguity, tamper-evident by design.**

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=fff)](https://www.prisma.io)
[![Postgres](https://img.shields.io/badge/Postgres-15+-4169E1?logo=postgresql&logoColor=fff)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

*Razorpay Buildathon 2026 · Track 04 (AI Finance Controller) · IIIT Lucknow*

</div>

---

## Overview

At month-end, every merchant taking online payments faces the same problem: three data sources — bank statement, gateway settlement, and internal ledger — that should agree but never do. Bundling, fees, refunds, typo'd references, and settlement lag mean **the mismatch is normal**. Existing tools do exact-match and give up. LLM-only prototypes hallucinate matches into financial ledgers.

ReconIQ takes a different position: **math for the math parts, AI for the ambiguity parts, cryptographic proof on every decision.**

- **100% precision** on the deterministic pipeline
- **49.7% precision** on the LLM-only baseline for the same data
- **787 audit rows, byte-identical across replays** — provably tamper-evident
- **₹34.86 lakh** of unmatched cash surfaced as a single headline number

---

## What it does

- 🎯 **Exact match** — normalized reference + amount + date window, commits only on unique candidates
- 🧮 **Subset-sum DP** — many-to-one bundling with signed amounts, tolerance bands, and parent-pointer reconstruction
- 📈 **Fee-schedule inference** — reverse-engineers the effective MDR + GST + TDS rate from confirmed bundles via linear regression, then re-matches at the inferred rate
- 🔍 **Embedding fuzzy match** — character-trigram TF-IDF cosine similarity for typo'd references, entirely local, entirely deterministic
- 🤖 **LLM classification** — Gemini 3.5 Flash-Lite with Zod-validated structured JSON output, retry-on-parse-fail, prompt version hashed into every audit row
- 🔗 **Hash-chained audit trail** — every decision writes one SHA-256 row; tampering with any row invalidates every subsequent one
- 💬 **Q&A agent** — function-calling over the reconciled state with four grounded tools; no hallucinated IDs
- 🔌 **MCP server** — same tools exposed via Model Context Protocol for Claude Desktop, Cursor, and other clients
- 📊 **Live dashboard** — React + Tailwind, WebSocket-ready, with side-by-side ambiguity approval UI

---

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Bank CSV    │  │ Gateway CSV  │  │  Ledger CSV  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └─────────────────┼─────────────────┘
                         ▼
                    Ingestion
              (normalize, paise-cast)
                         │
                         ▼
              ┌─────────────────────┐
              │  Layer 1a  Exact    │  →  100% precision, cheap
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Layer 1b  Subset-  │  →  many-to-one bundles
              │            sum DP   │      (signed, DP w/ pointers)
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Layer 1.5 Fee      │  →  learns MDR rate, catches
              │            infer.   │      fee leakage as a finding
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Layer 2a  Fuzzy    │  →  TF-IDF trigrams,
              │            match    │      PENDING_REVIEW band
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Layer 2b  LLM      │  →  structured JSON only,
              │            classify │      prompt version logged
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │   Hash-chained      │  ←  every decision, one row
              │   audit ledger      │      SHA-256 tamper-evidence
              └──────────┬──────────┘
                         ▼
              Dashboard · Q&A · MCP
```

Every stage that isn't confident stops and asks a human. The system never silently guesses, and every decision — algorithmic, AI, or human — lands in the same chain.

---

## The numbers

| Metric | Layered pipeline | LLM-only baseline |
|---|---|---|
| Precision | **100.0%** | 49.7% |
| Recall | 26.5% | 95.9% |
| Committed matches | 26 (correct) | 51 (25 wrong) |
| Hallucinated IDs | 0 | 1 |
| Cost per run | ₹0 | ₹0 (free tier) |
| Auditable | ✅ | ❌ |

**Determinism proof:** 787 / 787 audit rows byte-identical across two isolated pipeline runs. 221 / 221 match groups identical. Zero divergence.

**Cost of unmatched cash surfaced:** ₹34,85,984.06 across 169 unmatched bank records — money the merchant can see arrived but can't yet spend confidently, quantified as a single headline number.

---

## Tech stack

- **Runtime:** Bun 1.x (native TypeScript, native WebSocket, zero build step)
- **Database:** Postgres 15+ with pgvector extension
- **ORM:** Prisma 7 with driver adapter
- **Deterministic layers:** Pure TypeScript, no framework
- **Embeddings:** Character-trigram TF-IDF, local, deterministic
- **LLM:** Gemini 3.5 Flash-Lite (free tier), Zod-validated JSON output
- **Frontend:** React 19 + Vite 6 + Tailwind CSS
- **Agent protocol:** `@modelcontextprotocol/sdk` over stdio

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.x
- Postgres 15+ with `pgvector` extension (or a [Neon](https://neon.tech) branch)
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier works)

### Setup

```bash
git clone https://github.com/<your-username>/reconiq.git
cd reconiq

# Install dependencies
bun install
cd web && bun install && cd ..

# Configure environment
cp .env.example .env
# Edit .env:
#   DATABASE_URL="postgresql://..."
#   GEMINI_API_KEY="..."

# Initialize database
bunx prisma migrate deploy
bunx prisma generate

# Run the full matching pipeline
bun run src/matching/runExact.ts
bun run src/matching/runSubsetSum.ts
bun run src/matching/runFeeInference.ts
bun run src/matching/runFuzzyMatch.ts
bun run src/matching/runLlmClassify.ts

# Seed Postgres from pipeline results
bun run src/persistence/seed.ts

# Verify audit chain
bun run verify-chain.ts
# → MAIN CHAIN OK (787 rows)
```

### Running the app

```bash
# Terminal 1 — backend API
bun run src/api/server.ts
# → http://localhost:3000

# Terminal 2 — frontend
cd web && bun run dev
# → http://localhost:5173
```

Open `http://localhost:5173` in your browser.

### Verification

```bash
bun test                              # 43 pass / 0 fail
bun run scripts/e2e.ts                # 9/9 steps
bun run scripts/determinism.ts        # 100% byte-identical
```

---

## MCP integration

ReconIQ exposes its Q&A tools as an MCP server so any MCP-compatible client (Claude Desktop, Cursor) can query reconciliation state directly.

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "reconiq": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/reconiq/src/mcp/runServer.ts"],
      "env": {
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

Available tools:

- `reconiq_getTransactionById` — look up a transaction across sources
- `reconiq_getExceptionsByClassification` — filter unresolved exceptions
- `reconiq_getMatchRateByMethod` — per-layer performance metrics
- `reconiq_getAuditTrailForMatch` — full hash-chained audit slice

---

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/overview` | Match rates, unmatched cash, layer breakdown |
| GET | `/api/exceptions` | Filterable, sortable, paginated |
| GET | `/api/exceptions/:id` | Detail + candidate metadata |
| POST | `/api/exceptions/:id/approve` | Human picks a candidate → MANUAL match |
| POST | `/api/exceptions/:id/reject` | Reject with audit row |
| POST | `/api/exceptions/:id/resolve` | Mark resolved without a match |
| GET | `/api/match-groups/:id` | Match detail + linked audit slice |
| GET | `/api/transactions/:id` | Transaction detail |
| GET | `/api/transactions/:id/nearest-miss` | Counterfactual candidates |
| POST | `/api/qa` | Grounded Q&A with cited IDs |
| GET | `/api/verify-chain` | Live chain integrity check |

All responses are Zod-schema-validated. Every state-changing endpoint appends a hash-chained audit row.

---

## Documentation

- **[docs/DEEP_DIVE.md](docs/DEEP_DIVE.md)** — Full technical deep-dive: every algorithm, every design decision, at a level where you could rebuild the system from the doc alone.
- **[docs/PITCH.md](docs/PITCH.md)** — Three-minute talk track for live presentation.
- **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)** — Frame-by-frame demo video script.

---

## Project structure

```
reconiq/
├── prisma/
│   ├── schema.prisma           # single source of truth for data model
│   └── migrations/
├── src/
│   ├── matching/               # 5 pipeline layers, each pure & testable
│   │   ├── exact.ts
│   │   ├── subsetSum.ts
│   │   ├── feeInference.ts
│   │   ├── embedding.ts
│   │   ├── fuzzyMatch.ts
│   │   └── llmClassify.ts
│   ├── llm/                    # Gemini client + cache + rate limiter
│   ├── metrics/                # precision/recall/cost-of-unmatched-cash
│   ├── agent/                  # Q&A agent with 4 function-calling tools
│   ├── mcp/                    # MCP server wrapping the same tools
│   ├── api/                    # Bun HTTP API + Zod schemas
│   ├── persistence/            # Prisma client + seed
│   └── prompts/                # LLM prompts, versioned by content hash
├── scripts/
│   ├── e2e.ts                  # end-to-end integration test
│   └── determinism.ts          # byte-identical replay proof
├── web/                        # React + Vite + Tailwind dashboard
├── verify-chain.ts             # walk the audit chain, verify every hash
└── docs/
```

---

## Testing

```bash
bun test
```

Coverage:
- API smoke tests (endpoints, CORS, error handling)
- Embedding correctness (normalization, cosine similarity, batch retrieval)
- Subset-sum contracts (unambiguous, ambiguous, signed refunds, complexity caps)
- LLM classification (Zod validation, retry, hash chain integrity, prompt version stability)
- MCP server (tool registration, delegation, error masking)

Plus:
- `verify-chain.ts` — full chain traversal
- `scripts/e2e.ts` — 9-step end-to-end integration
- `scripts/determinism.ts` — two-run byte-identical proof

---

