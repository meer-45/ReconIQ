// Subset-sum matching layer for ReconIQ payment reconciliation engine
// Matches bank records with groups of gateway transactions whose raw amounts sum to the bank payout
// Uses bounded backtracking (DFS) to enumerate subsets up to maxSubsetSize
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
  matchGroupId: string | null; // Set by exact.ts matcher; null if unmatched
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
  minSubsetSize: number; // Minimum gateway transactions in a bundle (>=2)
  dateWindowDays: number; // ±N days window
  maxCandidatesToEnumerate: number;
  minimumScoreGap: number; // For separating ambiguous subsets
  netFactor?: number; // Optional fee adjustment: expected net = gross * netFactor. Defaults to 1.0 (no fee)
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

export interface PendingException {
  bankRecord: TransactionRecord;
  candidates: SubsetSumCandidate[]; // All candidates that were considered (for metadata)
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
  const bankDateMs = bankRecord.transactionDateMs;
  const windowMs = config.dateWindowDays * 24 * 3600 * 1000;
  const pool = gatewayPool.filter(g => {
    const diffMs = Math.abs(bankDateMs - g.transactionDateMs);
    const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
    return diffDays <= config.dateWindowDays;
  });

  const cap = config.maxSubsetSize * 40;
  if (pool.length > cap) {
    console.warn(`[SKIP] Pre-filter pool size (${pool.length}) for bank record ${bankRecord.transactionRecordId} exceeded max complexity limit (${cap}). Skipping.`);
    console.warn(`[POOL-SKIP] bank=${bankRecord.transactionRecordId} pool=${pool.length} > cap=${cap}`);
    return [];
  }

  // Sort pool deterministically (Date asc, then ID asc)
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
  const bankDateMs = bankRecord.transactionDateMs;

  let pool: TransactionRecord[] = [];
  for (const [dateMs, records] of buckets.entries()) {
    const diffMs = Math.abs(bankDateMs - dateMs);
    const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
    if (diffDays <= config.dateWindowDays) {
      pool.push(...records);
    }
  }

  const cap = config.maxSubsetSize * 40;
  if (pool.length > cap) {
    return [];
  }

  // Sort pool deterministically (Date asc, then ID asc)
  pool.sort((a, b) => {
    if (a.transactionDateMs !== b.transactionDateMs) return a.transactionDateMs - b.transactionDateMs;
    return a.transactionRecordId.localeCompare(b.transactionRecordId);
  });

  return pool;
}

/**
 * Deterministic scoring engine for subset candidates.
 * Uses the raw amounts of gateways (no fee conversion) to compare against the bank's amount.
 */
export function calculateScore(
  bank: TransactionRecord,
  gatewaySubset: TransactionRecord[],
  config: SubsetSumConfig
): CandidateScore {
  // Compute raw sum of gateway amounts (no fee conversion)
  const gatewaySum = gatewaySubset.reduce((sum, g) => sum + g.amountPaise, 0);
  const netFactor = config.netFactor ?? 1.0;
  const adjustedSum = gatewaySum * netFactor;

  // Amount precision: step-with-decay if inside tolerance
  const tolerancePercent = config.toleranceBasisPoints / 10000;
  const toleranceBand = Math.abs(bank.amountPaise) * tolerancePercent;
  const diff = Math.abs(bank.amountPaise - adjustedSum);
  let amountPrecision = 0.0;

  if (toleranceBand > 0) {
    if (diff <= toleranceBand) {
      amountPrecision = 1.0 - (diff / toleranceBand) * 0.2;
    } else {
      amountPrecision = 0.0;
    }
  } else {
    amountPrecision = bank.amountPaise === adjustedSum ? 1.0 : 0.0;
  }
  amountPrecision = Math.max(0, Math.min(1, amountPrecision));

  // Date proximity: 1 - (mean absolute date-gap in days between bank and each subset member) / dateWindowDays
  let totalGapMs = 0;
  gatewaySubset.forEach(g => {
    totalGapMs += Math.abs(bank.transactionDateMs - g.transactionDateMs);
  });
  const meanGapDays = gatewaySubset.length > 0 ? (totalGapMs / gatewaySubset.length) / (24 * 3600 * 1000) : 0;
  let dateProximity = 1 - meanGapDays / config.dateWindowDays;
  dateProximity = Math.max(0, Math.min(1, dateProximity));

  // Subset size penalty: 1 / subsetSize
  const subsetSizePenalty = gatewaySubset.length > 0 ? 1 / gatewaySubset.length : 0;

  // Final score (rounded to 6 decimal places for stable equality comparison)
  const scoreProduct = amountPrecision * dateProximity * subsetSizePenalty;
  const finalScore = parseFloat(scoreProduct.toFixed(6));

  // Sorted ID array for stable, deterministic lexicographical tie-breakers
  const sortedIds = gatewaySubset.map(g => g.transactionRecordId).sort();

  return {
    amountPrecision,
    dateProximity,
    subsetSizePenalty,
    finalScore,
    sortedIds
  };
}

/**
 * Recursive backtracking to find all subsets of gateways that sum to the bank amount within tolerance.
 * Works with raw amounts of gateways (no fee conversion) for amount comparison.
 * @param bank The bank transaction to match.
 * @param origPool Original gateway transactions (sorted by date, then ID).
 * @param start Index to start considering (to avoid recomputing permutations).
 * @param currentOrig Current subset of original gateways.
 * @param currentSum Current sum of raw amounts.
 * @param results Accumulator for valid subsets found.
 * @param config Configuration.
 */
function findCandidatesForBank(
  bank: TransactionRecord,
  origPool: TransactionRecord[],
  start: number,
  currentOrig: TransactionRecord[],
  currentSum: number,
  results: SubsetSumCandidate[],
  config: SubsetSumConfig
): void {
  // Check if current subset is a valid candidate
  const subsetSize = currentOrig.length;
  if (subsetSize >= config.minSubsetSize && subsetSize <= config.maxSubsetSize) {
    const tolerancePercent = config.toleranceBasisPoints / 10000;
    const netFactor = config.netFactor ?? 1.0;
    const adjustedSum = currentSum * netFactor;
    const toleranceBand = Math.abs(bank.amountPaise) * tolerancePercent;
    let inTolerance = false;
    if (toleranceBand > 0) {
      inTolerance = Math.abs(bank.amountPaise - adjustedSum) <= toleranceBand;
    } else {
      inTolerance = bank.amountPaise === adjustedSum;
    }
    if (inTolerance) {
      results.push({
        bankRecord: bank,
        gatewaySubset: [...currentOrig],
        score: calculateScore(bank, currentOrig, config)
      });
    }
  }

  // Stop if we've reached the max subset size or examined all candidates
  if (subsetSize >= config.maxSubsetSize || start >= origPool.length) {
    return;
  }

  // Stop if we've already found enough candidates (to avoid exponential explosion)
  if (results.length >= config.maxCandidatesToEnumerate) {
    return;
  }

  // Try each remaining candidate
  for (let i = start; i < origPool.length; i++) {
    currentOrig.push(origPool[i]);
    currentSum += origPool[i].amountPaise;
    findCandidatesForBank(bank, origPool, i + 1, currentOrig, currentSum, results, config);
    currentOrig.pop();
    currentSum -= origPool[i].amountPaise;
  }
}

/**
 * Core subset-sum matching engine.
 * Returns matches and exceptions (ambiguous cases).
 */
export function performSubsetSumMatching(
  bankRecords: TransactionRecord[],
  gatewayRecords: TransactionRecord[],
  merchantRecords: TransactionRecord[],
  config: SubsetSumConfig
): { matches: SubsetSumCandidate[]; exceptions: PendingException[] } {
  const matches: SubsetSumCandidate[] = [];
  const exceptions: PendingException[] = [];

  // We only consider bank records that are unmatched by exact.ts
  const unmatchedBanks = bankRecords.filter(bank => bank.matchGroupId === null);
  // We only consider gateway records that are unmatched by exact.ts
  const unmatchedGateways = gatewayRecords.filter(gw => gw.matchGroupId === null);
  // Merchant ledger records are not used in subset-sum matching (they are 1:1 with bank in exact.ts)
  // but we keep the argument for interface compatibility.

  // Build date buckets for efficient lookup (using original gateways)
  const gatewayBuckets = bucketGatewaysByDate(unmatchedGateways);

  for (const bank of unmatchedBanks) {
    // Get candidate gateways within date window (original records)
    const origPool = getGatewayCandidatesBucketed(bank, gatewayBuckets, config);
    if (origPool.length === 0) {
      continue; // No candidates, skip
    }

    // Find all valid subsets via bounded backtracking
    const rawCandidates: SubsetSumCandidate[] = [];
    findCandidatesForBank(bank, origPool, 0, [], 0, rawCandidates, config);

    if (rawCandidates.length === 0) {
      continue; // No valid subsets, skip
    }

    // Sort by finalScore descending, then by sortedIds ascending (lexicographic)
    rawCandidates.sort((a, b) => {
      if (a.score.finalScore !== b.score.finalScore) {
        return b.score.finalScore - a.score.finalScore; // descending
      }
      // Tie-breaker: compare sortedIds arrays lexicographically
      for (let i = 0; i < a.score.sortedIds.length; i++) {
        if (a.score.sortedIds[i] !== b.score.sortedIds[i]) {
          return a.score.sortedIds[i].localeCompare(b.score.sortedIds[i]);
        }
      }
      return 0;
    });

    // Keep top-5 by score for downstream decision; full enumeration only affects sorting
    const topN = rawCandidates.slice(0, 5);

    const topCandidate = topN[0];
    const secondBest = topN[1];

    // Determine if we have a clear winner
    const isClearWinner =
      rawCandidates.length === 1 ||
      (secondBest && (topCandidate.score.finalScore - secondBest.score.finalScore) >= config.minimumScoreGap);

    if (isClearWinner) {
      // Commit this match
      matches.push(topCandidate);
    } else {
      // Ambiguous case: create an exception
      exceptions.push({
        bankRecord: bank,
        candidates: rawCandidates
      });
    }
  }

  return { matches, exceptions };
}