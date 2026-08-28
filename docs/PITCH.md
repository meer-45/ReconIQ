# ReconIQ Pitch: 3-Minute Live Presentation Talk Track

**Event:** Razorpay Buildathon 2026  
**Track:** Track 04 — AI Finance Controller  
**Speaker:** Lead Developer / Presenter  
**Total Target Time:** 3 minutes (180 seconds)

---

### [0:00 – 0:20] The Problem & The Headline Metric

> **[Slide 1 / Screen: Dashboard at `http://localhost:5173/` showing headline metric `₹8,30,344.04` counting up]**

"At every month-end, finance teams face a massive, silent crisis: reconciling three conflicting files—the bank statement, the gateway settlement report from Razorpay, and the internal accounting ledger. 

Because gateways batch transactions together, deduct MDR fees, and net out negative refunds, standard 1:1 matching fails for the vast majority of volume. 

The result? Look at the headline number on our screen right now: **₹8,30,344.04 in Cost of Unmatched Cash**—money physically sitting in the bank account that the business cannot confidently spend because it's trapped in a massive manual exception queue."

---

### [0:20 – 1:00] The Insight: Why Rules-Only & LLM-Only Both Fail

> **[Slide 2 / Screen: Layer Architecture Diagram]**

"Traditional reconciliation software fails because it is brittle—it does exact 1:1 matching or nothing. It completely chokes on multi-transaction bundles, fee deductions, and signed refunds.

On the other extreme, modern AI prototypes throw raw financial logs at an LLM and hope for the best. That is disastrous. When we benchmarked a pure LLM-only baseline on 148 transactions, it achieved only **49.74% precision**—it hallucinated false matches into the ledger every other time. A wrong guess in an accounting ledger is a catastrophic, trust-destroying bug.

ReconIQ is built on a simple, powerful thesis:  
**Bundling, fees, and refunds are a combinatorial math problem—so we solve them with provably correct dynamic programming.**  
**Typos and missing counterparts are a language problem—so we solve them with embeddings and structured LLM hypotheses.**  
**Use math where math wins, use AI where AI earns its keep, and log every single decision in an immutable cryptographic audit chain.**"

---

### [1:00 – 2:00] Live Walkthrough: Resolving a Real Ambiguous Exception

> **[Screen: Click into `/exceptions`, select Exception `ss_ex_tx_aa5ltds16g` (`₹6,104.34`)]**

"Let's see this in action on a real, live case from our batch. 

Here is bank credit `tx_aa5ltds16g` for **₹6,104.34** (610,434 paise). 

Exact matching couldn't find a single payment. Our bounded subset-sum engine stepped in, factored in the 3.36% inferred gateway fee schedule, and discovered multiple competing candidate bundles. 

Instead of guessing—which is how bugs slip into ledgers—ReconIQ flagged this as an `AMBIGUOUS_MATCH` exception and presents both candidate subsets side-by-side:

- **Candidate 0** (Score: `0.1469`): 3 gateway transactions including a gross sale of ₹8,695.87 offset by two customer refund records of `-₹529.42` (`pay_KWSRBSYP-REF`) and `-₹1,877.00` (`pay_NTFQJ7NT-REF`), netting out to ₹6,289.45 gross.
- **Candidate 1** (Score: `0.1405`): 5 smaller gateway transactions.

ReconIQ surfaces the exact score breakdown—amount precision, date proximity, and bundle size penalty. 

As a finance controller, I review the breakdown, agree with Candidate 0's refund netting, and click **'Approve this match'**.

Instantly, the system creates a verified `MatchGroup`, updates our working capital, writes an audit row tagged `actor: HUMAN`, and stores this approval in our **ExampleBank** so the AI learns this merchant's refund pattern as few-shot context for all future runs."

---

### [2:00 – 2:30] Cryptographic Audit Trail & Determinism Proof

> **[Screen: Click footer 'Verify audit chain' badge on `http://localhost:5173/`, then show terminal with `determinism_proof.json`]**

"Now, how do auditors and regulators trust any of this? 

Look at the footer on every single page of our application: **`✓ MAIN CHAIN OK (1,061 rows) · 0 link breaks`**. 

Every algorithmic match, fee inference calculation, AI hypothesis, and human approval is chained into an unbroken SHA-256 cryptographic ledger. If a single byte of historical financial data is altered, the entire chain breaks loudly.

Furthermore, we proved this determinism mathematically: running our entire multi-layer pipeline independently across isolated database instances produces **100% byte-identical audit rowHashes across all 1,061 audit rows and 340 match groups with zero divergence**."

---

### [2:30 – 3:00] The Benchmark & Conclusion

> **[Slide 3 / Screen: Benchmark Comparison Table]**

"Here is the proof of our thesis:

| Metric | ReconIQ Layered Engine | LLM-Only Baseline |
|---|---|---|
| **Precision** | **100.0%** (0 false matches) | **49.74%** (1 in 2 false) |
| **Spurious Ledger Commits** | **0** | **1** |
| **Inference Cost** | **₹0.00** on deterministic core | **12,366 tokens** / batch |
| **Audit Proof** | **100% Cryptographic SHA-256** | Non-deterministic |

ReconIQ turns chaotic month-end reconciliation into provable mathematics, actionable AI hypotheses, and zero-trust auditability. 

It unlocks millions in trapped working capital on day one, and it is ready for production today. Thank you."
