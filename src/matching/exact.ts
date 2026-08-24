// Exact matching layer for ReconIQ payment reconciliation engine
// Reads TransactionRecord rows across all 3 sources from CSV files
// Matches by: identical amountPaise AND date within ±30 day window (no reference string requirement)
// Creates MatchGroup and AuditTrail entries for each match, with tamper-evident hash chaining

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from 'node:crypto';

// Types for reconciliation matching
interface TransactionRecord {
  transactionRecordId: string;
  dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER";
  externalReference: string;
  amountPaise: number;
  currencyCode: string;
  transactionDate: string; // ISO date string YYYY-MM-DD
  ingestedAt: string;
  rawDescription: string;
  rawPayload: string; // JSON string
  matchGroupId: string | null;
}

interface MatchGroup {
  matchGroupId: string;
  method: "EXACT";
  confidenceScore: number;
  status: "matched";
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
  gatewaySettlementRecordId: string;
  merchantLedgerRecordId: string | null;
  matchingAlgorithm: string;
  confidenceScore: number;
  expectedMatchedAt: string;
}

// Configuration for exact matching
interface ExactMatchConfig {
  dateWindowDays: number; // Number of days to look back/forward for date matching
  requireReferenceMatch: boolean; // Whether to require reference string equality
}

// Default configuration for exact matching
const DEFAULT_EXACT_MATCH_CONFIG: ExactMatchConfig = {
  dateWindowDays: 30, // Widened to ±30 day window
  requireReferenceMatch: false // Dropped reference string equality
};

// Generate unique identifier for new records
const generateRecordIdentifier = () => `tx_${Math.random().toString(36).substring(2, 14)}`;

// Parse a date string to Date object
function parseTransactionDate(dateString: string): Date {
  return new Date(dateString);
}

// Normalize reference string for comparison (strip spaces, lowercase)
function normalizeReference(reference: string): string {
  return reference.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

// Check if two dates are within the specified window
function datesWithinWindow(date1: Date, date2: Date, windowDays: number): boolean {
  const timeDifference = Math.abs(date1.getTime() - date2.getTime());
  const dayDifference = timeDifference / (1000 * 3600 * 24);
  return dayDifference <= windowDays;
}

// Load transaction records from CSV file
function loadTransactionsFromCsv(filepath: string, dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER"): TransactionRecord[] {
  const csvContent = readFileSync(filepath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  // Parse CSV header
  const header = parseCsvLine(lines[0]);
  const transactions: TransactionRecord[] = [];

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const values = parseCsvLine(lines[rowIndex]);
    if (values.length === 0) continue;

    const record: Record<string, string> = {};
    header.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });

    transactions.push({
      transactionRecordId: record["transactionRecordId"] || generateRecordIdentifier(),
      dataSource: dataSource,
      externalReference: record["externalReference"] || '',
      amountPaise: parseInt(record["amountPaise"] || '0', 10),
      currencyCode: record["currencyCode"] || "INR",
      transactionDate: record["transactionDate"] || '',
      ingestedAt: record["ingestedAt"] || new Date().toISOString(),
      rawDescription: record["rawDescription"] || '',
      rawPayload: record["rawPayload"] || '{}',
      matchGroupId: null // Initialize as unmatched
    });
  }

  return transactions;
}

// Simple CSV line parser that handles quoted strings
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

// Interface for matched transaction pairs
interface MatchedPair {
  bankId: string;
  gatewayId: string;
  matchGroupId: string;
}

// Perform exact matching across transaction records
function performExactMatching(
  allTransactions: TransactionRecord[],
  config: ExactMatchConfig = DEFAULT_EXACT_MATCH_CONFIG
): { matchGroups: MatchGroup[]; auditTrailEntries: AuditTrail[]; matchedPairs: MatchedPair[]; matchedTransactionIds: Set<string> } {
  const matchGroups: MatchGroup[] = [];
  const auditTrailEntries: AuditTrail[] = [];
  const matchedPairs: MatchedPair[] = [];
  const matchedTransactionIds = new Set<string>();

  // Group transactions by amountPaise for efficient matching
  const transactionsByAmount = new Map<number, TransactionRecord[]>();

  allTransactions.forEach(transaction => {
    const existingGroup = transactionsByAmount.get(transaction.amountPaise);
    if (existingGroup) {
      existingGroup.push(transaction);
    } else {
      transactionsByAmount.set(transaction.amountPaise, [transaction]);
    }
  });

  // Find potential matches within each amount group
  transactionsByAmount.forEach((amountGroup, amountPaise) => {
    if (amountGroup.length < 2) return; // Need at least 2 records to match

    // Sort by date for efficient window-based matching
    amountGroup.sort((a, b) => {
      const dateA = parseTransactionDate(a.transactionDate);
      const dateB = parseTransactionDate(b.transactionDate);
      return dateA.getTime() - dateB.getTime();
    });

    for (let i = 0; i < amountGroup.length - 1; i++) {
      const baseRecord = amountGroup[i];
      if (matchedTransactionIds.has(baseRecord.transactionRecordId)) continue;

      for (let j = i + 1; j < amountGroup.length; j++) {
        const compareRecord = amountGroup[j];
        if (matchedTransactionIds.has(compareRecord.transactionRecordId)) continue;

        // Check date window
        const baseDate = parseTransactionDate(baseRecord.transactionDate);
        const compareDate = parseTransactionDate(compareRecord.transactionDate);
        if (!datesWithinWindow(baseDate, compareDate, config.dateWindowDays)) continue;

        // Ensure we are matching across DIFFERENT data sources
        if (baseRecord.dataSource === compareRecord.dataSource) continue;

        // Check reference match if required
        if (config.requireReferenceMatch) {
          const normalizedBaseRef = normalizeReference(baseRecord.externalReference);
          const normalizedCompareRef = normalizeReference(compareRecord.externalReference);
          if (normalizedBaseRef !== normalizedCompareRef) continue;
        }

        // We have an exact match! Create the match group
        const matchGroupId = generateRecordIdentifier();

        const matchGroup: MatchGroup = {
          matchGroupId: matchGroupId,
          method: "EXACT",
          confidenceScore: 1.0,
          status: "matched",
          createdAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString()
        };

        matchGroups.push(matchGroup);

        // Create audit trail entry explaining the match
        const refMatchInfo = config.requireReferenceMatch
          ? `references matched (normalized: ${normalizeReference(baseRecord.externalReference)})`
          : `reference matching skipped`;

        const auditTrailEntry: AuditTrail = {
          auditTrailId: generateRecordIdentifier(),
          decisionTimestamp: new Date().toISOString(),
          method: "EXACT",
          reason: `Exact match: amountPaise=${amountPaise} INR, ` +
                  `dateWindow=${config.dateWindowDays} days, ` +
                  `${refMatchInfo}, ` +
                  `datasources=[${baseRecord.dataSource}, ${compareRecord.dataSource}]`,
          actor: "SYSTEM",
          actorId: "exact.ts",
          transactionRecordId: baseRecord.transactionRecordId,
          matchGroupId: matchGroupId,
          metadata: JSON.stringify({
            matchedAmountPaise: amountPaise,
            matchedDateWindowDays: config.dateWindowDays,
            referenceMatchRequired: config.requireReferenceMatch,
            datasources: [baseRecord.dataSource, compareRecord.dataSource]
          })
        };

        auditTrailEntries.push(auditTrailEntry);

        // Create a second audit entry for the other matched record
        const auditTrailEntry2: AuditTrail = {
          auditTrailId: generateRecordIdentifier(),
          decisionTimestamp: new Date().toISOString(),
          method: "EXACT",
          reason: `Exact match: amountPaise=${amountPaise} INR, ` +
                  `dateWindow=${config.dateWindowDays} days, ` +
                  `${refMatchInfo}, ` +
                  `datasources=[${compareRecord.dataSource}, ${baseRecord.dataSource}]`,
          actor: "SYSTEM",
          actorId: "exact.ts",
          transactionRecordId: compareRecord.transactionRecordId,
          matchGroupId: matchGroupId,
          metadata: JSON.stringify({
            matchedAmountPaise: amountPaise,
            matchedDateWindowDays: config.dateWindowDays,
            referenceMatchRequired: config.requireReferenceMatch,
            datasources: [compareRecord.dataSource, baseRecord.dataSource]
          })
        };

        auditTrailEntries.push(auditTrailEntry2);

        // We'll compute hashes after collecting all audit entries

        // Mark both records as matched
        matchedTransactionIds.add(baseRecord.transactionRecordId);
        matchedTransactionIds.add(compareRecord.transactionRecordId);

        // Assign matchGroupId to both records
        baseRecord.matchGroupId = matchGroupId;
        compareRecord.matchGroupId = matchGroupId;

        // Record the actual pair formed
        matchedPairs.push({
          bankId: baseRecord.dataSource === "BANK_STATEMENT" ? baseRecord.transactionRecordId : compareRecord.transactionRecordId,
          gatewayId: baseRecord.dataSource === "GATEWAY_SETTLEMENT" ? baseRecord.transactionRecordId : compareRecord.transactionRecordId,
          matchGroupId
        });

        break; // Only match each record once
      }
    }
  });

  return { matchGroups, auditTrailEntries, matchedPairs, matchedTransactionIds };
}

// Load and combine all transactions from CSVs
function loadAllTransactions(dataDirectory: string): TransactionRecord[] {
  const bankTransactions = loadTransactionsFromCsv(
    join(dataDirectory, "bank_statement.csv"),
    "BANK_STATEMENT"
  );
  const gatewayTransactions = loadTransactionsFromCsv(
    join(dataDirectory, "gateway_settlement.csv"),
    "GATEWAY_SETTLEMENT"
  );
  const merchantTransactions = loadTransactionsFromCsv(
    join(dataDirectory, "merchant_ledger.csv"),
    "MERCHANT_LEDGER"
  );

  return [...bankTransactions, ...gatewayTransactions, ...merchantTransactions];
}

// Load ground truth from JSON file
function loadGroundTruth(filepath: string): GroundTruthEntry[] {
  const groundTruthContent = readFileSync(filepath, 'utf-8');
  const groundTruth = JSON.parse(groundTruthContent);
  return groundTruth.expectedMatches || [];
}

// Compare matches against ground truth
function compareWithGroundTruth(
  matchedPairs: MatchedPair[],
  groundTruthEntries: GroundTruthEntry[]
): { correctMatchGroups: number; totalMatchGroups: number; totalExactExpected: number; precision: number; recall: number } {
  // Build ground truth pairs from ONLY "EXACT" method entries
  const groundTruthPairs = new Set<string>();
  const exactGroundTruth = groundTruthEntries.filter(entry => entry.matchingAlgorithm === "EXACT");

  exactGroundTruth.forEach(entry => {
    // Normalize the pair key to avoid ordering issues
    const pairKey = [entry.bankStatementRecordId, entry.gatewaySettlementRecordId].sort().join("|");
    groundTruthPairs.add(pairKey);
  });

  // Count how many matched pairs are actually correct
  let correctMatchGroups = 0;
  matchedPairs.forEach(pair => {
    // Create normalized key from our matched pair
    const pairKey = [pair.bankId, pair.gatewayId].sort().join("|");
    if (groundTruthPairs.has(pairKey)) {
      correctMatchGroups++;
    }
  });

  const totalMatchGroups = matchedPairs.length;
  const totalExactExpected = groundTruthPairs.size;
  const precision = totalMatchGroups > 0 ? correctMatchGroups / totalMatchGroups : 0;
  const recall = totalExactExpected > 0 ? correctMatchGroups / totalExactExpected : 0;

  return { correctMatchGroups, totalMatchGroups, totalExactExpected, precision, recall };
}

// Main function to run exact matching
async function runExactMatch(dataDirectory: string, groundTruthPath: string): Promise<{
  matchGroups: MatchGroup[];
  auditTrailEntries: AuditTrail[];
  matchedCount: number;
  precision: number;
  recall: number;
  exactMatchCount: number;
  totalExpected: number;
  correctMatchGroups: number;
  totalExactExpected: number;
}> {
  console.log("Starting exact matching layer for ReconIQ...");

  // Load all transactions
  const allTransactions = loadAllTransactions(dataDirectory);
  console.log("Loaded " + allTransactions.length + " transaction records");

  // Count by source
  const bankCount = allTransactions.filter(t => t.dataSource === "BANK_STATEMENT").length;
  const gatewayCount = allTransactions.filter(t => t.dataSource === "GATEWAY_SETTLEMENT").length;
  const merchantCount = allTransactions.filter(t => t.dataSource === "MERCHANT_LEDGER").length;

  console.log("- Bank statement records: " + bankCount);
  console.log("- Gateway settlement records: " + gatewayCount);
  console.log("- Merchant ledger records: " + merchantCount);

  // Perform exact matching
  const { matchGroups, auditTrailEntries, matchedPairs, matchedTransactionIds } = performExactMatching(allTransactions);
  console.log("\nExact matching complete!");
  console.log("- Match groups created: " + matchGroups.length);
  console.log("- Audit trail entries created: " + auditTrailEntries.length);
  console.log("- Total matched transactions: " + matchedTransactionIds.size);
  console.log("- Matched pairs: " + matchedPairs.length);

  // Compare with ground truth
  const groundTruth = loadGroundTruth(groundTruthPath);
  const comparison = compareWithGroundTruth(matchedPairs, groundTruth);

  console.log("\nGround Truth Comparison (EXACT method only):");
  console.log("- Correct match groups: " + comparison.correctMatchGroups);
  console.log("- Total match groups created: " + comparison.totalMatchGroups);
  console.log("- Total EXACT entries in ground truth: " + comparison.totalExactExpected);
  console.log("- Precision: " + (comparison.precision * 100).toFixed(1) + "%");
  console.log("- Recall: " + (comparison.recall * 100).toFixed(1) + "%");

  // Compute tamper-evident hash chain for audit trail entries (in-memory)
  const GENESIS_HASH = "0".repeat(64);
  let previousHash = GENESIS_HASH;

  // Add hash chain to audit trail entries
  const auditTrailEntriesWithHash = auditTrailEntries.map(entry => {
    // Compute rowHash: SHA256(previousHash + JSON.stringify of the entry's content)
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
    const hashInput = previousHash + contentString;
    const rowHash = createHash('sha256').update(hashInput, 'utf8').digest('hex');

    // Return entry with hash fields
    return {
      ...entry,
      rowHash,
      previousRowHash: previousHash
    };
  });

  // Update previousHash for next iteration would be handled by map's accumulator
  // but we'll compute it manually since map doesn't pass state between iterations
  const finalAuditTrailEntries = [];
  let runningHash = GENESIS_HASH;

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

  console.log(`Generated hash chain for ${finalAuditTrailEntries.length} audit trail entries (in-memory only).`);

  return {
    matchGroups,
    auditTrailEntries: finalAuditTrailEntries,
    matchedCount: matchedTransactionIds.size,
    matchedPairs,
    precision: comparison.precision,
    recall: comparison.recall,
    correctMatchGroups: comparison.correctMatchGroups,
    totalExactExpected: comparison.totalExactExpected
  };
}

// Export functions for external use
export {
  runExactMatch,
  loadAllTransactions,
  loadGroundTruth,
  performExactMatching,
  parseCsvLine,
  normalizeReference,
  datesWithinWindow,
  DEFAULT_EXACT_MATCH_CONFIG
};

// Run if executed directly
if (import.meta.main) {
  const dataDirectory = process.env.DATA_DIRECTORY || "./scripts";
  const groundTruthPath = process.env.GROUND_TRUTH_PATH || "./ground_truth.json";

  runExactMatch(dataDirectory, groundTruthPath).then(results => {
    // Write results to files
    const outputPath = join(process.cwd(), 'src', 'matching', 'exact_match_results.json');
    writeFileSync(outputPath, JSON.stringify({
      matchGroups: results.matchGroups,
      auditTrailEntries: results.auditTrailEntries, // Include ALL audit trail entries with hash chain
      matchedPairs: results.matchedPairs,
      summary: {
        matchedCount: results.matchedCount,
        precision: results.precision,
        recall: results.recall,
        correctMatchGroups: results.correctMatchGroups,
        totalExactExpected: results.totalExactExpected
      }
    }, null, 2));
    console.log("\nResults written to: " + outputPath);
  }).catch(error => {
    console.error("Error running exact matching:", error);
    process.exit(1);
  });
}

// Also export for testing
export {
  TransactionRecord,
  MatchGroup,
  AuditTrail,
  GroundTruthEntry,
  ExactMatchConfig,
  MatchedPair,
  TransactionRecord as TransactionRecordType
};