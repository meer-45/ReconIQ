# ReconIQ — Deep Technical Documentation

> A payment reconciliation engine that treats combinatorics as a math problem
> and ambiguity as a language problem — with a deterministic core, AI only
> where it earns its keep, and a full audit trail on every decision.

This document is written for a reader who knows nothing about payment
reconciliation and by the end should understand every design choice
in the codebase deeply enough to have built it themselves.

---

## Table of contents

**Part I — Context**
1. What payment reconciliation is
2. Why the records don't match
3. Why existing tools fail
4. The insight ReconIQ is built on

**Part II — Architecture**
5. High-level data flow
6. Data model
7. Stack choices and why

**Part III — The deterministic core (Layer 1)**
8. Layer 1a — Exact match
9. Layer 1b — Subset-sum DP
10. Layer 1.5 — Fee-schedule inference

**Part IV — The AI exception layer (Layer 2)**
11. Layer 2a — Embedding fuzzy match
12. Layer 2b — LLM classification

**Part V — Trust and verification (Layer 3)**
13. Hash-chained audit trail
14. Determinism proof

**Part VI — Interfaces**
15. Metrics engine
16. Q&A agent with function calling
17. Dashboard and WebSocket streaming
18. MCP server

**Part VII — Learning (Layer 4)**
19. Self-heal loop and ExampleBank

**Part VIII — Meta**
20. What's deliberately not built (and why)
21. What makes this different from existing tools

---

# Part I — Context

## 1. What payment reconciliation is

Every merchant that accepts online payments faces one recurring question
at the end of every day, week, and month: for every rupee that moved,
does everyone's story agree?

Three parties keep independent records of the same money:

- The **bank** sees money arriving into the merchant's current account,
  as a line item on the bank statement. It sees one line per settlement —
  usually a bundle of many customer payments — with the bank's own
  identifier (a UTR — Unique Transaction Reference number in India) and
  the settlement amount, net of fees.

- The **payment gateway** (Razorpay, Stripe, PayU) has processed each
  individual customer transaction as it happened. It has a row per
  transaction with its own gateway-side identifier (`pay_ABC123`), the
  gross amount, the fee it charged, and the net amount it later paid
  out to the merchant as part of a settlement batch.

- The **merchant's own system** — an ERP, a Shopify store, a custom
  order management tool — has a row per order with its own identifier
  (`ORD-ABC123`), the customer, the SKU, and the expected amount.

At the end of the month, an analyst at the merchant is expected to sit
down with three CSVs and answer, for every line on the bank statement:
which gateway transactions were bundled into this settlement, and which
merchant orders do those transactions correspond to.

That process is called **reconciliation**. Every match is a rupee
accounted for. Every unresolved line is either a bug in one of the
three systems or genuinely unresolved money — money the merchant can
see arrived but cannot yet spend confidently because they don't know
what it was for.

Reconciliation is not glamorous. It is also mostly done by hand or
with tools so brittle they only catch the easiest cases. That is the
problem this project attacks.

## 2. Why the records don't match

The three records rarely line up trivially. Five reasons, each of
which drives one of the algorithmic layers of the system.

### 2.1 Bundling (many-to-one)

Payment gateways don't wire one bank credit per customer transaction.
That would be one bank line per customer and would drown the bank
in noise. Instead, they batch all the day's transactions into a
single settlement and wire the merchant the sum. So a bank statement
line reading "credit ₹87,300 from RAZORPAY" is very likely the sum
of forty individual customer payments that occurred that day.

This means matching is inherently combinatorial. Given a bank credit
of ₹87,300 and 200 unmatched gateway transactions, which subset of
those 200 sums to ₹87,300? Naively there are $2^{200}$ subsets. The
subset-sum DP (§9) is what makes this tractable.

### 2.2 Fees

The gateway does not wire the full gross to the merchant. It deducts:

- **MDR (Merchant Discount Rate)**, a percentage of gross — say 2%
- **GST on MDR**, currently 18% of the MDR in India
- **TDS**, a small percentage withheld for tax purposes

So the bank credit is not `sum of gross` but

    net = sum(gross) − MDR% × sum(gross) − GST × MDR% × sum(gross) − TDS

Naive rule-based tools treat this as noise and reconcile with a wide
tolerance band ("match if amount is within ±3%"). That works when
volumes are low and fee schedules are stable. It quietly breaks when
gateways change their pricing, when a merchant has multiple pricing
tiers on the same account, or when the analyst gets a bill that
doesn't match what the contract says they should be paying.

ReconIQ's Layer 1.5 (§10) reverse-engineers the effective rate from
confirmed bundles instead of treating fees as noise.

### 2.3 Refunds inside a bundle

A refund is a negative payment. If a customer refunds ₹200 in the
same settlement batch that has ₹5,000 of sales, the bank sees a
credit of ₹4,800, not ₹5,200. The subset-sum problem is therefore
over **signed** integers, not positive ones. Most textbook subset-sum
implementations assume nonneg values and quietly fail when the input
has negatives. The offset-indexed DP array in §9.4 is how ReconIQ
handles this.

### 2.4 Different names for the same thing

The bank calls the settlement `UTR_ABC1234567`.
The gateway calls the batch `pay_XYZ456`.
The merchant calls the order `ORD-XYZ456`.

Sometimes there is a shared substring (`XYZ456` in the last two),
sometimes not. Sometimes the string has a typo. Sometimes it's
truncated. Sometimes it's been mangled by a Windows Excel export.
The reference matching problem is a **string similarity** problem,
which is what the embedding fuzzy layer (§11) handles.

### 2.5 Timing lag

A transaction on the 31st of the month is often settled by the
gateway to the bank on the 1st or the 3rd of the following month.
A "correct" match therefore spans months. Traditional tools reconcile
one calendar month at a time and treat late-arriving settlements as
unresolved, which then need manual sorting the next month.

ReconIQ's date-window logic (±3 days by default, extendable via the
classification layer identifying `TIMING_LAG` exceptions) accepts
this as normal and never treats it as an anomaly.

## 3. Why existing tools fail

Two dominant failure modes on the market today.

**Rule-based reconciliation tools** (SAP, Oracle FICO, various SaaS
tools) match on exact identifier equality with a tolerance band on
amount. They resolve maybe 60–80% of the easy cases and drop the
rest into a manual queue. They cannot solve bundling (that's a
combinatorial problem), cannot handle typos in references, and
cannot explain themselves beyond "it matched the rule."

**LLM-only reconciliation prototypes** (a 2024–2026 fashion) throw
all three CSVs at a large language model with a prompt like
"reconcile these transactions." This looks impressive in a demo
because the LLM confidently produces matches. It is dangerous in
production for three reasons:

- LLMs are terrible at combinatorial subset selection over hundreds
  of rows. They approximate. On our benchmark (§16), a Gemini Flash
  baseline achieved 49.7% precision — meaning half its confident
  matches were wrong.
- Every call costs money and time. Reconciling 10,000 transactions
  through an LLM in one pass is neither cheap nor fast.
- The output is unauditable. When the LLM says "I matched A with B
  because they seem related," there is no way to re-derive that
  decision or to verify no tampering happened between the analyst's
  desk and the auditor's desk.

A hallucinated match in a ledger is a trust-destroying bug. It is
not a bug you can allow yourself to have once and fix.

## 4. The insight ReconIQ is built on

Two problems that look like one are actually two problems.

**Bundling and fees are a math problem.** They are combinatorial and
numeric. There is a right answer to "which subset of these 200 gateway
transactions sums to ₹87,300 after fees." You want a deterministic
algorithm that either finds it or admits it cannot. You do not want
an AI guessing.

**Typos and missing counterparts are a language problem.** No amount
of arithmetic tells you `RAZPAY-SET-4892` and `RZPAY-SETT-4892` are
the same string. That is what modern text similarity — embeddings,
cosine distance, and where those fail, an LLM classifier — is
genuinely good at.

Every other reconciliation tool on the market either does dumb
exact-match and gives up on the interesting cases, or throws
everything at an LLM and hopes. ReconIQ does neither. It uses
math where math wins, AI where AI earns its keep, and logs every
decision in a tamper-evident chain so any auditor can re-derive
what happened.

The three rules of the system:

1. **Deterministic first, AI last.** Cheaper, faster, more auditable
   layers run first. Only genuine residual ambiguity reaches the LLM.
2. **Stop and ask, don't guess.** At every stage, if the system is
   not confident enough to auto-commit, it produces a structured
   exception with the candidate reasoning attached, and a human
   picks. It never silently resolves ambiguity.
3. **Log everything.** Every decision — algorithmic or AI or human —
   writes one row to a SHA-256 hash-chained audit trail. Tamper with
   any row and every subsequent row breaks.

The rest of this document is what those rules force you to build.

---

# Part II — Architecture

## 5. High-level data flow

```
BANK CSV         GATEWAY CSV        LEDGER CSV
    │                │                    │
    └────────────────┼────────────────────┘
                     ▼
              Ingestion
        (parse, normalize, paise-cast, sign)
                     │
                     ▼
         Layer 1a — Exact match
       amount + normalized ref + ±3d window
       commits only if unique candidate per side
                     │
                     ▼
         Layer 1b — Subset-sum DP
       many-to-one bundling with tolerance,
       signed amounts, capped subset size,
       parent-pointer reconstruction
                     │
                     ▼
        Layer 1.5 — Fee-schedule inference
       linear regression on confirmed bundles,
       re-match remaining vs expected net
                     │
                     ▼
        Layer 2a — Embedding fuzzy match
       char-trigram TF-IDF + cosine similarity
       0.60–0.85 band → PENDING_REVIEW
                     │
                     ▼
        Layer 2b — LLM classification
       Gemini structured JSON, Zod-validated,
       promptVersion + modelId logged
                     │
                     ▼
      Layer 3 — audit + interfaces
       hash-chained ledger, metrics, Q&A,
       MCP server, dashboard, WebSocket
                     │
                     ▼
      Layer 4 — self-heal loop
       human approvals → ExampleBank →
       few-shot context for future LLM calls
```

Every stage is a strict function of the previous stage's output plus
the input data. The system never mutates upstream state. This is what
makes the determinism proof (§14) work.

## 6. Data model

The Prisma schema uses five core entities. Each is chosen to make
one class of query fast and one class of decision auditable.

### 6.1 TransactionRecord

Every raw row from any source lands here. One unified pool — no
separate `BankRow`, `GatewayRow`, `LedgerRow` tables — because both
subset-sum and pgvector similarity queries need to scan a unified pool
and the alternative (three tables plus a junction) would multiply the
join complexity without adding meaning.

Key fields:

- `transactionRecordId` — primary key, UUID.
- `dataSource` — enum: `BANK`, `GATEWAY`, `LEDGER`.
- `externalReference` — the identifier from that source.
- `amountPaise` — **signed integer**. Never a float. Refunds are
  negative. Rounding to paise (100 paise = 1 rupee) means no FP
  drift ever. (See §6.5 on this.)
- `currencyCode` — always `INR` for the demo.
- `transactionDate` — datetime with source-side precision.
- `rawDescription` — free-text field the source provided.
- `rawPayload` — Json blob of the entire original row. Useful for
  audit ("show me exactly what the bank sent us") and never null.
- `referenceEmbedding` — pgvector column, populated by Layer 2a.
- `matchGroupId` — optional foreign key. Once matched, points to
  the `MatchGroup`.

### 6.2 MatchGroup

One resolved match — a set of `TransactionRecord`s that are the same
underlying money.

Key fields:

- `method` — enum: `EXACT`, `SUBSET_SUM`, `FEE_INFERENCE`, `AI_FUZZY`,
  `AI_CLASSIFIED`, `MANUAL`.
- `confidenceScore` — float in [0, 1]. Deterministic layers write
  1.0. Fuzzy and LLM layers write a genuine similarity or model
  confidence.
- `status` — enum: `MATCHED`, `PENDING_REVIEW`, `REJECTED`.
- `runId` — allows multiple pipeline runs to coexist and be aged
  independently.

There is no junction table between `MatchGroup` and
`TransactionRecord`. Instead, each `TransactionRecord` carries a
nullable `matchGroupId`. This is a deliberate simplification —
every record is in at most one match group, which is a domain
invariant we want the schema to enforce.

### 6.3 AuditTrail

One row per decision, algorithmic or AI or human.

Key fields:

- `method`, `reason` (plain English), `actor` (`SYSTEM`, `AI`,
  `HUMAN`), `actorId` (`subsetSum.ts`, `gemini-3.5-flash-lite`,
  a human user id).
- `metadata` — Json. From Layer 2 onward this includes `modelId`
  and `promptVersion` (a SHA-256 of the prompt template file), so
  a future auditor can ask "you changed the prompt, how do I
  re-audit last month's run?" and the answer is in this field.
- `rowHash` — SHA-256 of the row's content plus `previousRowHash`.
- `previousRowHash` — the previous row's hash. The genesis row uses
  a constant genesis hash (all zeros or a documented constant).

This is a hash-chained ledger — §13 covers the tamper-evidence
proof.

### 6.4 UnresolvedException

Anything that Layers 1 and 2 couldn't resolve confidently. An
ambiguous bundle, a fuzzy match below the auto-commit bar, an
LLM classification with confidence 0.7.

Key fields:

- `classification` — enum: `AMBIGUOUS_MATCH`, `DUPLICATE`,
  `MISSING_COUNTERPART`, `TIMING_LAG`, `OTHER`.
- `rootCauseHypothesis` — free text from the LLM classifier.
- `riskScore` — a float used for sorting the exceptions dashboard.
- `transactionRecordIds` — `String[]`. An ambiguous bundle spans
  one bank record plus N gateway records. A single FK would not
  express this.
- `candidateMetadata` — Json. For `AMBIGUOUS_MATCH`, this holds
  the competing subset candidates plus their score breakdowns.
- `totalAmountPaise` — denormalized so the cost-of-unmatched-cash
  headline is a single scan, not a join-and-sum.

### 6.5 The paise / floats decision

This is the single most important schema decision.

Never store money as a float. `0.1 + 0.2` does not equal `0.3` in
IEEE 754. Silent 1-paise rounding errors accumulated across a
month's reconciliation are how systems that "always work" one day
produce a mismatch and no one can figure out why.

Multiply everything by 100 at ingestion. Store `1523447` for
₹15,234.47. Every arithmetic operation in the codebase is over
integers. Display formatting (the Indian comma grouping used
across the frontend) divides by 100 at render time only.

### 6.6 ExampleBank

For the self-heal loop (§19). Every human approval writes a row
here with the exception snapshot, the correct action, and an
embedding of the action. Future LLM classifications retrieve
similar past examples and inject them as few-shot context.

## 7. Stack choices

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun | Native TypeScript, native WebSocket, no build step, fast startup for CLIs. |
| ORM | Prisma | Type-safe queries, versioned migrations, first-class JSON columns and enums. |
| DB | Postgres | Standard. Chosen for pgvector, which extends it into a vector store. |
| Vector | pgvector | Same Postgres, no separate service. `<->` operator in SQL. |
| Deterministic matching | Plain TypeScript | Every layer is a pure function of inputs — no framework needed. |
| Embeddings | Character-trigram TF-IDF (local) | Deterministic, no API cost, sufficient for the reference-string similarity task. See §11 for why not OpenAI/Gemini embeddings. |
| LLM classification | Gemini 3.5 Flash-Lite | Free tier (12 req/min), structured JSON output, cheap tokens. |
| Frontend | React + Vite + Tailwind | Fast dev loop, no CSS framework overhead. |
| Real-time | Bun native WebSocket | Zero dependencies. |
| Agent protocol | `@modelcontextprotocol/sdk` | The emerging standard for tool-exposing servers. |

---

# Part III — The deterministic core (Layer 1)

This is the most important part of the system. Everything the AI
layers do is on the residual that these three layers could not
resolve. Getting these right shrinks the LLM workload from 10,000
rows to 400 rows and gives the whole system its correctness story.

## 8. Layer 1a — Exact match

The cheapest, fastest, most trustworthy layer. Handles the easy
majority and gets out of the way.

### 8.1 The idea

Two `TransactionRecord`s from different sources match exactly if:

- Their signed `amountPaise` is equal.
- Their normalized `externalReference` is equal.
- Their `transactionDate`s are within a ±3 day window.

A match commits **only if there is exactly one candidate on each
side**. Ties fall through to Layer 1b — this rule prevents Layer 1a
from stealing transactions that actually belong to bundles.

### 8.2 Reference normalization

Reference strings come in inconsistent formats. Before hashing, we
normalize:

- Uppercase.
- Strip whitespace.
- Strip source-specific prefixes: `UTR_`, `pay_`, `gtx_`, `ORD-`.
- Strip trailing punctuation and internal separators (`-`, `_`, `.`).

The output is a "root" identifier that the three sources should
share for the same underlying transaction. `UTR_ABC-123` and
`pay_abc123` both normalize to `ABC123`.

This normalization is deliberately conservative. It won't rescue
typos (`ABC12E`) — that's what Layer 2a is for. It only removes
purely cosmetic differences that carry no information.

### 8.3 The hashing

For each candidate, compute a match key:

    key = SHA-256(normalizedRef + "|" + amountPaise + "|" + dateBucket)

where `dateBucket` is the day (`YYYY-MM-DD`) rounded to a 3-day
window. Two records hashing to the same key are candidates for
a match.

Bucketing means that at the ±3 day boundary, some genuine matches
will miss (the two records happen to hash into different buckets).
To cover this, we hash into three overlapping buckets per record:
today's, yesterday's, tomorrow's. A record therefore appears in
three hash tables; candidates are looked up in all three.

### 8.4 The uniqueness rule

Given a bank record with a match key that also appears in the
gateway hash table:

- If exactly one gateway record collides, commit the match.
- If two or more gateway records collide (a common case with
  round-number transactions like ₹1,000 that many customers
  might pay), do not commit. Fall through to Layer 1b, which
  will try to bundle them.

Committing on the first hit here is a silent correctness bug —
you'd be stealing rows from bundles. The uniqueness rule is what
makes Layer 1a safe to run before Layer 1b.

### 8.5 Result

On the current test dataset: 130 committed matches, 100% precision
against ground truth. Recall is lower because many easy cases
sit inside bundles and correctly fall through.

## 9. Layer 1b — Subset-sum DP

The algorithmic heart of the system. This is the layer that
existing rule-based tools cannot do, and the layer LLM-only tools
approximate badly.

### 9.1 The problem

Given a bank credit of ₹X and a pool of N unmatched gateway
transactions with signed amounts, find a subset of the pool
whose sum equals X (within a small tolerance for rounding),
whose dates fall within a window of the bank credit, and
whose size is bounded (real bundles are usually 5–50
transactions, not 500).

### 9.2 Why naive approaches fail

Enumerating all subsets is $O(2^N)$. For N=200, that's roughly
$10^{60}$ subsets. This is not viable.

Greedy approaches ("keep adding the biggest transaction until
the target is reached") are wrong because subset-sum is
NP-hard in general — greedy is a heuristic that can miss valid
answers or return wrong ones. Real bundles have refunds inside
them (negative amounts), which breaks greedy immediately.

### 9.3 The dynamic programming formulation

We use the classic subset-sum DP with a twist.

Let `dp[j]` be a boolean: "is the target amount `j` achievable
as a sum of some subset of the pool?"

- `dp[0] = true` (the empty subset sums to 0).
- For each transaction with amount `a`, update
  `dp[j] |= dp[j − a]` for all `j`.

After processing all transactions, `dp[X]` tells you whether
the target is achievable.

Complexity: $O(N \cdot X)$. For X in paise (say ₹1,00,000 =
10,000,000 paise) and N = 200, this is 2 × 10^9 boolean
updates — too slow.

Two tricks to bring it down to interesting scale:

1. **Bucket the target.** Round the target to nearest ₹1 (100
   paise), and store the DP in ₹1 units, then verify to the
   exact paise once a subset is found. This shrinks X by 100x.
2. **Pre-filter the pool.** Restrict the candidate pool to
   transactions within the date window and within a plausible
   magnitude of the target. This shrinks N.

After these, a typical query is over N ≈ 30 and X ≈ 100,000 —
manageable at 3 × 10^6 updates per query.

### 9.4 Parent-pointer reconstruction

Standard DP tells you *whether* a subset exists. You need to
know *which subset*. For that, maintain a parent-pointer table:

    parent[j][i] = pool[i]  if dp[j] first became true by adding pool[i]

After the DP fills in, reconstruct the subset by walking
backward from `dp[X]`:

    subset = []
    j = X
    while j > 0:
        i = parent[j][last-set-index]
        subset.append(pool[i])
        j -= pool[i].amount

Every subset-sum result therefore carries with it the exact
list of transactions that produced it, ready to be written
into `MatchGroup.transactionRecordIds`.

### 9.5 Signed amounts (refunds)

Textbook subset-sum assumes nonneg values because the DP index
`j` ranges over `[0, X]`. With negative values (refunds), a
partial subset can have a sum less than 0, and standard
indexing breaks.

The fix is an **offset-indexed** DP array. Compute the sum
of all positive amounts (upper bound) and the sum of all
negative amounts (lower bound). Then

    dp[j + offset]  for j in [lowerBound, upperBound]

where `offset = −lowerBound`. Every valid partial sum,
positive or negative, maps to a non-negative array index.

The reconstruction logic is unchanged — the parent pointers
work the same way. This is a small engineering detail with
a large correctness payoff.

### 9.6 Tolerance band

The bank credit is a net figure. If the gateway is charging
2.36% MDR + 18% GST on MDR + a small TDS, then

    net ≈ gross × (1 − 0.0236 × 1.18) = gross × 0.972

So a bank credit of ₹87,300 corresponds to a gross of roughly
₹89,815. Before we know the fee rate exactly (that's Layer
1.5's job), we accept subsets whose sum is within ±3% of the
target. This band is deliberately wide at Layer 1b so that
Layer 1.5 has confirmed bundles to fit a rate against; a
narrower deterministic pass is done again after Layer 1.5.

### 9.7 Multi-candidate enumeration and scoring

If the DP finds multiple valid subsets for the same target
(same sum, different combinations), we enumerate up to 5
of them and score each.

The score is a weighted product of three factors:

    score = amountPrecision × dateProximity × 1 / subsetSize

- **amountPrecision** ∈ [0, 1] — 1.0 means exact match, decays
  with tolerance-band deviation.
- **dateProximity** ∈ [0, 1] — 1.0 for same-day, decays over
  the ±3d window.
- **1 / subsetSize** — prefer smaller bundles when everything
  else is equal (a bundle of 3 is more informative than a
  bundle of 30 when both are valid).

### 9.8 Wide-gap vs narrow-gap

Compare the top-1 and top-2 scores.

- If `score₁ − score₂ ≥ 0.15` (wide gap), commit `score₁`.
  The winner is clearly the right answer.
- If `score₁ − score₂ < 0.15` (narrow gap), do not commit.
  Emit an `UnresolvedException(AMBIGUOUS_MATCH)` with all
  candidates in `candidateMetadata`. A human picks in the UI.

This threshold is empirically calibrated. On the current
dataset, 215 subset-sum exceptions correctly abstained via
this rule and were later routed to the LLM layer.

## 10. Layer 1.5 — Fee-schedule inference

The single most differentiating layer of the system.

### 10.1 The idea

Once Layer 1b has confirmed some bundles (wide-gap commits),
each confirmed bundle gives us a data point:

    (sum of gross amounts, bank credit)

And the relationship, if fees are the only difference, is
linear:

    bankCredit = grossSum × (1 − effectiveRate) − constantFees

Fit an ordinary-least-squares line through the confirmed
bundles' data points. The slope tells you the effective
combined MDR + GST + TDS rate. The intercept picks up any
per-settlement fixed fee (e.g. a ₹5 flat fee per settlement).

### 10.2 Why this matters

- **Turns fuzzy candidates into exact matches.** After we know
  the effective rate is 3.36%, we can re-run Layer 1b's DP
  against `expected net = gross × 0.9664`, and a subset that
  was previously rejected as being off by 3.4% now matches
  exactly.
- **Detects fee leakage.** If the inferred rate drifts above
  the contracted rate, that drift is real money the merchant
  is losing to the gateway. Nobody else is looking for this.
  It surfaces on the dashboard as a "fee leakage" finding
  with a rupee amount attached.

### 10.3 Implementation

Regression is a two-line numeric problem, no library needed:

    n = len(bundles)
    sumG = Σ grossSum
    sumB = Σ bankCredit
    sumGG = Σ grossSum²
    sumGB = Σ grossSum × bankCredit

    slope = (n × sumGB − sumG × sumB) / (n × sumGG − sumG²)
    intercept = (sumB − slope × sumG) / n

`effectiveRate = 1 − slope`. On the test dataset, the fitted
rate is 3.3646% from 61 confirmed bundles, which matches the
generator's ground truth.

### 10.4 What Layer 1.5 does NOT do

It does not attempt to disaggregate MDR from GST from TDS.
The three rates are combined in the observed data and cannot
be separated without additional signal. If the merchant
tells us their contracted MDR is 2%, we can back out the
expected combined rate (`2% × 1.18 = 2.36%`, plus TDS) and
compare — that's the fee leakage number. But the inference
itself only produces one rate.

---

# Part IV — The AI exception layer (Layer 2)

Everything upstream is deterministic. Every match here is
either committed with high confidence auto or routed to a
human via `PENDING_REVIEW`.

## 11. Layer 2a — Embedding fuzzy match

The layer that catches typo'd references.

### 11.1 Why not just use Gemini embeddings?

Two reasons.

- **Cost.** Reference strings are short (30–50 chars). Embedding
  each one with Gemini costs a token per few characters plus API
  overhead. Across 10,000 transactions × 3 sources, this adds
  meaningful cost and latency without meaningful quality gain
  for a task as simple as string similarity.
- **Determinism.** The determinism proof (§14) requires that
  the same input produces the same output byte-for-byte across
  runs. External embedding APIs give you no guarantee of this —
  they can be updated without notice.

For this specific task — comparing strings that should be nearly
identical modulo typos — a locally computed character-trigram
TF-IDF representation is both cheaper and more principled.

### 11.2 Character trigrams

A trigram is a substring of length 3. The trigrams of `ABC123`
are `ABC`, `BC1`, `C12`, `123`. Every reference string becomes
its multiset of trigrams.

Why trigrams and not bigrams (length 2) or 4-grams (length 4)?

- Bigrams are too common — every pair of letters appears in many
  strings, so similarity scores compress into a narrow band.
- 4-grams are too specific — a single-character typo destroys
  most of them.
- Trigrams strike the balance: a single-character change alters
  three trigrams out of the string's total, which is enough to
  differentiate but not enough to obliterate.

### 11.3 TF-IDF weighting

Not all trigrams carry equal information. `AAA` occurs in
almost every string; `X7Q` occurs rarely. IDF (inverse
document frequency) downweights common trigrams:

    idf(t) = log(N / (1 + df(t)))

where `N` is the number of reference strings and `df(t)` is
the number of strings containing trigram `t`.

TF (term frequency) is just the count of `t` in the string.

The final weight for trigram `t` in string `s`:

    weight(t, s) = tf(t, s) × idf(t)

The string is represented as a vector over the space of all
observed trigrams, with these weights as coordinates.

### 11.4 Cosine similarity

Given two strings represented as trigram-TF-IDF vectors,
their similarity is the cosine of the angle between them:

    cos(u, v) = (u · v) / (|u| × |v|)

Range [0, 1]. A cosine of 1.0 means identical strings.
Empirically:

- `> 0.95` — strings differ by whitespace or normalization only
- `0.85 – 0.95` — one or two character typos
- `0.60 – 0.85` — same root plus/minus a prefix or a heavier
  corruption
- `< 0.60` — probably different transactions

### 11.5 Thresholds and the PENDING_REVIEW band

The layer commits automatically only above 0.85. Between 0.60
and 0.85 it produces `MatchGroup(status=PENDING_REVIEW,
method=AI_FUZZY, confidence=cosine)` and does not touch the
bank record's `matchGroupId`. A human sees the proposed pair
in the UI and confirms or rejects.

Below 0.60, the layer produces no output — the transaction
flows to Layer 2b for classification.

On the test dataset: 5/5 ground-truth typo pairs caught in
the review band with zero false-positive auto-commits.

## 12. Layer 2b — LLM classification

The final AI layer. Runs on transactions no other layer
could resolve.

### 12.1 What the LLM is asked to do

Not to match. To **classify** and **hypothesize**.

For each unmatched transaction, the LLM sees:

- The transaction's fields.
- A summary of what upstream layers tried and failed.
- A list of nearby candidates from the opposite source (for
  reference).

And is asked to output a structured JSON object:

    {
      "classification": "DUPLICATE" | "MISSING_COUNTERPART"
                      | "TIMING_LAG" | "OTHER",
      "rootCauseHypothesis": "one-paragraph English",
      "confidence": 0.0-1.0
    }

The classification is one of a small closed set. The
hypothesis is free text but is only ever shown to a human,
never acted on programmatically. The confidence is used to
sort the exceptions dashboard.

### 12.2 Zod validation and retry

Every LLM response is parsed and validated against a Zod
schema. If parsing fails or a required field is missing, the
call is retried once with an appended user message
("your previous response was not valid JSON, here is the
error, produce valid JSON only"). If the second attempt also
fails, the transaction is classified as `OTHER` with
confidence 0 and the raw response is logged for debugging.

This is the answer to the standard LLM-in-production
failure mode: "the model returned a string I couldn't parse
and my pipeline broke." The pipeline never breaks. It either
gets a valid structured response or a documented fallback.

### 12.3 promptVersion and modelId

Every LLM call writes an audit row with:

    metadata = {
      modelId: "gemini-3.5-flash-lite",
      promptVersion: "<sha256 of classification-v1.md>",
      tokens: { input, output },
      latencyMs: 1234
    }

The `promptVersion` is a SHA-256 of the prompt template
file. If anyone edits `classification-v1.md`, the hash
changes and every subsequent audit row records the new
version. Auditing last month's classifications is now a
matter of "which prompt version was in force? Here's the
file, here's its hash, they match."

### 12.4 Rate limiting and caching

Gemini's free tier permits 12 requests per minute. A
naive implementation classifying 417 exceptions would
take 35 minutes.

Two mitigations:

- **Rate limiter** (`src/llm/rateLimiter.ts`) — a
  token-bucket-style throttle at 12 rpm. Requests queue
  and dispatch as tokens refill.
- **Response cache** (`src/llm/responseCache.ts`) — the
  hash of the request payload is the cache key. Re-runs
  return cached responses in ~1ms per request. This is
  what makes the E2E test viable — it re-runs the whole
  pipeline in seconds because the second LLM pass is
  100% cache hits.

Both are keyed by the prompt content, so a promptVersion
change invalidates the cache automatically. The cache is
disk-persistent (a single JSON file), gitignored, and
re-buildable from scratch.

### 12.5 Results on the test dataset

417 exceptions classified in the first pass.

- `MISSING_COUNTERPART`: 335
- `OTHER`: 61
- `TIMING_LAG`: 21
- `DUPLICATE`: 0

Ground-truth AI_FUZZY typos: 2/5 correctly labeled
`TIMING_LAG` (confidence 0.65, 0.82); 3/5 labeled `OTHER`.
The disagreement between the layers is expected — Layer 2a
catches the string similarity, Layer 2b explains the
underlying category. Both write to audit; the human
decides.

---

# Part V — Trust and verification (Layer 3)

## 13. Hash-chained audit trail

The tamper-evidence guarantee.

### 13.1 The construction

Every audit row has two hash fields.

    previousRowHash = <previous row's rowHash>
    rowHash = SHA-256(canonical(row) || previousRowHash)

where `canonical(row)` is a deterministic serialization of
every field except `rowHash` itself, and `||` is
concatenation.

The genesis row uses a fixed constant as `previousRowHash`
(the SHA-256 of the empty string, in this codebase). Every
subsequent row's hash depends on every prior row's content.

### 13.2 Tamper evidence

Alter any single field of any single audit row. Its
`rowHash` no longer matches `SHA-256(canonical(row) ||
previousRowHash)`. Alter the row and update its `rowHash`
to hide the tamper. Then every row after it has a
`previousRowHash` that no longer matches the actual
previous row's `rowHash`.

To hide a tamper you would need to recompute every
subsequent row's hash and rewrite every subsequent row.
This is detectable in principle by anyone who saved a
snapshot of the ledger at any earlier point; it is
computationally cheap to do but administratively hard —
the chain hash acts as a fingerprint of the whole ledger
state, and any downstream party (an auditor, a regulator,
even a git commit that recorded the chain tip) can compare.

### 13.3 verify-chain

`verify-chain.ts` reads every row from Postgres in
`createdAt` order and, for each row, recomputes:

    expected = SHA-256(canonical(row) || row.previousRowHash)

If `expected == row.rowHash` and `row.previousRowHash`
matches the previous row's `rowHash`, the row is valid.

Any mismatch fails the whole verification, printing the
first-diverging row's id so the analyst can dig in.

On the current build (post fee-inference unification): a
single continuous chain from genesis to tail of ~994 rows,
`MAIN CHAIN OK` printed in a fraction of a second.

## 14. Determinism proof

The determinism proof is what closes the "how do we know
the AI didn't quietly move something between runs" loop.

### 14.1 The construction

`scripts/determinism.ts` runs the entire pipeline twice,
into two separate Neon branches (`neondb_a` and `neondb_b`),
starting from the same input CSVs.

It then compares:

- Every `MatchGroup`'s `(method, sorted transactionRecordIds,
  confidence)`.
- Every `AuditTrail` row's `rowHash` in chain order.

Both must be byte-identical.

### 14.2 What could break this

- **Non-deterministic algorithm.** Anywhere a set iteration
  order or a Map iteration order leaks into hashed output.
  The codebase sorts explicitly before hashing to prevent this.
- **Non-deterministic LLM output.** Gemini can be seeded, and
  the cache means the second run replays the first run's
  responses byte-for-byte. Both together give determinism.
- **Wall-clock in metadata.** `createdAt` timestamps are
  excluded from the canonical hash. Only content is hashed.

### 14.3 Current status

On the current build: 100% byte-identical across all 221
match groups and all 787 audit rows. Zero divergence, zero
non-determinism.

This is a claim that no LLM-only reconciliation tool on the
market can make.

---

# Part VI — Interfaces

## 15. Metrics engine

`src/metrics/computeMetrics.ts` is a pure computation over
the result files and ground truth.

### 15.1 What it computes

- **Precision** per method: `TP / (TP + FP)`.
- **Recall** per method: `TP / (TP + FN)`, where FN is
  ground-truth matches of that class that no method caught.
- **Total match rate**: fraction of bank records covered by
  at least one MatchGroup or fuzzy proposal.
- **Cost of unmatched cash**: `sum(|amountPaise|)` across
  every unmatched bank record. Rendered in ₹ with Indian
  comma grouping.

### 15.2 The headline number

Cost of unmatched cash is the number to put in front of a
judge or a CFO. It converts abstract match-rate percentages
into rupees the merchant cannot spend confidently. On the
test dataset: **₹34,85,984.06 across 169 unmatched bank
records** (44.5% of bank volume).

Halving that number is worth analyst time. Halving it
autonomously with an audit trail is what the system offers.

### 15.3 LLM-only baseline

The pitch requires comparative evidence. `src/baseline/
llmOnly.ts` runs the same dataset through a single Gemini
call ("here are 148 rows, group them") and scores it against
the same ground truth.

Result:

    metric        LAYERED     LLM-ONLY
    ─────────────────────────────────────
    matches       26          51
    precision     100.0%      49.7%
    recall        26.5%       95.9%
    tokens        n/a         12,366

The layered pipeline is surgical: every match it commits is
correct. The LLM-only pipeline is over-eager: high recall but
half its matches are wrong, and it hallucinated one invented
transaction ID despite an explicit instruction not to.

This is the pitch slide. It proves the thesis instead of
asserting it.

## 16. Q&A agent with function calling

Grounded question-answering over the reconciled state.

### 16.1 Four tools

- `getTransactionById(id)` — returns a single `TransactionRecord`.
- `getExceptionsByClassification(cls)` — filter by class.
- `getMatchRateByMethod(method)` — delegates to `computeMetrics`.
- `getAuditTrailForMatch(matchGroupId)` — the audit slice for a
  given match.

### 16.2 The agent loop

Gemini's function-calling protocol lets the model choose
which tool to invoke, invoke it, receive the result, and
either call another tool or produce a final answer.

The system prompt instructs the model:

- Cite real IDs, always. Never invent.
- Answer only from tool output — if tools returned nothing,
  say so.
- Return a structured envelope: `{ answer, citedIds[],
  toolsUsed[] }`.

### 16.3 Why not just ask an LLM?

Two reasons.

- **Grounding.** Without tools, the LLM would generate
  plausible-sounding answers that reference no real
  transaction ID. Users cannot verify these.
- **Auditability.** Every Q&A query writes an
  `AGENT_QUERY` audit row with `modelId`, `promptVersion`,
  `question`, `toolCalls[]`, `tokens`, `latencyMs`. The
  hash chain covers agent queries too.

### 16.4 The Q&A FAB

The floating action button on the dashboard is not a
gimmick. It is the demo answer to "how do I query this
data without writing SQL?" — the analyst asks in English,
the agent picks the right tool, cites real IDs. Latency
is ~3–5s on Flash-Lite.

## 17. Dashboard and WebSocket streaming

React + Vite + Tailwind, connected to the Bun API.

### 17.1 Routes

- `/` — Overview: cost-of-unmatched-cash headline (count-up
  animation), 4-tile KPI grid, method breakdown table.
- `/exceptions` — filterable, sortable exceptions table.
- `/exceptions/:id` — the approval UI. For `AMBIGUOUS_MATCH`,
  side-by-side candidate cards with score breakdowns. For
  other classifications, the LLM's hypothesis and cited IDs.
- `/match-groups/:id` — the explainability page. Left panel:
  linked transactions grouped by source. Right panel: the
  audit trail as a vertical timeline with SHA-256 hash
  fragments visible.
- `/transactions/:id` — for unmatched rows, the "nearest miss"
  counterfactual: the top 3 candidates within ±7 days ranked
  by amount closeness × 0.6 + text similarity × 0.4.

### 17.2 WebSocket (if shipped)

Two channels:

- `live_matches` — every new `MatchGroup` push. Overview
  animates on receive.
- `trace` — for a given transaction id, replay its pipeline
  journey stage by stage with 300ms delays. Read from the
  audit trail; do NOT re-run matching (that would drift the
  chain).

The trace channel is a demo showpiece. It renders the
system's decision tree in real time. Streaming only
deterministic stage output, never LLM chain-of-thought —
raw model reasoning will eventually contradict the final
JSON live in front of judges.

### 17.3 Approval writes are hash-chained continuations

When a human approves a candidate:

- `MatchGroup(method=MANUAL, status=MATCHED)` is created.
- Involved `TransactionRecord`s point to it.
- The exception is marked resolved.
- One `AuditTrail` row is appended: `actor=HUMAN`,
  `actorId=<user id>`, `previousRowHash=<current chain tail>`.

`verify-chain` after approval must still pass. This is the
loop-closing property: humans are first-class actors in
the chain, not second-class.

## 18. MCP server

Model Context Protocol is an open standard for LLM agents
to consume tools from external servers. Building an MCP
server around ReconIQ's four Q&A tools means any MCP client
(Claude Desktop, Cursor, custom agents) can query the
reconciliation state directly.

### 18.1 Architecture

`src/mcp/server.ts` is a thin adapter. It:

- Registers the four tools with MCP-flavored input schemas.
- Zod-validates every input.
- Delegates to the same `src/agent/tools/*` implementations
  the internal Q&A agent uses.
- Wraps results in MCP's response format.

No query logic is reimplemented. This is the correct
factoring: `src/agent/tools/*` is the single source of
truth; `src/agent/qaAgent.ts` and `src/mcp/server.ts` are
two different transports over the same tools.

### 18.2 Stdio transport

MCP supports several transports. The chosen one is stdio —
the server reads JSON-RPC requests on stdin and writes
responses to stdout. Claude Desktop launches the server
as a subprocess.

Claude Desktop config:

    {
      "mcpServers": {
        "reconiq": {
          "command": "bun",
          "args": ["run", "/absolute/path/to/reconiq/src/mcp/runServer.ts"],
          "env": { "DATABASE_URL": "..." }
        }
      }
    }

Once configured, the analyst can chat with Claude Desktop
about reconciliation state — "list all TIMING_LAG
exceptions from the last run" — and Claude picks the right
tool, cites real IDs, and the conversation lands in
Claude's normal chat history, not in a custom UI.

---

# Part VII — Learning (Layer 4)

## 19. Self-heal loop and ExampleBank

If shipped, this is what makes the system sharpen over time
without any fine-tuning.

### 19.1 The write path

Every human approval or resolve action triggers a write to
`ExampleBank`:

    exceptionSnapshot = full exception JSON at time of decision
    correctAction     = {
                          type: "APPROVE_CANDIDATE" |
                                "REJECT" |
                                "MARK_RESOLVED",
                          chosenCandidateIndex?: number,
                          classification?: string,
                          humanNote?: string
                        }
    actionEmbedding   = embed(canonicalize(exceptionSnapshot))

The embedding uses the same character-trigram TF-IDF as
Layer 2a — one dependency, one behavior, one determinism
story. The canonicalization packs classification +
reference strings + amount bucket into a single string.

### 19.2 The read path

On each future LLM classification, before hitting the model:

    similar = retrieveSimilar(currentException, k=5)

using cosine similarity over `actionEmbedding`. If any
example scores above 0.55, the top-K are injected into the
prompt as few-shot examples:

    ## Similar past cases (human-approved)

    Case 1: <summary of similar past exception>
      → Action taken: <what the human did>
      → Outcome: <how it resolved>

    Case 2: ...

    Given the current exception below, classify it and
    hypothesize a root cause.

    <current exception>

The prompt version now hashes over the base template plus
the sorted list of example IDs used, so audit rows record
exactly which past cases informed each classification.

### 19.3 Why this is not fine-tuning

Fine-tuning bakes examples into the model's weights.
This approach injects them at inference time, per query.
Advantages:

- No training run required. Every human approval is
  immediately available for the next classification.
- Fully reversible — remove an example, its influence
  disappears on next call.
- Auditable — the `promptVersion` records exactly which
  examples were in the context window.

This is retrieval-augmented generation for the specific
task of reconciliation classification. Simpler than
fine-tuning, more transparent, easier to defend.

---

# Part VIII — Meta

## 20. What's deliberately not built (and why)

Every design choice has a shadow: things that could have
gone in and did not. Listing them explicitly is what makes
the scope defensible.

- **Predictive / pre-matching.** Contradicts the
  auditable-and-provably-correct thesis. Would also train
  on our own synthetic generator, not reality.
- **"Reconciliation health score."** An invented composite
  with arbitrary weights. Cost-of-unmatched-cash already
  is the money number, and it's not arbitrary.
- **LLM-as-judge evaluation.** We have ground truth.
  Grading against ground truth beats grading against an
  LLM's opinion of ground truth.
- **PDF / vision ingestion.** Vision extraction is
  commodity in 2026. Weak differentiator.
- **Natural-language rule editor.** Demo-friendly, high
  effort, low substance.
- **Compliance PDF export.** Nothing you can't already
  see on the dashboard.
- **Multi-currency.** Signals nothing a judge will test
  in an INR-first market.
- **C++ subprocess for the DP.** JSON marshalling
  overhead across the boundary would eat any speedup at
  the scale we care about.
- **Langfuse or other observability infra.** A 40-line
  custom tracer produces the same signal without new
  auth or deployment surface.
- **Graph matching (min-cost max-flow) over the residual
  1:1 pool.** Conditional Day 7 stretch item, deferred
  because the layered pipeline already outperformed the
  target metrics without it.

## 21. What makes this different from existing tools

Ten points, ranked by how much a payments judge would
weight each.

1. **Fee-schedule inference.** Nobody else reverse-engineers
   the fee schedule. Everyone else treats fees as noise.
2. **Cost-of-unmatched-cash headline.** Turns abstract
   accuracy into a rupee figure the analyst feels.
3. **Hash-chained audit trail with one-command verify.**
   Tamper-evident, provable. Rare at hackathons; unheard of
   in market rules-based tools.
4. **Deterministic replay proof.** Same input twice → same
   hash chain. Answers the "did the AI move something?"
   question definitively.
5. **LLM-only baseline in the pitch deck.** Proves the
   thesis instead of asserting it. 100% vs 49.7% precision.
6. **Real Razorpay Settlements API compatibility.** Works
   on Razorpay's actual data shapes, not just synthetic
   CSVs.
7. **Confidence with visible breakdown.** Amount weight ×
   date weight × text similarity — the analyst can see why
   a match scored where it scored.
8. **MCP server exposure.** A real interop story, not just
   a checkbox.
9. **Ambiguity handled as first-class.** Every existing
   tool silently picks a candidate. ReconIQ presents both
   and asks. That's what makes it trustworthy.
10. **Human approvals are hash-chained too.** The audit
    ledger doesn't distinguish deterministic layers, AI
    layers, and humans. All are `actor` types with the same
    chain guarantee.

The one-sentence summary:

> Every transaction flows through a strict waterfall —
> exact match → subset-sum → fee inference → AI fuzzy →
> AI classification — and at every stage, if the system
> isn't confident, it stops and asks a human rather than
> guessing, with every decision written to a hash-chained
> audit trail queryable in plain English.

---

*End of document.*
