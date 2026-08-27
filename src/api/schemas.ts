// src/api/schemas.ts — Zod validation schemas for all ReconIQ API request and response payloads.

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
  rawPayload:          z.any().nullable(),
  matchGroupId:        z.string().nullable().optional(),
});

export const AuditTrailRowSchema = z.object({
  auditTrailId:        z.string(),
  decisionTimestamp:   z.string(),
  method:              z.string(),
  reason:              z.string(),
  actor:               z.string(),
  actorId:             z.string().nullable(),
  transactionRecordId: z.string().nullable(),
  matchGroupId:        z.string().nullable(),
  metadata:            z.any().nullable(),
  rowHash:             z.string(),
  previousRowHash:     z.string(),
});

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
  classification:        z.string().nullable(),
  rootCauseHypothesis:   z.string().nullable(),
  riskScore:             z.number(),
  totalAmountPaise:      z.number(),
  isResolved:            z.boolean(),
  resolvedAt:            z.string().nullable(),
  resolvedBy:            z.string().nullable(),
  candidateMetadata:     z.any().nullable(),
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
  classification:        z.string().nullable(),
  rootCauseHypothesis:   z.string().nullable(),
  riskScore:             z.number(),
  totalAmountPaise:      z.number(),
  isResolved:            z.boolean(),
  resolvedAt:            z.string().nullable(),
  resolvedBy:            z.string().nullable(),
  candidateMetadata:     z.any().nullable(),
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
  resolvedAt:      z.string().nullable(),
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
  rawPayload:          z.any().nullable(),
  matchGroupId:        z.string().nullable(),
  exceptionId:         z.string().nullable(),
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

// ── Error Response ────────────────────────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  error:     z.string(),
  requestId: z.string(),
  details:   z.any().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
