# ReconIQ

> **One-Line Pitch:** Payment reconciliation engine that treats combinatorics as a math problem and ambiguity as a language problem — deterministic core, AI only where it earns its keep, full audit trail on every decision.

ReconIQ automates multi-source payment reconciliation across bank statements, payment gateway settlement reports, and merchant ledgers. It replaces brittle rule-based tools and inaccurate LLM-only scripts with a mathematically grounded, layered engine featuring bounded dynamic programming subset-sum matching, automated fee schedule regression, character trigram TF-IDF fuzzy matching, schema-constrained LLM root-cause classification, interactive human-in-the-loop exception resolution, and continuous few-shot self-healing over a tamper-evident SHA-256 audit ledger.

---

## The Problem

At month-end, every payments company and D2C merchant must answer one question for every rupee that moved: *did this bank credit, this gateway settlement, and this order in our ledger all refer to the same real transaction?*

Today, three files arrive at month-end:
1. **Bank Statement** — cash that actually landed in the bank account.
2. **Gateway Settlement Report** — what the payment gateway (e.g., Razorpay) states was paid out.
3. **Merchant Ledger** — orders and payouts expected by the internal accounting system.

They rarely line up cleanly due to five real-world friction points:
- **Many-to-One Bundling:** Gateways batch dozens of customer payments into single bulk settlement credits.
- **Deducted Fees:** Gateway MDR cuts, GST on MDR, and TDS mean bank deposits equal `gross_sum - fees`.
- **Negative Refunds:** Chargebacks and customer refunds net directly against positive settlements within the same batch.
- **Inconsistent Identifiers & Typos:** The bank sees a `UTR`, the gateway sees `pay_ABC123`, and the ledger sees `ORD-ABC123` with occasional typo variations.
- **Timing Lags:** Payouts initiated on the 31st land in the bank on the 2nd or 3rd of the following month.

Traditional tools perform **exact 1:1 matching or nothing**. Everything else lands in a massive manual queue. Unmatched transactions represent **locked-up working capital** — money visible on bank records that finance teams cannot confidently spend because its source remains unverified.

---

## The Insight

ReconIQ is built on a fundamental realization: two issues that appear identical are actually two completely different problems requiring completely different tools.

- **Bundling, fees, and refunds are a math problem.** They are combinatorial knapsack problems with an exact numerical answer. They require a deterministic algorithm (bounded dynamic programming) that either proves a match or admits ambiguity. An AI guessing at ledger sums creates hallucinated financial records.
- **Typos and missing counterparts are a language problem.** Mathematical algorithms cannot determine that `RAZPAY-SET-4892` and `RZPAY-SETT-4892` refer to the same settlement. Text embeddings and structured LLM reasoning excel at this.

**The ReconIQ Philosophy:** *Use math where math wins, use AI where AI earns its keep, and log every decision in a tamper-evident cryptographic audit chain.*

---

## Architecture

```text
┌─────────────┐ ┌──────────────────┐ ┌────────────────┐
│ Bank CSV /   │ │ Gateway CSV /    │ │ Merchant       │
│ Bank stmt    │ │ Razorpay Settle- │ │ Ledger CSV     │
│              │ │ ments API        │ │                │
└──────┬───────┘ └────────┬─────────┘ └───────┬────────┘
       └────────────┬─────┴────────────┬──────┘
                    ▼                          
           ┌────────────────┐
           │ Ingestion      │ (parse, normalize, paise-cast, signed integers)
           └────────┬───────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 1  — Deterministic │
           │  · Exact hash match      │
           │  · Subset-sum DP         │
           │  · Ambiguity → exception │
           └────────┬─────────────────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 1.5 — Fee Inference │
           │  Learn MDR/GST/TDS from   │
           │  confirmed bundles → re-  │
           │  match remaining          │
           └────────┬─────────────────┘
                    ▼ (unmatched residual)
           ┌──────────────────────────┐
           │ Layer 2 — AI Exception   │
           │  · TF-IDF fuzzy match    │
           │  · LLM classification    │
           │  · Zod-validated JSON    │
           └────────┬─────────────────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 3 — Audit & Serve  │
           │  · Hash-chained trail    │
           │  · Metrics engine        │
           │  · Q&A agent + MCP srvr  │
           │  · Dashboard (WebSocket) │
           └────────┬─────────────────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 4 — Self-Heal Loop │
           │  AI proposes → human     │
           │  approves → ExampleBank  │
           │  → future few-shot ctx   │
           └──────────────────────────┘
```

---

## Layer Overview

| Layer | What It Does | Why It Exists |
|---|---|---|
| **Ingestion** | Reads 3 CSV sources, casts all currency to signed 64-bit integer paise | Floating-point numbers silently corrupt financial balances; integer paise is non-negotiable |
| **Layer 1: Exact Match** | 1:1 match on amount + normalized reference + ±3-day window | High-throughput, zero-cost, provably correct matching for the standard majority |
| **Layer 1: Subset-Sum DP** | Bounded dynamic programming knapsack with offset indexing for negative refunds | Reconciles many-to-one settlement batches without guessing; computes ambiguity gaps |
| **Layer 1.5: Fee Inference** | Solves for effective MDR/GST/TDS rates across confirmed bundles and re-matches residuals | Converts fuzzy tolerance candidates into deterministic matches and detects fee leakage |
| **Layer 2a: AI Fuzzy Match** | Character trigram TF-IDF vector embeddings with cosine similarity thresholds | Disambiguates candidate subsets and catches reference typos without external API calls |
| **Layer 2b: LLM Classify** | Generates root-cause hypotheses (`DUPLICATE`, `MISSING_COUNTERPART`, `TIMING_LAG`, `OTHER`) | Classifies genuine residuals into structured, Zod-validated JSON with model/prompt audit tracking |
| **Layer 3: Audit Trail** | SHA-256 hash-chained immutable ledger linking every system and human action | Tamper-evident ledger; any modification breaks the linear cryptographic chain |
| **Layer 3: Dashboard & WS** | React frontend with live metrics, exception triage, and native WebSocket stream | Provides real-time visibility into working capital, match rates, and stage execution traces |
| **Layer 3: Q&A Agent** | Natural language query interface powered by database function calling | Answers complex questions by citing real database entity IDs with zero hallucination |
| **Layer 3: MCP Server** | Model Context Protocol server exposing 4 reconciliation tools over `stdio` | Enables external LLM clients (such as Claude Desktop) to query ReconIQ directly |
| **Layer 4: Self-Heal Loop** | Converts human approvals into few-shot context stored in `ExampleBank` | Continuously sharpens future LLM classifications without expensive model fine-tuning |

---

## Getting Started

### Prerequisites
- **[Bun](https://bun.sh/)** `>= 1.1.0`
- **PostgreSQL** database (Local or [Neon](https://neon.tech/)) with `pgvector` extension

### 1. Environment Setup
```bash
cp .env.example .env
# Configure DATABASE_URL and GEMINI_API_KEY in .env
```

### 2. Database Migration & Seed
```bash
bun install
bunx prisma migrate deploy
bunx prisma generate
bun run src/persistence/seed.ts
```

### 3. Start Backend API & WebSocket Server
```bash
# Runs Bun native HTTP & WebSocket server on http://localhost:3000
bun run src/api/server.ts
```

### 4. Start Web Dashboard
```bash
cd web
bun install
bun run dev
# Dashboard available on http://localhost:5173
```

### 5. Run Verification & Test Suites
```bash
# 1. Verify single continuous linear SHA-256 audit chain
bun run verify-chain.ts

# 2. Run byte-identical determinism proof
bun run scripts/determinism.ts

# 3. Run full 9-step End-to-End integration test suite
bun run scripts/e2e.ts

# 4. Run automated test suite (43 tests across 5 suites)
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

## Numbers to Know

All metrics pulled directly from actual pipeline reports (`metrics_report.json`, `baseline_report.json`, and `determinism_proof.json`):

### 1. Headline Reconciliation Metrics (`metrics_report.json`)
- **Total Match Rate:** **54.45%** (220 match groups formed across 1,596 ingested transactions)
- **Cost of Unmatched Cash:** **₹34,85,984.06** (348,598,406 paise across 169 unmatched bank records)
- **Layer 1 Exact Match:** 130 bank / 130 gateway records matched with **100.0% precision**
- **Layer 1.5 Fee Inference:** Inferred MDR/GST/TDS rate of **3.3646%** ($\sigma = 0.00108$) across 61 training pairs
- **Layer 2a AI Fuzzy Disambiguation:** 100% catch rate on target ground-truth fuzzy pairs (5/5)
- **Layer 2b LLM Classify:** 417 structured hypotheses generated (`335 MISSING_COUNTERPART`, `21 TIMING_LAG`, `61 OTHER`) with average confidence **0.8255** and **100% cache hit rate** on replay

### 2. Layered Engine vs. LLM-Only Baseline (`baseline_report.json`)

Evaluating against a 148-transaction sample (`50 bank`, `98 gateway`):

| Evaluation Metric | ReconIQ Layered Engine | LLM-Only Baseline (`gemini-1.5-pro`) |
|---|---|---|
| **Precision** | **100.0%** (Zero false matches) | **49.74%** (1 in 2 proposals is wrong) |
| **Spurious Matches** | **0** | **1** (hallucinated match into accounting ledger) |
| **Deterministic Cost** | **₹0.00** ($0.00 on deterministic core) | **12,366 tokens** consumed per sample batch |
| **Latency / Throughput** | **< 1 ms** algorithmic execution | **15 ms** (cached) to multiple minutes live |
| **Auditability** | **100% Cryptographic SHA-256 Proof** | Non-deterministic, unverifiable freeform output |

### 3. Cryptographic Determinism Proof (`determinism_proof.json`)
```text
===============================================================
                 Determinism Proof: PASSED                     
===============================================================
✓ MATCH GROUPS DETERMINISM: 100% (221/221 identical)
✓ AUDIT CHAIN DETERMINISM:  100% (787/787 byte-identical rowHashes)
✓ CRYPTOGRAPHIC REPRODUCIBILITY: Zero divergence across all deterministic and AI layers.
===============================================================
```

---

## What's Deliberately Not Built (And Why)

| Deliberately Omitted Feature | Architectural Rationale |
|---|---|
| **Predictive / Pre-Matching** | Contradicts the auditable-and-provably-correct thesis; creates speculative entries rather than verified matches. |
| **Composite "Reconciliation Health Score"** | Arbitrary weighted metrics lack financial meaning; finance teams require concrete ₹ cost-of-unmatched-cash figures. |
| **LLM-as-a-Judge Evaluation** | Verifying against mathematical ground truth is provably objective; LLM self-evaluations introduce circular bias. |
| **PDF / Vision OCR Ingestion** | Commodity OCR adds fragile parsing overhead; focus is dedicated to the core settlement & matching engine. |
| **Natural Language Rule Editor** | High UI complexity with low substance compared to deterministic mathematical scoring and few-shot vector self-healing. |
| **Compliance PDF Exporter** | Redundant when all raw transaction payloads and decisions are continuously verified in the live audit ledger. |
| **Multi-Currency Conversion** | Single-currency integer paise avoids external FX rate fluctuation noise during benchmark verification. |
| **C++ Subprocess for Dynamic Programming** | JSON marshalling overhead across subprocess boundaries exceeds computation time for $\le$ 10k transaction batches. |
| **External Observability (Langfuse/W&B)** | Eliminated external third-party dependencies in favor of an in-process, zero-overhead tracer. |

---

## Known Limitations

- **MCMF Graph Overlap Optimization:** For extremely dense combinatorial pools with overlapping multi-subset collisions, a global Min-Cost Max-Flow (MCMF) formulation can resolve simultaneous subsets globally. Evaluated and deferred as unnecessary for standard monthly batch sizes ($\le$ 10k transactions).
- **Audit Chain Linearization:** Unified fee-inference side chain into the primary linear SHA-256 audit ledger (resolved in Day 15).

---

## 30-Second Demo Path

Follow this path to experience the complete live workflow:

1. **Dashboard Overview (`/`):**
   - Watch the **Cost of Unmatched Cash** (`₹34,85,984.06`) count up smoothly in the headline card.
   - Inspect the 4-tile KPI grid showing exact, subset-sum, and AI disambiguation rates.
   - Check the global footer badge: `✓ MAIN CHAIN OK (786 rows) · 0 link breaks`.
2. **Exception Triage (`/exceptions`):**
   - Filter exceptions by `MISSING_COUNTERPART` or `AMBIGUOUS_MATCH`.
   - Click on exception `ss_ex_tx_aa5ltds16g` (`₹6,104.34`).
3. **Interactive Side-by-Side Disambiguation (`/exceptions/ss_ex_tx_aa5ltds16g`):**
   - Compare competing candidate subsets side-by-side. Inspect the score breakdown: amount precision, date proximity, and subset size penalty (Candidate 0 includes refund records `-₹529.42` and `-₹1,877.00`).
   - Click **"Approve this match"** on Candidate 0.
   - Observe the instant toast confirmation, human audit row creation, and automatic redirect to `/match-groups/:newId`.
4. **Audit Trail & Hash Chain Inspection (`/match-groups/:id`):**
   - Inspect the verified `MatchGroup` and view the full SHA-256 hash-chain audit trail showing timestamp, actor (`HUMAN`), and parent hash links.
5. **Self-Healing ExampleBank (`/example-bank`):**
   - Navigate to `/example-bank` to see the approved decision saved as a canonical vector example for future few-shot LLM classifications.
6. **Pipeline Trace Inspection (`/transactions/:id`):**
   - Click on an unmatched transaction (e.g., from `/exceptions`), click **"Inspect Pipeline Trace"**, and watch the stage-by-stage evaluation playback.
7. **Autonomous Q&A Agent (`Cmd+K` / Floating Bar):**
   - Ask: *"Why wasn't tx_aa5ltds16g matched by exact match?"*
   - Observe the agent execute database tool calls and return a grounded answer citing real transaction IDs.
