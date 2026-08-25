// Subset-Sum execution harness with hash-chain continuity
// Reads previous exact match audit trail for hash chain continuation

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { performSubsetSumMatching, SubsetSumConfig, TransactionRecord } from "./subsetSum";
import { loadAllTransactions } from "./exact"; // reusing exact's loader

async function runSubsetSum(dataDirectory: string) {
  console.log("Starting Subset-Sum matching layer...");

  // 1. Hash-Chain Continuity: Load exact matcher audit results
  const exactResultsPath = join(process.cwd(), 'src', 'matching', 'exact_match_results.json');
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

  const config: SubsetSumConfig = {
    // Set to 400 basis points (4%) to accommodate realistic MDR (2.0%) + GST (0.36%) + TDS (1.0%) = ~3.36% net deduction
    toleranceBasisPoints: 400,
    maxSubsetSize: 5,
    dateWindowDays: 3,
    maxCandidatesToEnumerate: 5,
    minimumScoreGap: 0.1
  };

  // 3. Perform Subset-Sum
  const candidates = performSubsetSumMatching(bankRecords, gatewayRecords, merchantRecords, config);

  console.log(`Subset-Sum complete: found ${candidates.length} candidates.`);

  // 4. Record decision and compute AuditTrail rowHash (stubbed until Meer writes the logic)
  console.log("AuditTrail hash-chaining continuation seeded with genesis:", genesisHash);

  return { candidates };
}

if (import.meta.main) {
  const dataDir = join(process.cwd(), 'data');
  runSubsetSum(dataDir).catch(console.error);
}
