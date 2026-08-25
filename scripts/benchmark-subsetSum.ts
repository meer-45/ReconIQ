// Benchmark script for subset-sum pre-filter and DP performance across scaling tiers

import {
  getGatewayCandidatesBucketed,
  bucketGatewaysByDate,
  performSubsetSumMatching,
  TransactionRecord,
  SubsetSumConfig
} from "../src/matching/subsetSum";

const defaultConfig: SubsetSumConfig = {
  toleranceBasisPoints: 400,
  maxSubsetSize: 5,
  dateWindowDays: 3,
  maxCandidatesToEnumerate: 10,
  minimumScoreGap: 0.1
};

function generateBenchmarkData(scale: number): {
  bankRecords: TransactionRecord[];
  gatewayRecords: TransactionRecord[];
} {
  const bankRecords: TransactionRecord[] = [];
  const gatewayRecords: TransactionRecord[] = [];
  const baseDate = new Date("2026-08-01");

  for (let i = 0; i < scale; i++) {
    const bankDate = new Date(baseDate);
    bankDate.setDate(bankDate.getDate() + (i % 30));
    const bankDateStr = bankDate.toISOString().split('T')[0];
    const bankAmount = Math.floor(Math.random() * 4900000) + 100000;

    bankRecords.push({
      transactionRecordId: `bank_${i}`,
      dataSource: "BANK_STATEMENT",
      externalReference: `UTR_${i}`,
      amountPaise: Math.round(bankAmount * 0.9663),
      currencyCode: "INR",
      transactionDate: bankDateStr,
      transactionDateMs: bankDate.getTime(),
      ingestedAt: bankDateStr,
      rawDescription: "Bank raw",
      rawPayload: "{}",
      matchGroupId: null
    });

    const nGateways = Math.floor(Math.random() * 4) + 2;
    for (let g = 0; g < nGateways; g++) {
      const gDate = new Date(bankDate);
      gDate.setDate(gDate.getDate() + (Math.floor(Math.random() * 7) - 3));
      const gDateStr = gDate.toISOString().split('T')[0];

      gatewayRecords.push({
        transactionRecordId: `gtw_${i}_${g}`,
        dataSource: "GATEWAY_SETTLEMENT",
        externalReference: `pay_${i}_${g}`,
        amountPaise: Math.round(bankAmount / nGateways),
        currencyCode: "INR",
        transactionDate: gDateStr,
        transactionDateMs: gDate.getTime(),
        ingestedAt: gDateStr,
        rawDescription: "Gateway raw",
        rawPayload: "{}",
        matchGroupId: null
      });
    }
  }

  return { bankRecords, gatewayRecords };
}

async function runBenchmark() {
  console.log("==========================================================================");
  console.log("          ReconIQ Subset-Sum Engine Benchmark (Scales: 1k, 5k, 10k)        ");
  console.log("==========================================================================\n");

  const scales = [1000, 5000, 10000];
  const resultsTable: Array<{
    "Scale (Records)": string;
    "Pre-Filter Pool Time (ms)": string;
    "Full DP Call Time (ms)": string;
    "DP Execution Status": string;
  }> = [];

  for (const scale of scales) {
    const { bankRecords, gatewayRecords } = generateBenchmarkData(scale);

    // Build buckets ONCE
    const buckets = bucketGatewaysByDate(gatewayRecords);

    // 1. Benchmark Bucketed Pre-filter
    const startPreFilter = performance.now();
    bankRecords.forEach(bank => {
      getGatewayCandidatesBucketed(bank, buckets, defaultConfig);
    });
    const preFilterMs = performance.now() - startPreFilter;

    // 2. Benchmark Full DP Call
    let dpMs = 0;
    let dpStatus = "COMPLETED";
    const startDP = performance.now();

    try {
      performSubsetSumMatching(bankRecords, gatewayRecords, [], defaultConfig);
      dpMs = performance.now() - startDP;
    } catch (err: any) {
      dpMs = performance.now() - startDP;
      if (err.message.includes("NOT IMPLEMENTED")) {
        dpStatus = "CAUGHT_UNIMPLEMENTED_THROW";
      } else {
        dpStatus = `ERROR: ${err.message}`;
      }
    }

    resultsTable.push({
      "Scale (Records)": `${scale.toLocaleString()} txns`,
      "Pre-Filter Pool Time (ms)": `${preFilterMs.toFixed(2)} ms`,
      "Full DP Call Time (ms)": `${dpMs.toFixed(2)} ms`,
      "DP Execution Status": dpStatus
    });
  }

  console.table(resultsTable);
}

runBenchmark().catch(console.error);
