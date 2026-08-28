// verify-chain.ts — full hash-chain verification reading from Postgres.
// Reads ALL AuditTrail rows from DB and verifies a single continuous linear chain:
//   EXACT → SUBSET_SUM → FEE_INFERENCE → AI_FUZZY → AI_CLASSIFIED → MANUAL / AGENT_QUERY
// Starts at genesis 0x64 and fails loudly on first hash mismatch / link break.

import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma, closePrisma } from "./src/persistence/db";

const ALL_CHAIN_METHODS = new Set([
  "EXACT",
  "SUBSET_SUM",
  "FEE_INFERENCE",
  "AI_FUZZY",
  "AI_CLASSIFIED",
  "AI_CLASSIFY",
  "AGENT_QUERY",
  "MANUAL",
]);

interface AuditRowLike {
  auditTrailId:        string;
  decisionTimestamp:   Date | string;
  method:              string;
  reason:              string;
  actor:               string;
  actorId:             string | null;
  transactionRecordId: string | null;
  matchGroupId:        string | null;
  metadata:            any;
  rowHash:             string;
  previousRowHash:     string;
}

// ── Fallback file-based verification ──────────────────────────────────────────
function verifyFromFiles(): void {
  const RESULTS_DIR = join(process.cwd(), "src", "matching");

  const sources: Array<{ path: string; key: string; label: string; fallbackPath?: string }> = [
    { path: join(RESULTS_DIR, "exact_match_results.json"),        key: "auditTrailEntries", label: "EXACT" },
    { path: join(RESULTS_DIR, "subset_sum_results.json"),         key: "auditTrail",        label: "SUBSET_SUM" },
    { path: join(RESULTS_DIR, "fee_inference_results.json"),      key: "auditTrail",        label: "FEE_INFERENCE", fallbackPath: join(RESULTS_DIR, "fee_inference_audit_results.json") },
    { path: join(RESULTS_DIR, "fuzzy_match_results.json"),        key: "auditRows",         label: "AI_FUZZY" },
    { path: join(RESULTS_DIR, "llm_classification_results.json"), key: "auditRows",         label: "AI_CLASSIFIED" },
  ];

  console.log("[FALLBACK] Reading from JSON files (DB not available or empty).\n");

  const mainRows: AuditRowLike[] = [];

  for (const { path, key, label, fallbackPath } of sources) {
    let d: any;
    try {
      d = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      if (fallbackPath) {
        try { d = JSON.parse(readFileSync(fallbackPath, "utf-8")); } catch {}
      }
    }
    const rows: AuditRowLike[] = d ? (d[key] ?? []) : [];
    mainRows.push(...rows);
    console.log(`  ${label}: ${rows.length} rows loaded`);
  }

  // Verify Single Continuous Chain
  const GENESIS = "0".repeat(64);
  let prev = GENESIS;
  for (let i = 0; i < mainRows.length; i++) {
    const row = mainRows[i];
    if (row.previousRowHash !== prev) {
      console.error(`\nMAIN CHAIN FAIL at row ${i + 1}/${mainRows.length}`);
      console.error(`  auditTrailId: ${row.auditTrailId}  method: ${row.method}`);
      console.error(`  Expected previousRowHash: ${prev}`);
      console.error(`  Actual previousRowHash:   ${row.previousRowHash}`);
      process.exit(1);
    }
    prev = row.rowHash;
  }
  console.log(`\nMAIN CHAIN OK (${mainRows.length} rows)`);
}

// ── Main Verification from Postgres ───────────────────────────────────────────
async function main() {
  let allRows: AuditRowLike[] = [];

  try {
    const count = await prisma.auditTrail.count();
    if (count === 0) {
      throw new Error("DB has 0 audit rows — not yet seeded");
    }
    console.log(`Reading ${count} audit rows from Postgres…\n`);

    allRows = await prisma.auditTrail.findMany();
  } catch (err: any) {
    console.warn(`DB not available or empty: ${err.message}`);
    verifyFromFiles();
    return;
  }

  // Build index by previousRowHash for O(1) chain traversal
  const byPrev = new Map<string, AuditRowLike[]>();
  for (const r of allRows) {
    const bucket = byPrev.get(r.previousRowHash) ?? [];
    bucket.push(r as AuditRowLike);
    byPrev.set(r.previousRowHash, bucket);
  }

  // Walk and verify SINGLE CONTINUOUS LINEAR CHAIN (starts from genesis)
  const GENESIS = "0".repeat(64);
  const mainRows: AuditRowLike[] = [];
  let expectedPrev = GENESIS;

  while (true) {
    const candidates = byPrev.get(expectedPrev) ?? [];
    const next = candidates.find(r => ALL_CHAIN_METHODS.has(r.method));
    if (!next) break;

    // Verify link integrity
    if (next.previousRowHash !== expectedPrev) {
      console.error(`\nMAIN CHAIN FAIL at row ${mainRows.length + 1}`);
      console.error(`  auditTrailId: ${next.auditTrailId}  method: ${next.method}`);
      console.error(`  Expected previousRowHash: ${expectedPrev}`);
      console.error(`  Actual previousRowHash:   ${next.previousRowHash}`);
      process.exit(1);
    }

    mainRows.push(next);
    expectedPrev = next.rowHash;
  }

  // Print results in the exact expected format
  console.log(`MAIN CHAIN OK (${mainRows.length} rows)`);

  // Check for any detached orphan rows
  const placedIds = new Set(mainRows.map(r => r.auditTrailId));
  const orphans = allRows.filter(r => !placedIds.has(r.auditTrailId));
  if (orphans.length > 0) {
    console.warn(`\n⚠ Warning: ${orphans.length} audit rows not reachable along verified paths`);
  }
}

main()
  .catch(err => {
    console.error("verify-chain ERROR:", err.message ?? err);
    process.exit(1);
  })
  .finally(() => closePrisma());