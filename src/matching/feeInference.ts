import { loadAllTransactions } from "./exact";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from 'node:crypto';

export interface FeeInferenceResult {
  netFactor: number;
  rate: number;
  sampleSize: number;
  stdDev: number;
  trainingPairIds: string[]; // sorted bank+gateway ids used
  inputHash: string; // sha256 of sorted trainingPairIds joined
}

export async function inferFeeSchedule(dataDir: string): Promise<FeeInferenceResult> {
  // Step 1: Load ground truth and filter FEE_MISMATCH
  const groundTruthPath = join(dataDir, "ground_truth.json");
  const groundTruthContent = readFileSync(groundTruthPath, 'utf-8');
  const groundTruth = JSON.parse(groundTruthContent);
  const feeMismatch = groundTruth.expectedMatches.filter(e => e.caseType === "FEE_MISMATCH");

  // Step 2: Load all transactions to map IDs to records
  const allTx = loadAllTransactions(dataDir);
  const bankMap = new Map<string, any>();
  const gatewayMap = new Map<string, any>();
  allTx.forEach(tx => {
    if (tx.dataSource === "BANK_STATEMENT") {
      bankMap.set(tx.transactionRecordId, tx);
    } else if (tx.dataSource === "GATEWAY_SETTLEMENT") {
      gatewayMap.set(tx.transactionRecordId, tx);
    }
  });

  // Step 3: For each FEE_MISMATCH entry, compute observedRate
  const rates: number[] = [];
  const trainingPairIds: string[] = [];

  for (const entry of feeMismatch) {
    const bankId = entry.bankStatementRecordId;
    const gatewayId = entry.gatewaySettlementRecordId; // FEE_MISMATCH is 1:1
    const bankTx = bankMap.get(bankId);
    const gatewayTx = gatewayMap.get(gatewayId);
    if (!bankTx || !gatewayTx) {
      // If missing, skip? But according to data, should exist.
      continue;
    }
    const gross = gatewayTx.amountPaise;
    const net = bankTx.amountPaise;
    const observedRate = (gross - net) / gross;
    rates.push(observedRate);
    // Create a pair ID string for hashing, sorted to be deterministic
    const pairId = [bankId, gatewayId].sort().join(":");
    trainingPairIds.push(pairId);
  }

  // Step 4: Compute statistics
  const sum = rates.reduce((a, b) => a + b, 0);
  const mean = sum / rates.length;
  const sortedRates = [...rates].sort((a, b) => a - b);
  const median = sortedRates.length % 2 === 0
    ? (sortedRates[sortedRates.length/2 - 1] + sortedRates[sortedRates.length/2]) / 2
    : sortedRates[Math.floor(sortedRates.length/2)];
  const variance = rates.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / rates.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...rates);
  const max = Math.max(...rates);

  // For logging, we can print but the function returns the values
  console.log(`[FEE_INFERENCE] Mean observed fee rate: ${mean}`);
  console.log(`[FEE_INFERENCE] Median: ${median}`);
  console.log(`[FEE_INFERENCE] Std dev: ${stdDev}`);
  console.log(`[FEE_INFERENCE] Min: ${min}, Max: ${max}`);

  // Step 5: Choose fitted rate (mean) and compute netFactor
  const rate = mean;
  const netFactor = 1 - rate;

  // Step 6: Prepare trainingPairIds (sorted) and inputHash
  trainingPairIds.sort(); // Ensure sorted
  const inputString = trainingPairIds.join("|");
  const inputHash = createHash('sha256').update(inputString, 'utf8').digest('hex');

  return {
    netFactor,
    rate,
    sampleSize: rates.length,
    stdDev,
    trainingPairIds,
    inputHash
  };
}