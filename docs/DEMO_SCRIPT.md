# ReconIQ Demo Video Script: 90-Second Walkthrough

**Format:** Screencast + Voiceover  
**Target Duration:** 90 Seconds  
**Resolution:** 1080p / 60fps  
**Host Application:** `http://localhost:5173` (ReconIQ Web Dashboard)

---

### [00:00 – 00:15] Frame 1: Overview Dashboard & The Working Capital Problem

- **URL:** `http://localhost:5173/`
- **Visual Action:** 
  1. Load Overview page.
  2. Cursor points to the headline metric **Cost of Unmatched Cash (`₹34,85,984.06`)** as it smoothly counts up over 800ms.
  3. Cursor hovers over the 4-tile KPI grid showing **54.4% Total Match Rate** and **100% Exact Precision**.
- **Voiceover:**
  > "Every month-end, finance teams struggle to reconcile bank statements with payment gateway settlements. Look at this headline number: **₹34.85 Lakhs in Cost of Unmatched Cash** locked up in manual exception queues. ReconIQ replaces brittle rules and hallucinating LLMs with a mathematically proven, layered engine."

---

### [00:15 – 00:32] Frame 2: Exception Queue & Triage

- **URL:** `http://localhost:5173/exceptions`
- **Visual Action:**
  1. Click **"Exceptions"** in the top navigation bar.
  2. Click the classification filter dropdown and select **`MISSING_COUNTERPART`**.
  3. Scroll down and click on exception row **`ss_ex_tx_aa5ltds16g`** (`₹6,104.34`).
- **Voiceover:**
  > "When transactions cannot be matched 1:1, ReconIQ's bounded subset-sum dynamic programming finds complex multi-payment bundles. If multiple candidate subsets compete, the system doesn't guess—it generates an `AMBIGUOUS_MATCH` exception with transparent scoring."

---

### [00:32 – 00:52] Frame 3: Side-by-Side Candidate Disambiguation & One-Click Approval

- **URL:** `http://localhost:5173/exceptions/ss_ex_tx_aa5ltds16g`
- **Visual Action:**
  1. Show the side-by-side comparison cards:
     - **Candidate 0** (Green border, Score `0.1469`): 3 transactions including gross sale ₹8,695.87 and two refunds (`-₹529.42` and `-₹1,877.00`).
     - **Candidate 1** (Score `0.1405`): 5 transactions.
  2. Hover over the score breakdown (Amount Precision, Date Proximity, Subset Penalty).
  3. Click the large green button: **"Approve this match"** on Candidate 0.
  4. Instant success toast appears: *"Match approved successfully"*, then redirects to the new MatchGroup.
- **Voiceover:**
  > "Here on exception `ss_ex_tx_aa5ltds16g`, we see two competing bundles. Candidate 0 correctly nets two customer refund records against a gross settlement. As a controller, I inspect the score breakdown, click **'Approve this match'**, and resolve the exception in one click."

---

### [00:52 – 01:08] Frame 4: MatchGroup & Immutable Cryptographic Audit Trail

- **URL:** `http://localhost:5173/match-groups/mg_manual_...`
- **Visual Action:**
  1. Highlight the newly created **`MatchGroup`** with status `MATCHED` and method `MANUAL`.
  2. Scroll to the **Audit Trail** table below.
  3. Highlight the new audit row with `actor: HUMAN`, timestamp, and parent SHA-256 `rowHash`.
- **Voiceover:**
  > "This immediately creates a verified MatchGroup. Every single action—whether algorithmic, AI-hypothesized, or human-approved—is appended to an unbroken SHA-256 cryptographic audit chain. If anyone tampers with past records, the ledger breaks loudly."

---

### [01:08 – 01:20] Frame 5: Self-Healing ExampleBank & Few-Shot Vector Loop

- **URL:** `http://localhost:5173/example-bank`
- **Visual Action:**
  1. Click **"Example Bank"** in the top navigation bar.
  2. Highlight the top card showing the newly stored approval: `Action: APPROVE_CANDIDATE`, exception snapshot, and vector embedding metadata.
- **Voiceover:**
  > "Human approvals don't disappear into a void. ReconIQ saves the decision to our **ExampleBank**. Future LLM classifications automatically retrieve these approved cases via vector similarity as few-shot context—the engine gets smarter with every approval without fine-tuning."

---

### [01:20 – 01:30] Frame 6: Autonomous Q&A Agent & Global Chain Verification

- **URL:** Global view across any page
- **Visual Action:**
  1. Click the green badge in the footer: **`✓ MAIN CHAIN OK (786 rows) · 0 link breaks`**.
  2. Press **`Cmd + K`** to trigger the floating Q&A bar.
  3. Type: *"Why wasn't tx_aa5ltds16g matched by exact match?"* and press Enter.
  4. Agent returns grounded response citing real transaction IDs from the database.
- **Voiceover:**
  > "Auditors can verify ledger integrity across the entire database in milliseconds, while finance teams query reconciliation history in plain English via our grounded Q&A agent and MCP server. That's ReconIQ."
