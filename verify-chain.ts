// Verification script for AuditTrail hash chaining
// Reads exact_match_results.json and validates the hash chain

import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from 'node:crypto';

// Result structure from exact_match_results.json
interface ExactMatchResults {
  matchGroups: any[];
  auditTrailEntries: AuditTrailEntry[];
  matchedPairs: any[];
  summary: {
    matchedCount: number;
    precision: number;
    recall: number;
    correctMatchGroups: number;
    totalExactExpected: number;
  };
}

interface AuditTrailEntry {
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

function verifyAuditChain() {
  const resultsPath = join(process.cwd(), 'src', 'matching', 'exact_match_results.json');

  try {
    const resultsContent = readFileSync(resultsPath, 'utf-8');
    const results: ExactMatchResults = JSON.parse(resultsContent);
    const auditEntries: AuditTrailEntry[] = results.auditTrailEntries;

    console.log(`Verifying ${auditEntries.length} audit trail entries...`);

    const GENESIS_HASH = "0".repeat(64);
    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < auditEntries.length; i++) {
      const entry = auditEntries[i];

      // Check link integrity
      if (entry.previousRowHash !== expectedPreviousHash) {
        console.error(`FAIL: Chain broken at row ${i + 1}`);
        console.error(`Expected previousHash: ${expectedPreviousHash}`);
        console.error(`Actual previousHash:   ${entry.previousRowHash}`);
        process.exit(1);
      }

      // Recompute hash
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

      const hashInput = entry.previousRowHash + JSON.stringify(content);
      const recomputedHash = createHash('sha256').update(hashInput, 'utf8').digest('hex');

      if (recomputedHash !== entry.rowHash) {
        console.error(`FAIL: Hash mismatch at row ${i + 1}`);
        console.error(`Expected hash: ${recomputedHash}`);
        console.error(`Actual hash:   ${entry.rowHash}`);
        process.exit(1);
      }

      expectedPreviousHash = entry.rowHash;
    }

    console.log("PASS: All audit entries verified successfully.");
  } catch (error) {
    console.error("ERROR: Failed to verify audit chain:", error.message);
    process.exit(1);
  }
}

verifyAuditChain();