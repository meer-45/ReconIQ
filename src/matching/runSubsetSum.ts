// Subset-Sum execution harness with hash-chain continuity
// Reads previous exact match audit trail for hash chain continuation
// Generates MatchGroup and AuditTrail entries for matches and exceptions

import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createHash } from 'node:crypto';
import {
  performSubsetSumMatching,
  SubsetSumConfig,
  TransactionRecord,
  SubsetSumCandidate,
  PendingException,
  MatchGroup,
  AuditTrail
} from "./subsetSum";
import { loadAllTransactions } from "./exact"; // reusing exact's loader

interface GroundTruthEntry {
  bankStatementRecordId: string;
  gatewaySettlementRecordIds?: string[];
  gatewaySettlementRecordId: string;
  merchantLedgerRecordId: string | null;
  matchingAlgorithm: string;
  confidenceScore: number;
  expectedMatchedAt: string;
  caseType?: string;
  classification?: string | null;
  corruptionType?: string | null;
  settlementLagDays?: number;
}

async function runSubsetSum(dataDirectory: string) {
  console.log("Starting Subset-Sum matching layer...");

  // 1. Hash-Chain Continuity: Load exact matcher audit results
  const exactResultsPath = resolve(__dirname, 'exact_match_results.json');
  let genesisHash = "0".repeat(64);

  try {
    const resultsContent = readFileSync(exactResultsPath, 'utf-8');
    const results = JSON.parse(resultsContent);
    const auditEntries = results.auditTrailEntries;

    if (auditEntries && auditEntries.length > 0) {
      genesisHash = auditEntries[auditEntries.length - 1].rowHash;
      console.log(`[Chain Continuation] Successfully loaded starting previousRowHash from exact.ts: ${genesisHash}`);
    }
  } catch (err) {
    throw new Error("Missing exact_match_results.json! You must run the exact matching layer (exact.ts) first to establish the starting hash chain.");
  }

  // 2. Load Data
  const allTransactions = loadAllTransactions(dataDirectory);
  const bankRecords = allTransactions.filter(t => t.dataSource === "BANK_STATEMENT");
  const gatewayRecords = allTransactions.filter(t => t.dataSource === "GATEWAY_SETTLEMENT");
  const merchantRecords = allTransactions.filter(t => t.dataSource === "MERCHANT_LEDGER");

  // Bug 1 Fix: Mark records claimed by exact.ts so subset-sum knows to exclude them
  let exactClaimedCount = 0;
  try {
    const exactResultsPath = resolve(__dirname, 'exact_match_results.json');
    const exactResultsContent = readFileSync(exactResultsPath, 'utf-8');
    const exactResults = JSON.parse(exactResultsContent);

    // Extract from audit trail entries which have the actual transactionRecordId
    const claimedByExact = new Set<string>();
    exactResults.auditTrailEntries.forEach(entry => {
      if (entry.transactionRecordId) {
        claimedByExact.add(entry.transactionRecordId);
      }
    });

    // Apply the EXACT_CLAIMED marker to records
    allTransactions.forEach(record => {
      if (claimedByExact.has(record.transactionRecordId)) {
        record.matchGroupId = "EXACT_CLAIMED";
        exactClaimedCount++;
      }
    });

    console.log(`[EXACT CLAIM] Marked ${exactClaimedCount} records as claimed by exact.ts`);
  } catch (err) {
    console.error("Failed to load exact match results for claiming:", err);
    // Continue without claiming - fallback to original behavior
  }

  // Load fee inference results if available
  let netFactor = 1.0;
  let toleranceBasisPoints = 400; // default, will be overridden if fee inference results exist
  const feeInferencePath = resolve(__dirname, 'fee_inference_results.json');
  try {
    const feeContent = readFileSync(feeInferencePath, 'utf-8');
    const feeResults = JSON.parse(feeContent);
    netFactor = feeResults.netFactor;
    // After fee is handled explicitly, tolerance only needs to absorb paise rounding
    toleranceBasisPoints = 50;
    console.log(`[FEE_CONFIG] Loaded netFactor=${netFactor} from fee inference results, setting toleranceBasisPoints=${toleranceBasisPoints}`);
  } catch (err) {
    console.log(`[FEE_CONFIG] No fee inference results found, using defaults (netFactor=1.0, toleranceBasisPoints=400)`);
  }

  const config: SubsetSumConfig = {
    toleranceBasisPoints,
    maxSubsetSize: 5,
    minSubsetSize: 2,
    dateWindowDays: 5,
    maxCandidatesToEnumerate: 200,
    minimumScoreGap: 0.05,
    netFactor
  };

  // 3. Perform Subset-Sum
  const result = performSubsetSumMatching(bankRecords, gatewayRecords, merchantRecords, config);
  const matches = result.matches;
  const exceptions = result.exceptions;

  console.log(`Subset-Sum complete: found ${matches.length} matches, ${exceptions.length} exceptions (ambiguous).`);

  // 4. Build AuditTrail entries and compute hash chain
  let runningHash = genesisHash;
  const finalAuditTrailEntries: AuditTrail[] = [];

  // Helper to push an audit entry and update hash
  const pushAuditEntry = (entry: Omit<AuditTrail, 'rowHash' | 'previousRowHash'>) => {
    const content = {
      method: entry.method,
      reason: entry.reason,
      actor: entry.actor,
      actorId: entry.actorId,
      transactionRecordId: entry.transactionRecordId,
      matchGroupId: entry.matchGroupId,
      metadata: entry.metadata,
      decisionTimestamp: entry.decisionTimestamp
    };
    const contentString = JSON.stringify(content);
    const hashInput = runningHash + contentString;
    const rowHash = createHash('sha256').update(hashInput, 'utf8').digest('hex');

    finalAuditTrailEntries.push({
      ...entry,
      rowHash,
      previousRowHash: runningHash
    });
    runningHash = rowHash;
  };

  // Process matches
  for (const match of matches) {
    const matchGroupId = `tx_${Math.random().toString(36).substring(2, 14)}`;
    const nowISO = new Date().toISOString();

    const matchGroup: MatchGroup = {
      matchGroupId,
      method: "SUBSET_SUM",
      confidenceScore: match.score.finalScore,
      status: "MATCHED",
      createdAt: nowISO,
      resolvedAt: nowISO
    };

    // Assign matchGroupId to records (for downstream use, though not persisted)
    match.bankRecord.matchGroupId = matchGroupId;
    match.gatewaySubset.forEach(gw => {
      gw.matchGroupId = matchGroupId;
    });

    // Build audit trail entry (one per match, representing the bundle)
    const gatewayIds = match.gatewaySubset.map(g => g.transactionRecordId).join(", ");
    pushAuditEntry({
      auditTrailId: `at_${Math.random().toString(36).substring(2, 14)}`,
      decisionTimestamp: nowISO,
      method: "SUBSET_SUM",
      reason: `Subset-sum match: bank=${match.bankRecord.transactionRecordId} (${match.bankRecord.amountPaise}) = sum(${gatewayIds})`,
      actor: "SYSTEM",
      actorId: "subsetSum.ts",
      transactionRecordId: match.bankRecord.transactionRecordId, // could also pick first gateway; we choose bank as anchor
      matchGroupId,
      metadata: JSON.stringify({
        matchedAmountPaise: match.bankRecord.amountPaise,
        subsetSize: match.gatewaySubset.length,
        score: match.score.finalScore,
        amountPrecision: match.score.amountPrecision,
        dateProximity: match.score.dateProximity,
        subsetSizePenalty: match.score.subsetSizePenalty,
        gatewayIds: match.gatewaySubset.map(g => g.transactionRecordId)
      })
    });

    // Also create audit entries for each gateway? Exact.ts created one per transaction in the pair.
    // For consistency, we'll create one audit entry per transaction in the bundle (bank + each gateway).
    // Bank already done above; now for each gateway:
    match.gatewaySubset.forEach(gw => {
      pushAuditEntry({
        auditTrailId: `at_${Math.random().toString(36).substring(2, 14)}`,
        decisionTimestamp: nowISO,
        method: "SUBSET_SUM",
        reason: `Subset-sum match: bank=${match.bankRecord.transactionRecordId} (${match.bankRecord.amountPaise}) = sum(${gatewayIds})`,
        actor: "SYSTEM",
        actorId: "subsetSum.ts",
        transactionRecordId: gw.transactionRecordId,
        matchGroupId,
        metadata: JSON.stringify({
          matchedAmountPaise: match.bankRecord.amountPaise,
          gatewayAmountPaise: gw.amountPaise,
          subsetSize: match.gatewaySubset.length,
          score: match.score.finalScore
        })
      });
    });
  }

  // Process exceptions (ambiguous cases)
  for (const exc of exceptions) {
    const nowISO = new Date().toISOString();
    const candidateSummary = exc.candidates.map(c => ({
      subset: c.gatewaySubset.map(g => g.transactionRecordId).join("+"),
      score: c.score.finalScore
    }));
    pushAuditEntry({
      auditTrailId: `at_${Math.random().toString(36).substring(2, 14)}`,
      decisionTimestamp: nowISO,
      method: "SUBSET_SUM",
      reason: `Ambiguous subset-sum: bank=${exc.bankRecord.transactionRecordId} has ${exc.candidates.length} valid subsets`,
      actor: "SYSTEM",
      actorId: "subsetSum.ts",
      transactionRecordId: exc.bankRecord.transactionRecordId,
      matchGroupId: null,
      metadata: JSON.stringify({
        bankAmountPaise: exc.bankRecord.amountPaise,
        candidateCount: exc.candidates.length,
        candidates: candidateSummary
      })
    });
  }

  // 5. Score against Ground Truth v2.1
  const gtPath = resolve(__dirname, '../../data/ground_truth.json');
  const gtContent = readFileSync(gtPath, 'utf-8');
  const groundTruth: { expectedMatches: GroundTruthEntry[] } = JSON.parse(gtContent);

  // Build set of matched transaction IDs from our matches
  const matchedTransactionIds = new Set<string>();
  matches.forEach(m => {
    matchedTransactionIds.add(m.bankRecord.transactionRecordId);
    m.gatewaySubset.forEach(gw => matchedTransactionIds.add(gw.transactionRecordId));
  });

  // Subset of ground truth entries expected to be matched by SUBSET_SUM (MANY_TO_ONE + NEGATIVE_REFUND)
  const subsetSumGtEntries = groundTruth.expectedMatches.filter(e =>
    e.matchingAlgorithm === "SUBSET_SUM"
  );

  let correctMatches = 0;
  subsetSumGtEntries.forEach(entry => {
    const bankId = entry.bankStatementRecordId;
    const gatewayIds = entry.gatewaySettlementRecordIds || [entry.gatewaySettlementRecordId];
    const allIds = [bankId, ...gatewayIds];
    const allMatched = allIds.every(id => matchedTransactionIds.has(id));
    if (allMatched) {
      correctMatches++;
    }
  });

  const totalExpected = subsetSumGtEntries.length;
  const catchRate = totalExpected > 0 ? correctMatches / totalExpected : 0;

  console.log("\n--- GROUND TRUTH EVALUATION (SUBSET_SUM SUBSET) ---");
  console.log(`- Total GT SUBSET_SUM Expected:  ${totalExpected} (MANY_TO_ONE + NEGATIVE_REFUND)`);
  console.log(`- Correct Matches (exact bundle): ${correctMatches}`);
  console.log(`- Catch Rate:                    ${(catchRate * 100).toFixed(1)}%`);

  // 6. Write results to file
  const outPath = resolve(__dirname, 'subset_sum_results.json');
  writeFileSync(outPath, JSON.stringify({
    matches,
    exceptions,
    auditTrail: finalAuditTrailEntries,
    summary: {
      matchedCount: matches.length,
      exceptionCount: exceptions.length,
      catchRate,
      totalExpectedSubsetSum: totalExpected,
      correctMatches
    }
  }, null, 2));
  console.log(`\nResults written to ${outPath}`);

  // 7. Return for potential further use
  return { matches, exceptions, auditTrail: finalAuditTrailEntries };
}

if (import.meta.main) {
  const dataDir = resolve(__dirname, '../../data');
  runSubsetSum(dataDir).catch(console.error);
}