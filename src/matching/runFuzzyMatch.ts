// runFuzzyMatch.ts — Layer 2a harness
// Loads data from CSV (via exact.ts loader) and JSON results from prior layers.
// Does NOT touch Postgres, pgvector, or any API. Reads JSON/CSV, writes JSON.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { loadAllTransactions } from "./exact";
import {
  resolveExactResiduals,
  disambiguateSubsetSumExceptions,
  loadStartingHash,
  type SubsetSumException,
  type TransactionRecord,
  type AuditRow,
  type FuzzyMatchGroup,
} from "./fuzzyMatch";
import { FuzzyTracer } from "./fuzzyTracer";

const DATA_DIR    = resolve(__dirname, "../../data");
const RESULTS_DIR = __dirname;

// ── Unique run ID for this invocation ─────────────────────────────────────────
const RUN_ID = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Load exact match results → claimedIds ─────────────────────────────────────
function loadExactClaimedIds(): Set<string> {
  const path    = join(RESULTS_DIR, "exact_match_results.json");
  const content = JSON.parse(readFileSync(path, "utf-8"));
  const ids     = new Set<string>();
  for (const pair of (content.matchedPairs ?? [])) {
    ids.add(pair.bankId);
    ids.add(pair.gatewayId);
  }
  return ids;
}

// ── Load subset-sum results → additional claimedIds + exceptions ──────────────
interface SubsetSumData {
  claimedIds:  Set<string>;
  exceptions:  SubsetSumException[];
}

function loadSubsetSumData(): SubsetSumData {
  const path    = join(RESULTS_DIR, "subset_sum_results.json");
  const content = JSON.parse(readFileSync(path, "utf-8"));
  const ids     = new Set<string>();

  // matches: each match has bankRecord + gatewaySubset
  for (const m of (content.matches ?? [])) {
    ids.add(m.bankRecord.transactionRecordId);
    for (const g of (m.gatewaySubset ?? [])) {
      ids.add(g.transactionRecordId);
    }
  }

  // exceptions: bank record IDs are NOT claimed (they're the ones we want to disambiguate)
  // But we should not let resolveExactResiduals steal them either
  const exceptions: SubsetSumException[] = content.exceptions ?? [];

  return { claimedIds: ids, exceptions };
}

// ── Ground truth helpers ──────────────────────────────────────────────────────
interface GTEntry {
  bankStatementRecordId:     string;
  gatewaySettlementRecordIds?: string[];
  gatewaySettlementRecordId: string;
  caseType:                  string;
  matchingAlgorithm:         string;
  settlementLagDays?:        number;
  corruptionType?:           string | null;
  rootReferenceToken?:       string;
}

function loadGroundTruth(): GTEntry[] {
  const path = join(DATA_DIR, "ground_truth.json");
  const d    = JSON.parse(readFileSync(path, "utf-8"));
  return d.expectedMatches ?? d;
}

/**
 * Build a Set of "bankId|gatewayId" pair keys from resolved fuzzy matches.
 * Used to evaluate against GT pair keys (same approach as exact.ts).
 */
function buildPairKeySet(matches: FuzzyMatchGroup[]): Set<string> {
  const keys = new Set<string>();
  for (const m of matches) {
    for (const gwId of m.gatewayRecordIds) {
      keys.add(`${m.bankRecordId}|${gwId}`);
    }
  }
  return keys;
}

function buildGTPairKeys(gtEntries: GTEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const e of gtEntries) {
    const gIds = e.gatewaySettlementRecordIds ?? [e.gatewaySettlementRecordId];
    for (const gId of gIds) {
      keys.add(`${e.bankStatementRecordId}|${gId}`);
    }
  }
  return keys;
}

function evalCatchRate(
  label:        string,
  resolvedMatches: FuzzyMatchGroup[],
  gtEntries:    GTEntry[]
): { caught: number; total: number; rate: number } {
  // Match by pair key (bankId|gatewayId) — same method exact.ts uses
  const proposedPairKeys = buildPairKeySet(resolvedMatches);
  const gtPairKeys       = buildGTPairKeys(gtEntries);
  const caught = [...gtPairKeys].filter(k => proposedPairKeys.has(k)).length;
  const total  = gtEntries.length;
  const rate   = total > 0 ? caught / total : 0;
  console.log(`  [GT ${label}] caught=${caught}/${total} (${(rate * 100).toFixed(1)}%)`);
  return { caught, total, rate };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Layer 2a — Fuzzy Match  runId=${RUN_ID}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const tracer = new FuzzyTracer(RUN_ID);

  // 1. Load all transactions (reuse exact.ts loader — no CSV parser rewrite)
  const allTx      = loadAllTransactions(DATA_DIR);
  const bankAll    = allTx.filter(t => t.dataSource === "BANK_STATEMENT");
  const gatewayAll = allTx.filter(t => t.dataSource === "GATEWAY_SETTLEMENT");

  // 2. Build claimed ID set from exact + subset-sum matches
  const exactClaimedIds       = loadExactClaimedIds();
  const { claimedIds: ssClaimedIds, exceptions } = loadSubsetSumData();

  const claimedIds = new Set<string>([...exactClaimedIds, ...ssClaimedIds]);
  console.log(`Claimed IDs so far: ${claimedIds.size} (exact=${exactClaimedIds.size}, subset-sum=${ssClaimedIds.size})`);

  // 3. Mark bank records from AMBIGUOUS_MATCH exceptions as "in-exception" so
  //    resolveExactResiduals doesn't try to steal them
  const exceptionBankIds = new Set(exceptions.map(e => e.bankRecord.transactionRecordId));
  const claimedPlusException = new Set<string>([...claimedIds, ...exceptionBankIds]);

  const unmatchedBanks    = bankAll.filter(b => !claimedPlusException.has(b.transactionRecordId));
  const unmatchedGateways = gatewayAll.filter(g => !claimedIds.has(g.transactionRecordId));

  console.log(`Unmatched banks for residual resolution: ${unmatchedBanks.length}`);
  console.log(`Available gateways for residual resolution: ${unmatchedGateways.length}`);
  console.log(`Subset-sum exceptions to disambiguate: ${exceptions.length}`);

  // 4. Load starting hash (continues from subset_sum or fee_inference, whichever is latest)
  const startingHash = loadStartingHash();
  console.log(`\nChain continuation hash: ${startingHash.slice(0, 16)}…\n`);

  // 5. Resolve exact residuals (typo / near-miss cases)
  const residualStart = performance.now();
  const residualResult = resolveExactResiduals(
    unmatchedBanks,
    unmatchedGateways,
    claimedPlusException,
    startingHash
  );
  const residualMs = performance.now() - residualStart;

  // Track similarity computations: each unmatched bank vs available gateways
  const residualSimCount = unmatchedBanks.length * unmatchedGateways.length;
  const residualEmbCount = unmatchedBanks.length + unmatchedGateways.length;

  tracer.log({
    batchLabel:           "resolveExactResiduals",
    wallClockMs:          residualMs,
    embeddingsComputed:   residualEmbCount,
    similaritiesComputed: residualSimCount,
    proposalsEmitted:     residualResult.newMatches.length,
  });

  const residualAutoCommit   = residualResult.newMatches.filter(m => m.status === "MATCHED").length;
  const residualPendingReview = residualResult.newMatches.filter(m => m.status === "PENDING_REVIEW").length;
  console.log(`\n── resolveExactResiduals ─────────────────────────────────────`);
  console.log(`  Unmatched banks:    ${unmatchedBanks.length}`);
  console.log(`  AUTO_COMMIT:        ${residualAutoCommit}`);
  console.log(`  PENDING_REVIEW:     ${residualPendingReview}`);
  console.log(`  New exceptions:     ${residualResult.newExceptions.length}`);
  console.log(`  Audit rows:         ${residualResult.auditRows.length}`);
  console.log(`  Wall clock:         ${residualMs.toFixed(0)} ms`);

  // 6. Disambiguate subset-sum AMBIGUOUS_MATCH exceptions
  // Continue hash chain from end of residual batch
  const residualLastHash = residualResult.auditRows.length > 0
    ? residualResult.auditRows[residualResult.auditRows.length - 1].rowHash
    : startingHash;

  const disambigStart = performance.now();
  const disambigResult = disambiguateSubsetSumExceptions(exceptions, residualLastHash);
  const disambigMs = performance.now() - disambigStart;

  // Track computations: each exception bank × each gateway in each candidate subset
  const disambigEmbCount = exceptions.reduce((sum, ex) => {
    return sum + 1 + ex.candidates.reduce((s, c) => s + c.gatewaySubset.length, 0);
  }, 0);
  const disambigSimCount = exceptions.reduce((sum, ex) => {
    return sum + ex.candidates.reduce((s, c) => s + c.gatewaySubset.length, 0);
  }, 0);

  tracer.log({
    batchLabel:           "disambiguateSubsetSumExceptions",
    wallClockMs:          disambigMs,
    embeddingsComputed:   disambigEmbCount,
    similaritiesComputed: disambigSimCount,
    proposalsEmitted:     disambigResult.resolvedCount,
  });

  console.log(`\n── disambiguateSubsetSumExceptions ───────────────────────────`);
  console.log(`  Total exceptions:   ${exceptions.length}`);
  console.log(`  Disambiguated:      ${disambigResult.resolvedCount}`);
  console.log(`  Still ambiguous:    ${disambigResult.stillAmbiguousCount}`);
  console.log(`  Audit rows:         ${disambigResult.auditRows.length}`);
  console.log(`  Wall clock:         ${disambigMs.toFixed(0)} ms`);

  // 7. Ground truth evaluation
  // NOTE: exact_match_results.json references IDs from a data snapshot taken before the CSV was
  // regenerated. The stale claimed IDs do not appear in the current CSVs, so they don't filter
  // any real records. This is a known state from Day 1–2. The fuzzy layer is evaluated against
  // the current GT file which is aligned with the current CSVs.
  const gt = loadGroundTruth();

  // GT AI_FUZZY = 5 timing-lag typo cases (14–15 day settlement lag, exact missed due to ±3d window)
  const gtAiFuzzy = gt.filter(e => e.matchingAlgorithm === "AI_FUZZY");
  // GT SUBSET_SUM = 139 MANY_TO_ONE + NEGATIVE_REFUND bundle cases
  const gtSubsetSum = gt.filter(e => e.matchingAlgorithm === "SUBSET_SUM");
  // All PENDING_REVIEW matches — also valid catches (queued for human review)
  const allResidualProposed = residualResult.newMatches; // includes PENDING_REVIEW

  console.log(`\n── Ground Truth Evaluation ───────────────────────────────────`);
  console.log(`  GT AI_FUZZY targets (timing-lag typos, exact missed): ${gtAiFuzzy.length}`);
  console.log(`  GT SUBSET_SUM targets (MANY_TO_ONE + NEGATIVE_REFUND): ${gtSubsetSum.length}`);
  console.log(`  Note: exact_match_results IDs are from a stale data snapshot (pre-CSV regen).`);
  console.log(`        Residual unmatched count reflects current CSV data.`);

  const allNewMatches = [
    ...residualResult.newMatches.filter(m => m.status === "MATCHED"),
    ...disambigResult.resolvedMatches,
  ];
  const allProposed = [
    ...residualResult.newMatches, // MATCHED + PENDING_REVIEW
    ...disambigResult.resolvedMatches,
  ];

  const aiFuzzyCatchAuto   = evalCatchRate("AI_FUZZY GT (AUTO_COMMIT only)", residualResult.newMatches.filter(m => m.status === "MATCHED"), gtAiFuzzy);
  const aiFuzzyCatchAll    = evalCatchRate("AI_FUZZY GT (MATCHED + PENDING_REVIEW)", allResidualProposed, gtAiFuzzy);
  const ssCatch            = evalCatchRate("SUBSET_SUM GT (disambiguated)", disambigResult.resolvedMatches, gtSubsetSum);
  console.log(`  Subset-sum still-ambiguous: ${disambigResult.stillAmbiguousCount}/${exceptions.length} (gap threshold working: ${disambigResult.stillAmbiguousCount > 0 ? 'YES' : 'NO — CHECK THRESHOLD'})`);

  // 8. Merge all audit rows
  const allAuditRows: AuditRow[] = [
    ...residualResult.auditRows,
    ...disambigResult.auditRows,
  ];

  // 9. Write results
  const output = {
    runId:             RUN_ID,
    timestamp:         new Date().toISOString(),
    newMatches:        residualResult.newMatches,
    newExceptions:     residualResult.newExceptions,
    resolvedExceptions: disambigResult.resolvedMatches,
    stillAmbiguous:    disambigResult.stillAmbiguousCount,
    auditRows:         allAuditRows,
    summary: {
      unmatchedBanks:        unmatchedBanks.length,
      residualAutoCommit,
      residualPendingReview,
      subsetSumExceptions:   exceptions.length,
      disambiguated:         disambigResult.resolvedCount,
      stillAmbiguous:        disambigResult.stillAmbiguousCount,
      totalNewAuditRows:     allAuditRows.length,
    },
  };

  const outPath = join(RESULTS_DIR, "fuzzy_match_results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Results written to ${outPath}`);
  console.log(`✓ Trace written to logs/fuzzy-trace-${RUN_ID}.jsonl`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
