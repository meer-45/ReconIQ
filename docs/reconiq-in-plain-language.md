# ReconIQ — In Plain Language

For pitch prep, judges, teammates who aren't devs, and future-you at 3am on Sep 3.

---

## What is this, in one paragraph

At month-end, every payments company has to answer one question for every rupee that moved: *did this bank credit, this gateway settlement, and this order in our ledger all refer to the same real thing?* Today, most of that work is done by hand or by tools so brittle they only catch the easy cases. ReconIQ automates it with a layered engine — math handles the combinatorial parts (bundles, fees, refunds), AI handles the ambiguous text parts (typos, missing counterparts), and every single decision — whether the software's or a human's — is written to a tamper-evident audit trail you can query in plain English.

---

## Why this is a real problem

Imagine you run a small D2C brand. Every day, hundreds of customers pay you via a gateway like Razorpay. Three files show up at month-end:

- **Bank statement** — what your bank says landed in your account
- **Gateway settlement report** — what Razorpay says it paid you
- **Merchant ledger** — what your own system expected

They *should* line up. They don't. Here's why:

1. **Bundling.** Razorpay doesn't send one bank credit per transaction. It bundles dozens together into one big settlement. So one line on your bank statement = twenty lines in the gateway report.

2. **Fees.** MDR (Razorpay's cut), GST on that MDR, TDS. So bank credit ≠ sum of gross transactions. It's `sum - fees`, and the exact fees are their own thing to figure out.

3. **Refunds.** A refund inside a settlement batch means the bank credit is *smaller* than the sum of positive transactions — because a negative refund netted against them.

4. **Different names for the same thing.** The bank calls it a `UTR`. The gateway calls it `pay_ABC123`. Your ledger calls it `ORD-ABC123`. Sometimes one of those has a typo.

5. **Timing lag.** A transaction on the 31st might settle to your bank on the 1st or the 3rd. So even a "correct" match spans months.

Existing tools do **exact match or nothing**. Everything else falls into a manual pile that a human sorts by hand. That's hours a month of analyst time. Worse, until it's resolved, that money is **locked-up working capital** — the business can see the cash arrived but can't confidently spend it because it doesn't know what it's for.

---

## The insight ReconIQ is built on

Two things that look like one problem are actually two very different problems.

**Bundling and fees are a math problem.** They're combinatorial. There's a right answer. You want a deterministic algorithm that either finds it or admits it can't. You don't want an AI guessing, because a wrong guess in a ledger is a bug that destroys trust.

**Typos and missing counterparts are a language problem.** No amount of math tells you `RAZPAY-SET-4892` and `RZPAY-SETT-4892` are the same string. That's what AI is good at.

So: **use math where math wins, use AI where AI earns its keep, log everything.**

Every other reconciliation tool on the market either (a) does dumb exact-match and gives up, or (b) throws the whole thing at an LLM and hopes. ReconIQ does neither.

---

## Seven concrete cases

Same synthetic month-end batch running through the system. Real numbers, real IDs (shortened).

### Case 1 — The easy one: 1:1 match

- Bank: `UTR_XYZ1` — ₹15,000 — 13 Aug
- Gateway: `pay_XYZ1` — ₹15,000 — 12 Aug

**What happens:** the exact-match layer runs first. It sees identical amounts, references that normalize to the same root (`XYZ1`), and dates one day apart. Match. A MatchGroup is created with confidence 1.0, and one audit trail row records the decision. Zero AI cost, zero ambiguity.

Most transactions in a healthy month resolve here.

### Case 2 — Bundle with no ambiguity

- Bank: `UTR_A2` — ₹10,000 — 15 Aug
- Gateway: `pay_A2_1` ₹4,000, `pay_A2_2` ₹6,000 — 14 Aug

**What happens:** exact match fails (no single gateway row equals ₹10,000). Subset-sum runs. It asks: is there some subset of unmatched gateway rows within a 3-day window that sums to ₹10,000? It finds `{pay_A2_1, pay_A2_2}` — the only valid grouping. Since there's exactly one candidate, commit. Audit trail explains: "Bundle of 2 gateway transactions sums to bank amount, single valid grouping."

### Case 3 — Bundle WITH ambiguity (the interesting one)

- Bank: `UTR_A3` — ₹10,000 — 15 Aug
- Gateway pool has many candidates that could sum to ₹10,000: `{3k + 3k + 4k}` and also `{6k + 4k}`

**What happens:** subset-sum finds *multiple* valid subsets. Rather than picking the first one it finds (which is a silent correctness bug — many recon tools do this), it scores each candidate on amount precision × date proximity × 1/(subset size). If one candidate clearly wins (wide score gap), commit it. If the top two are neck-and-neck (narrow gap), **don't guess** — create an "AMBIGUOUS_MATCH" exception with both candidates stored. A human sees them side-by-side on the dashboard and picks with one click. That approval also gets saved to an ExampleBank so the AI learns the pattern for next time.

This case is where the whole "math for math, AI for ambiguity, human when confidence is low" philosophy is visible in one flow.

### Case 4 — Bundle with a refund inside it

- Bank: `UTR_A4` — ₹7,000 — 18 Aug
- Gateway: `pay_A4` ₹9,000 (a sale), `pay_A4-REF` **−₹2,000** (a refund) — 18 Aug

**What happens:** the subset-sum DP handles signed amounts natively (offset-indexed array — a small engineering detail with a big correctness payoff). `9,000 + (−2,000) = 7,000`, matches the bank credit. Audit trail explicitly notes: "Bundle includes 1 refund netting against gross settlement" — so anyone skimming the log immediately understands why the numbers don't look like simple addition.

### Case 5 — Typo caught by AI

- Bank: `UTR_ABC123` — ₹5,000
- Gateway: `pay_ABC12E` — ₹5,000 (typo — should be `ABC123`)

**What happens:** exact match fails because the references don't normalize to the same root. Subset-sum finds nothing. Then the AI fuzzy layer runs — it turns each reference into an embedding (a math vector representing the string), and computes cosine similarity. `ABC123` and `ABC12E` score 0.94 (nearly identical). Above the threshold, so it's proposed as a match with `method: AI_FUZZY, confidence: 0.85` — lower than deterministic methods because it's a text guess, not a number match. If the confidence clears the auto-commit bar, it becomes a MatchGroup. If not, it goes to the human review queue with the fuzzy candidate shown as a suggestion.

### Case 6 — Genuine unmatched, AI explains why

- Bank: `UTR_A6` — ₹3,200 — 20 Aug — no gateway or ledger counterpart found by anything

**What happens:** all prior layers fail — not even a fuzzy candidate exists. The LLM classification step runs. It's given the transaction and asked to classify into one of `DUPLICATE / MISSING_COUNTERPART / TIMING_LAG / OTHER` and generate a plain-English hypothesis. Output is **structured JSON only**, validated against a schema (Zod), retried if malformed. Example: `{classification: "TIMING_LAG", rootCause: "No counterpart in this batch; matches historical pattern of gateway settlements arriving the following week", confidence: 0.7}`. An UnresolvedException is created; the audit trail logs that the AI made this call, which model version, and which prompt version.

Nothing here auto-commits. The classification is a *hypothesis* for a human to act on — the system never silently resolves an exception with just AI.

### Case 7 — Self-heal loop

Same as Case 3 above, but taken further. A human approved the `{6k + 4k}` candidate. That approval gets:
- Written to the AuditTrail with `actor: HUMAN`
- Saved to the ExampleBank with the exception input and the correct action
- Its embedding stored via pgvector

Next month, when a similar ambiguous case shows up, the LLM classifier's prompt is automatically enriched with the 3-5 most similar past examples as **few-shot context**. Same LLM, no fine-tuning, but sharpening over time as the human corrects it.

---

## What each layer actually is, one line each

| Layer | What it does | Why it exists |
|---|---|---|
| **Ingestion** | Read the 3 CSVs, cast all money to signed integer paise | Floats silently corrupt money — integer paise is non-negotiable |
| **Exact match** | Amount + normalized reference + ±3 day window, only commits when there's exactly one candidate on each side | Fast, cheap, correct for the easy majority |
| **Subset-sum** | Bounded DP to find bundles, with tolerance for fees, offset-indexed for refunds, multi-candidate scoring for ambiguity | The one thing traditional tools can't do at all |
| **Fee inference** | Learn the actual MDR/GST/TDS rates from confirmed bundles, then re-match remaining candidates against `expected net` | Also catches "fee leakage" — when your gateway is charging more than your contract says |
| **AI fuzzy** | Embeddings + cosine similarity, catches typo'd references | Text similarity is what AI is genuinely good at |
| **LLM classify** | For leftovers, classify + root-cause hypothesis, structured JSON only | Human still decides; AI just proposes |
| **Audit trail** | Every decision, one row, hash-chained (each row's SHA-256 includes the previous row's hash) | Tamper-evident. Any single change to history breaks the chain |
| **Dashboard** | Match rate, exceptions, cost-of-unmatched-cash, live via WebSocket | The demo surface. Also the human-in-the-loop surface for ambiguous cases |
| **Q&A agent** | Function-calling over the DB — "why wasn't tx_X matched?" answered with real IDs | Grounded, cites real evidence, cannot hallucinate |
| **MCP server** | Same Q&A tools wrapped in the Model Context Protocol standard | Queryable from Claude Desktop or any other MCP client, not just our UI |
| **Self-heal** | Human approvals → ExampleBank → few-shot context for future LLM calls | Sharpens over time without training runs |

---

## The pitch, in three lines

> Payment reconciliation today is either brittle rules that miss the interesting cases, or LLM-only tools that guess wrong on numbers. ReconIQ uses math for the math, AI for the ambiguity, and logs every decision in a tamper-evident chain. The result: fewer things fall into the manual pile, and the ones that do come with a plain-English explanation of why.

---

## The money story

Every unmatched transaction is **locked-up working capital**. The dashboard has one big headline number: **cost of unmatched cash** — the ₹ sum of everything still sitting in exceptions. A judge looks at that number and immediately understands: "these people made me ₹47 lakh less scared to spend."

Also: fee inference doubles as **fee leakage detection**. If the effective MDR you're being charged drifts above your contracted rate, that drift is real money the finance team didn't know they were losing.

---

## What we're building tomorrow

Right now: subset-sum matcher. This is the piece that makes bundles work — the thing no rule-based tool can do. It's the algorithmic heart of the whole system. Once this lands and passes tests on our synthetic data (which we just spent today making realistic enough to actually test against), Layer 1 is complete and we can move on to fee inference, then the AI layers.

Timeline: 11 days to submit. What's built already covers about 25% of the target scope. Nothing behind schedule.
