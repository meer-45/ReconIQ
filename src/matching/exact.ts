// Exact matching layer for ReconIQ payment reconciliation engine
// Reads TransactionRecord rows across all 3 sources from data/ directory
// Matches by: identical amountPaise AND normalized reference string equality AND transaction date within ±3 days window
// Enforces 1:1 uniqueness (skips matches if multiple candidates tie)
// Creates MatchGroup and AuditTrail entries for each match, with tamper-evident hash chaining

import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createHash } from 'node:crypto';

// Types for reconciliation matching
interface TransactionRecord {
  transactionRecordId: string;
  dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER";
  externalReference: string;
  amountPaise: number;
  currencyCode: string;
  transactionDate: string; // ISO date string YYYY-MM-DD
  transactionDateMs: number; // Unix ms epoch
  ingestedAt: string;
  rawDescription: string;
  rawPayload: string; // JSON string
  matchGroupId: string | null;
}

interface MatchGroup {
  matchGroupId: string;
  method: "EXACT";
  confidenceScore: number;
  status: "MATCHED";
  createdAt: string;
  resolvedAt: string | null;
}

interface AuditTrail {
  auditTrailId: string;
  decisionTimestamp: string;
  method: "EXACT";
  reason: string;
  actor: "SYSTEM";
  actorId: string | null;
  transactionRecordId: string | null;
  matchGroupId: string | null;
  metadata: string | null;
  rowHash: string;
  previousRowHash: string;
}

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

// Configuration for exact matching
interface ExactMatchConfig {
  dateWindowDays: number; // ±3 days default window
  requireReferenceMatch: boolean;
}

const DEFAULT_EXACT_MATCH_CONFIG: ExactMatchConfig = {
  dateWindowDays: 3,
  requireReferenceMatch: true
};

const generateRecordIdentifier = () => `tx_${Math.random().toString(36).substring(2, 14)}`;

function parseTransactionDate(dateString: string): Date {
  return new Date(dateString);
}

// Normalize reference string: strips UTR, pay_, gtx_, ORD- prefixes, trims whitespace, uppercases.
// Does NOT do fuzzy correction.
function normalizeReference(reference: string): string {
  if (!reference) return '';
  return reference
    .trim()
    .replace(/^(UTR|pay_|gtx_|ORD-)/i, '')
    .trim()
    .toUpperCase();
}

function datesWithinWindow(date1: Date, date2: Date, windowDays: number): boolean {
  const timeDifference = Math.abs(date1.getTime() - date2.getTime());
  const dayDifference = timeDifference / (1000 * 3600 * 24);
  return dayDifference <= windowDays;
}

// Load transaction records from CSV file
function loadTransactionsFromCsv(filepath: string, dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER"): TransactionRecord[] {
  const csvContent = readFileSync(filepath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]);
  const transactions: TransactionRecord[] = [];

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const values = parseCsvLine(lines[rowIndex]);
    if (values.length === 0) continue;

    const record: Record<string, string> = {};
    header.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });

    const txDateStr = record["transactionDate"] || '';

    transactions.push({
      transactionRecordId: record["transactionRecordId"] || generateRecordIdentifier(),
      dataSource: dataSource,
      externalReference: record["externalReference"] || '',
      amountPaise: parseInt(record["amountPaise"] || '0', 10),
      currencyCode: record["currencyCode"] || "INR",
      transactionDate: txDateStr,
      transactionDateMs: txDateStr ? new Date(txDateStr).getTime() : 0,
      ingestedAt: record["ingestedAt"] || new Date().toISOString(),
      rawDescription: record["rawDescription"] || '',
      rawPayload: record["rawPayload"] || '{}',
      matchGroupId: null
    });
  }

  return transactions;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (!inQuotes && char === '"') {
      inQuotes = true;
      quoteChar = '"';
      continue;
    }
    if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = '';
      continue;
    }
    if (inQuotes) {
      current += char;
      continue;
    }
    if (char === ',') {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

interface MatchedPair {
  bankId: string;
  gatewayId: string;
  matchGroupId: string;
}

interface ExactMatchingResult {
  matchGroups: MatchGroup[];
  auditTrailEntries: AuditTrail[];
  matchedPairs: MatchedPair[];
  matchedTransactionIds: Set<string>;
  skippedCollisionsCount: number;
}

// Perform strict 1:1 exact matching between BANK_STATEMENT and GATEWAY_SETTLEMENT records
function performExactMatching(
  allTransactions: TransactionRecord[],
  config: ExactMatchConfig = DEFAULT_EXACT_MATCH_CONFIG
): ExactMatchingResult {
  const matchGroups: MatchGroup[] = [];
  const auditTrailEntries: AuditTrail[] = [];
  const matchedPairs: MatchedPair[] = [];
  const matchedTransactionIds = new Set<string>();

  const bankRecords = allTransactions.filter(t => t.dataSource === "BANK_STATEMENT");
  const gatewayRecords = allTransactions.filter(t => t.dataSource === "GATEWAY_SETTLEMENT");

  // Step 1: Find all valid candidate pairs (bank, gateway) meeting amount, reference, and date window criteria
  interface CandidatePair {
    bank: TransactionRecord;
    gateway: TransactionRecord;
  }

  const candidatePairs: CandidatePair[] = [];
  const bankCandidatesMap = new Map<string, TransactionRecord[]>(); // bankId -> gateway[]
  const gatewayCandidatesMap = new Map<string, TransactionRecord[]>(); // gatewayId -> bank[]

  bankRecords.forEach(bank => {
    gatewayRecords.forEach(gateway => {
      // 1. Identical amountPaise
      if (bank.amountPaise !== gateway.amountPaise) return;

      // 2. Normalized reference equality
      if (config.requireReferenceMatch) {
        const normBank = normalizeReference(bank.externalReference);
        const normGateway = normalizeReference(gateway.externalReference);
        if (!normBank || !normGateway || normBank !== normGateway) return;
      }

      // 3. Date window check
      if (Math.abs(bank.transactionDateMs - gateway.transactionDateMs) > config.dateWindowDays * 24 * 3600 * 1000) return;

      // Valid candidate
      candidatePairs.push({ bank, gateway });

      let bList = bankCandidatesMap.get(bank.transactionRecordId);
      if (!bList) { bList = []; bankCandidatesMap.set(bank.transactionRecordId, bList); }
      bList.push(gateway);

      let gList = gatewayCandidatesMap.get(gateway.transactionRecordId);
      if (!gList) { gList = []; gatewayCandidatesMap.set(gateway.transactionRecordId, gList); }
      gList.push(bank);
    });
  });

  // Step 2: Enforce strict uniqueness (1:1 matching). Reject ties/collisions.
  let skippedCollisionsCount = 0;
  const committedPairs: CandidatePair[] = [];

  candidatePairs.forEach(pair => {
    const bGateways = bankCandidatesMap.get(pair.bank.transactionRecordId) || [];
    const gBanks = gatewayCandidatesMap.get(pair.gateway.transactionRecordId) || [];

    if (bGateways.length === 1 && gBanks.length === 1) {
      // Ensure neither has been matched yet
      if (!matchedTransactionIds.has(pair.bank.transactionRecordId) && !matchedTransactionIds.has(pair.gateway.transactionRecordId)) {
        committedPairs.push(pair);
        matchedTransactionIds.add(pair.bank.transactionRecordId);
        matchedTransactionIds.add(pair.gateway.transactionRecordId);
      }
    } else {
      skippedCollisionsCount++;
    }
  });

  // Step 3: Create MatchGroups and AuditTrail entries for committed pairs
  committedPairs.forEach(pair => {
    const matchGroupId = generateRecordIdentifier();
    const nowISO = new Date().toISOString();

    const matchGroup: MatchGroup = {
      matchGroupId,
      method: "EXACT",
      confidenceScore: 1.0,
      status: "MATCHED",
      createdAt: nowISO,
      resolvedAt: nowISO
    };
    matchGroups.push(matchGroup);

    pair.bank.matchGroupId = matchGroupId;
    pair.gateway.matchGroupId = matchGroupId;

    matchedPairs.push({
      bankId: pair.bank.transactionRecordId,
      gatewayId: pair.gateway.transactionRecordId,
      matchGroupId
    });

    // Audit trail for bank record
    auditTrailEntries.push({
      auditTrailId: generateRecordIdentifier(),
      decisionTimestamp: nowISO,
      method: "EXACT",
      reason: `Exact match: amountPaise=${pair.bank.amountPaise}, normalizedRef=${normalizeReference(pair.bank.externalReference)}, lagWithin=${config.dateWindowDays}d`,
      actor: "SYSTEM",
      actorId: "exact.ts",
      transactionRecordId: pair.bank.transactionRecordId,
      matchGroupId,
      metadata: JSON.stringify({
        matchedAmountPaise: pair.bank.amountPaise,
        bankRef: pair.bank.externalReference,
        gatewayRef: pair.gateway.externalReference
      }),
      rowHash: '',
      previousRowHash: ''
    });

    // Audit trail for gateway record
    auditTrailEntries.push({
      auditTrailId: generateRecordIdentifier(),
      decisionTimestamp: nowISO,
      method: "EXACT",
      reason: `Exact match: amountPaise=${pair.gateway.amountPaise}, normalizedRef=${normalizeReference(pair.gateway.externalReference)}, lagWithin=${config.dateWindowDays}d`,
      actor: "SYSTEM",
      actorId: "exact.ts",
      transactionRecordId: pair.gateway.transactionRecordId,
      matchGroupId,
      metadata: JSON.stringify({
        matchedAmountPaise: pair.gateway.amountPaise,
        bankRef: pair.bank.externalReference,
        gatewayRef: pair.gateway.externalReference
      }),
      rowHash: '',
      previousRowHash: ''
    });
  });

  return { matchGroups, auditTrailEntries, matchedPairs, matchedTransactionIds, skippedCollisionsCount };
}

function loadAllTransactions(dataDirectory: string): TransactionRecord[] {
  const bankTransactions = loadTransactionsFromCsv(join(dataDirectory, "bank_statement.csv"), "BANK_STATEMENT");
  const gatewayTransactions = loadTransactionsFromCsv(join(dataDirectory, "gateway_settlement.csv"), "GATEWAY_SETTLEMENT");
  const merchantTransactions = loadTransactionsFromCsv(join(dataDirectory, "merchant_ledger.csv"), "MERCHANT_LEDGER");
  return [...bankTransactions, ...gatewayTransactions, ...merchantTransactions];
}

function loadGroundTruth(filepath: string): { expectedMatches: GroundTruthEntry[] } {
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content);
}

// Scoring and Verification against Ground Truth v2.1
function compareWithGroundTruth(
  matchedPairs: MatchedPair[],
  groundTruthEntries: GroundTruthEntry[],
  allTransactions: TransactionRecord[]
) {
  // Subset of ground truth entries expected to be matched by EXACT
  const exactGtEntries = groundTruthEntries.filter(e => e.matchingAlgorithm === "EXACT");
  const exactGtPairs = new Set<string>();

  exactGtEntries.forEach(entry => {
    const gIds = entry.gatewaySettlementRecordIds || [entry.gatewaySettlementRecordId];
    gIds.forEach(gId => {
      exactGtPairs.add(`${entry.bankStatementRecordId}|${gId}`);
    });
  });

  let correctMatches = 0;
  let leakageCount = 0;

  matchedPairs.forEach(pair => {
    const pairKey = `${pair.bankId}|${pair.gatewayId}`;
    if (exactGtPairs.has(pairKey)) {
      correctMatches++;
    } else {
      leakageCount++;
    }
  });

  const totalCommitted = matchedPairs.length;
  const totalExactExpected = exactGtEntries.length;

  const precision = totalCommitted > 0 ? correctMatches / totalCommitted : 1.0;
  const recall = totalExactExpected > 0 ? correctMatches / totalExactExpected : 0.0;

  // Breakdown of missed EXACT cases
  const matchedBankIds = new Set(matchedPairs.map(p => p.bankId));
  const missedExactEntries = exactGtEntries.filter(e => !matchedBankIds.has(e.bankStatementRecordId));

  let missedCorrupted = 0;
  let missedTimingLag = 0;
  let missedCollision = 0;
  let missedOther = 0;

  missedExactEntries.forEach(entry => {
    if (entry.corruptionType) {
      missedCorrupted++;
    } else if ((entry.settlementLagDays || 0) > 3) {
      missedTimingLag++;
    } else {
      missedOther++;
    }
  });

  return {
    correctMatches,
    totalCommitted,
    totalExactExpected,
    precision,
    recall,
    leakageCount,
    missedBreakdown: {
      totalMissed: missedExactEntries.length,
      corruptedReference: missedCorrupted,
      timingLag: missedTimingLag,
      otherOrCollision: missedOther
    }
  };
}

async function runExactMatch(dataDirectory: string, groundTruthPath: string) {
  console.log("Starting exact matching layer for ReconIQ (v2.1 evaluation)...");

  const allTransactions = loadAllTransactions(dataDirectory);
  console.log(`Loaded ${allTransactions.length} total transaction records from ${dataDirectory}`);

  const { matchGroups, auditTrailEntries, matchedPairs, matchedTransactionIds, skippedCollisionsCount } = performExactMatching(allTransactions);

  console.log("\nExact Matching Complete:");
  console.log(`- Match Groups formed: ${matchGroups.length}`);
  console.log(`- Matched Transactions: ${matchedTransactionIds.size}`);
  console.log(`- Candidate Collisions Skipped (Uniqueness Rule): ${skippedCollisionsCount}`);

  // Compute tamper-evident hash chain (SHA-256)
  const GENESIS_HASH = "0".repeat(64);
  let runningHash = GENESIS_HASH;
  const finalAuditTrailEntries: AuditTrail[] = [];

  for (const entry of auditTrailEntries) {
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
  }

  // Score against Ground Truth v2.1
  const gt = loadGroundTruth(groundTruthPath);
  const comparison = compareWithGroundTruth(matchedPairs, gt.expectedMatches, allTransactions);

  console.log("\n--- GROUND TRUTH EVALUATION (EXACT SUBSET) ---");
  console.log(`- Total GT EXACT Expected:  ${comparison.totalExactExpected}`);
  console.log(`- Correct Matches:          ${comparison.correctMatches}`);
  console.log(`- Total Committed Matches:  ${comparison.totalCommitted}`);
  console.log(`- Precision:                ${(comparison.precision * 100).toFixed(1)}%`);
  console.log(`- Recall:                   ${(comparison.recall * 100).toFixed(1)}%`);
  console.log(`- Leakage (Wrongly Claimed): ${comparison.leakageCount}`);
  console.log(`- Collisions Skipped:       ${skippedCollisionsCount}`);
  console.log(`\n- Missed EXACT Breakdown:`);
  console.log(`  * Corrupted References:   ${comparison.missedBreakdown.corruptedReference}`);
  console.log(`  * Timing Lag (>3 days):   ${comparison.missedBreakdown.timingLag}`);
  console.log(`  * Other / Collision:      ${comparison.missedBreakdown.otherOrCollision}`);

  return {
    matchGroups,
    auditTrailEntries: finalAuditTrailEntries,
    matchedPairs,
    summary: {
      matchedCount: matchedTransactionIds.size,
      precision: comparison.precision,
      recall: comparison.recall,
      correctMatchGroups: comparison.correctMatches,
      totalExactExpected: comparison.totalExactExpected,
      leakage: comparison.leakageCount,
      skippedCollisions: skippedCollisionsCount
    }
  };
}

export {
  runExactMatch,
  loadAllTransactions,
  loadGroundTruth,
  performExactMatching,
  normalizeReference,
  TransactionRecord
};

if (import.meta.main) {
  const dataDir = resolve(__dirname, '../../data');
  const gtPath = resolve(__dirname, '../../data/ground_truth.json');

  runExactMatch(dataDir, gtPath).then(results => {
    const outPath = resolve(__dirname, 'exact_match_results.json');
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\nResults written to ${outPath}`);
  }).catch(err => {
    console.error("Error running exact matching:", err);
    process.exit(1);
  });
}
