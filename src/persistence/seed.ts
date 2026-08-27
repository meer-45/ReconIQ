// seed.ts — idempotent seed: truncate all tables, then load from result files.
// Run order preserves hash-chain integrity:
//   1. TransactionRecords  (CSV → DB)
//   2. MatchGroups         (exact → SS → fee → fuzzy)
//   3. UnresolvedExceptions (SS + fuzzy exceptions, enriched by LLM hypotheses)
//   4. AuditTrail rows     (verbatim rowHash/previousRowHash, never recomputed)
//
// Skips MatchGroups whose member IDs are not in DB.
// Logs skipped count per layer.

import "dotenv/config";
import { readFileSync } from "fs";
import { join }         from "path";
import { prisma, closePrisma } from "./db";

const DATA_DIR     = join(process.cwd(), "data");
const RESULTS_DIR  = join(process.cwd(), "src", "matching");

// ── CSV parsing (RFC 4180 — handles quoted fields with embedded commas) ────────
interface RawTx {
  transactionRecordId: string;
  dataSource:          string;
  externalReference:   string;
  amountPaise:         number;
  currencyCode:        string;
  transactionDate:     string;
  ingestedAt:          string;
  rawDescription:      string;
  rawPayload:          string;
}

/** RFC 4180-compliant CSV row splitter. Handles quoted fields with embedded commas and quotes. */
function splitCsvRow(line: string): string[] {
  const fields: string[] = [];
  let cur   = "";
  let inQ   = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"')                    { inQ = false; }
      else                                    { cur += ch; }
    } else {
      if (ch === '"')      { inQ = true; }
      else if (ch === ',') { fields.push(cur); cur = ""; }
      else                 { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(path: string): RawTx[] {
  const lines  = readFileSync(path, "utf-8").split("\n").filter(l => l.trim());
  const header = splitCsvRow(lines[0]);
  const idx    = (f: string) => header.indexOf(f);
  const rows: RawTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const v  = splitCsvRow(lines[i]);
    if (v.length <= 1) continue;
    const g  = (f: string) => v[idx(f)] ?? "";
    const id = g("transactionRecordId");
    if (!id) continue;
    rows.push({
      transactionRecordId: id,
      dataSource:          g("dataSource"),
      externalReference:   g("externalReference"),
      amountPaise:         parseInt(g("amountPaise"), 10) || 0,
      currencyCode:        g("currencyCode") || "INR",
      transactionDate:     g("transactionDate"),
      ingestedAt:          g("ingestedAt"),
      rawDescription:      g("rawDescription"),
      rawPayload:          g("rawPayload"),
    });
  }
  return rows;
}

// ── Result file loader helper ────────────────────────────────────────────────
function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ── Step 1: TransactionRecords ────────────────────────────────────────────────
async function seedTransactions(): Promise<Set<string>> {
  const csvFiles: Array<{ path: string; dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER" }> = [
    { path: join(DATA_DIR, "bank_statement.csv"),    dataSource: "BANK_STATEMENT" },
    { path: join(DATA_DIR, "gateway_settlement.csv"), dataSource: "GATEWAY_SETTLEMENT" },
    { path: join(DATA_DIR, "merchant_ledger.csv"),    dataSource: "MERCHANT_LEDGER" },
  ];

  const allIds = new Set<string>();
  let total = 0;

  for (const { path, dataSource } of csvFiles) {
    const rows = parseCsv(path);
    const data = rows.map(r => ({
      transactionRecordId: r.transactionRecordId,
      dataSource:          dataSource,
      externalReference:   r.externalReference,
      amountPaise:         r.amountPaise,
      currencyCode:        r.currencyCode,
      transactionDate:     new Date(r.transactionDate),
      ingestedAt:          r.ingestedAt ? new Date(r.ingestedAt) : new Date(),
      rawDescription:      r.rawDescription,
      rawPayload:          r.rawPayload ? JSON.parse(r.rawPayload) : {},
    }));

    // Batch upsert
    const BATCH = 200;
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH);
      await prisma.transactionRecord.createMany({ data: chunk, skipDuplicates: true });
    }
    rows.forEach(r => allIds.add(r.transactionRecordId));
    total += rows.length;
    console.log(`  ${dataSource}: ${rows.length} rows`);
  }

  console.log(`  → ${total} transaction records total`);
  return allIds;
}

// ── Step 2: MatchGroups ───────────────────────────────────────────────────────
// Strategy: collect ALL MatchGroup rows across layers, then:
//   1. createMany (batch, skipDuplicates) for MatchGroup rows
//   2. Single raw SQL UPDATE to link TransactionRecord.matchGroupId
// This cuts from O(N × 2 RTTs) down to O(layers × 2 RTTs) = ~8 total RTTs.
async function seedMatchGroups(knownIds: Set<string>): Promise<{ count: number; skipped: number; mgIds: Set<string> }> {
  let skipped = 0;
  const mgIds = new Set<string>();

  // Collect all groups and their member linkages
  interface MgRow {
    matchGroupId:    string;
    method:          "EXACT" | "SUBSET_SUM" | "FEE_INFERENCE" | "AI_FUZZY";
    confidenceScore: number;
    status:          "MATCHED" | "PENDING_REVIEW";
    createdAt:       Date;
    resolvedAt:      Date | null;
  }
  const allMgRows:    MgRow[]                       = [];
  const allLinkages:  Map<string, string>           = new Map(); // txId → mgId

  // EXACT
  const exact = loadJson(join(RESULTS_DIR, "exact_match_results.json"));
  for (const p of (exact.matchedPairs ?? [])) {
    if (!knownIds.has(p.bankId) || !knownIds.has(p.gatewayId)) { skipped++; continue; }
    allMgRows.push({
      matchGroupId: p.matchGroupId, method: "EXACT", confidenceScore: 1.0,
      status: "MATCHED", createdAt: new Date(p.createdAt ?? Date.now()),
      resolvedAt: new Date(p.createdAt ?? Date.now()),
    });
    allLinkages.set(p.bankId,    p.matchGroupId);
    allLinkages.set(p.gatewayId, p.matchGroupId);
    mgIds.add(p.matchGroupId);
  }
  console.log(`  EXACT:         ${mgIds.size} match groups collected`);

  // SUBSET_SUM
  const ss = loadJson(join(RESULTS_DIR, "subset_sum_results.json"));
  let ssCount = 0; let ssSkip = 0;
  for (const m of (ss.matches ?? [])) {
    const memberIds: string[] = [
      m.bankRecord?.transactionRecordId,
      ...(m.gatewayRecords ?? []).map((r: any) => r.transactionRecordId),
    ].filter(Boolean);
    if (memberIds.some(id => !knownIds.has(id))) { ssSkip++; continue; }
    allMgRows.push({
      matchGroupId: m.matchGroupId, method: "SUBSET_SUM", confidenceScore: 1.0,
      status: "MATCHED", createdAt: new Date(m.createdAt ?? Date.now()),
      resolvedAt: new Date(m.createdAt ?? Date.now()),
    });
    for (const id of memberIds) allLinkages.set(id, m.matchGroupId);
    mgIds.add(m.matchGroupId);
    ssCount++;
  }
  console.log(`  SUBSET_SUM:    ${ssCount} match groups collected (skipped ${ssSkip})`);
  skipped += ssSkip;

  // FEE_INFERENCE — each training pair becomes a MatchGroup
  const fee = loadJson(join(RESULTS_DIR, "fee_inference_results.json"));
  let feeCount = 0; let feeSkip = 0;
  for (const pairId of (fee.trainingPairIds ?? [])) {
    const [bankId, gatewayId] = pairId.split(":");
    if (!bankId || !gatewayId || !knownIds.has(bankId) || !knownIds.has(gatewayId)) { feeSkip++; continue; }
    const mgId = `fee_mg_${bankId}`;
    allMgRows.push({
      matchGroupId: mgId, method: "FEE_INFERENCE", confidenceScore: 0.97,
      status: "MATCHED", createdAt: new Date(), resolvedAt: new Date(),
    });
    allLinkages.set(bankId,    mgId);
    allLinkages.set(gatewayId, mgId);
    mgIds.add(mgId);
    feeCount++;
  }
  console.log(`  FEE_INFERENCE: ${feeCount} match groups collected (skipped ${feeSkip})`);
  skipped += feeSkip;

  // AI_FUZZY — PENDING_REVIEW proposals
  const fuzzy = loadJson(join(RESULTS_DIR, "fuzzy_match_results.json"));
  let fzCount = 0; let fzSkip = 0;
  for (const m of (fuzzy.newMatches ?? [])) {
    const memberIds: string[] = [m.bankRecordId, ...(m.gatewayRecordIds ?? [])].filter(Boolean);
    if (memberIds.some(id => !knownIds.has(id))) { fzSkip++; continue; }
    const mgId = m.matchGroupId ?? `fz_mg_${m.bankRecordId}`;
    allMgRows.push({
      matchGroupId: mgId, method: "AI_FUZZY", confidenceScore: m.confidenceScore ?? 0.5,
      status: "PENDING_REVIEW", createdAt: new Date(m.createdAt ?? Date.now()), resolvedAt: null,
    });
    mgIds.add(mgId);
    fzCount++;
  }
  console.log(`  AI_FUZZY:      ${fzCount} match groups collected (skipped ${fzSkip})`);
  skipped += fzSkip;

  // ── Batch insert MatchGroups ──────────────────────────────────────────────────
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < allMgRows.length; i += BATCH) {
    await prisma.matchGroup.createMany({ data: allMgRows.slice(i, i + BATCH), skipDuplicates: true });
    inserted += Math.min(BATCH, allMgRows.length - i);
  }
  console.log(`  → ${inserted} match groups written to DB`);

  // ── Bulk link TransactionRecord.matchGroupId via raw SQL ─────────────────────
  // Build a CASE WHEN … END update to set matchGroupId for all linked records in one shot
  if (allLinkages.size > 0) {
    const entries = [...allLinkages.entries()];
    // Batch in chunks of 500 IDs to keep SQL size sane
    const SQL_BATCH = 500;
    let linked = 0;
    for (let i = 0; i < entries.length; i += SQL_BATCH) {
      const chunk = entries.slice(i, i + SQL_BATCH);
      // Build: UPDATE "TransactionRecord" SET "matchGroupId" = CASE
      //   WHEN "transactionRecordId" = $1 THEN $2 ...
      //   ELSE "matchGroupId" END
      // WHERE "transactionRecordId" IN ($1, $3, ...)
      const params: string[] = [];
      let caseExpr = "";
      for (let j = 0; j < chunk.length; j++) {
        const [txId, mgId] = chunk[j];
        const p1 = j * 2 + 1;
        const p2 = j * 2 + 2;
        caseExpr += ` WHEN "transactionRecordId" = $${p1} THEN $${p2}`;
        params.push(txId, mgId);
      }
      const inParams = chunk.map((_, j) => `$${j * 2 + 1}`).join(",");
      const sql = `UPDATE "TransactionRecord" SET "matchGroupId" = CASE${caseExpr} ELSE "matchGroupId" END WHERE "transactionRecordId" IN (${inParams})`;
      await prisma.$executeRawUnsafe(sql, ...params);
      linked += chunk.length;
    }
    console.log(`  → ${linked} transaction records linked to match groups`);
  }

  const total = inserted;
  console.log(`  → ${total} match groups total, ${skipped} skipped`);
  return { count: total, skipped, mgIds };
}

// ── Step 3: UnresolvedExceptions ──────────────────────────────────────────────
async function seedExceptions(knownIds: Set<string>): Promise<number> {
  const classMap: Record<string, string> = {
    TIMING_LAG: "TIMING_LAG", MISSING_COUNTERPART: "MISSING_COUNTERPART",
    DUPLICATE: "DUPLICATE", OTHER: "OTHER", AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH",
  };

  // Load LLM hypotheses for enrichment
  const llmMap = new Map<string, { classification: string; rootCauseHypothesis: string }>();
  try {
    const llm = loadJson(join(RESULTS_DIR, "llm_classification_results.json"));
    for (const c of (llm.fuzzyClassifications ?? [])) {
      llmMap.set(c.exceptionId, { classification: c.classification, rootCauseHypothesis: c.rootCauseHypothesis });
    }
  } catch { /* llm classify results may not exist */ }

  const allExRows: any[] = [];

  // SS AMBIGUOUS exceptions
  const ss = loadJson(join(RESULTS_DIR, "subset_sum_results.json"));
  let ssCount = 0;
  for (const ex of (ss.exceptions ?? [])) {
    const bankId = ex.bankRecord?.transactionRecordId;
    if (!bankId || !knownIds.has(bankId)) continue;
    const gwIds = (ex.gatewaySubsets ?? []).flat().map((r: any) => r.transactionRecordId).filter(Boolean);
    allExRows.push({
      unresolvedExceptionId: ex.exceptionId ?? `ss_ex_${bankId}`,
      classification:        "AMBIGUOUS_MATCH",
      transactionRecordIds:  [bankId, ...gwIds],
      totalAmountPaise:      ex.bankRecord?.amountPaise ?? 0,
      candidateMetadata:     ex.candidateSubsets ?? null,
    });
    ssCount++;
  }
  console.log(`  AMBIGUOUS_MATCH: ${ssCount} SS exceptions`);

  // FUZZY exceptions (enriched with LLM hypotheses)
  const fuzzy = loadJson(join(RESULTS_DIR, "fuzzy_match_results.json"));
  let fzCount = 0;
  for (const ex of (fuzzy.newExceptions ?? [])) {
    const bankId = ex.bankRecordId;
    if (!bankId || !knownIds.has(bankId)) continue;
    const llm  = llmMap.get(ex.exceptionId);
    const gwIds = (ex.candidateMetadata?.topCandidates ?? []).map((c: any) => c.gatewayId).filter(Boolean);
    allExRows.push({
      unresolvedExceptionId: ex.exceptionId,
      classification:        llm ? classMap[llm.classification] : null,
      rootCauseHypothesis:   llm?.rootCauseHypothesis ?? null,
      transactionRecordIds:  [bankId, ...gwIds],
      totalAmountPaise:      0,
      candidateMetadata:     ex.candidateMetadata ?? null,
    });
    fzCount++;
  }
  console.log(`  FUZZY_PENDING: ${fzCount} exceptions (LLM-enriched: ${llmMap.size})`);

  // Batch insert
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < allExRows.length; i += BATCH) {
    await prisma.unresolvedException.createMany({ data: allExRows.slice(i, i + BATCH), skipDuplicates: true });
    inserted += Math.min(BATCH, allExRows.length - i);
  }

  console.log(`  → ${inserted} exceptions total`);
  return inserted;
}

// ── Step 4: AuditTrail rows ───────────────────────────────────────────────────
async function seedAuditTrail(knownIds: Set<string>, knownMgIds: Set<string>): Promise<number> {
  // Source files in chain order
  const sources: Array<{ path: string; key: string }> = [
    { path: join(RESULTS_DIR, "exact_match_results.json"),        key: "auditTrailEntries" },
    { path: join(RESULTS_DIR, "subset_sum_results.json"),         key: "auditTrail" },
    { path: join(RESULTS_DIR, "fuzzy_match_results.json"),        key: "auditRows" },
  ];
  // Fee inference is a side chain — seeded last
  const sideChainSource = { path: join(RESULTS_DIR, "fee_inference_audit_results.json"), key: "auditTrail" };

  let total = 0;

  const methodMap: Record<string, any> = {
    EXACT: "EXACT", SUBSET_SUM: "SUBSET_SUM",
    AI_FUZZY: "AI_FUZZY", AI_CLASSIFY: "AI_CLASSIFIED", AI_CLASSIFIED: "AI_CLASSIFIED",
    FEE_INFERENCE: "FEE_INFERENCE", AGENT_QUERY: "AGENT_QUERY",
    MANUAL: "MANUAL",
  };
  const actorMap: Record<string, any> = { SYSTEM: "SYSTEM", AI: "AI", HUMAN: "HUMAN" };

  async function insertBatch(rows: any[], label: string) {
    let inserted = 0;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const data = chunk.map((r: any) => ({
        auditTrailId:        r.auditTrailId,
        decisionTimestamp:   new Date(r.decisionTimestamp),
        method:              methodMap[r.method] ?? "MANUAL",
        reason:              r.reason ?? "",
        actor:               actorMap[r.actor] ?? "SYSTEM",
        actorId:             r.actorId ?? null,
        transactionRecordId: r.transactionRecordId && knownIds.has(r.transactionRecordId)
          ? r.transactionRecordId : null,
        matchGroupId:        r.matchGroupId && knownMgIds.has(r.matchGroupId)
          ? r.matchGroupId : null,
        metadata:            r.metadata ? (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) : null,
        rowHash:             r.rowHash,
        previousRowHash:     r.previousRowHash,
      }));
      await prisma.auditTrail.createMany({ data, skipDuplicates: true });
      inserted += chunk.length;
    }
    total += inserted;
    console.log(`  ${label}: ${inserted} rows`);
  }

  // Main chain
  for (const { path, key } of sources) {
    const d    = loadJson(path);
    const rows = d[key] ?? [];
    const label = key === "auditTrailEntries" ? "EXACT" : key === "auditTrail" ? "SS" : "FUZZY";
    if (rows.length > 0) await insertBatch(rows, label);
  }

  // LLM classify audit rows (if exists)
  try {
    const llm  = loadJson(join(RESULTS_DIR, "llm_classification_results.json"));
    const rows = llm.auditRows ?? [];
    if (rows.length > 0) await insertBatch(rows, "LLM_CLASSIFY");
  } catch { /* not yet generated */ }

  // Side chain: fee inference
  const fee  = loadJson(sideChainSource.path);
  const feeRows = fee[sideChainSource.key] ?? [];
  if (feeRows.length > 0) await insertBatch(feeRows, "FEE_INFERENCE (side chain)");

  console.log(`  → ${total} audit rows total`);
  return total;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== ReconIQ Seed ===\n");

  // Idempotent: truncate in reverse FK order
  console.log("Truncating tables…");
  await prisma.auditTrail.deleteMany();
  await prisma.unresolvedException.deleteMany();
  await prisma.exampleBank.deleteMany();
  // Unlink match groups before deleting
  await prisma.transactionRecord.updateMany({ data: { matchGroupId: null } });
  await prisma.matchGroup.deleteMany();
  await prisma.transactionRecord.deleteMany();
  console.log("Tables cleared.\n");

  // Step 1
  console.log("Step 1: TransactionRecords");
  const knownIds = await seedTransactions();

  // Step 2
  console.log("\nStep 2: MatchGroups");
  const { count: mgCount, skipped: mgSkipped, mgIds } = await seedMatchGroups(knownIds);

  // Step 3
  console.log("\nStep 3: UnresolvedExceptions");
  const exCount = await seedExceptions(knownIds);

  // Step 4
  console.log("\nStep 4: AuditTrail");
  const auditCount = await seedAuditTrail(knownIds, mgIds);

  console.log("\n=== Seed complete ===");
  console.log(`  Transactions:  ${knownIds.size}`);
  console.log(`  Match groups:  ${mgCount} (${mgSkipped} skipped)`);
  console.log(`  Exceptions:    ${exCount}`);
  console.log(`  Audit rows:    ${auditCount}`);
}

main()
  .catch(err => { console.error("Seed failed:", err.message ?? err); process.exit(1); })
  .finally(() => closePrisma());
