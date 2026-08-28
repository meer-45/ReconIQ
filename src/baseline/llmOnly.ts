// llmOnly.ts — LLM-only baseline for the pitch-deck "we proved the thesis" slide.
//
// Design decisions:
// - 50 GT-covered bank rows + their paired gateway rows (~100 gw) = ~150 records total
// - No noise GW rows (they caused ID hallucination at scale)
// - No ledger rows (3-source ambiguity confused the model into constructing IDs)
// - Single Gemini call, disk-cached (re-runs are free)
// - maxOutputTokens=4096 (est. output ~1900 tokens — 2× headroom)
// - Truncation guard throws before parse if ceiling is hit
// - Full field name `transactionRecordId` (not `id`) prevents hallucination
// - Pair-key scoring restricted to the sampled GT subset (fair recall denominator)

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash }    from "node:crypto";
import { join, resolve } from "path";
import { z }             from "zod";
import { callGemini }    from "../llm/geminiClient";
import { withCache }     from "../llm/responseCache";
import { acquire }       from "../llm/rateLimiter";

const DATA_DIR     = resolve(__dirname, "../../data");
const BASELINE_DIR = __dirname;
const PROMPT_PATH  = resolve(__dirname, "../prompts/baseline-v1.md");

// Tuning knobs — adjust here if output hits ceiling
const N_BANK_ROWS      = 50;   // GT-covered bank rows to sample
const MAX_OUTPUT_TOKENS = 4096; // est. ~1900 tokens needed — 2× headroom

// ── Seeded sampler (deterministic Fisher-Yates, seed=42) ──────────────────────
const SEED = 42;

function seededSample<T>(arr: T[], n: number, salt: number): T[] {
  const copy = [...arr];
  let s = ((SEED ^ salt) + 1) >>> 0;
  const lcg = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

// ── CSV reader ────────────────────────────────────────────────────────────────
interface TxRecord {
  transactionRecordId: string;
  dataSource:          string;
  externalReference:   string;
  amountPaise:         number;
  transactionDate:     string;
  rawDescription:      string;
}

function parseCsv(path: string): TxRecord[] {
  const lines  = readFileSync(path, "utf-8").split("\n").filter(l => l.trim());
  const header = lines[0].replace(/"/g, "").split(",");
  const idx    = (f: string) => header.indexOf(f);
  const rows: TxRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(",");
    if (v.length <= 1) continue;
    const g = (f: string) => v[idx(f)]?.replace(/"/g, "") ?? "";
    const id = g("transactionRecordId");
    if (!id) continue;
    rows.push({
      transactionRecordId: id,
      dataSource:          g("dataSource"),
      externalReference:   g("externalReference"),
      amountPaise:         parseInt(g("amountPaise"), 10) || 0,
      transactionDate:     g("transactionDate"),
      rawDescription:      g("rawDescription"),
    });
  }
  return rows;
}

// ── GT loader ─────────────────────────────────────────────────────────────────
interface GTEntry {
  bankStatementRecordId:      string;
  gatewaySettlementRecordIds: string[];
  matchingAlgorithm:          string;
  caseType:                   string;
}

function loadGT(): GTEntry[] {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, "ground_truth.json"), "utf-8"));
  return (raw.expectedMatches as any[]).map(e => ({
    bankStatementRecordId:      e.bankStatementRecordId,
    gatewaySettlementRecordIds: e.gatewaySettlementRecordIds ?? [e.gatewaySettlementRecordId],
    matchingAlgorithm:          e.matchingAlgorithm,
    caseType:                   e.caseType,
  }));
}

// ── Stratified sample ─────────────────────────────────────────────────────────
export interface SampledSet {
  records:   TxRecord[];
  sampleIds: Set<string>;
  coveredGT: GTEntry[];
}

export function buildSample(): SampledSet {
  const bank    = parseCsv(join(DATA_DIR, "bank_statement.csv"));
  const gateway = parseCsv(join(DATA_DIR, "gateway_settlement.csv"));
  const gt      = loadGT();

  const bankMap = new Map(bank.map(r    => [r.transactionRecordId, r]));
  const gwMap   = new Map(gateway.map(r => [r.transactionRecordId, r]));

  // bank → GT entries index
  const bankToGT = new Map<string, GTEntry[]>();
  for (const e of gt) {
    const existing = bankToGT.get(e.bankStatementRecordId) ?? [];
    bankToGT.set(e.bankStatementRecordId, [...existing, e]);
  }

  // Sample N_BANK_ROWS bank rows that have GT matches
  const gtBankIds     = [...bankMap.keys()].filter(id => bankToGT.has(id));
  const sampledBankIds = new Set(seededSample(gtBankIds, N_BANK_ROWS, 0));

  // Include ALL gateway rows that are paired to the sampled bank rows via GT
  // No noise — clean pairing only to avoid hallucination
  const pairedGwIds = new Set<string>();
  for (const bid of sampledBankIds) {
    for (const e of (bankToGT.get(bid) ?? [])) {
      for (const gid of e.gatewaySettlementRecordIds) {
        if (gwMap.has(gid)) pairedGwIds.add(gid);
      }
    }
  }

  const allSampledIds = new Set([...sampledBankIds, ...pairedGwIds]);

  // Shuffle so row order doesn't bias the model
  const bankRecords = seededSample([...sampledBankIds].map(id => bankMap.get(id)!).filter(Boolean), Infinity, 10);
  const gwRecords   = seededSample([...pairedGwIds].map(id => gwMap.get(id)!).filter(Boolean),      Infinity, 11);
  const records     = [...bankRecords, ...gwRecords];

  // GT entries fully covered: bank in sample AND all gateway sides in sample
  const coveredGT = gt.filter(e =>
    sampledBankIds.has(e.bankStatementRecordId) &&
    e.gatewaySettlementRecordIds.every(gid => allSampledIds.has(gid))
  );

  const estOutputTokens = Math.round(records.length * 12); // empirical: ~12 tokens/record output

  console.log(`\nSampling (seed=${SEED}):`);
  console.log(`  Bank:    ${sampledBankIds.size}  (all GT-covered)`);
  console.log(`  Gateway: ${pairedGwIds.size}  (paired only, no noise, no ledger)`);
  console.log(`  Total:   ${records.length} records`);
  console.log(`  GT pairs fully in sample (recall denominator): ${coveredGT.length}`);
  console.log(`  Est. input tokens: ~${Math.round(records.length * 65)}`);
  console.log(`  Est. output tokens: ~${estOutputTokens} (ceiling: ${MAX_OUTPUT_TOKENS})`);

  if (estOutputTokens > MAX_OUTPUT_TOKENS * 0.7) {
    console.warn(`  ⚠ Output estimate >70% of ceiling — consider reducing N_BANK_ROWS`);
  }

  return { records, sampleIds: allSampledIds, coveredGT };
}

// ── Prompt builder ────────────────────────────────────────────────────────────
export function buildPrompt(records: TxRecord[]): { prompt: string; promptVersion: string } {
  const template      = readFileSync(PROMPT_PATH, "utf-8");
  const promptVersion = createHash("sha256").update(template, "utf8").digest("hex");

  // Shuffle with a different seed for prompt order (already shuffled in buildSample)
  const shuffled = seededSample(records, records.length, 99);

  // Use FULL field names — abbreviated names caused ID hallucination
  const recordsJson = JSON.stringify(
    shuffled.map(r => ({
      transactionRecordId: r.transactionRecordId,
      dataSource:          r.dataSource,
      externalReference:   r.externalReference,
      amountPaise:         r.amountPaise,
      transactionDate:     r.transactionDate,
    }))
  );

  const prompt = template.replace("{{RECORDS}}", recordsJson);
  console.log(`\nPrompt: ${prompt.length.toLocaleString()} chars (~${Math.round(prompt.length / 4).toLocaleString()} tokens)`);
  console.log(`Prompt version: ${promptVersion.slice(0, 16)}…`);
  return { prompt, promptVersion };
}

// ── LLM response schema ───────────────────────────────────────────────────────
const MatchGroupSchema = z.object({
  matchGroupId:         z.string(),
  transactionRecordIds: z.array(z.string()).min(2),
  method:               z.literal("LLM_ONLY"),
  confidence:           z.number().min(0).max(1),
});

const LlmResponseSchema = z.object({
  matchGroups: z.array(MatchGroupSchema),
  unmatched:   z.array(z.string()),
});

type LlmResponse = z.infer<typeof LlmResponseSchema>;

function parseResponse(rawText: string, attempt: number): LlmResponse {
  const start = rawText.indexOf("{");
  const end   = rawText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Attempt ${attempt}: no JSON object found. First 200: ${rawText.slice(0, 200)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Attempt ${attempt}: JSON.parse failed — ${(e as Error).message}. Slice (first 300): ${rawText.slice(start, start + 300)}`);
  }
  const result = LlmResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Attempt ${attempt}: Zod failed — ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
  return result.data;
}

// ── Integrity check ───────────────────────────────────────────────────────────
interface IntegrityReport {
  missing:    string[];  // input IDs absent from output
  spurious:   string[];  // output IDs not in input (hallucinated)
  duplicates: string[];  // IDs in both matchGroups and unmatched
}

function checkIntegrity(parsed: LlmResponse, sampleIds: Set<string>): IntegrityReport {
  const inGroups    = new Set<string>();
  const inUnmatched = new Set<string>();
  for (const g of parsed.matchGroups) for (const id of g.transactionRecordIds) inGroups.add(id);
  for (const id of parsed.unmatched) inUnmatched.add(id);
  const allOutput = new Set([...inGroups, ...inUnmatched]);
  return {
    missing:    [...sampleIds].filter(id => !allOutput.has(id)),
    spurious:   [...allOutput].filter(id => !sampleIds.has(id)),
    duplicates: [...inGroups].filter(id => inUnmatched.has(id)),
  };
}

// ── Pair-key scoring ──────────────────────────────────────────────────────────
interface ScoreResult {
  tp: number; fp: number; fn: number;
  precision: number; recall: number;
  gtPairCount: number; llmPairCount: number;
}

function score(llmResponse: LlmResponse, coveredGT: GTEntry[]): ScoreResult {
  const llmPairKeys = new Set<string>();
  for (const grp of llmResponse.matchGroups) {
    const ids = grp.transactionRecordIds;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        llmPairKeys.add([ids[i], ids[j]].sort().join("|"));
  }
  const gtPairKeys = new Set<string>();
  for (const e of coveredGT)
    for (const gid of e.gatewaySettlementRecordIds)
      gtPairKeys.add([e.bankStatementRecordId, gid].sort().join("|"));

  const tp = [...gtPairKeys].filter(k => llmPairKeys.has(k)).length;
  return {
    tp, fp: llmPairKeys.size - tp, fn: gtPairKeys.size - tp,
    precision:    llmPairKeys.size > 0 ? tp / llmPairKeys.size : 0,
    recall:       gtPairKeys.size  > 0 ? tp / gtPairKeys.size  : 0,
    gtPairCount:  gtPairKeys.size,
    llmPairCount: llmPairKeys.size,
  };
}

// ── Layered pipeline score on the same GT subset ──────────────────────────────
function scoreLayeredOnSample(coveredGT: GTEntry[]): { precision: number; recall: number; matchCount: number; note: string } {
  const RESULTS_DIR = resolve(__dirname, "../matching");
  let exactRaw: any = {};
  let ssRaw: any = {};
  let fuzzyRaw: any = {};
  try { exactRaw = JSON.parse(readFileSync(join(RESULTS_DIR, "exact_match_results.json"), "utf-8")); } catch {}
  try { ssRaw = JSON.parse(readFileSync(join(RESULTS_DIR, "subset_sum_results.json"), "utf-8")); } catch {}
  try { fuzzyRaw = JSON.parse(readFileSync(join(RESULTS_DIR, "fuzzy_match_results.json"), "utf-8")); } catch {}

  // Restrict pipeline pairs to those involving sample bank IDs (fair denominator)
  const sampleBids = new Set(coveredGT.map(e => e.bankStatementRecordId));
  const pipelinePairs = new Set<string>();
  let matchCount = 0;

  for (const p of exactRaw.matchedPairs ?? []) {
    if (!sampleBids.has(p.bankId)) continue;
    pipelinePairs.add([p.bankId, p.gatewayId].sort().join("|"));
    matchCount++;
  }

  for (const m of ssRaw.matches ?? []) {
    const bId = m.bankRecord?.transactionRecordId;
    if (!bId || !sampleBids.has(bId)) continue;
    for (const gw of m.gatewaySubset ?? []) {
      pipelinePairs.add([bId, gw.transactionRecordId].sort().join("|"));
    }
    matchCount++;
  }

  for (const m of (fuzzyRaw.newMatches ?? [])) {
    if (!sampleBids.has(m.bankRecordId)) continue;
    for (const gid of (m.gatewayRecordIds ?? []))
      pipelinePairs.add([m.bankRecordId, gid].sort().join("|"));
    matchCount++;
  }

  const gtPairKeys = new Set<string>();
  for (const e of coveredGT)
    for (const gid of e.gatewaySettlementRecordIds)
      gtPairKeys.add([e.bankStatementRecordId, gid].sort().join("|"));

  const tp = [...gtPairKeys].filter(k => pipelinePairs.has(k)).length;

  return {
    precision: pipelinePairs.size > 0 ? tp / pipelinePairs.size : 0,
    recall:    gtPairKeys.size    > 0 ? tp / gtPairKeys.size    : 0,
    matchCount,
    note: "Layered score evaluated across EXACT, SUBSET_SUM, and AI_FUZZY on the 50 sampled bank rows.",
  };
}

// ── Report ────────────────────────────────────────────────────────────────────
export interface BaselineReport {
  generatedAt:     string;
  promptVersion:   string;
  sampleSize:      number;
  sampleBreakdown: { bank: number; gateway: number };
  coveredGTPairs:  number;
  precision:       number;
  recall:          number;
  truePositives:   number;
  matchCount:      number;
  wallClockMs:     number;
  tokensUsed:      { prompt: number; completion: number; total: number };
  estCostInr:      0;
  notes:           string;
  integrity:       { missing: number; spurious: number; duplicates: number };
  layeredComparison: { precision: number; recall: number; matchCount: number; wallClockMs: number; note: string };
  cacheHit: boolean;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function runLlmOnlyBaseline(): Promise<BaselineReport> {
  const t0 = Date.now();

  const { records, sampleIds, coveredGT } = buildSample();
  const bankCount = records.filter(r => r.dataSource === "BANK_STATEMENT").length;
  const gwCount   = records.filter(r => r.dataSource === "GATEWAY_SETTLEMENT").length;

  const { prompt, promptVersion } = buildPrompt(records);

  console.log(`\nAcquiring rate limiter slot…`);
  await acquire();

  console.log(`Calling gemini-3.6-flash (maxOutputTokens=${MAX_OUTPUT_TOKENS})…`);
  const t1 = Date.now();

  const { result: llmResult, cacheHit } = await withCache(
    prompt, "gemini-3.6-flash", 0.0,
    () => callGemini(prompt, { temperature: 0.0, maxOutputTokens: MAX_OUTPUT_TOKENS })
  );

  const llmMs = Date.now() - t1;
  console.log(`Response: ${llmMs}ms | cache=${cacheHit}`);
  console.log(`Tokens: prompt=${llmResult.promptTokens} completion=${llmResult.completionTokens}/${MAX_OUTPUT_TOKENS}`);

  // Truncation guard — must check BEFORE parsing
  if (llmResult.completionTokens >= MAX_OUTPUT_TOKENS * 0.98) {
    throw new Error(
      `[llmOnly] Hit token ceiling (${llmResult.completionTokens}/${MAX_OUTPUT_TOKENS}). ` +
      `JSON is truncated. Reduce N_BANK_ROWS (currently ${N_BANK_ROWS}) or raise MAX_OUTPUT_TOKENS.`
    );
  }

  // Parse with one retry
  let parsed: LlmResponse;
  try {
    parsed = parseResponse(llmResult.text, 1);
    console.log(`Parse: OK (attempt 1)`);
  } catch (err1) {
    console.warn(`Parse attempt 1 failed: ${(err1 as Error).message.slice(0, 120)}`);
    try {
      parsed = parseResponse(llmResult.text, 2);
      console.log(`Parse: OK (attempt 2)`);
    } catch (err2) {
      throw new Error(
        `[llmOnly] Parse failed twice.\nAttempt 1: ${(err1 as Error).message}\nAttempt 2: ${(err2 as Error).message}`
      );
    }
  }

  const integrity = checkIntegrity(parsed, sampleIds);
  if (integrity.missing.length)    console.warn(`[integrity] ${integrity.missing.length} missing IDs`);
  if (integrity.spurious.length)   console.warn(`[integrity] ${integrity.spurious.length} invented IDs`);
  if (integrity.duplicates.length) console.warn(`[integrity] ${integrity.duplicates.length} duplicate IDs`);

  const s       = score(parsed, coveredGT);
  const layered = scoreLayeredOnSample(coveredGT);

  console.log(`\nScoring vs ${coveredGT.length} covered GT pairs:`);
  console.log(`  TP=${s.tp} FP=${s.fp} FN=${s.fn}`);
  console.log(`  LLM-Only:  P=${(s.precision*100).toFixed(1)}%  R=${(s.recall*100).toFixed(1)}%`);
  console.log(`  Layered:   P=${(layered.precision*100).toFixed(1)}%  R=${(layered.recall*100).toFixed(1)}%`);

  const wallClockMs = Date.now() - t0;

  const report: BaselineReport = {
    generatedAt:     new Date().toISOString(),
    promptVersion,
    sampleSize:      records.length,
    sampleBreakdown: { bank: bankCount, gateway: gwCount },
    coveredGTPairs:  coveredGT.length,
    precision:       parseFloat(s.precision.toFixed(4)),
    recall:          parseFloat(s.recall.toFixed(4)),
    truePositives:   s.tp,
    matchCount:      parsed.matchGroups.length,
    wallClockMs,
    tokensUsed: {
      prompt:     llmResult.promptTokens,
      completion: llmResult.completionTokens,
      total:      llmResult.promptTokens + llmResult.completionTokens,
    },
    estCostInr: 0,
    notes: `Free tier. Cache=${cacheHit}. Missing=${integrity.missing.length} Spurious=${integrity.spurious.length} Dup=${integrity.duplicates.length}.`,
    integrity: {
      missing: integrity.missing.length, spurious: integrity.spurious.length, duplicates: integrity.duplicates.length,
    },
    layeredComparison: {
      precision: parseFloat(layered.precision.toFixed(4)), recall: parseFloat(layered.recall.toFixed(4)),
      matchCount: layered.matchCount, wallClockMs: 0,
      note: layered.note,
    },
    cacheHit,
  };

  mkdirSync(BASELINE_DIR, { recursive: true });
  const outPath = join(BASELINE_DIR, "baseline_report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n✓ Written to ${outPath}`);

  return report;
}

// ── Side-by-side table ────────────────────────────────────────────────────────
export function printComparison(r: BaselineReport): void {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const lc = r.layeredComparison;
  const W  = 16;
  const p  = (s: string) => s.padEnd(W);

  console.log(`\n${"═".repeat(54)}`);
  console.log(`  Layered Pipeline  vs  LLM-Only Baseline`);
  console.log(`  Sample: ${r.sampleSize} records | GT pairs evaluated: ${r.coveredGTPairs}`);
  console.log(`${"═".repeat(54)}`);
  console.log(`  ${p("")}${p("LAYERED")}${p("LLM-ONLY")}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  ${p("Matches")}${p(String(lc.matchCount))}${p(String(r.matchCount))}`);
  console.log(`  ${p("Precision")}${p(pct(lc.precision))}${p(pct(r.precision))}`);
  console.log(`  ${p("Recall")}${p(pct(lc.recall))}${p(pct(r.recall))}`);
  console.log(`  ${p("Time")}${p("pre-computed")}${p(r.wallClockMs + "ms")}`);
  console.log(`  ${p("Cost")}${p("₹0")}${p("₹0 (free tier)")}`);
  console.log(`  ${p("Tokens (total)")}${p("N/A")}${p(String(r.tokensUsed.total))}`);
  console.log(`  ${"-".repeat(50)}`);
  console.log(`  Integrity  missing=${r.integrity.missing} spurious=${r.integrity.spurious} dup=${r.integrity.duplicates}`);
  console.log(`  Layered note: ${r.layeredComparison.note}`);
  console.log(`  ${r.notes}`);
  console.log(`${"═".repeat(54)}\n`);
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
if (import.meta.main) {
  runLlmOnlyBaseline()
    .then(printComparison)
    .catch(err => { console.error("FATAL:", err.message ?? err); process.exit(1); });
}
