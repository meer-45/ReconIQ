// Subset-sum matching layer for ReconIQ payment reconciliation engine
// Matches bank records with groups of gateway transactions whose amounts sum to the bank payout
// Incorporates deterministic scoring and rigorous pre-filtering complexity caps

import { createHash } from 'node:crypto';

// Types mirroring the Prisma Schema and Exact Match shapes
export interface TransactionRecord {
  transactionRecordId: string;
  dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER";
  externalReference: string;
  amountPaise: number;
  currencyCode: string;
  transactionDate: string; // ISO date string YYYY-MM-DD
  transactionDateMs: number; // Unix ms epoch for O(1) date math
  ingestedAt: string;
  rawDescription: string;
  rawPayload: string; // JSON string
  matchGroupId: string | null;
}

export interface MatchGroup {
  matchGroupId: string;
  method: "SUBSET_SUM";
  confidenceScore: number;
  status: "MATCHED" | "PENDING_REVIEW" | "REJECTED";
  createdAt: string;
  resolvedAt: string | null;
  runId: string | null;
}

export interface AuditTrail {
  auditTrailId: string;
  decisionTimestamp: string;
  method: "SUBSET_SUM";
  reason: string;
  actor: "SYSTEM" | "AI" | "HUMAN";
  actorId: string | null;
  transactionRecordId: string | null;
  matchGroupId: string | null;
  metadata: string | null;
  rowHash: string;
  previousRowHash: string;
}

export interface SubsetSumConfig {
  toleranceBasisPoints: number; // e.g., 100 basis points = 1%
  maxSubsetSize: number; // Maximum gateway transactions in a single bundle
  dateWindowDays: number; // ±N days window
  maxCandidatesToEnumerate: number;
  minimumScoreGap: number; // For separating ambiguous subsets
}

export interface SubsetSumCandidate {
  bankRecord: TransactionRecord;
  gatewaySubset: TransactionRecord[];
  score: CandidateScore;
}

export interface CandidateScore {
  amountPrecision: number;
  dateProximity: number;
  subsetSizePenalty: number;
  finalScore: number;
  sortedIds: string[];
}

/**
 * Pre-filters unmatched gateway records for a given bank statement record.
 *
 * - Enforces complexity cap of maxSubsetSize * 8 to prevent combinatorial explosion.
 * - Sorts pool by transactionDate ascending, then lexicographically by transactionRecordId ascending.
 */
export function getGatewayCandidates(
  bankRecord: TransactionRecord,
  gatewayPool: TransactionRecord[],
  config: SubsetSumConfig
): TransactionRecord[] {
  const windowMs = config.dateWindowDays * 24 * 3600 * 1000;
  const pool = gatewayPool.filter(g => {
    const diffMs = Math.abs(bankRecord.transactionDateMs - g.transactionDateMs);
    return diffMs <= windowMs;
  });

  const cap = config.maxSubsetSize * 8;
  if (pool.length > cap) {
    console.warn(`[SKIP] Pre-filter pool size (${pool.length}) for bank record ${bankRecord.transactionRecordId} exceeded max complexity limit (${cap}). Skipping.`);
    return [];
  }

  pool.sort((a, b) => {
    if (a.transactionDateMs !== b.transactionDateMs) return a.transactionDateMs - b.transactionDateMs;
    return a.transactionRecordId.localeCompare(b.transactionRecordId);
  });

  return pool;
}

export function bucketGatewaysByDate(
  gatewayPool: TransactionRecord[]
): Map<number, TransactionRecord[]> {
  const buckets = new Map<number, TransactionRecord[]>();
  for (const record of gatewayPool) {
    let list = buckets.get(record.transactionDateMs);
    if (!list) {
      list = [];
      buckets.set(record.transactionDateMs, list);
    }
    list.push(record);
  }
  return buckets;
}

export function getGatewayCandidatesBucketed(
  bankRecord: TransactionRecord,
  buckets: Map<number, TransactionRecord[]>,
  config: SubsetSumConfig
): TransactionRecord[] {
  const windowMs = config.dateWindowDays * 24 * 3600 * 1000;
  const minMs = bankRecord.transactionDateMs - windowMs;
  const maxMs = bankRecord.transactionDateMs + windowMs;

  let pool: TransactionRecord[] = [];
  for (const [dateMs, records] of buckets.entries()) {
    if (dateMs >= minMs && dateMs <= maxMs) {
      pool.push(...records);
    }
  }

  const cap = config.maxSubsetSize * 8;
  if (pool.length > cap) {
    return [];
  }

  pool.sort((a, b) => {
    if (a.transactionDateMs !== b.transactionDateMs) return a.transactionDateMs - b.transactionDateMs;
    return a.transactionRecordId.localeCompare(b.transactionRecordId);
  });

  return pool;
}

/**
 * Deterministic scoring engine for subset candidates.
 */
export function calculateScore(
  bank: TransactionRecord,
  gatewaySubset: TransactionRecord[],
  config: SubsetSumConfig
): CandidateScore {
  const subsetSumPaise = gatewaySubset.reduce((sum, g) => sum + g.amountPaise, 0);

  const tolerancePercent = config.toleranceBasisPoints / 10000;
  const toleranceBand = Math.abs(bank.amountPaise) * tolerancePercent;
  let amountPrecision = 1.0;
  if (toleranceBand > 0) {
    amountPrecision = 1 - Math.abs(bank.amountPaise - subsetSumPaise) / toleranceBand;
  } else {
    amountPrecision = bank.amountPaise === subsetSumPaise ? 1.0 : 0.0;
  }
  amountPrecision = Math.max(0, Math.min(1, amountPrecision));

  let totalGapMs = 0;
  gatewaySubset.forEach(g => {
    totalGapMs += Math.abs(bank.transactionDateMs - g.transactionDateMs);
  });
  const meanGapDays = gatewaySubset.length > 0 ? (totalGapMs / gatewaySubset.length) / (24 * 3600 * 1000) : 0;
  let dateProximity = 1 - meanGapDays / config.dateWindowDays;
  dateProximity = Math.max(0, Math.min(1, dateProximity));

  const subsetSizePenalty = gatewaySubset.length > 0 ? 1 / gatewaySubset.length : 0;
  const scoreProduct = amountPrecision * dateProximity * subsetSizePenalty;
  const finalScore = parseFloat(scoreProduct.toFixed(6));
  const sortedIds = gatewaySubset.map(g => g.transactionRecordId).sort();

  return {
    amountPrecision,
    dateProximity,
    subsetSizePenalty,
    finalScore,
    sortedIds
  };
}

export function performSubsetSumMatching(
  bankRecords: TransactionRecord[],
  gatewayRecords: TransactionRecord[],
  merchantRecords: TransactionRecord[],
  config: SubsetSumConfig
): SubsetSumCandidate[] {
  throw new Error("NOT IMPLEMENTED — Meer writes this");
}
