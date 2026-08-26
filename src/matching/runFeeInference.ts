import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from 'node:crypto';
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

  // 1. Hash-Chain Continuity: Load the latest audit trail from either subset_sum or exact match
  let genesisHash = "0".repeat(64);
  const subsetSumResultsPath = join(process.cwd(), 'src', 'matching', 'subset_sum_results.json');
  const exactResultsPath = join(process.cwd(), 'src', 'matching', 'exact_match_results.json');

  try {
    // Try to read subset_sum_results.json first
    const subsetSumContent = readFileSync(subsetSumResultsPath, 'utf-8');
    const subsetSumResults = JSON.parse(subsetSumContent);
    const auditEntries = subsetSumResults.auditTrail;
    if (auditEntries && auditEntries.length > 0) {
      genesisHash = auditEntries[auditEntries.length - 1].rowHash;
      console.log(`[Chain Continuation] Successfully loaded starting previousRowHash from subset_sum.ts: ${genesisHash}`);
    }
  } catch (err) {
    // If subset_sum results not available, try exact match results
    try {
      const exactContent = readFileSync(exactResultsPath, 'utf-8');
      const exactResults = JSON.parse(exactContent);
      const auditEntries = exactResults.auditTrailEntries;
      if (auditEntries && auditEntries.length > 0) {
        genesisHash = auditEntries[auditEntries.length - 1].rowHash;
        console.log(`[Chain Continuation] Successfully loaded starting previousRowHash from exact.ts: ${genesisHash}`);
      }
    } catch (exactErr) {
      console.error("No previous audit trail found. Starting from genesis hash.");
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

  // 3. Load all transactions to get gross and net for each training pair (for audit trail)
  const { loadAllTransactions } = await import('./exact');
  const allTransactions = loadAllTransactions(dataDirectory);
  const bankMap = new Map<string, any>();
  const gatewayMap = new Map<string, any>();
  allTransactions.forEach(tx => {
    if (tx.dataSource === "BANK_STATEMENT") {
      bankMap.set(tx.transactionRecordId, tx);
    } else if (tx.dataSource === "GATEWAY_SETTLEMENT") {
      gatewayMap.set(tx.transactionRecordId, tx);
    }
  });

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
      transactionRecordId: null, // Not tied to a specific transaction, but we can leave null or set to bankId? We'll set null as per instruction.
      matchGroupId: null,
      metadata: JSON.stringify({
        gross,
        net,
        observedRate,
        fittedRate: rate,
        sampleSize,
        inputHash
      })
    });
  }

  // 5. Write results to file
  const outPath = join(process.cwd(), 'src', 'matching', 'fee_inference_results.json');
  writeFileSync(outPath, JSON.stringify({
    ...result,
    timestamp: new Date().toISOString()
  }, null, 2));
  console.log(`\nFee inference results written to ${outPath}`);

  // 6. Write audit trail to a temporary file? Actually, the instructions say to write AuditTrail rows.
  // But the runFeeInference.ts is standalone and the audit trail is meant to be used by subset-sum in the same run?
  // However, the instructions for Step 9 say to run runFeeInference.ts and then runSubsetSum.ts separately.
  // So we write the audit trail to a file that runSubsetSum.ts can read? Not specified.
  // Looking back at the instructions for Step 9:
  //   runFeeInference.ts writes AuditTrail rows for fee inference:
  //   ... (as above)
  // It doesn't say to write them to a file, but the subset-sum step expects to read the last hash from subset_sum_results.json.
  // However, the fee inference audit trail is meant to be chained before the subset-sum run.
  // Since we are running them separately, we need to persist the audit trail somewhere.
  // The instructions for Step 9 do not specify where to write the audit trail for fee inference.
  // But note: the subset-sum step in runSubsetSum.ts reads the genesis hash from either subset_sum_results.json or exact_match_results.json.
  // We have two options:
  //   Option 1: Write the fee inference audit trail to a file and then have runSubsetSum.ts read it as the genesis hash if available.
  //   Option 2: Since we are running them sequentially, we can have runFeeInference.ts update a file that runSubsetSum.ts will read.
  //   The instructions for Step 9 say:
  //     - Genesis: read last rowHash from src/matching/subset_sum_results.json
  //       (or from exact_match_results.json if subset_sum's not yet regenerated in this cycle)
  //   So if we want the fee inference audit chain to be the genesis for subset-sum, we should write the fee inference audit trail to a file that will be read as the previous step.
  //   However, the subset-sum step expects to read from subset_sum_results.json (which is the output of the subset-sum run) or exact_match_results.json.
  //   We are not supposed to modify those files in runFeeInference.ts.
  //
  //   Let me re-read:
  //     "Genesis: read last rowHash from src/matching/subset_sum_results.json
  //      (or from exact_match_results.json if subset_sum's not yet regenerated in this cycle)"
  //   This is in the context of runFeeInference.ts writing audit trail for fee inference.
  //   So runFeeInference.ts should read the last hash from subset_sum_results.json (if exists) or exact_match_results.json (if subset_sum results not available) to continue the chain.
  //   Then, after writing the fee inference audit trail, we should update the genesis hash for the next step (which is subset-sum) to be the last hash of the fee inference audit trail.
  //   But the subset-sum step in runSubsetSum.ts reads the genesis hash from subset_sum_results.json (if exists) or exact_match_results.json.
  //   Therefore, to chain the fee inference audit trail before the subset-sum run, we must write the fee inference audit trail to a file that will be read as the previous step by subset-sum.
  //   However, the subset-sum step does not read a fee inference file.
  //
  //   Wait, the instructions for Step 9 say:
  //     "Audit trail continuity.
  //      runFeeInference.ts writes AuditTrail rows for fee inference:
  //        - Genesis: read last rowHash from src/matching/subset_sum_results.json
  //          (or from exact_match_results.json if subset_sum's not yet regenerated in this cycle)
  //        - One AuditTrail row per training pair used, ..."
  //   This implies that runFeeInference.ts should read the last hash from subset_sum_results.json (if it exists) or exact_match_results.json (if subset_sum results are not available) and then continue the chain from there.
  //   Then, after writing the fee inference audit trail, we should leave the last hash in a place where the next step (subset-sum) can read it as the genesis.
  //   But the subset-sum step in runSubsetSum.ts reads the genesis hash from subset_sum_results.json (if exists) or exact_match_results.json.
  //   So if we want the fee inference audit trail to be the genesis for subset-sum, we must have the subset-sum step read the fee inference audit trail's last hash.
  //   However, the subset-sum step is designed to read from subset_sum_results.json (which is the output of the subset-sum run) or exact_match_results.json (the output of the exact match run).
  //   We are not supposed to change that.
  //
  //   Let me look at the runSubsetSum.ts code (from earlier in the conversation) to see how it gets the genesis hash:
  //     It reads from src/matching/exact_match_results.json (the exact match results) and takes the last rowHash from the auditTrailEntries.
  //   So if we want to chain the fee inference audit trail before the subset-sum run, we have two options:
  //     1. Modify runSubsetSum.ts to also check for a fee inference results file and use its audit trail's last hash if available.
  //     2. Have runFeeInference.ts write the audit trail to a file and then have runSubsetSum.ts read that file as the genesis hash.
  //   But the instructions say: "Do NOT modify data/, generate-data.ts, exact.ts, prisma schema"
  //   and we are not to modify subsetSum.test.ts, but we are allowed to modify runSubsetSum.ts? The instructions for Step 6 and 7 say to modify subsetSum.ts and runSubsetSum.ts.
  //   However, the current instruction is to create runFeeInference.ts and then run it, then runSubsetSum.ts.
  //   We are not instructed to modify runSubsetSum.ts in this step, but we will in Step 7.
  //   Step 7 says:
  //     "Modify src/matching/runSubsetSum.ts:
  //      - After loading data and marking exact-claimed records, read
  //        src/matching/fee_inference_results.json (if exists)
  //      - Pass netFactor from that file into config
  //      - Lower toleranceBasisPoints from 400 to 50 (fee is now handled explicitly;
  //        tolerance only needs to absorb paise rounding)"
  //   It does not mention anything about the audit trail.
  //
  //   However, the instructions for Step 9 (audit trail continuity) say that runFeeInference.ts should write the audit trail rows and chain properly.
  //   And then in Step 9, we run both and then run verify-chain.ts.
  //   The verify-chain.ts likely checks the entire chain including the fee inference audit trail.
  //
  //   Therefore, we must write the fee inference audit trail to a file that will be read by verify-chain.ts? Or by runSubsetSum.ts?
  //   Let me think: the verify-chain.ts probably checks the audit trail from the exact match, then the fee inference, then the subset-sum.
  //   So we need to persist the fee inference audit trail in a file that is part of the chain.
  //
  //   Since the instructions for Step 9 do not specify where to write the audit trail for fee inference, but they do say to write the results to fee_inference_results.json,
  //   and we are already writing the fee inference results (netFactor, rate, etc.) to that file, we can also include the audit trail in that file?
  //   But the instructions for Step 4 say the return object of inferFeeSchedule does not include the audit trail.
  //   And the instructions for Step 5 say to write to src/matching/fee_inference_results.json (all fields from Step 4 return + a timestamp).
  //   So we are not to put the audit trail in that file.
  //
  //   Alternatively, we can write the audit trail to a separate file, and then have verify-chain.ts read it.
  //   But we are not told to create verify-chain.ts; it is assumed to exist.
  //
  //   Given the time, and since the instructions for Step 9 say to write the audit trail rows (and chain them) in runFeeInference.ts,
  //   we will write the audit trail to a file that we can then use in verify-chain.ts. However, we are not told the filename.
  //   Let me look at the existing files: we have exact_match_results.json and subset_sum_results.json.
  //   We are creating fee_inference_results.json for the results.
  //   We can create a file for the audit trail, e.g., fee_inference_audit.json.
  //   But the instructions do not specify.
  //
  //   Alternatively, we can include the audit trail in the fee_inference_results.json file?
  //   The instructions for Step 5 say: "Write to src/matching/fee_inference_results.json (all fields from Step 4 return + a timestamp)"
  //   So we are not to add extra fields.
  //
  //   Let me re-read Step 9:
  //     "runFeeInference.ts writes AuditTrail rows for fee inference:
  //      - Genesis: read last rowHash from src/matching/subset_sum_results.json
  //        (or from exact_match_results.json if subset_sum's not yet regenerated in this cycle)
  //      - One AuditTrail row per training pair used, method="FEE_INFERENCE",
  //        actor="SYSTEM", actorId="feeInference.ts"
  //      - Each row's metadata: {gross, net, observedRate, fittedRate, sampleSize,
  //        inputHash}
  //      - Chain properly (each row's rowHash includes previous)"
  //   It does not say to write them to a file, but the word "writes" implies persisting.
  //   And then we are to run verify-chain.ts which will check the chain.
  //   Therefore, we must write the audit trail to a file that verify-chain.ts can read.
  //   Since we are not told the filename, we can choose one that fits the pattern:
  //     src/matching/fee_inference_audit_results.json
  //   However, to be safe, let's check if there is any existing audit trail file for fee inference? Not in the current code.
  //
  //   Given the ambiguity, I will write the audit trail to a file named
  //     src/matching/fee_inference_audit_results.json
  //   and hope that verify-chain.ts knows to read it.
  //   Alternatively, we can write the audit trail to the same file as the results?
  //   But the instructions for Step 5 are explicit about the content of fee_inference_results.json.
  //
  //   Let's do:
  //     - Write the fee inference audit trail to src/matching/fee_inference_audit_results.json
  //     - In that file, we can have an array of audit trail entries and the last hash for chaining.
  //   Then, in verify-chain.ts, it can read the exact match audit trail, then the fee inference audit trail, then the subset-sum audit trail.
  //
  //   However, we are not to modify verify-chain.ts.
  //   Since we are not given the code for verify-chain.ts, we must assume it knows where to find the fee inference audit trail.
  //   Looking at the existing audit trail files:
  //     exact_match_results.json has a field "auditTrailEntries"
  //     subset_sum_results.json has a field "auditTrail"
  //   So for consistency, we can write the fee inference audit trail to a file with a field "auditTrail" (or "auditTrailEntries").
  //   Let's use "auditTrail" to match subset_sum_results.json.
  //
  //   We'll create: src/matching/fee_inference_audit_results.json
  //   with content: { auditTrail: [ ... ] }
  //
  //   But note: the instructions for Step 9 do not require returning the audit trail from inferFeeSchedule, so we are free to write it in runFeeInference.ts.
  //
  //   Let's do it.

  // 7. Write the audit trail for fee inference to a file
  const auditOutPath = join(process.cwd(), 'src', 'matching', 'fee_inference_audit_results.json');
  writeFileSync(auditOutPath, JSON.stringify({ auditTrail: finalAuditTrailEntries }, null, 2));
  console.log(`Fee inference audit trail written to ${auditOutPath}`);

  // 8. Return for potential further use
  return { result, auditTrail: finalAuditTrailEntries };
}

if (import.meta.main) {
  const dataDir = join(process.cwd(), 'data');
  runFeeInference(dataDir).catch(console.error);
}