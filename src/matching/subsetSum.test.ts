import { test, expect } from "bun:test";
import {
  performSubsetSumMatching,
  calculateScore,
  getGatewayCandidates,
  TransactionRecord,
  SubsetSumConfig,
  SubsetSumCandidate
} from "./subsetSum";

// Helper function to build dummy TransactionRecords
function buildTx(
  id: string,
  dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER",
  amountPaise: number,
  dateStr: string
): TransactionRecord {
  const date = new Date(dateStr);
  return {
    transactionRecordId: id,
    dataSource,
    externalReference: `ref_${id}`,
    amountPaise,
    currencyCode: "INR",
    transactionDate: dateStr,
    transactionDateMs: date.getTime(),
    ingestedAt: new Date().toISOString(),
    rawDescription: "Test raw desc",
    rawPayload: "{}",
    matchGroupId: null
  };
}

const defaultConfig: SubsetSumConfig = {
  toleranceBasisPoints: 0,
  maxSubsetSize: 5,
  minSubsetSize: 2,
  dateWindowDays: 3,
  maxCandidatesToEnumerate: 5,
  minimumScoreGap: 0.1
};

test("Deterministic calculateScore: perfect amount, date, and subset size factors", () => {
  const bank = buildTx("bank_1", "BANK_STATEMENT", 1000000, "2026-08-20"); // ₹10,000
  const g1 = buildTx("g_1", "GATEWAY_SETTLEMENT", 400000, "2026-08-19");
  const g2 = buildTx("g_2", "GATEWAY_SETTLEMENT", 600000, "2026-08-19");

  const score = calculateScore(bank, [g1, g2], defaultConfig);

  expect(score.amountPrecision).toBe(1.0); // Exact summation hit
  expect(score.dateProximity).toBe(1 - 1 / 3); // Mean gap of 1 day / 3 days limit = 0.666667
  expect(score.subsetSizePenalty).toBe(0.5); // 1 / 2 size = 0.5
  expect(score.finalScore).toBeCloseTo(1.0 * (2/3) * 0.5, 5);
  expect(score.sortedIds).toEqual(["g_1", "g_2"]);
});

test("Deterministic tie-breaker test on lexicographical IDs", () => {
  const bank = buildTx("bank_1", "BANK_STATEMENT", 10000, "2026-08-20");
  const subA = [
    buildTx("b_first", "GATEWAY_SETTLEMENT", 5000, "2026-08-20"),
    buildTx("y_last", "GATEWAY_SETTLEMENT", 5000, "2026-08-20")
  ];
  const subB = [
    buildTx("c_first", "GATEWAY_SETTLEMENT", 5000, "2026-08-20"),
    buildTx("x_last", "GATEWAY_SETTLEMENT", 5000, "2026-08-20")
  ];

  const scoreA = calculateScore(bank, subA, defaultConfig);
  const scoreB = calculateScore(bank, subB, defaultConfig);

  expect(scoreA.finalScore).toEqual(scoreB.finalScore);
  // Deterministic tie-breaker check
  const aFirstId = scoreA.sortedIds.join("|");
  const bFirstId = scoreB.sortedIds.join("|");
  expect(aFirstId.localeCompare(bFirstId)).toBeLessThan(0); // "b_first|y_last" < "c_first|x_last"
});

test("Unambiguous 2-transaction bundle match contract", () => {
  const bank = [buildTx("bank_1", "BANK_STATEMENT", 1000000, "2026-08-20")]; // ₹10,000
  const gateways = [
    buildTx("g_1", "GATEWAY_SETTLEMENT", 400000, "2026-08-19"), // ₹4,000
    buildTx("g_2", "GATEWAY_SETTLEMENT", 600000, "2026-08-19")   // ₹6,000
  ];

  const result = performSubsetSumMatching(bank, gateways, [], defaultConfig);
  expect(result.matches.length).toBe(1);
  expect(result.matches[0].bankRecord.transactionRecordId).toBe("bank_1");
  expect(result.matches[0].gatewaySubset.map(g => g.transactionRecordId).sort()).toEqual(["g_1", "g_2"]);
});

test("Ambiguous subsets contract: smallest subset wins", () => {
  const bank = [buildTx("bank_1", "BANK_STATEMENT", 1000000, "2026-08-20")]; // ₹10,000
  const gateways = [
    buildTx("g_1", "GATEWAY_SETTLEMENT", 300000, "2026-08-19"), // ₹3,000
    buildTx("g_2", "GATEWAY_SETTLEMENT", 300000, "2026-08-19"), // ₹3,000
    buildTx("g_3", "GATEWAY_SETTLEMENT", 400000, "2026-08-19"), // ₹4,000
    buildTx("g_4", "GATEWAY_SETTLEMENT", 600000, "2026-08-19")  // ₹6,000
  ];

  const result = performSubsetSumMatching(bank, gateways, [], defaultConfig);
  expect(result.matches.length).toBe(1);
  expect(result.matches[0].gatewaySubset.map(g => g.transactionRecordId).sort()).toEqual(["g_3", "g_4"]);
});

test("Signed refund bundle matching contract", () => {
  const bank = [buildTx("bank_1", "BANK_STATEMENT", 700000, "2026-08-20")]; // ₹7,000 net
  const gateways = [
    buildTx("g_1", "GATEWAY_SETTLEMENT", 900000, "2026-08-19"),  // ₹9,000 credit
    buildTx("g_2", "GATEWAY_SETTLEMENT", -200000, "2026-08-19") // -₹2,000 refund/chargeback
  ];

  const result = performSubsetSumMatching(bank, gateways, [], defaultConfig);
  expect(result.matches.length).toBe(1);
  expect(result.matches[0].gatewaySubset.map(g => g.transactionRecordId).sort()).toEqual(["g_1", "g_2"]);
});

test("Pathological pre-filter complexity cap triggers bank record skip", () => {
  const bank = buildTx("bank_1", "BANK_STATEMENT", 500000, "2026-08-20");
  const gateways: TransactionRecord[] = [];
  for (let idx = 0; idx < 45; idx++) {
    gateways.push(buildTx(`g_${idx}`, "GATEWAY_SETTLEMENT", 100000, "2026-08-20"));
  }

  // maxSubsetSize = 5 -> complexity cap is 40. 45 gateways matches criteria.
  const candidates = getGatewayCandidates(bank, gateways, defaultConfig);
  expect(candidates).toEqual([]); // Pre-filter returns empty pool to enforce complexity cap
});