// runFeeInference.ts — Layer 1.5 Fee Inference runner
// Infers fee schedule (MDR/GST/TDS) and writes audit rows chained from subset-sum tail.

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "node:crypto";
import { inferFeeSchedule } from "./feeInference";

interface AuditTrail {
  auditTrailId: string;
  decisionTimestamp: string;
  method: "FEE_INFERENCE";
  reason: string;
  actor: "SYSTEM";
  actorId: string | null;
  transactionRecordId: string | null;
  matchGroupId: string | null;
  metadata: string | null;
  rowHash: string;
  previousRowHash: string;
}

async function runFeeInference(dataDirectory: string) {
  console.log("Starting Fee Inference layer...");

  // 1. Hash-Chain Continuity: Read the tail hash from subset_sum_results.json
  let genesisHash = "0".repeat(64);
  const subsetSumResultsPath = join(process.cwd(), "src", "matching", "subset_sum_results.json");
  const exactResultsPath     = join(process.cwd(), "src", "matching", "exact_match_results.json");

  try {
    const subsetSumContent = readFileSync(subsetSumResultsPath, "utf-8");
    const subsetSumResults = JSON.parse(subsetSumContent);
    const auditEntries = subsetSumResults.auditTrail;
    if (auditEntries && auditEntries.length > 0) {
      genesisHash = auditEntries[auditEntries.length - 1].rowHash;
      console.log(`[Chain Continuation] Successfully loaded starting previousRowHash from subset_sum.ts: ${genesisHash}`);
    }
  } catch {
    try {
      const exactContent = readFileSync(exactResultsPath, "utf-8");
      const exactResults = JSON.parse(exactContent);
      const auditEntries = exactResults.auditTrailEntries;
      if (auditEntries && auditEntries.length > 0) {
        genesisHash = auditEntries[auditEntries.length - 1].rowHash;
        console.log(`[Chain Continuation] Successfully loaded starting previousRowHash from exact.ts: ${genesisHash}`);
      }
    } catch {
      console.warn("No previous audit trail found. Starting from genesis hash.");
    }
  }

  // 2. Infer fee schedule
  const result = await inferFeeSchedule(dataDirectory);
  const { netFactor, rate, sampleSize, stdDev, trainingPairIds, inputHash } = result;

  console.log(`[FEE_INFERENCE] Results:`);
  console.log(`  rate (mean observed fee rate): ${rate}`);
  console.log(`  netFactor (1 - rate): ${netFactor}`);
  console.log(`  sampleSize: ${sampleSize}`);
  console.log(`  stdDev: ${stdDev}`);
  console.log(`  inputHash (of sorted training pair IDs): ${inputHash}`);

  // 3. Load all transactions to get gross and net for each training pair
  const { loadAllTransactions } = await import("./exact");
  const allTransactions = loadAllTransactions(dataDirectory);
  const bankMap = new Map<string, any>();
  const gatewayMap = new Map<string, any>();
  allTransactions.forEach((tx) => {
    if (tx.dataSource === "BANK_STATEMENT") {
      bankMap.set(tx.transactionRecordId, tx);
    } else if (tx.dataSource === "GATEWAY_SETTLEMENT") {
      gatewayMap.set(tx.transactionRecordId, tx);
    }
  });

  // 4. Build AuditTrail entries and compute hash chain
  let runningHash = genesisHash;
  const finalAuditTrailEntries: AuditTrail[] = [];

  const pushAuditEntry = (entry: Omit<AuditTrail, "rowHash" | "previousRowHash">) => {
    const content = {
      method: entry.method,
      reason: entry.reason,
      actor: entry.actor,
      actorId: entry.actorId,
      transactionRecordId: entry.transactionRecordId,
      matchGroupId: entry.matchGroupId,
      metadata: entry.metadata,
      decisionTimestamp: entry.decisionTimestamp,
    };
    const contentString = JSON.stringify(content);
    const hashInput = runningHash + contentString;
    const rowHash = createHash("sha256").update(hashInput, "utf8").digest("hex");

    finalAuditTrailEntries.push({
      ...entry,
      rowHash,
      previousRowHash: runningHash,
    });
    runningHash = rowHash;
  };

  // Create one audit entry per training pair
  for (const pairId of trainingPairIds) {
    const [bankId, gatewayId] = pairId.split(":");
    const bankTx = bankMap.get(bankId);
    const gatewayTx = gatewayMap.get(gatewayId);
    if (!bankTx || !gatewayTx) {
      console.warn(`Missing transaction for pair ${pairId}, skipping audit entry`);
      continue;
    }
    const gross = gatewayTx.amountPaise;
    const net = bankTx.amountPaise;
    const observedRate = (gross - net) / gross;

    const nowISO = new Date().toISOString();
    pushAuditEntry({
      auditTrailId: `at_${Math.random().toString(36).substring(2, 14)}`,
      decisionTimestamp: nowISO,
      method: "FEE_INFERENCE",
      reason: `Fee inference pair: bank=${bankId}, gateway=${gatewayId}`,
      actor: "SYSTEM",
      actorId: "feeInference.ts",
      transactionRecordId: null,
      matchGroupId: null,
      metadata: JSON.stringify({
        gross,
        net,
        observedRate,
        fittedRate: rate,
        sampleSize,
        inputHash,
      }),
    });
  }

  // 5. Write results to file with standard audit envelope
  const outPath = join(process.cwd(), "src", "matching", "fee_inference_results.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...result,
        auditTrail: finalAuditTrailEntries,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`\nFee inference results written to ${outPath}`);

  // Also write fee_inference_audit_results.json for secondary tooling compatibility
  const auditOutPath = join(process.cwd(), "src", "matching", "fee_inference_audit_results.json");
  writeFileSync(auditOutPath, JSON.stringify({ auditTrail: finalAuditTrailEntries }, null, 2));
  console.log(`Fee inference audit trail written to ${auditOutPath}`);

  return { result, auditTrail: finalAuditTrailEntries };
}

if (import.meta.main) {
  const dataDir = join(process.cwd(), "data");
  runFeeInference(dataDir).catch(console.error);
}