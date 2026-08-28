// fuzzyMatch.ts — Layer 2a fuzzy matching using char-trigram TF-IDF embeddings
// Disambiguates subset-sum AMBIGUOUS_MATCH exceptions and catches exact-residual typos.
// No API calls, no Postgres, no pgvector. Reads JSON/CSV, writes JSON.

import { readFileSync } from "fs";
import { join, resolve } from "path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { computeEmbedding, cosineSimilarity, normalizeReference } from "./embedding";

// ── Named thresholds (no magic numbers below) ─────────────────────────────────
const AUTO_COMMIT_SIMILARITY   = 0.85;
const EXCEPTION_FLOOR_SIMILARITY = 0.60;
const AMBIGUITY_GAP_THRESHOLD  = 0.15;
const AMOUNT_TOLERANCE_BP      = 400; // 4 % — matches fee-inference band

// ── Shared types ──────────────────────────────────────────────────────────────
export interface TransactionRecord {
  transactionRecordId: string;
  dataSource: string;
  externalReference: string;
  amountPaise: number;
  currencyCode: string;
  transactionDate: string;
  transactionDateMs: number;
  ingestedAt: string;
  rawDescription: string;
  rawPayload: string;
  matchGroupId: string | null;
}

export interface FuzzyMatchGroup {
  matchGroupId: string;
  method: "AI_FUZZY";
  confidenceScore: number;
  status: "MATCHED" | "PENDING_REVIEW";
  createdAt: string;
  resolvedAt: string | null;
  bankRecordId: string;
  gatewayRecordIds: string[];
}

export interface UnresolvedException {
  exceptionId: string;
  bankRecordId: string;
  exceptionType: "FUZZY_LOW_CONFIDENCE";
  isResolved: false;
  candidateMetadata: {
    topCandidates: Array<{ gatewayId: string; similarity: number; ref: string }>;
  };
}

export interface AuditRow {
  auditTrailId: string;
  decisionTimestamp: string;
  method: "AI_FUZZY";
  reason: string;
  actor: "SYSTEM";
  actorId: "fuzzyMatch.ts";
  transactionRecordId: string | null;
  matchGroupId: string | null;
  metadata: string;
  rowHash: string;
  previousRowHash: string;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────
const FuzzyMatchGroupSchema = z.object({
  matchGroupId:     z.string().min(1),
  method:           z.literal("AI_FUZZY"),
  confidenceScore:  z.number().min(0).max(1),
  status:           z.enum(["MATCHED", "PENDING_REVIEW"]),
  createdAt:        z.string().min(1),
  resolvedAt:       z.string().nullable(),
  bankRecordId:     z.string().min(1),
  gatewayRecordIds: z.array(z.string().min(1)).min(1),
});

const UnresolvedExceptionSchema = z.object({
  exceptionId:    z.string().min(1),
  bankRecordId:   z.string().min(1),
  exceptionType:  z.literal("FUZZY_LOW_CONFIDENCE"),
  isResolved:     z.literal(false),
  candidateMetadata: z.object({
    topCandidates: z.array(
      z.object({
        gatewayId:  z.string().min(1),
        similarity: z.number().min(0).max(1),
        ref:        z.string(),
      })
    ).min(1),
  }),
});

// ── Validation helpers ────────────────────────────────────────────────────────
function validateMatchGroup(proposal: unknown): FuzzyMatchGroup {
  const result = FuzzyMatchGroupSchema.safeParse(proposal);
  if (result.success) return result.data as FuzzyMatchGroup;
  // Retry once
  const retry = FuzzyMatchGroupSchema.safeParse(proposal);
  if (retry.success) return retry.data as FuzzyMatchGroup;
  throw new Error(
    `FuzzyMatchGroup validation failed twice: ${JSON.stringify(FuzzyMatchGroupSchema.safeParse(proposal).error?.issues)}`
  );
}

function validateException(proposal: unknown): UnresolvedException {
  const result = UnresolvedExceptionSchema.safeParse(proposal);
  if (result.success) return result.data as UnresolvedException;
  const retry = UnresolvedExceptionSchema.safeParse(proposal);
  if (retry.success) return retry.data as UnresolvedException;
  throw new Error(
    `UnresolvedException validation failed twice: ${JSON.stringify(UnresolvedExceptionSchema.safeParse(proposal).error?.issues)}`
  );
}

// ── ID generators ─────────────────────────────────────────────────────────────
function uid(): string {
  return `fz_${Math.random().toString(36).slice(2, 14)}`;
}

// ── Hash-chain helpers ────────────────────────────────────────────────────────
function computeRowHash(previousRowHash: string, row: Omit<AuditRow, "rowHash">): string {
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
  return createHash("sha256").update(previousRowHash + JSON.stringify(content), "utf8").digest("hex");
}

function makeAuditRow(
  opts: {
    reason: string;
    transactionRecordId: string | null;
    matchGroupId: string | null;
    similarity: number;
    embeddingDim: number;
    threshold: number;
    previousRowHash: string;
  }
): AuditRow {
  const ts = new Date().toISOString();
  const metadata = JSON.stringify({
    embeddingMethod: "char-trigram-tfidf",
    embeddingDim:    opts.embeddingDim,
    similarity:      opts.similarity,
    threshold:       opts.threshold,
    promptVersion:   null,
    modelId:         null,
  });

  const partial: Omit<AuditRow, "rowHash"> = {
    auditTrailId:        uid(),
    decisionTimestamp:   ts,
    method:              "AI_FUZZY",
    reason:              opts.reason,
    actor:               "SYSTEM",
    actorId:             "fuzzyMatch.ts",
    transactionRecordId: opts.transactionRecordId,
    matchGroupId:        opts.matchGroupId,
    metadata,
    previousRowHash:     opts.previousRowHash,
  };

  return { ...partial, rowHash: computeRowHash(opts.previousRowHash, partial) };
}

/**
 * Load the last rowHash from fee_inference_results.json (primary) or
 * fee_inference_audit_results.json, with fallback to subset_sum_results.json.
 */
export function loadStartingHash(): string {
  const GENESIS = "0".repeat(64);

  const feePath      = resolve(__dirname, "fee_inference_results.json");
  const feeAuditPath = resolve(__dirname, "fee_inference_audit_results.json");
  const subsetPath   = resolve(__dirname, "subset_sum_results.json");

  // 1. Try fee_inference_results.json
  try {
    const fi = JSON.parse(readFileSync(feePath, "utf-8"));
    const at: AuditRow[] = fi.auditTrail ?? [];
    if (at.length > 0) {
      return at[at.length - 1].rowHash;
    }
  } catch {}

  // 2. Try fee_inference_audit_results.json
  try {
    const fi = JSON.parse(readFileSync(feeAuditPath, "utf-8"));
    const at: AuditRow[] = fi.auditTrail ?? [];
    if (at.length > 0) {
      return at[at.length - 1].rowHash;
    }
  } catch {}

  // 3. Fallback to subset_sum_results.json
  try {
    const ss = JSON.parse(readFileSync(subsetPath, "utf-8"));
    const at: AuditRow[] = ss.auditTrail ?? [];
    if (at.length > 0) {
      return at[at.length - 1].rowHash;
    }
  } catch {}

  return GENESIS;
}

// ── Amount check ──────────────────────────────────────────────────────────────
function withinAmountTolerance(bankAmountPaise: number, gwAmountPaise: number): boolean {
  if (bankAmountPaise === 0) return gwAmountPaise === 0;
  const bpDiff = (Math.abs(bankAmountPaise - gwAmountPaise) / bankAmountPaise) * 10_000;
  return bpDiff <= AMOUNT_TOLERANCE_BP;
}

// ── resolveExactResiduals ─────────────────────────────────────────────────────
export interface ExactResidualResult {
  newMatches:    FuzzyMatchGroup[];
  newExceptions: UnresolvedException[];
  auditRows:     AuditRow[];
}

export function resolveExactResiduals(
  bankRecords:    TransactionRecord[],
  gatewayRecords: TransactionRecord[],
  claimedIds:     Set<string>,
  startingHash:   string
): ExactResidualResult {
  const newMatches:    FuzzyMatchGroup[]    = [];
  const newExceptions: UnresolvedException[] = [];
  const auditRows:     AuditRow[]           = [];

  let currentHash = startingHash;
  const locallyClaimedGatewayIds = new Set<string>();

  const unclaimed = bankRecords.filter(b => !claimedIds.has(b.transactionRecordId));
  const availableGateways = gatewayRecords.filter(
    g => !claimedIds.has(g.transactionRecordId)
  );

  for (const bank of unclaimed) {
    const bankEmb = computeEmbedding(normalizeReference(bank.externalReference));
    const embDim  = bankEmb.size;

    // Score all available gateway records (excluding already locally committed ones)
    const candidates = availableGateways
      .filter(g => !locallyClaimedGatewayIds.has(g.transactionRecordId))
      .filter(g => withinAmountTolerance(bank.amountPaise, g.amountPaise))
      .map(g => ({
        record: g,
        score:  cosineSimilarity(bankEmb, computeEmbedding(normalizeReference(g.externalReference))),
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) continue;

    const top = candidates[0];

    if (top.score >= AUTO_COMMIT_SIMILARITY) {
      // Auto-commit as MATCHED
      const matchGroupId = uid();
      const proposal: FuzzyMatchGroup = {
        matchGroupId,
        method:           "AI_FUZZY",
        confidenceScore:  top.score,
        status:           "MATCHED",
        createdAt:        new Date().toISOString(),
        resolvedAt:       new Date().toISOString(),
        bankRecordId:     bank.transactionRecordId,
        gatewayRecordIds: [top.record.transactionRecordId],
      };
      const validated = validateMatchGroup(proposal);
      newMatches.push(validated);
      locallyClaimedGatewayIds.add(top.record.transactionRecordId);

      const row = makeAuditRow({
        reason:              `AI_FUZZY AUTO_COMMIT: bank=${bank.transactionRecordId} gateway=${top.record.transactionRecordId} sim=${top.score.toFixed(4)}`,
        transactionRecordId: bank.transactionRecordId,
        matchGroupId,
        similarity:          top.score,
        embeddingDim:        embDim,
        threshold:           AUTO_COMMIT_SIMILARITY,
        previousRowHash:     currentHash,
      });
      auditRows.push(row);
      currentHash = row.rowHash;

    } else if (top.score >= EXCEPTION_FLOOR_SIMILARITY) {
      // Pending review + emit exception with top-3
      const matchGroupId = uid();
      const proposal: FuzzyMatchGroup = {
        matchGroupId,
        method:           "AI_FUZZY",
        confidenceScore:  top.score,
        status:           "PENDING_REVIEW",
        createdAt:        new Date().toISOString(),
        resolvedAt:       null,
        bankRecordId:     bank.transactionRecordId,
        gatewayRecordIds: [top.record.transactionRecordId],
      };
      const validatedMatch = validateMatchGroup(proposal);
      newMatches.push(validatedMatch);

      const top3 = candidates.slice(0, 3).map(c => ({
        gatewayId:  c.record.transactionRecordId,
        similarity: c.score,
        ref:        c.record.externalReference,
      }));
      const exceptionProposal: UnresolvedException = {
        exceptionId:   uid(),
        bankRecordId:  bank.transactionRecordId,
        exceptionType: "FUZZY_LOW_CONFIDENCE",
        isResolved:    false,
        candidateMetadata: { topCandidates: top3 },
      };
      const validatedEx = validateException(exceptionProposal);
      newExceptions.push(validatedEx);

      const row = makeAuditRow({
        reason:              `AI_FUZZY PENDING_REVIEW: bank=${bank.transactionRecordId} top_sim=${top.score.toFixed(4)}`,
        transactionRecordId: bank.transactionRecordId,
        matchGroupId,
        similarity:          top.score,
        embeddingDim:        embDim,
        threshold:           EXCEPTION_FLOOR_SIMILARITY,
        previousRowHash:     currentHash,
      });
      auditRows.push(row);
      currentHash = row.rowHash;
    }
    // Below floor: skip silently — no audit row (no decision made)
  }

  return { newMatches, newExceptions, auditRows };
}

// ── disambiguateSubsetSumExceptions ──────────────────────────────────────────
export interface SubsetSumException {
  bankRecord: TransactionRecord;
  candidates: Array<{
    bankRecord:    TransactionRecord;
    gatewaySubset: TransactionRecord[];
    score:         unknown;
  }>;
}

export interface DisambiguateResult {
  resolvedCount:      number;
  stillAmbiguousCount: number;
  resolvedMatches:    FuzzyMatchGroup[];
  auditRows:          AuditRow[];
}

export function disambiguateSubsetSumExceptions(
  exceptions:   SubsetSumException[],
  startingHash: string
): DisambiguateResult {
  const resolvedMatches: FuzzyMatchGroup[] = [];
  const auditRows:       AuditRow[]        = [];
  let resolvedCount      = 0;
  let stillAmbiguousCount = 0;
  let currentHash        = startingHash;

  for (const ex of exceptions) {
    const bankRef  = normalizeReference(ex.bankRecord.externalReference);
    const bankEmb  = computeEmbedding(bankRef);
    const embDim   = bankEmb.size;

    // Score each candidate subset by mean cosine similarity of bank vs all gateway refs in subset
    const scored = ex.candidates.map(cand => {
      if (cand.gatewaySubset.length === 0) return { cand, meanSim: 0 };
      let total = 0;
      for (const gw of cand.gatewaySubset) {
        total += cosineSimilarity(bankEmb, computeEmbedding(normalizeReference(gw.externalReference)));
      }
      return { cand, meanSim: total / cand.gatewaySubset.length };
    }).sort((a, b) => b.meanSim - a.meanSim);

    if (scored.length === 0) {
      stillAmbiguousCount++;
      continue;
    }

    const rank1 = scored[0];
    const rank2 = scored.length > 1 ? scored[1] : null;
    const gap   = rank2 !== null ? rank1.meanSim - rank2.meanSim : 1.0;

    if (gap >= AMBIGUITY_GAP_THRESHOLD) {
      // Disambiguated — promote to MATCHED
      const matchGroupId = uid();
      const gatewayIds   = rank1.cand.gatewaySubset.map(g => g.transactionRecordId);
      const proposal: FuzzyMatchGroup = {
        matchGroupId,
        method:           "AI_FUZZY",
        confidenceScore:  rank1.meanSim,
        status:           "MATCHED",
        createdAt:        new Date().toISOString(),
        resolvedAt:       new Date().toISOString(),
        bankRecordId:     ex.bankRecord.transactionRecordId,
        gatewayRecordIds: gatewayIds,
      };
      const validated = validateMatchGroup(proposal);
      resolvedMatches.push(validated);
      resolvedCount++;

      const row = makeAuditRow({
        reason:              `AI_FUZZY DISAMBIGUATE: bank=${ex.bankRecord.transactionRecordId} gap=${gap.toFixed(4)} meanSim=${rank1.meanSim.toFixed(4)} gateways=${gatewayIds.join(",")}`,
        transactionRecordId: ex.bankRecord.transactionRecordId,
        matchGroupId,
        similarity:          rank1.meanSim,
        embeddingDim:        embDim,
        threshold:           AMBIGUITY_GAP_THRESHOLD,
        previousRowHash:     currentHash,
      });
      auditRows.push(row);
      currentHash = row.rowHash;
    } else {
      stillAmbiguousCount++;
    }
  }

  return { resolvedCount, stillAmbiguousCount, resolvedMatches, auditRows };
}

// Re-export constants so runFuzzyMatch.ts can log them
export { AUTO_COMMIT_SIMILARITY, EXCEPTION_FLOOR_SIMILARITY, AMBIGUITY_GAP_THRESHOLD, AMOUNT_TOLERANCE_BP };
