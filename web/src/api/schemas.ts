// web/src/api/schemas.ts — Zod validation schemas mirrored for the web frontend client.

import { z } from "zod";

// ── Shared Sub-Schemas ─────────────────────────────────────────────────────────

export const TransactionRecordSchema = z.object({
  transactionRecordId: z.string(),
  dataSource:          z.string(),
  externalReference:   z.string(),
  amountPaise:         z.number(),
  currencyCode:        z.string(),
  transactionDate:     z.string(),
  ingestedAt:          z.string(),
  rawDescription:      z.string(),
  rawPayload:          z.any().nullable().optional(),
  matchGroupId:        z.string().nullable().optional(),
});
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;

export const AuditTrailRowSchema = z.object({
  auditTrailId:        z.string(),
  decisionTimestamp:   z.string(),
  method:              z.string(),
  reason:              z.string(),
  actor:               z.string(),
  actorId:             z.string().nullable().optional(),
  transactionRecordId: z.string().nullable().optional(),
  matchGroupId:        z.string().nullable().optional(),
  metadata:            z.any().nullable().optional(),
  rowHash:             z.string(),
  previousRowHash:     z.string(),
});
export type AuditTrailRow = z.infer<typeof AuditTrailRowSchema>;

// ── GET /api/overview ─────────────────────────────────────────────────────────

export const OverviewResponseSchema = z.object({
  matchRateByMethod:       z.record(z.string(), z.number().nullable()),
  totalMatchRate:          z.number(),
  costOfUnmatchedCashPaise: z.number(),
  costOfUnmatchedCashInr:   z.string(),
  unmatchedCount:          z.number(),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

// ── GET /api/exceptions ───────────────────────────────────────────────────────

export const ExceptionItemSchema = z.object({
  unresolvedExceptionId: z.string(),
  classification:        z.string().nullable().optional(),
  rootCauseHypothesis:   z.string().nullable().optional(),
  riskScore:             z.number(),
  totalAmountPaise:      z.number(),
  isResolved:            z.boolean(),
  resolvedAt:            z.string().nullable().optional(),
  resolvedBy:            z.string().nullable().optional(),
  candidateMetadata:     z.any().nullable().optional(),
  transactionRecordIds:  z.array(z.string()),
  createdAt:             z.string(),
});
export type ExceptionItem = z.infer<typeof ExceptionItemSchema>;

export const ExceptionsListResponseSchema = z.object({
  exceptions: z.array(ExceptionItemSchema),
  total:      z.number(),
});
export type ExceptionsListResponse = z.infer<typeof ExceptionsListResponseSchema>;

// ── GET /api/exceptions/:id ───────────────────────────────────────────────────

export const ExceptionDetailResponseSchema = z.object({
  unresolvedExceptionId: z.string(),
  classification:        z.string().nullable().optional(),
  rootCauseHypothesis:   z.string().nullable().optional(),
  riskScore:             z.number(),
  totalAmountPaise:      z.number(),
  isResolved:            z.boolean(),
  resolvedAt:            z.string().nullable().optional(),
  resolvedBy:            z.string().nullable().optional(),
  candidateMetadata:     z.any().nullable().optional(),
  transactionRecordIds:  z.array(z.string()),
  transactions:          z.array(TransactionRecordSchema),
  createdAt:             z.string(),
});
export type ExceptionDetailResponse = z.infer<typeof ExceptionDetailResponseSchema>;

// ── POST /api/exceptions/:id/approve ──────────────────────────────────────────

export const ApproveExceptionRequestSchema = z.object({
  chosenCandidateIndex: z.number().int().min(0),
  actorId:              z.string().min(1),
});
export type ApproveExceptionRequest = z.infer<typeof ApproveExceptionRequestSchema>;

export const ApproveExceptionResponseSchema = z.object({
  matchGroupId: z.string(),
  status:       z.string(),
  auditTrailId: z.string(),
  message:      z.string(),
});
export type ApproveExceptionResponse = z.infer<typeof ApproveExceptionResponseSchema>;

// ── GET /api/match-groups/:id ─────────────────────────────────────────────────

export const MatchGroupDetailResponseSchema = z.object({
  matchGroupId:    z.string(),
  method:          z.string(),
  confidenceScore: z.number(),
  status:          z.string(),
  createdAt:       z.string(),
  resolvedAt:      z.string().nullable().optional(),
  transactions:    z.array(TransactionRecordSchema),
  auditTrail:      z.array(AuditTrailRowSchema),
});
export type MatchGroupDetailResponse = z.infer<typeof MatchGroupDetailResponseSchema>;

// ── GET /api/transactions/:id ─────────────────────────────────────────────────

export const TransactionDetailResponseSchema = z.object({
  transactionRecordId: z.string(),
  dataSource:          z.string(),
  externalReference:   z.string(),
  amountPaise:         z.number(),
  currencyCode:        z.string(),
  transactionDate:     z.string(),
  ingestedAt:          z.string(),
  rawDescription:      z.string(),
  rawPayload:          z.any().nullable().optional(),
  matchGroupId:        z.string().nullable().optional(),
  exceptionId:         z.string().nullable().optional(),
});
export type TransactionDetailResponse = z.infer<typeof TransactionDetailResponseSchema>;

// ── GET /api/transactions/:id/nearest-miss ───────────────────────────────────

export const NearestMissCandidateSchema = z.object({
  id:     z.string(),
  delta:  z.number(),
  score:  z.number(),
  reason: z.string(),
});
export type NearestMissCandidate = z.infer<typeof NearestMissCandidateSchema>;

export const NearestMissResponseSchema = z.object({
  candidates: z.array(NearestMissCandidateSchema),
});
export type NearestMissResponse = z.infer<typeof NearestMissResponseSchema>;

// ── POST /api/qa ──────────────────────────────────────────────────────────────

export const QaRequestSchema = z.object({
  question: z.string().min(1),
});
export type QaRequest = z.infer<typeof QaRequestSchema>;

export const QaResponseSchema = z.object({
  answer:                    z.string(),
  citedTransactionRecordIds: z.array(z.string()),
  auditTrailId:              z.string(),
  confidence:                z.number().optional(),
  toolCallsMade:             z.array(z.string()).optional(),
});
export type QaResponse = z.infer<typeof QaResponseSchema>;

// ── GET /api/example-bank ─────────────────────────────────────────────────────

export const ExampleBankCountResponseSchema = z.object({
  count: z.number(),
});
export type ExampleBankCountResponse = z.infer<typeof ExampleBankCountResponseSchema>;

export const ExampleBankItemSchema = z.object({
  exampleBankId:     z.string(),
  createdAt:         z.string(),
  exceptionSnapshot: z.record(z.any()),
  correctAction:     z.record(z.any()),
});
export type ExampleBankItem = z.infer<typeof ExampleBankItemSchema>;

export const ExampleBankListResponseSchema = z.object({
  examples: z.array(ExampleBankItemSchema),
  total:    z.number(),
});
export type ExampleBankListResponse = z.infer<typeof ExampleBankListResponseSchema>;

// ── GET /api/verify-chain ───────────────────────────────────────────────────

export const VerifyChainResponseSchema = z.object({
  ok:             z.boolean(),
  mainChainRows:  z.number(),
  sideChainRows:  z.number(),
  totalRows:      z.number(),
  status:         z.string(),
  verifiedAt:     z.string(),
  error:          z.string().optional(),
});
export type VerifyChainResponse = z.infer<typeof VerifyChainResponseSchema>;

// ── Error Response ────────────────────────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  error:     z.string(),
  requestId: z.string(),
  details:   z.any().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
