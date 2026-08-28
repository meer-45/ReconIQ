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
    const mgId = m.matchGroupId || `ss_mg_${m.bankRecord?.transactionRecordId}`;
    const gatewayList = m.gatewaySubset ?? m.gatewayRecords ?? [];
    const memberIds: string[] = [
      m.bankRecord?.transactionRecordId,
      ...gatewayList.map((r: any) => r.transactionRecordId),
    ].filter(Boolean);
    if (memberIds.some(id => !knownIds.has(id))) { ssSkip++; continue; }
    allMgRows.push({
      matchGroupId: mgId, method: "SUBSET_SUM", confidenceScore: 1.0,
      status: "MATCHED", createdAt: new Date(m.createdAt ?? Date.now()),
      resolvedAt: new Date(m.createdAt ?? Date.now()),
    });
    for (const id of memberIds) allLinkages.set(id, mgId);
    mgIds.add(mgId);
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
  const classMap: Record<string, any> = {
    TIMING_LAG:          "TIMING_LAG",
    MISSING_COUNTERPART: "MISSING_COUNTERPART",
    DUPLICATE:           "DUPLICATE",
    OTHER:               "OTHER",
    AMBIGUOUS_MATCH:     "AMBIGUOUS_MATCH",
  };

  // Load LLM hypotheses for enrichment
  let fuzzyClassifications: any[] = [];
  let subsetSumClassifications: any[] = [];
  try {
    const llm = loadJson(join(RESULTS_DIR, "llm_classification_results.json"));
    fuzzyClassifications     = llm.fuzzyClassifications ?? [];
    subsetSumClassifications = llm.subsetSumClassifications ?? [];
  } catch { /* llm classify results may not exist */ }

  const ssLlmMap = new Map<string, { classification: string; rootCauseHypothesis: string; confidence: number }>();
  for (const c of subsetSumClassifications) {
    ssLlmMap.set(c.exceptionId, {
      classification:      c.classification,
      rootCauseHypothesis: c.rootCauseHypothesis,
      confidence:          c.confidence ?? 0.5,
    });
    if (c.bankRecordId) {
      ssLlmMap.set(c.bankRecordId, {
        classification:      c.classification,
        rootCauseHypothesis: c.rootCauseHypothesis,
        confidence:          c.confidence ?? 0.5,
      });
    }
  }

  const allExRows: any[] = [];
  const seenIds = new Set<string>();

  // 1. SS AMBIGUOUS exceptions
  const ss = loadJson(join(RESULTS_DIR, "subset_sum_results.json"));
  let ssCount = 0;
  for (const ex of (ss.exceptions ?? [])) {
    const bankId = ex.bankRecord?.transactionRecordId;
    if (!bankId || !knownIds.has(bankId)) continue;
    const exId = ex.exceptionId ?? `ss_ex_${bankId}`;
    if (seenIds.has(exId)) continue;
    seenIds.add(exId);

    const llmInfo = ssLlmMap.get(exId) ?? ssLlmMap.get(bankId);

    const candidates = (ex.candidates ?? []).slice(0, 3).map((c: any, idx: number) => {
      const gwList = (c.gatewaySubset ?? []).map((g: any) => ({
        transactionRecordId: g.transactionRecordId,
        externalReference:   g.externalReference,
        amountPaise:         g.amountPaise,
        transactionDate:     g.transactionDate,
      }));
      const sumPaise = gwList.reduce((s: number, r: any) => s + r.amountPaise, 0);
      return {
        candidateIndex:    idx,
        gatewayRecords:    gwList,
        sumPaise,
        deltaPaise:        sumPaise - (ex.bankRecord?.amountPaise ?? 0),
        finalScore:        c.score?.finalScore ?? 0,
        amountPrecision:   c.score?.amountPrecision ?? 0,
        dateProximity:     c.score?.dateProximity ?? 0,
        subsetSizePenalty: c.score?.subsetSizePenalty ?? 0,
      };
    });

    const allGwIds = candidates.flatMap((c: any) => c.gatewayRecords.map((g: any) => g.transactionRecordId));
    const uniqueTxIds = Array.from(new Set([bankId, ...allGwIds])).filter((id) => knownIds.has(id));

    allExRows.push({
      unresolvedExceptionId: exId,
      classification:        llmInfo ? classMap[llmInfo.classification] : "AMBIGUOUS_MATCH",
      rootCauseHypothesis:   llmInfo?.rootCauseHypothesis ?? null,
      riskScore:             llmInfo ? (1.0 - llmInfo.confidence) : 0.5,
      transactionRecordIds:  uniqueTxIds,
      totalAmountPaise:      ex.bankRecord?.amountPaise ?? 0,
      candidateMetadata:     candidates.length > 0 ? { candidates } : null,
    });
    ssCount++;
  }
  console.log(`  AMBIGUOUS_MATCH / SS: ${ssCount} exceptions (with candidate subsets)`);

  // 2. FUZZY exceptions (from Layer 2b LLM classifications — includes 21 TIMING_LAG)
  let fzCount = 0;
  for (const c of fuzzyClassifications) {
    if (!c.exceptionId || seenIds.has(c.exceptionId)) continue;
    seenIds.add(c.exceptionId);

    const bankId = c.bankRecordId;
    const evidenceIds: string[] = Array.isArray(c.evidenceRefs) ? c.evidenceRefs : [];
    const txIds = [bankId, ...evidenceIds].filter((id): id is string => typeof id === "string" && knownIds.has(id));

    allExRows.push({
      unresolvedExceptionId: c.exceptionId,
      classification:        classMap[c.classification] ?? "OTHER",
      rootCauseHypothesis:   c.rootCauseHypothesis ?? null,
      riskScore:             c.confidence ? Math.max(0, 1.0 - c.confidence) : 0.5,
      transactionRecordIds:  txIds.length > 0 ? txIds : (bankId ? [bankId] : []),
      totalAmountPaise:      0,
      candidateMetadata:     {
        evidenceRefs: c.evidenceRefs ?? [],
        confidence:   c.confidence ?? 0.5,
        modelId:      c.modelId ?? "gemini-3.5-flash-lite",
      },
    });
    fzCount++;
  }
  console.log(`  FUZZY (Layer 2b):    ${fzCount} exceptions (LLM-classified, 21 TIMING_LAG)`);

  // Batch insert
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < allExRows.length; i += BATCH) {
    await prisma.unresolvedException.createMany({ data: allExRows.slice(i, i + BATCH), skipDuplicates: true });
    inserted += Math.min(BATCH, allExRows.length - i);
  }

  console.log(`  → ${inserted} exceptions total written to DB`);
  return inserted;
}

// ── Step 4: AuditTrail rows ───────────────────────────────────────────────────
async function seedAuditTrail(knownIds: Set<string>, knownMgIds: Set<string>): Promise<number> {
  // Source files in linear continuous chain order: EXACT → SUBSET_SUM → FEE_INFERENCE → FUZZY → LLM_CLASSIFY
  const sources: Array<{ path: string; key: string; label: string; fallbackPath?: string }> = [
    { path: join(RESULTS_DIR, "exact_match_results.json"), key: "auditTrailEntries", label: "EXACT" },
    { path: join(RESULTS_DIR, "subset_sum_results.json"), key: "auditTrail", label: "SS" },
    { path: join(RESULTS_DIR, "fee_inference_results.json"), key: "auditTrail", label: "FEE_INFERENCE", fallbackPath: join(RESULTS_DIR, "fee_inference_audit_results.json") },
    { path: join(RESULTS_DIR, "fuzzy_match_results.json"), key: "auditRows", label: "FUZZY" },
  ];

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

  // Linear Main chain traversal
  for (const { path, key, label, fallbackPath } of sources) {
    let d: any;
    try {
      d = loadJson(path);
    } catch {
      if (fallbackPath) {
        try { d = loadJson(fallbackPath); } catch {}
      }
    }
    const rows = d ? (d[key] ?? []) : [];
    if (rows.length > 0) await insertBatch(rows, label);
  }

  // LLM classify audit rows (if exists)
  try {
    const llm  = loadJson(join(RESULTS_DIR, "llm_classification_results.json"));
    const rows = llm.auditRows ?? [];
    if (rows.length > 0) await insertBatch(rows, "LLM_CLASSIFY");
  } catch { /* not yet generated */ }

  console.log(`  → ${total} audit rows total (single continuous chain)`);
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
