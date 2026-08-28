# ReconIQ — Project Doc

Razorpay Buildathon 2026 · Track 04 (AI Finance Controller) · IIIT Lucknow

---

## 1. One line

Payment reconciliation engine that treats combinatorics as a math problem and ambiguity as a language problem — deterministic core, AI only where it earns its keep, full audit trail on every decision.

---

## 2. The problem

Payments companies reconcile three data sources every month-end, by hand:

- **Bank statement** — credits hitting the account
- **Gateway settlement report** — what the payment gateway says it paid out
- **Internal ledger** — what the merchant's own system expected

Four concrete reasons this is broken today:

1. **Many-to-one bundling.** One bank credit is usually the sum of dozens of individual gateway transactions settled together.
2. **Amount mismatch.** MDR, GST-on-MDR, TDS, partial refunds, rounding — amounts rarely match exactly.
3. **Inconsistent IDs.** Same transaction is a `UTR` in the bank, a `pay_xxx` in the gateway, an `ORD-xxx` in the ledger.
4. **Binary tooling.** Existing tools do exact-match only. Anything imperfect falls into a manual pile that a human sorts by hand.

Real cost isn't the annoyance — it's **locked-up working capital** (unresolved cash sitting on books) and analyst-hours burned every month.

---

## 3. Why existing approaches fail

Two failure modes on the market:

- **Rule-based tools** — brittle. Exact-match or nothing. Fees, bundles, typos all fall out.
- **LLM-only pipelines** — plausible-sounding but wrong. LLMs are terrible at combinatorial subset selection over hundreds of rows, expensive to run at scale, and unauditable when they get it wrong. A hallucinated match in a ledger is a trust-destroying bug.

ReconIQ's thesis: **use math for the math parts, use AI only for the ambiguous text parts, log every decision either way.**

---

## 4. The idea — four layers, strict separation

### Layer 1 — Deterministic core
Exact hash match first (amount + normalized reference + date window). Then bounded subset-sum DP with parent-pointer reconstruction to solve many-to-one bundling, tolerance band for fees/rounding, offset-indexed to handle signed refunds inside a bundle. All money as integer paise, never floats. AI never touches numeric matching — this is what keeps the core auditable and provably correct.

### Layer 1.5 — Fee-schedule inference (the headline math extension)
Take confirmed bundles from Layer 1, solve for the effective MDR/GST/TDS rates, then re-match remaining candidates against **expected net**, not a fuzzy ±band. Two payoffs: converts fuzzy candidates into deterministic matches (shrinking what the AI layer even sees), and if the inferred rate drifts from the contracted rate, that drift is **fee leakage** — real money surfaced as a finding.

### Layer 2 — AI exception layer
Only runs on what Layer 1 + 1.5 can't resolve.

- **Embeddings + cosine similarity** (pgvector, inside existing Postgres) catch fuzzy text matches — typo'd references, reordered fields, case changes.
- **LLM classification** on genuine leftovers: `DUPLICATE / MISSING_COUNTERPART / TIMING_LAG / OTHER`, with a plain-English root-cause hypothesis.
- Output is **Zod-validated structured JSON only** — freeform text never flows into the database.
- Every AI call logs `modelId` + `promptVersion` (sha256 of prompt template) — a payments judge's first question is "you changed the prompt, how do I re-audit last month's run."

### Layer 3 — Audit + interfaces
- Every decision (algorithmic or AI) writes one row to a **hash-chained AuditTrail** (each row's sha256 includes the previous row's hash — tamper-evident).
- **Dashboard**: match rate by method, exceptions table sortable by risk score, cost-of-unmatched-cash headline number, match-detail explainability view (full audit trail for any match, one click).
- **Live WebSocket push**: matches appear on the dashboard as they resolve during a batch run — no manual refresh.
- **Q&A agent**: function-calling over the DB (four tools: `getTransactionById`, `getExceptionsByClassification`, `getMatchRateByMethod`, `getAuditTrailForMatch`), grounded answers only, cites real transaction IDs — never hallucinates numbers.
- **MCP server** wrapping the same tool set — queryable from Claude Desktop or any other MCP client, not just our own UI.

### Layer 4 — Agentic self-heal loop (human-in-the-loop)
For high-confidence exceptions, the AI proposes a concrete fix (link A+B as a bundle, mark as duplicate, etc.) — never auto-committed. Human reviews on the dashboard, clicks approve/reject. Approved fixes land in an `ExampleBank` and are retrieved via pgvector similarity as **few-shot context** for future classifications — the system sharpens over time without fine-tuning. Every proposal, approval, and rejection is a separate AuditTrail row with the right actor tag.

---

## 5. End-to-end data flow

```
┌─────────────┐ ┌──────────────────┐ ┌────────────────┐
│ Bank CSV /   │ │ Gateway CSV /    │ │ Merchant       │
│ Bank stmt    │ │ Razorpay Settle- │ │ Ledger CSV     │
│              │ │ ments API        │ │                │
└──────┬───────┘ └────────┬─────────┘ └───────┬────────┘
       └────────────┬─────┴────────────┬──────┘
                    ▼                          
           ┌────────────────┐
           │ Ingestion      │ (parse, normalize, paise-cast, signed)
           └────────┬───────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 1  — deterministic │
           │  · Exact hash match      │
           │  · Subset-sum DP         │
           │  · Ambiguity → exception │
           └────────┬─────────────────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 1.5 — fee inference │
           │  Learn MDR/GST/TDS from   │
           │  confirmed bundles → re-  │
           │  match remaining          │
           └────────┬─────────────────┘
                    ▼ (unmatched residual)
           ┌──────────────────────────┐
           │ Layer 2 — AI exception   │
           │  · pgvector fuzzy match  │
           │  · LLM classification    │
           │  · Zod-validated JSON    │
           └────────┬─────────────────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 3 — audit + serve  │
           │  · Hash-chained trail    │
           │  · Metrics engine        │
           │  · Q&A agent + MCP srvr  │
           │  · Dashboard (WebSocket) │
           └────────┬─────────────────┘
                    ▼
           ┌──────────────────────────┐
           │ Layer 4 — self-heal loop │
           │  AI proposes → human     │
           │  approves → ExampleBank  │
           │  → future few-shot ctx   │
           └──────────────────────────┘
```

Design principle: **at every stage, if the system isn't confident, it stops and asks a human — never silently guesses.** Every decision (confident or deferred) lands in the hash-chained audit trail.

---

## 6. Data model (Prisma)

Single unified pool for all raw records — subset-sum and pgvector similarity both query one table, no cross-source joins.

- **TransactionRecord** — every raw row from any source. Fields: `transactionRecordId`, `dataSource` (enum: BANK/GATEWAY/LEDGER), `externalReference`, `amountPaise` (signed integer), `currencyCode`, `transactionDate`, `rawDescription`, `rawPayload` (Json — full original row for audit), `referenceEmbedding` (pgvector), optional `matchGroupId`.

- **MatchGroup** — one resolved match, spans N `TransactionRecord`s across any combination of sources (no junction table needed). Fields: `matchGroupId`, `method` (enum: EXACT/SUBSET_SUM/AI_FUZZY/AI_CLASSIFIED/MANUAL), `confidenceScore`, `status` (enum: MATCHED/PENDING_REVIEW/REJECTED), `runId`, timestamps.

- **AuditTrail** — one row per decision, algorithmic or AI. Fields: `auditTrailId`, `method`, `reason` (plain English), `actor` (enum: SYSTEM/AI/HUMAN), `actorId` (`subsetSum.ts`, `gemini-pro-classifier-v1`, human user id), `metadata` (Json: DP params, score breakdown, `modelId`, `promptVersion`), `rowHash`, `previousRowHash` (SHA-256 chain).

- **UnresolvedException** — anything Layers 1–2 couldn't resolve confidently. Fields: `classification` (enum), `rootCauseHypothesis`, `riskScore`, `transactionRecordIds` (String[] — spans one bank + N gateway rows for ambiguous bundles), `candidateMetadata` (Json — competing subset candidates + scores for AMBIGUOUS_MATCH cases), `totalAmountPaise` (denormalized for fast cost-of-unmatched-cash query), resolution fields, `runId`.

- **ExampleBank** — approved human decisions stored as labeled examples with `actionEmbedding` (pgvector) for similarity retrieval during future LLM calls.

---

## 7. Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (native WebSocket, no build step) |
| ORM / DB | Prisma + Postgres + pgvector extension |
| Deterministic matching | TypeScript (exact hash, subset-sum DP) |
| Embeddings | OpenAI/Gemini embedding API → pgvector column |
| LLM classification | Gemini Pro, structured JSON only, Zod-validated with retry |
| Frontend | React + Tailwind (reuses SkillSync ThemeContext pattern) |
| Real-time | Bun native WebSocket → dashboard push |
| Agent protocol | `@modelcontextprotocol/sdk` (MCP server wrapping Q&A tools) |
| External data | Razorpay test-mode Settlements API |

---

## 8. What makes it stand out for judges

- **Real Razorpay test-mode Settlements API data** — not just synthetic CSVs. Proves it works on Razorpay's actual data shapes.
- **Fee-schedule inference** — nobody else will reverse-engineer the fee schedule. It's the single differentiator most likely to be memorable.
- **Cost-of-unmatched-cash headline** — turns abstract match-rate into a ₹ figure. Payments judges feel this immediately.
- **Confidence score with visible breakdown** — amount weight × date weight × text-similarity weight. Explainability wins.
- **Hash-chained audit trail** — tamper-evident, one-command verify. Nobody else at a hackathon builds this.
- **Deterministic replay proof** — same input twice → identical hash chain. Kills the "how do I know the AI didn't quietly move something" question.
- **LLM-only baseline comparison in the pitch deck** — proves the thesis instead of asserting it.
- **MCP server exposure** — real interop story, not just a buzzword.
- **WebSocket live updates** — dashboard feels alive during demo, not static.

---

## 9. Deliberately not doing (with reasons)

| Rejected | Why |
|---|---|
| Predictive / pre-matching | Contradicts the auditable-and-provably-correct thesis; would train on my own generator, not reality |
| Reconciliation Health Score | Arbitrary composite; first judge question is "why those weights" |
| LLM-as-judge eval | Have ground truth — comparing to ground truth beats an LLM's opinion of it |
| PDF/vision ingestion | Vision extraction is commodity in 2026; weak differentiator |
| NL rule editor | High effort, low substance |
| Compliance PDF export | Nothing here that isn't already visible in the dashboard |
| Multi-currency | Signals nothing a judge will test |
| C++ subprocess for DP | JSON marshalling overhead across the boundary would eat any speedup at 10k scale |
| Langfuse | New infra for zero signal over a 40-line custom tracer |

---

## 10. Status (as of Aug 25)

**Done:** Prisma schema (with all Day-3 patches applied and `prisma validate` clean), synthetic data generator scaffold, `exact.ts` with hash-chained AuditTrail (`verify-chain.ts` PASS).

**In progress right now:** generator correctness pass (P2c) — MANY_TO_ONE bundles, negative refund rows, `matchGroupId` leakage, and fee-schedule application to EXACT cases all need fixing before subset-sum has anything real to work against.

**Next:** subset-sum DP scaffolding, then I write the DP itself against failing tests.

**Cut-line order** (first thing to fall if the calendar bites, last thing safe):
1. Graph matching (MCMF) — Day 7 conditional
2. MCP server — Day 13
3. ExampleBank few-shot loop — Day 12
4. Pipeline-trace streaming — Day 11

Everything above the line is polish. Core matching + fee inference + AI exception layer + audit trail + dashboard alone is a complete, judge-worthy submission.

---

## 11. The one-sentence summary

Every transaction flows through a strict waterfall — exact match → subset-sum (handling refunds and ambiguity) → fee inference → AI fuzzy → AI classification — and at every stage, if the system isn't confident, it stops and asks a human rather than guessing, with every decision written to a hash-chained audit trail queryable in plain English.
