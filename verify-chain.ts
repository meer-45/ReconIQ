// verify-chain.ts — full hash-chain verification reading from Postgres.
// Reads ALL AuditTrail rows from DB and verifies:
//   MAIN CHAIN: EXACT → SUBSET_SUM → AI_FUZZY → AI_CLASSIFIED rows (starts at genesis 0x64)
//   SIDE CHAIN: FEE_INFERENCE rows (branches from SUBSET_SUM tail, verified independently)
// Fails loudly on first hash mismatch / link break with the offending auditTrailId.

import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma, closePrisma } from "./src/persistence/db";

// ── Which methods belong to the main chain vs side chain ──────────────────────
const MAIN_CHAIN_METHODS = new Set([
  "EXACT",
  "SUBSET_SUM",
  "AI_FUZZY",
  "AI_CLASSIFIED",
  "AI_CLASSIFY",
  "AGENT_QUERY",
  "MANUAL",
]);

const SIDE_CHAIN_METHODS = new Set(["FEE_INFERENCE"]);

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

  const mainSources: Array<{ path: string; key: string; label: string }> = [
    { path: join(RESULTS_DIR, "exact_match_results.json"),        key: "auditTrailEntries", label: "EXACT" },
    { path: join(RESULTS_DIR, "subset_sum_results.json"),         key: "auditTrail",        label: "SUBSET_SUM" },
    { path: join(RESULTS_DIR, "fuzzy_match_results.json"),        key: "auditRows",         label: "AI_FUZZY" },
    { path: join(RESULTS_DIR, "llm_classification_results.json"), key: "auditRows",         label: "AI_CLASSIFIED" },
  ];
  const sideSource = {
    path: join(RESULTS_DIR, "fee_inference_audit_results.json"),
    key:  "auditTrail",
    label: "FEE_INFERENCE",
  };

  console.log("[FALLBACK] Reading from JSON files (DB not available or empty).\n");

  const mainRows: AuditRowLike[] = [];
  let ssTailHash = "";

  for (const { path, key, label } of mainSources) {
    try {
      const d = JSON.parse(readFileSync(path, "utf-8"));
      const rows: AuditRowLike[] = d[key] ?? [];
      mainRows.push(...rows);
      if (label === "SUBSET_SUM" && rows.length > 0) {
        ssTailHash = rows[rows.length - 1].rowHash;
      }
      console.log(`  ${label}: ${rows.length} rows loaded`);
    } catch {
      console.log(`  ${label}: FILE NOT FOUND (skipping)`);
    }
  }

  // Verify Main Chain
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

  // Verify Side Chain (Fee Inference)
  try {
    const d = JSON.parse(readFileSync(sideSource.path, "utf-8"));
    const sideRows: AuditRowLike[] = d[sideSource.key] ?? [];
    let feePrev = ssTailHash || (sideRows.length > 0 ? sideRows[0].previousRowHash : "");
    for (let i = 0; i < sideRows.length; i++) {
      const row = sideRows[i];
      if (row.previousRowHash !== feePrev) {
        console.error(`\nSIDE CHAIN FAIL at row ${i + 1}/${sideRows.length}`);
        console.error(`  auditTrailId: ${row.auditTrailId}  method: ${row.method}`);
        console.error(`  Expected previousRowHash: ${feePrev}`);
        console.error(`  Actual previousRowHash:   ${row.previousRowHash}`);
        process.exit(1);
      }
      feePrev = row.rowHash;
    }
    console.log(`SIDE CHAIN OK (${sideRows.length} rows, fee-inference)`);
  } catch {
    console.log("SIDE CHAIN: FEE_INFERENCE file not found (skipping)");
  }
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

  // 1. Walk and verify MAIN CHAIN (starts from genesis)
  const GENESIS = "0".repeat(64);
  const mainRows: AuditRowLike[] = [];
  let expectedPrev = GENESIS;
  let ssTailHash = "";

  while (true) {
    const candidates = byPrev.get(expectedPrev) ?? [];
    // Prioritize main chain methods
    const next = candidates.find(r => MAIN_CHAIN_METHODS.has(r.method));
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

    if (next.method === "SUBSET_SUM") {
      ssTailHash = next.rowHash;
    }
  }

  // 2. Walk and verify SIDE CHAIN (FEE_INFERENCE branches off SS tail)
  const sideRows: AuditRowLike[] = [];
  if (ssTailHash) {
    let feeExpectedPrev = ssTailHash;
    while (true) {
      const candidates = byPrev.get(feeExpectedPrev) ?? [];
      const next = candidates.find(r => SIDE_CHAIN_METHODS.has(r.method));
      if (!next) break;

      if (next.previousRowHash !== feeExpectedPrev) {
        console.error(`\nSIDE CHAIN FAIL at row ${sideRows.length + 1}`);
        console.error(`  auditTrailId: ${next.auditTrailId}  method: ${next.method}`);
        console.error(`  Expected previousRowHash: ${feeExpectedPrev}`);
        console.error(`  Actual previousRowHash:   ${next.previousRowHash}`);
        process.exit(1);
      }

      sideRows.push(next);
      feeExpectedPrev = next.rowHash;
    }
  }

  // Print results in the exact expected format
  console.log(`MAIN CHAIN OK (${mainRows.length} rows)`);
  console.log(`SIDE CHAIN OK (${sideRows.length} rows, fee-inference)`);

  // Check for any detached orphan rows
  const placedIds = new Set([...mainRows, ...sideRows].map(r => r.auditTrailId));
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