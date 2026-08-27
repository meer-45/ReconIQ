// getAuditTrailForMatch.ts — returns audit rows for a given matchGroupId.
// Scans ALL result files' audit trails; preserves hash-chain order.

import { readFileSync } from "fs";
import { join } from "path";

const RESULTS_DIR = join(process.cwd(), "src", "matching");

export interface AuditTrailEntry {
  auditTrailId:        string;
  decisionTimestamp:   string;
  method:              string;
  reason:              string;
  actor:               string;
  actorId:             string;
  transactionRecordId: string | null;
  matchGroupId:        string | null;
  metadata:            string;
  rowHash:             string;
  previousRowHash:     string;
}

// All result files with their audit trail key, in chain order
const AUDIT_SOURCES: Array<{ path: string; key: string }> = [
  { path: "exact_match_results.json",             key: "auditTrailEntries" },
  { path: "subset_sum_results.json",              key: "auditTrail" },
  { path: "fee_inference_audit_results.json",     key: "auditTrail" },
  { path: "fuzzy_match_results.json",             key: "auditRows" },
  { path: "llm_classification_results.json",      key: "auditRows" },
];

// Module-level flat cache of all rows
let _allRows: AuditTrailEntry[] | null = null;

function loadAllAuditRows(): AuditTrailEntry[] {
  if (_allRows) return _allRows;
  const rows: AuditTrailEntry[] = [];
  for (const { path, key } of AUDIT_SOURCES) {
    try {
      const d     = JSON.parse(readFileSync(join(RESULTS_DIR, path), "utf-8"));
      const batch = d[key] ?? [];
      rows.push(...batch);
    } catch { /* file not found — skip */ }
  }
  _allRows = rows;
  return rows;
}

export function getAuditTrailForMatch(matchGroupId: string): AuditTrailEntry[] {
  return loadAllAuditRows().filter(
    r => r.matchGroupId === matchGroupId
  );
}

/** Look up audit rows by transactionRecordId (when matchGroupId is unknown). */
export function getAuditTrailForTransaction(transactionRecordId: string): AuditTrailEntry[] {
  return loadAllAuditRows().filter(
    r => r.transactionRecordId === transactionRecordId
      || r.matchGroupId === transactionRecordId  // some rows use bankId as matchGroupId
  );
}

/** Returns last rowHash across all files — used to continue the hash chain. */
export function getLatestChainHash(): string {
  const rows = loadAllAuditRows();
  return rows.length > 0 ? rows[rows.length - 1].rowHash : "0".repeat(64);
}
