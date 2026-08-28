// llmClassify.ts — LLM classification layer (Layer 2b)
// Classifies fuzzy PENDING_REVIEW and subset-sum AMBIGUOUS exceptions via Gemini.
// Never auto-commits. All output is hypothesis-only.

import { readFileSync } from "fs";
import { createHash } from "node:crypto";
import { join, resolve } from "path";
import { z } from "zod";
import { callGemini } from "../llm/geminiClient";
import { withCache } from "../llm/responseCache";
import type { GeminiCallResult } from "../llm/geminiClient";
import type { FuzzyTracer } from "./fuzzyTracer";

// ── Local audit row type (method="AI_CLASSIFY" for this layer) ───────────────
export interface LlmAuditRow {
  auditTrailId:        string;
  decisionTimestamp:   string;
  method:              "AI_CLASSIFY";
  reason:              string;
  actor:               "AI";
  actorId:             "llmClassify.ts";
  transactionRecordId: string | null;
  matchGroupId:        null;
  metadata:            string;
  rowHash:             string;
  previousRowHash:     string;
}

// ── Named constants ───────────────────────────────────────────────────────────
const MIN_CONFIDENCE_FOR_HYPOTHESIS = 0.5;
const MAX_EVIDENCE_REFS             = 5;
const MODEL_ID                      = "gemini-3.5-flash-lite";
const TEMPERATURE                   = 0.0;

// ── Prompt template (loaded once per module load) ─────────────────────────────
const PROMPT_TEMPLATE_PATH = resolve(__dirname, "../prompts/classification-v1.md");

let _promptTemplate: string | null = null;
let _promptVersion:  string | null = null;

function getPromptTemplate(): { template: string; version: string } {
  if (_promptTemplate && _promptVersion) {
    return { template: _promptTemplate, version: _promptVersion };
  }
  const raw      = readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
  const version  = createHash("sha256").update(raw, "utf8").digest("hex");
  _promptTemplate = raw;
  _promptVersion  = version;
  return { template: raw, version };
}

// ── Zod schema for Gemini response ────────────────────────────────────────────
const ClassificationSchema = z.object({
  classification:      z.enum(["DUPLICATE", "MISSING_COUNTERPART", "TIMING_LAG", "OTHER"]),
  rootCauseHypothesis: z.string().max(200),
  confidence:          z.number().min(0).max(1),
  evidenceRefs:        z.array(z.string()).max(MAX_EVIDENCE_REFS),
});

type ParsedClassification = z.infer<typeof ClassificationSchema>;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LlmClassification {
  exceptionId:         string;
  bankRecordId:        string;
  classification:      string;
  rootCauseHypothesis: string;
  confidence:          number;
  evidenceRefs:        string[];
  modelId:             string;
  promptVersion:       string;
  cacheHit:            boolean;
  promptTokens:        number;
  completionTokens:    number;
  latencyMs:           number;
  costRupees:          0;
}

// ── Audit row helpers ─────────────────────────────────────────────────────────
function uid(): string {
  return `llm_${Math.random().toString(36).slice(2, 14)}`;
}

function computeRowHash(previousRowHash: string, row: Omit<LlmAuditRow, "rowHash">): string {
  const content = {
    method:              row.method,
    reason:              row.reason,
    actor:               row.actor,
    actorId:             row.actorId,
    transactionRecordId: row.transactionRecordId,
    matchGroupId:        row.matchGroupId,
    metadata:            row.metadata,
    decisionTimestamp:   row.decisionTimestamp,
  };
  return createHash("sha256")
    .update(previousRowHash + JSON.stringify(content), "utf8")
    .digest("hex");
}

function makeAuditRow(opts: {
  reason:              string;
  bankRecordId:        string;
  classification:      string;
  confidence:          number;
  modelId:             string;
  promptVersion:       string;
  promptTokens:        number;
  completionTokens:    number;
  latencyMs:           number;
  cacheHit:            boolean;
  previousRowHash:     string;
}): LlmAuditRow {
  const ts = new Date().toISOString();
  const metadata = JSON.stringify({
    modelId:          opts.modelId,
    promptVersion:    opts.promptVersion,
    promptTokens:     opts.promptTokens,
    completionTokens: opts.completionTokens,
    latencyMs:        opts.latencyMs,
    costRupees:       0,
    cacheHit:         opts.cacheHit,
    classification:   opts.classification,
    confidence:       opts.confidence,
  });

  const partial: Omit<LlmAuditRow, "rowHash"> = {
    auditTrailId:        uid(),
    decisionTimestamp:   ts,
    method:              "AI_CLASSIFY",
    reason:              opts.reason,
    actor:               "AI",
    actorId:             "llmClassify.ts",
    transactionRecordId: opts.bankRecordId,
    matchGroupId:        null,
    metadata,
    previousRowHash:     opts.previousRowHash,
  };

  return { ...partial, rowHash: computeRowHash(opts.previousRowHash, partial) };
}

// ── JSON extraction from LLM response ────────────────────────────────────────
function extractJson(text: string): string {
  // Strip ```json fences if present
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Try raw JSON
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1).trim();
  return text.trim();
}

// ── Parse + validate with retry ───────────────────────────────────────────────
function parseAndValidate(
  text: string,
  attempt: number
): ParsedClassification {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch {
    throw new Error(`[llmClassify] Attempt ${attempt}: JSON parse failed. Raw text: ${text.slice(0, 200)}`);
  }

  // Truncate evidenceRefs if over limit
  if (raw && typeof raw === "object" && "evidenceRefs" in raw) {
    const r = raw as any;
    if (Array.isArray(r.evidenceRefs) && r.evidenceRefs.length > MAX_EVIDENCE_REFS) {
      r.evidenceRefs = r.evidenceRefs.slice(0, MAX_EVIDENCE_REFS);
    }
  }

  const result = ClassificationSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `[llmClassify] Attempt ${attempt}: Zod validation failed: ` +
      JSON.stringify(result.error.issues.slice(0, 3))
    );
  }
  return result.data;
}

// ── Prompt builder ────────────────────────────────────────────────────────────
interface PromptInput {
  bankId:          string;
  bankRef:         string;
  amountPaise:     number;
  date:            string;
  topCandidates:   Array<{ id: string; ref: string; amountPaise: number; similarity?: number; amountDeltaPaise?: number }>;
  priorLayerSummary: string;
}

function buildPrompt(template: string, input: PromptInput): string {
  const inputJson = JSON.stringify({
    bank: { id: input.bankId, ref: input.bankRef, amountPaise: input.amountPaise, date: input.date },
    topCandidates: input.topCandidates,
    priorLayerSummary: input.priorLayerSummary,
  }, null, 2);
  return template.replace("{{INPUT_JSON}}", inputJson);
}

// ── Core classify helper ──────────────────────────────────────────────────────
async function classify(
  exceptionId: string,
  bankRecordId: string,
  promptInput:  PromptInput,
  promptVersion: string,
  promptTemplate: string,
  startHash:    string,
  tracer?:      FuzzyTracer
): Promise<{ classification: LlmClassification; auditRow: LlmAuditRow }> {
  const promptText = buildPrompt(promptTemplate, promptInput);

  let geminiResult: GeminiCallResult;
  let cacheHit: boolean;

  const callFn = () => callGemini(promptText, { temperature: TEMPERATURE }, tracer);

  const cached = await withCache(promptText, MODEL_ID, TEMPERATURE, callFn, tracer);
  geminiResult = cached.result;
  cacheHit     = cached.cacheHit;

  // Parse and validate — retry once on failure
  let parsed: ParsedClassification;
  try {
    parsed = parseAndValidate(geminiResult.text, 1);
  } catch (err1) {
    console.warn(`[llmClassify] First parse failed for ${exceptionId}, retrying…`);
    // Retry: append correction instruction to prompt, call again (no cache for retry)
    const retryPrompt = promptText + "\n\nYour previous reply was invalid JSON. Return valid JSON matching the schema exactly.";
    const retryResult = await callGemini(retryPrompt, { temperature: TEMPERATURE }, tracer);
    try {
      parsed = parseAndValidate(retryResult.text, 2);
      // Use retry result for reporting
      geminiResult = retryResult;
      cacheHit     = false;
    } catch (err2) {
      throw new Error(
        `[llmClassify] Classification for ${exceptionId} failed twice.\n` +
        `Attempt 1: ${(err1 as Error).message}\n` +
        `Attempt 2: ${(err2 as Error).message}`
      );
    }
  }

  const classification: LlmClassification = {
    exceptionId,
    bankRecordId,
    classification:      parsed.classification,
    rootCauseHypothesis: parsed.rootCauseHypothesis,
    confidence:          parsed.confidence,
    evidenceRefs:        parsed.evidenceRefs,
    modelId:             MODEL_ID,
    promptVersion,
    cacheHit,
    promptTokens:        geminiResult.promptTokens,
    completionTokens:    geminiResult.completionTokens,
    latencyMs:           geminiResult.latencyMs,
    costRupees:          0,
  };

  const auditRow = makeAuditRow({
    reason:           `AI_CLASSIFY: ${exceptionId} → ${parsed.classification} (confidence=${parsed.confidence.toFixed(2)})`,
    bankRecordId,
    classification:   parsed.classification,
    confidence:       parsed.confidence,
    modelId:          MODEL_ID,
    promptVersion,
    promptTokens:     geminiResult.promptTokens,
    completionTokens: geminiResult.completionTokens,
    latencyMs:        geminiResult.latencyMs,
    cacheHit,
    previousRowHash:  startHash,
  });

  return { classification, auditRow };
}

// ── Input shapes ──────────────────────────────────────────────────────────────
export interface FuzzyException {
  exceptionId:  string;
  bankRecordId: string;
  exceptionType: string;
  candidateMetadata: {
    topCandidates: Array<{ gatewayId: string; similarity: number; ref: string }>;
  };
}

export interface SubsetSumException {
  bankRecord: {
    transactionRecordId: string;
    externalReference:   string;
    amountPaise:         number;
    transactionDate:     string;
  };
  candidates: Array<{
    gatewaySubset: Array<{ transactionRecordId: string; externalReference: string; amountPaise: number }>;
    score:         unknown;
  }>;
}

// ── classifyFuzzyPendingReview ────────────────────────────────────────────────
export async function classifyFuzzyPendingReview(
  exceptions:      FuzzyException[],
  bankRecordMap:   Map<string, { externalReference: string; amountPaise: number; transactionDate: string }>,
  startingHash:    string,
  tracer?:         FuzzyTracer
): Promise<{ classifications: LlmClassification[]; auditRows: LlmAuditRow[] }> {
  const { template, version } = getPromptTemplate();
  const classifications: LlmClassification[] = [];
  const auditRows:       AuditRow[]           = [];
  let currentHash = startingHash;

  for (const ex of exceptions) {
    const bank = bankRecordMap.get(ex.bankRecordId);
    const promptInput: PromptInput = {
      bankId:      ex.bankRecordId,
      bankRef:     bank?.externalReference ?? ex.bankRecordId,
      amountPaise: bank?.amountPaise ?? 0,
      date:        bank?.transactionDate ?? "",
      topCandidates: ex.candidateMetadata.topCandidates.slice(0, 3).map(c => ({
        id:               c.gatewayId,
        ref:              c.ref,
        amountPaise:      0, // not stored in fuzzy exception — use 0
        similarity:       c.similarity,
        amountDeltaPaise: 0,
      })),
      priorLayerSummary: `Layer 2a fuzzy match: top similarity ${ex.candidateMetadata.topCandidates[0]?.similarity?.toFixed(2) ?? "N/A"}. Status: PENDING_REVIEW.`,
    };

    const { classification, auditRow } = await classify(
      ex.exceptionId, ex.bankRecordId, promptInput, version, template, currentHash, tracer
    );
    classifications.push(classification);
    auditRows.push(auditRow);
    currentHash = auditRow.rowHash;
  }

  return { classifications, auditRows };
}

// ── classifySubsetSumAmbiguous ────────────────────────────────────────────────
export async function classifySubsetSumAmbiguous(
  exceptions:   SubsetSumException[],
  startingHash: string,
  tracer?:      FuzzyTracer
): Promise<{ classifications: LlmClassification[]; auditRows: LlmAuditRow[] }> {
  const { template, version } = getPromptTemplate();
  const classifications: LlmClassification[] = [];
  const auditRows:       AuditRow[]           = [];
  let currentHash = startingHash;

  for (const ex of exceptions) {
    const bankId  = ex.bankRecord.transactionRecordId;
    const top3Cands = ex.candidates.slice(0, 3);

    const topCandidates = top3Cands.flatMap((cand, ci) =>
      cand.gatewaySubset.slice(0, 2).map((gw, gi) => ({
        id:               gw.transactionRecordId,
        ref:              gw.externalReference,
        amountPaise:      gw.amountPaise,
        similarity:       undefined,
        amountDeltaPaise: Math.abs(gw.amountPaise - ex.bankRecord.amountPaise),
      }))
    ).slice(0, 3);

    const promptInput: PromptInput = {
      bankId,
      bankRef:     ex.bankRecord.externalReference,
      amountPaise: ex.bankRecord.amountPaise,
      date:        ex.bankRecord.transactionDate,
      topCandidates,
      priorLayerSummary: `Layer 2 subset-sum: ${ex.candidates.length} ambiguous candidate subsets, gap < 0.15 in similarity. Status: AMBIGUOUS_MATCH.`,
    };

    const exceptionId = `ss_ex_${bankId}`;
    const { classification, auditRow } = await classify(
      exceptionId, bankId, promptInput, version, template, currentHash, tracer
    );
    classifications.push(classification);
    auditRows.push(auditRow);
    currentHash = auditRow.rowHash;
  }

  return { classifications, auditRows };
}

export { MIN_CONFIDENCE_FOR_HYPOTHESIS };
