// metricsSchema.ts — Zod schemas for the ReconIQ metrics report.
// Every field has a comment explaining what it measures and how it is computed.

import { z } from "zod";

// ── Per-method row ─────────────────────────────────────────────────────────────
export const MethodMetricsSchema = z.object({
  method: z.enum(["EXACT", "SUBSET_SUM", "FEE_INFERENCE", "AI_FUZZY", "AI_CLASSIFIED"]),

  /** Number of bank records where this method produced a committed match.
   *  FEE_INFERENCE = training-pair count (regression, not a direct match engine).
   *  AI_FUZZY      = PENDING_REVIEW proposals (not yet committed by a human).
   *  AI_CLASSIFIED = 0 (hypothesis-only — never auto-commits). */
  matchedBankRecords: z.number().int().nonnegative(),

  /** Number of unique gateway records involved in those matches. */
  matchedGatewayRecords: z.number().int().nonnegative(),

  /** Precision = TP / (TP + FP).
   *  Computed using pair-key intersection with ground_truth.json expectedMatches.
   *  null when the method has no committed pairs to evaluate (AI_CLASSIFIED). */
  precision: z.number().min(0).max(1).nullable(),

  /** Recall = TP / (TP + FN) = TP / |GT for this method|.
   *  null for methods without a discrete GT set. */
  recall: z.number().min(0).max(1).nullable(),

  /** True positives — GT pair keys that also appear in this method's output. */
  truePositives: z.number().int().nonnegative().nullable(),

  /** GT entries that target this method (denominator for recall). */
  gtTargetCount: z.number().int().nonnegative().nullable(),

  /** Human-readable note about data-alignment caveats, e.g. stale result files. */
  note: z.string().optional(),
});

export type MethodMetrics = z.infer<typeof MethodMetricsSchema>;

// ── LLM classification breakdown (AI_CLASSIFIED supplemental detail) ──────────
export const LlmBreakdownSchema = z.object({
  totalHypotheses:       z.number().int().nonnegative(),
  DUPLICATE:             z.number().int().nonnegative(),
  MISSING_COUNTERPART:   z.number().int().nonnegative(),
  TIMING_LAG:            z.number().int().nonnegative(),
  OTHER:                 z.number().int().nonnegative(),
  avgConfidence:         z.number().min(0).max(1),
  lowConfidenceCount:    z.number().int().nonnegative(), // confidence < 0.5
  cacheHits:             z.number().int().nonnegative(),
  apiCalls:              z.number().int().nonnegative(),
  promptVersion:         z.string(),
  wasIncomplete:         z.boolean(),
});

export type LlmBreakdown = z.infer<typeof LlmBreakdownSchema>;

// ── Unmatched-cash section ─────────────────────────────────────────────────────
export const UnmatchedCashSchema = z.object({
  /** Count of bank records with no committed or proposed match. */
  unmatchedBankRecords: z.number().int().nonnegative(),

  /** Total bank records in current bank_statement.csv. */
  totalBankRecords: z.number().int().nonnegative(),

  /** Sum of |amountPaise| across unmatched bank records. */
  unmatchedAmountPaise: z.number().nonnegative(),

  /** Same, formatted as "₹X,XXX.XX". */
  unmatchedAmountFormatted: z.string(),

  /** Fraction of total bank-side volume that is unmatched (by amount). */
  unmatchedAmountFraction: z.number().min(0).max(1),
});

export type UnmatchedCash = z.infer<typeof UnmatchedCashSchema>;

// ── Top-level report ───────────────────────────────────────────────────────────
export const MetricsReportSchema = z.object({
  generatedAt:   z.string().datetime(),
  dataSourceNote: z.string(),

  /** Per-method metrics rows, in pipeline order. */
  methods: z.array(MethodMetricsSchema),

  llmBreakdown: LlmBreakdownSchema,

  /** Fraction of bank records that have at least one committed or proposed match
   *  from any layer. Numerator excludes AI_CLASSIFIED (hypothesis-only). */
  totalMatchRate: z.number().min(0).max(1),

  /** Total bank records in the current CSV (denominator for match rate). */
  totalBankRecords: z.number().int().nonnegative(),

  unmatchedCash: UnmatchedCashSchema,

  /** Ground truth totals from ground_truth.json. */
  groundTruth: z.object({
    totalExpectedMatches: z.number().int().nonnegative(),
    byAlgorithm: z.record(z.number().int().nonnegative()),
    byCaseType:  z.record(z.number().int().nonnegative()),
  }),
});

export type MetricsReport = z.infer<typeof MetricsReportSchema>;
