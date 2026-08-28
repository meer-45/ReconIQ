// runLlmClassify.ts — Layer 2b harness
// Classifies fuzzy PENDING_REVIEW and subset-sum AMBIGUOUS exceptions via Gemini.
// Reads JSON from prior layers. Writes llm_classification_results.json.
// Never auto-commits. All output is hypothesis-only.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash } from "node:crypto";
import { join } from "path";
import {
  classifyFuzzyPendingReview,
  classifySubsetSumAmbiguous,
  MIN_CONFIDENCE_FOR_HYPOTHESIS,
  type FuzzyException,
  type SubsetSumException,
  type LlmAuditRow,
  type LlmClassification,
} from "./llmClassify";
import { FuzzyTracer } from "./fuzzyTracer";
import { getState as getRateLimiterState } from "../llm/rateLimiter";
import { loadAllTransactions } from "./exact";

const RESULTS_DIR = join(process.cwd(), "src", "matching");
const DATA_DIR    = join(process.cwd(), "data");
const PROMPT_PATH = join(process.cwd(), "src", "prompts", "classification-v1.md");

// ── Run ID ────────────────────────────────────────────────────────────────────
const RUN_ID = `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── promptVersion seal ────────────────────────────────────────────────────────
// Computed once at startup; verified not to change mid-run
const PROMPT_VERSION_AT_START = createHash("sha256")
  .update(readFileSync(PROMPT_PATH, "utf-8"), "utf8")
  .digest("hex");

// ── Load helpers ──────────────────────────────────────────────────────────────
function loadFuzzyPendingReview(): FuzzyException[] {
  const path    = join(RESULTS_DIR, "fuzzy_match_results.json");
  const content = JSON.parse(readFileSync(path, "utf-8"));
  // newExceptions are the FUZZY_LOW_CONFIDENCE ones (one per PENDING_REVIEW match)
  return (content.newExceptions ?? []) as FuzzyException[];
}

function loadSubsetSumAmbiguous(): SubsetSumException[] {
  const path    = join(RESULTS_DIR, "subset_sum_results.json");
  const content = JSON.parse(readFileSync(path, "utf-8"));
  // All exceptions are AMBIGUOUS_MATCH (none have isResolved = true after Day 6)
  return (content.exceptions ?? []) as SubsetSumException[];
}

function loadStartingHash(): string {
  try {
    const fz = JSON.parse(readFileSync(join(RESULTS_DIR, "fuzzy_match_results.json"), "utf-8"));
    const rows = fz.auditRows ?? [];
    if (rows.length > 0) return rows[rows.length - 1].rowHash;
  } catch { /* fall through */ }
  try {
    const fi = JSON.parse(readFileSync(join(RESULTS_DIR, "fee_inference_audit_results.json"), "utf-8"));
    const rows = fi.auditTrail ?? fi.auditRows ?? [];
    if (rows.length > 0) return rows[rows.length - 1].rowHash;
  } catch { /* fall through */ }
  try {
    const fi = JSON.parse(readFileSync(join(RESULTS_DIR, "fee_inference_results.json"), "utf-8"));
    const rows = fi.auditTrail ?? fi.auditRows ?? [];
    if (rows.length > 0) return rows[rows.length - 1].rowHash;
  } catch { /* fall through */ }
  try {
    const ss = JSON.parse(readFileSync(join(RESULTS_DIR, "subset_sum_results.json"), "utf-8"));
    const rows = ss.auditTrail ?? [];
    if (rows.length > 0) return rows[rows.length - 1].rowHash;
  } catch { /* fall through */ }
  return "0".repeat(64);
}

// ── Build bank record map for fuzzy exception context ─────────────────────────
function buildBankRecordMap(): Map<string, { externalReference: string; amountPaise: number; transactionDate: string }> {
  const all = loadAllTransactions(DATA_DIR);
  const map = new Map<string, { externalReference: string; amountPaise: number; transactionDate: string }>();
  for (const tx of all) {
    if (tx.dataSource === "BANK_STATEMENT") {
      map.set(tx.transactionRecordId, {
        externalReference: tx.externalReference,
        amountPaise:       tx.amountPaise,
        transactionDate:   tx.transactionDate,
      });
    }
  }
  return map;
}

// ── Sanity guards ─────────────────────────────────────────────────────────────
const HIGH_CONFIDENCE_THRESHOLD = 0.95;
const HIGH_CONFIDENCE_RATIO_CAP = 0.50;

function checkConfidenceLeakage(classifications: LlmClassification[], label: string): void {
  if (classifications.length === 0) return;
  const highConf = classifications.filter(c => c.confidence > HIGH_CONFIDENCE_THRESHOLD);
  const ratio    = highConf.length / classifications.length;
  if (ratio > HIGH_CONFIDENCE_RATIO_CAP) {
    throw new Error(
      `[runLlmClassify] SAFETY STOP: ${label} — ${highConf.length}/${classifications.length} ` +
      `(${(ratio * 100).toFixed(0)}%) classifications have confidence > ${HIGH_CONFIDENCE_THRESHOLD}. ` +
      `Prompt may have a leak. Stopping before writing results.`
    );
  }
}

function checkAllSameLabel(classifications: LlmClassification[], label: string): void {
  if (classifications.length < 2) return;
  const labels = new Set(classifications.map(c => c.classification));
  if (labels.size === 1) {
    throw new Error(
      `[runLlmClassify] SAFETY STOP: ${label} — all ${classifications.length} classifications ` +
      `returned the same label "${[...labels][0]}". Prompt is likely broken.`
    );
  }
}

function assertPromptVersionUnchanged(): void {
  const current = createHash("sha256")
    .update(readFileSync(PROMPT_PATH, "utf-8"), "utf8")
    .digest("hex");
  if (current !== PROMPT_VERSION_AT_START) {
    throw new Error(
      `[runLlmClassify] SAFETY STOP: classification-v1.md sha256 changed mid-run! ` +
      `Started with ${PROMPT_VERSION_AT_START.slice(0, 16)}…, now ${current.slice(0, 16)}…`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Layer 2b — LLM Classify  runId=${RUN_ID}`);
  console.log(`  promptVersion=${PROMPT_VERSION_AT_START.slice(0, 16)}…`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const tracer = new FuzzyTracer(RUN_ID);

  // 1. Load exceptions
  const fuzzyExceptions  = loadFuzzyPendingReview();
  const ssExceptions     = loadSubsetSumAmbiguous();
  const totalCalls       = fuzzyExceptions.length + ssExceptions.length;
  const estMinutes       = Math.ceil(totalCalls / 12);

  console.log(`About to classify ${fuzzyExceptions.length} fuzzy + ${ssExceptions.length} subset-sum exceptions = ${totalCalls} total.`);
  console.log(`Rate limit: 12/min. Estimated wall-clock: ~${estMinutes} min.`);
  console.log(`\nStarting in 3 seconds… (Ctrl-C to abort)\n`);
  await new Promise(res => setTimeout(res, 3_000));

  // 2. Build bank record context map
  const bankRecordMap = buildBankRecordMap();
  const startingHash  = loadStartingHash();

  // 3. Classify fuzzy PENDING_REVIEW exceptions
  const t0Fuzzy = Date.now();
  console.log(`── Classifying ${fuzzyExceptions.length} fuzzy PENDING_REVIEW exceptions…`);
  let fuzzyClassifications: LlmClassification[] = [];
  let fuzzyAuditRows:       LlmAuditRow[]        = [];
  let wasIncomplete = false;

  try {
    const result = await classifyFuzzyPendingReview(
      fuzzyExceptions, bankRecordMap, startingHash, tracer
    );
    fuzzyClassifications = result.classifications;
    fuzzyAuditRows       = result.auditRows;

    // Prompt integrity check after every batch
    assertPromptVersionUnchanged();

    // Sanity guards — only run if we have enough data (>= 5)
    if (fuzzyClassifications.length >= 5) {
      checkConfidenceLeakage(fuzzyClassifications, "fuzzy");
      checkAllSameLabel(fuzzyClassifications, "fuzzy");
    }
  } catch (err: any) {
    if (err.message?.includes("day quota exhausted")) {
      wasIncomplete = true;
      console.error(`[QUOTA] Day quota hit mid-run: ${err.message}`);
    } else {
      throw err;
    }
  }

  const fuzzyMs = Date.now() - t0Fuzzy;
  console.log(`  Done: ${fuzzyClassifications.length}/${fuzzyExceptions.length} classified in ${(fuzzyMs / 1000).toFixed(0)}s`);

  // 4. Classify subset-sum AMBIGUOUS exceptions
  // Chain continues from end of fuzzy audit rows
  const ssStartHash = fuzzyAuditRows.length > 0
    ? fuzzyAuditRows[fuzzyAuditRows.length - 1].rowHash
    : startingHash;

  const t0Ss = Date.now();
  console.log(`\n── Classifying ${ssExceptions.length} subset-sum AMBIGUOUS exceptions…`);
  let ssClassifications: LlmClassification[] = [];
  let ssAuditRows:       LlmAuditRow[]        = [];

  if (!wasIncomplete) {
    try {
      const result = await classifySubsetSumAmbiguous(ssExceptions, ssStartHash, tracer);
      ssClassifications = result.classifications;
      ssAuditRows       = result.auditRows;

      assertPromptVersionUnchanged();

      if (ssClassifications.length >= 5) {
        checkConfidenceLeakage(ssClassifications, "subset-sum");
        checkAllSameLabel(ssClassifications, "subset-sum");
      }
    } catch (err: any) {
      if (err.message?.includes("day quota exhausted")) {
        wasIncomplete = true;
        console.error(`[QUOTA] Day quota hit mid-run: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  const ssMs = Date.now() - t0Ss;
  console.log(`  Done: ${ssClassifications.length}/${ssExceptions.length} classified in ${(ssMs / 1000).toFixed(0)}s`);

  // 5. Compute summary stats
  const allClassifications = [...fuzzyClassifications, ...ssClassifications];
  const allAuditRows       = [...fuzzyAuditRows, ...ssAuditRows];

  const dist: Record<string, number> = { DUPLICATE: 0, MISSING_COUNTERPART: 0, TIMING_LAG: 0, OTHER: 0 };
  let totalConf  = 0;
  let lowConfCnt = 0;
  let cacheHits  = 0;
  let apiCalls   = 0;

  for (const c of allClassifications) {
    dist[c.classification] = (dist[c.classification] ?? 0) + 1;
    totalConf  += c.confidence;
    if (c.confidence < MIN_CONFIDENCE_FOR_HYPOTHESIS) lowConfCnt++;
    if (c.cacheHit) cacheHits++; else apiCalls++;
  }

  const avgConf        = allClassifications.length > 0 ? totalConf / allClassifications.length : 0;
  const rateLimiterEnd = getRateLimiterState();

  // 6. Write results
  mkdirSync(RESULTS_DIR, { recursive: true });
  const output = {
    runId:                   RUN_ID,
    timestamp:               new Date().toISOString(),
    promptVersion:           PROMPT_VERSION_AT_START,
    fuzzyClassifications,
    subsetSumClassifications: ssClassifications,
    auditRows:               allAuditRows,
    wasIncomplete,
    summary: {
      totalCalls:               totalCalls,
      fuzzyClassified:          fuzzyClassifications.length,
      ssClassified:             ssClassifications.length,
      cacheHits,
      apiCalls,
      totalCostRupees:          0,
      classificationDistribution: dist,
      avgConfidence:            parseFloat(avgConf.toFixed(4)),
      lowConfidenceCount:       lowConfCnt,
      rateLimiterState:         rateLimiterEnd,
    },
  };

  const outPath = join(RESULTS_DIR, "llm_classification_results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  // 7. Print summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total calls:        ${totalCalls}`);
  console.log(`  Cache hits:         ${cacheHits} (${totalCalls > 0 ? ((cacheHits / totalCalls) * 100).toFixed(0) : 0}%)`);
  console.log(`  API calls:          ${apiCalls}`);
  console.log(`  Classification dist:`);
  for (const [k, v] of Object.entries(dist)) {
    console.log(`    ${k.padEnd(22)} ${v}`);
  }
  console.log(`  Avg confidence:     ${avgConf.toFixed(3)}`);
  console.log(`  Low confidence (<0.5): ${lowConfCnt}`);
  console.log(`  Rate limiter:       min=${rateLimiterEnd.minuteCount} day=${rateLimiterEnd.dayCount}`);
  console.log(`  wasIncomplete:      ${wasIncomplete}`);
  console.log(`\n✓ Results written to ${outPath}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(err => {
  console.error("FATAL:", err.message ?? err);
  process.exit(1);
});
