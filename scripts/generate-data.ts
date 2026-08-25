// Synthetic data generator for ReconIQ hackathon
// Produces 3 CSV files and ground truth mapping in the data/ directory

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Data generation utilities
const generateRecordIdentifier = () => `tx_${Math.random().toString(36).substring(2, 14)}`;
const generateRootReferenceToken = () => Math.random().toString(36).substring(2, 10).toUpperCase();
const generateAccountNumber = () => `acc_${Math.random().toString(36).substring(2, 14).toUpperCase()}`;
const generateInvoiceNumber = (root: string) => `ORD-${root}`;
const generateGatewayTransactionIdentifier = (root: string, suffix?: string | number) => suffix !== undefined ? `pay_${root}_${suffix}` : `pay_${root}`;
const generateBankReferenceIdentifier = (root: string) => `UTR${root}`;
const generateCustomerIdentifier = () => `cust_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
const generateProviderName = () => {
  const providers = ["STRIPE", "PAYPAL", "RAZORPAY", "SQUARE", "BRAINTREE"];
  return providers[Math.floor(Math.random() * providers.length)];
};

// Fee schedule constants
const FEE_SCHEDULE = {
  mdrPercentage: 0.020, // 2.0% MDR
  gstOnMdrPercentage: 0.18, // 18% GST on MDR
  tdsPercentage: 0.010 // 1.0% TDS
};

// Date utilities
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const generateRandomDate = (daysAgo: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
};

const generateRandomTimestamp = (daysAgo: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(Math.floor(Math.random() * 24));
  date.setMinutes(Math.floor(Math.random() * 60));
  date.setSeconds(Math.floor(Math.random() * 60));
  return date.toISOString();
};

const generatePaymentDescription = () => {
  const descriptions = [
    "ONLINE_SUBSCRIPTION_PURCHASE",
    "E_COMMERCE_ONE_TIME_SALE",
    "DIGITAL_GOODS_EBOOK_DOWNLOAD",
    "MONTHLY_SERVICE_SUBSCRIPTION",
    "ANNUAL_PREMIUM_UPGRADE",
    "REFUND_FOR_ORDER_INV_12345",
    "COMMUNITY_MEMBERSHIP_FEE",
    "CHARITABLE_DONATION",
    "SOFTWARE_LICENSE_RENEWAL",
    "PLATFORM_MAINTENANCE_FEE",
    "REFUNDED_CUSTOMER_REQUEST",
    "CHARGEBACK_CUSTOMER_DISPUTE"
  ];
  return descriptions[Math.floor(Math.random() * descriptions.length)];
};

// Corruption generator (~8% of references)
function applyReferenceCorruption(reference: string): [string, string] {
  const types = [
    "SINGLE_TRANSPOSITION",
    "CASE_CHANGE",
    "PREFIX_DROPPED",
    "WHITESPACE",
    "VISUALLY_CONFUSABLE"
  ];
  const type = types[Math.floor(Math.random() * types.length)];
  let corrupted = reference;

  switch (type) {
    case "SINGLE_TRANSPOSITION":
      if (corrupted.length > 3) {
        const idx = Math.floor(Math.random() * (corrupted.length - 1));
        const arr = corrupted.split('');
        const temp = arr[idx];
        arr[idx] = arr[idx + 1];
        arr[idx + 1] = temp;
        corrupted = arr.join('');
      }
      break;
    case "CASE_CHANGE":
      corrupted = Math.random() > 0.5 ? corrupted.toLowerCase() : corrupted.toUpperCase();
      break;
    case "PREFIX_DROPPED":
      if (corrupted.startsWith("UTR")) corrupted = corrupted.substring(3);
      else if (corrupted.startsWith("pay_")) corrupted = corrupted.substring(4);
      else if (corrupted.startsWith("ORD-")) corrupted = corrupted.substring(4);
      break;
    case "WHITESPACE":
      corrupted = ` ${corrupted} `;
      break;
    case "VISUALLY_CONFUSABLE":
      corrupted = corrupted
        .replace(/O/g, '0')
        .replace(/0/g, 'O')
        .replace(/I/g, '1')
        .replace(/l/g, '1')
        .replace(/S/g, '5')
        .replace(/5/g, 'S');
      break;
  }
  return [corrupted, type];
}

function generateSyntheticData() {
  console.log("Starting synthetic data generation with fixes for Defect 1-4...");

  const bankRecords: any[] = [];
  const gatewayRecords: any[] = [];
  const merchantRecords: any[] = [];
  const expectedMatches: any[] = [];

  let exactMatchesCount = 0;
  let manyToOneMatchesCount = 0;
  let feeMismatchCount = 0;
  let negativeRefundCount = 0;
  let pureExceptionsCount = 0;
  const corruptionCounts: Record<string, number> = {};

  const totalLogicalTransactions = 400;

  for (let i = 0; i < totalLogicalTransactions; i++) {
    const rootRef = generateRootReferenceToken();
    const baseDate = generateRandomDate(Math.floor(Math.random() * 45) + 5);
    const amountPaise = Math.floor(Math.random() * (4500000 - 100000 + 1)) + 100000; // ₹1,000 to ₹45,000

    // Determine settlement lag: T+1 to T+3 for bulk (~97%), T+7 to T+15 for timing lag (~3%)
    const isTimingLag = Math.random() < 0.03;
    const lagDays = isTimingLag ? Math.floor(Math.random() * 9) + 7 : Math.floor(Math.random() * 3) + 1;
    const settlementDate = addDays(baseDate, lagDays);

    // Determine case category
    const randCase = Math.random();
    let caseType = "EXACT_1_1";
    if (randCase < 0.35) {
      caseType = "EXACT_1_1";
    } else if (randCase < 0.60) {
      caseType = "MANY_TO_ONE";
    } else if (randCase < 0.75) {
      caseType = "FEE_MISMATCH";
    } else if (randCase < 0.88) {
      caseType = "NEGATIVE_REFUND";
    } else {
      caseType = "PURE_EXCEPTION";
    }

    // References with independent corruption check (~8%)
    let bankRef = generateBankReferenceIdentifier(rootRef);
    let gatewayRef = generateGatewayTransactionIdentifier(rootRef);
    const merchantRef = generateInvoiceNumber(rootRef);

    let corruptionType: string | null = null;
    if (Math.random() < 0.08 && caseType !== "PURE_EXCEPTION") {
      const [corrRef, cType] = applyReferenceCorruption(gatewayRef);
      gatewayRef = corrRef;
      corruptionType = cType;
      corruptionCounts[cType] = (corruptionCounts[cType] || 0) + 1;
    }

    if (Math.random() < 0.08 && caseType !== "PURE_EXCEPTION") {
      const [corrBank, cTypeBank] = applyReferenceCorruption(bankRef);
      bankRef = corrBank;
      corruptionCounts[`BANK_${cTypeBank}`] = (corruptionCounts[`BANK_${cTypeBank}`] || 0) + 1;
    }

    if (caseType === "PURE_EXCEPTION") {
      pureExceptionsCount++;
      const isBankOnly = Math.random() > 0.5;
      if (isBankOnly) {
        bankRecords.push({
          transactionRecordId: generateRecordIdentifier(),
          dataSource: "BANK_STATEMENT",
          externalReference: bankRef,
          amountPaise: amountPaise,
          currencyCode: "INR",
          transactionDate: baseDate,
          ingestedAt: generateRandomTimestamp(2),
          rawDescription: `BANK_CREDIT: ${amountPaise / 100} INR`,
          rawPayload: JSON.stringify({ sourceAccountNumber: generateAccountNumber() })
        });
      } else {
        gatewayRecords.push({
          transactionRecordId: generateRecordIdentifier(),
          dataSource: "GATEWAY_SETTLEMENT",
          externalReference: gatewayRef,
          amountPaise: amountPaise,
          currencyCode: "INR",
          transactionDate: settlementDate,
          ingestedAt: generateRandomTimestamp(2),
          rawDescription: `${generateProviderName()} PAYMENT: ${amountPaise / 100} INR`,
          rawPayload: JSON.stringify({ gatewayProvider: generateProviderName() })
        });
      }
      continue;
    }

    // Fee calculation logic
    let netBankAmount = amountPaise;
    if (caseType !== "EXACT_1_1") {
      const mdrAmount = amountPaise * FEE_SCHEDULE.mdrPercentage;
      const gstAmount = mdrAmount * FEE_SCHEDULE.gstOnMdrPercentage;
      const tdsAmount = amountPaise * FEE_SCHEDULE.tdsPercentage;
      const totalDeductions = Math.round(mdrAmount + gstAmount + tdsAmount);
      netBankAmount = amountPaise - totalDeductions;

      if (caseType === "FEE_MISMATCH") {
        feeMismatchCount++;
        netBankAmount += (Math.random() > 0.5 ? 500 : -500);
      }
    } else {
      exactMatchesCount++;
    }

    const bankTxId = generateRecordIdentifier();

    if (caseType === "MANY_TO_ONE") {
      manyToOneMatchesCount++;
      // Split amount into N gateway rows (N sampled 2..5)
      const nGateways = Math.floor(Math.random() * 4) + 2;
      const gatewayIds: string[] = [];
      let remainingGross = amountPaise;

      for (let g = 0; g < nGateways; g++) {
        const gtId = generateRecordIdentifier();
        gatewayIds.push(gtId);
        const partAmount = (g === nGateways - 1) ? remainingGross : Math.round(amountPaise / nGateways);
        remainingGross -= partAmount;

        const gRef = generateGatewayTransactionIdentifier(rootRef, g + 1);
        gatewayRecords.push({
          transactionRecordId: gtId,
          dataSource: "GATEWAY_SETTLEMENT",
          externalReference: gRef,
          amountPaise: partAmount,
          currencyCode: "INR",
          transactionDate: baseDate,
          ingestedAt: generateRandomTimestamp(1),
          rawDescription: `GATEWAY_SPLIT_SETTLEMENT: ${partAmount / 100} INR`,
          rawPayload: JSON.stringify({ reference: gRef })
        });

        merchantRecords.push({
          transactionRecordId: generateRecordIdentifier(),
          dataSource: "MERCHANT_LEDGER",
          externalReference: `${merchantRef}-${g + 1}`,
          amountPaise: partAmount,
          currencyCode: "INR",
          transactionDate: baseDate,
          ingestedAt: generateRandomTimestamp(1),
          rawDescription: `MERCHANT_LEDGER_SPLIT: ${partAmount / 100} INR`,
          rawPayload: JSON.stringify({ reference: `${merchantRef}-${g + 1}` })
        });
      }

      // Recalculate net bank amount for the whole sum
      const mdrAmount = amountPaise * FEE_SCHEDULE.mdrPercentage;
      const gstAmount = mdrAmount * FEE_SCHEDULE.gstOnMdrPercentage;
      const tdsAmount = amountPaise * FEE_SCHEDULE.tdsPercentage;
      netBankAmount = amountPaise - Math.round(mdrAmount + gstAmount + tdsAmount);

      bankRecords.push({
        transactionRecordId: bankTxId,
        dataSource: "BANK_STATEMENT",
        externalReference: bankRef,
        amountPaise: netBankAmount,
        currencyCode: "INR",
        transactionDate: settlementDate,
        ingestedAt: generateRandomTimestamp(1),
        rawDescription: `BANK_CREDIT_BUNDLE: ${netBankAmount / 100} INR`,
        rawPayload: JSON.stringify({ reference: bankRef })
      });

      expectedMatches.push({
        bankStatementRecordId: bankTxId,
        gatewaySettlementRecordIds: gatewayIds,
        gatewaySettlementRecordId: gatewayIds[0], // backward compat
        merchantLedgerRecordId: null,
        matchingAlgorithm: "SUBSET_SUM",
        confidenceScore: 0.95,
        expectedMatchedAt: new Date().toISOString(),
        caseType: caseType,
        classification: null,
        corruptionType: corruptionType,
        rootReferenceToken: rootRef,
        settlementLagDays: lagDays
      });
      continue;
    }

    if (caseType === "NEGATIVE_REFUND") {
      negativeRefundCount++;
      const posGatewayId = generateRecordIdentifier();
      const negGatewayId = generateRecordIdentifier();
      const refundAmount = -Math.round(amountPaise * 0.25);
      const grossSum = amountPaise + refundAmount;

      const mdrAmount = grossSum * FEE_SCHEDULE.mdrPercentage;
      const gstAmount = mdrAmount * FEE_SCHEDULE.gstOnMdrPercentage;
      const tdsAmount = grossSum * FEE_SCHEDULE.tdsPercentage;
      netBankAmount = grossSum - Math.round(mdrAmount + gstAmount + tdsAmount);

      gatewayRecords.push({
        transactionRecordId: posGatewayId,
        dataSource: "GATEWAY_SETTLEMENT",
        externalReference: gatewayRef,
        amountPaise: amountPaise,
        currencyCode: "INR",
        transactionDate: baseDate,
        ingestedAt: generateRandomTimestamp(1),
        rawDescription: `GATEWAY_SALE: ${amountPaise / 100} INR`,
        rawPayload: JSON.stringify({ reference: gatewayRef })
      });

      gatewayRecords.push({
        transactionRecordId: negGatewayId,
        dataSource: "GATEWAY_SETTLEMENT",
        externalReference: `${gatewayRef}-REF`,
        amountPaise: refundAmount,
        currencyCode: "INR",
        transactionDate: baseDate,
        ingestedAt: generateRandomTimestamp(1),
        rawDescription: `GATEWAY_REFUND: ${refundAmount / 100} INR`,
        rawPayload: JSON.stringify({ reference: `${gatewayRef}-REF` })
      });

      bankRecords.push({
        transactionRecordId: bankTxId,
        dataSource: "BANK_STATEMENT",
        externalReference: bankRef,
        amountPaise: netBankAmount,
        currencyCode: "INR",
        transactionDate: settlementDate,
        ingestedAt: generateRandomTimestamp(1),
        rawDescription: `BANK_CREDIT_NET_REFUND: ${netBankAmount / 100} INR`,
        rawPayload: JSON.stringify({ reference: bankRef })
      });

      merchantRecords.push({
        transactionRecordId: generateRecordIdentifier(),
        dataSource: "MERCHANT_LEDGER",
        externalReference: merchantRef,
        amountPaise: amountPaise,
        currencyCode: "INR",
        transactionDate: baseDate,
        ingestedAt: generateRandomTimestamp(1),
        rawDescription: `MERCHANT_INVOICE: ${amountPaise / 100} INR`,
        rawPayload: JSON.stringify({ reference: merchantRef })
      });

      expectedMatches.push({
        bankStatementRecordId: bankTxId,
        gatewaySettlementRecordIds: [posGatewayId, negGatewayId],
        gatewaySettlementRecordId: posGatewayId, // backward compat
        merchantLedgerRecordId: null,
        matchingAlgorithm: "SUBSET_SUM",
        confidenceScore: 0.94,
        expectedMatchedAt: new Date().toISOString(),
        caseType: caseType,
        classification: null,
        corruptionType: corruptionType,
        rootReferenceToken: rootRef,
        settlementLagDays: lagDays
      });
      continue;
    }

    // Default EXACT_1_1 or FEE_MISMATCH
    const gatewayTxId = generateRecordIdentifier();
    const merchantTxId = generateRecordIdentifier();

    bankRecords.push({
      transactionRecordId: bankTxId,
      dataSource: "BANK_STATEMENT",
      externalReference: bankRef,
      amountPaise: netBankAmount,
      currencyCode: "INR",
      transactionDate: settlementDate,
      ingestedAt: generateRandomTimestamp(1),
      rawDescription: `BANK_CREDIT: ${netBankAmount / 100} INR`,
      rawPayload: JSON.stringify({ reference: bankRef })
    });

    gatewayRecords.push({
      transactionRecordId: gatewayTxId,
      dataSource: "GATEWAY_SETTLEMENT",
      externalReference: gatewayRef,
      amountPaise: amountPaise,
      currencyCode: "INR",
      transactionDate: baseDate,
      ingestedAt: generateRandomTimestamp(1),
      rawDescription: `GATEWAY_SETTLEMENT: ${amountPaise / 100} INR`,
      rawPayload: JSON.stringify({ reference: gatewayRef })
    });

    merchantRecords.push({
      transactionRecordId: merchantTxId,
      dataSource: "MERCHANT_LEDGER",
      externalReference: merchantRef,
      amountPaise: amountPaise,
      currencyCode: "INR",
      transactionDate: baseDate,
      ingestedAt: generateRandomTimestamp(1),
      rawDescription: `MERCHANT_INVOICE: ${amountPaise / 100} INR`,
      rawPayload: JSON.stringify({ reference: merchantRef })
    });

    expectedMatches.push({
      bankStatementRecordId: bankTxId,
      gatewaySettlementRecordIds: [gatewayTxId],
      gatewaySettlementRecordId: gatewayTxId,
      merchantLedgerRecordId: merchantTxId,
      matchingAlgorithm: isTimingLag ? "AI_FUZZY" : "EXACT",
      confidenceScore: isTimingLag ? 0.88 : 0.99,
      expectedMatchedAt: new Date().toISOString(),
      caseType: caseType,
      classification: isTimingLag ? "TIMING_LAG" : null,
      corruptionType: corruptionType,
      rootReferenceToken: rootRef,
      settlementLagDays: lagDays
    });
  }

  const groundTruth = {
    version: "2.1",
    generatedAt: new Date().toISOString(),
    feeSchedule: FEE_SCHEDULE,
    totalExpectedMatches: expectedMatches.length,
    expectedMatches: expectedMatches
  };

  // Ensure data/ directory exists
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });

  // Write CSV helper (ensures matchGroupId is NOT present)
  function writeCsv(data: any[], filename: string) {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]).filter(h => h !== 'matchGroupId');
    const csvLines = [
      headers.map(h => `"${h}"`).join(','),
      ...data.map(row => headers.map(h => {
        const val = row[h] === null ? '' : String(row[h]);
        return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','))
    ];
    const path = join(process.cwd(), 'data', filename);
    writeFileSync(path, csvLines.join('\n'));
    console.log(`Generated data/${filename} with ${data.length} rows`);
  }

  writeCsv(bankRecords, 'bank_statement.csv');
  writeCsv(gatewayRecords, 'gateway_settlement.csv');
  writeCsv(merchantRecords, 'merchant_ledger.csv');

  const gtPath = join(process.cwd(), 'data', 'ground_truth.json');
  writeFileSync(gtPath, JSON.stringify(groundTruth, null, 2));
  console.log(`Generated data/ground_truth.json with ${expectedMatches.length} expected matches.`);

  // Verification checks & Summary metrics
  const actualBundlesProduced = expectedMatches.filter(m => m.caseType === "MANY_TO_ONE" && m.gatewaySettlementRecordIds && m.gatewaySettlementRecordIds.length > 1).length;
  const actualNegativeGatewayRows = gatewayRecords.filter(r => r.amountPaise < 0).length;

  // Grep check for matchGroupId in CSVs
  const { execSync } = require('child_process');
  const matchGroupGrep = execSync('grep -o "matchGroupId" data/*.csv | wc -l', { encoding: 'utf-8' }).trim();

  console.log("\n--- GENERATION SUMMARY ---");
  console.log(`- Bank Statement records:     ${bankRecords.length}`);
  console.log(`- Gateway Settlement records: ${gatewayRecords.length}`);
  console.log(`- Merchant Ledger records:    ${merchantRecords.length}`);
  console.log(`- Case Type Counts:`);
  console.log(`  * EXACT_1_1:         ${exactMatchesCount}`);
  console.log(`  * MANY_TO_ONE:       ${manyToOneMatchesCount}`);
  console.log(`  * FEE_MISMATCH:      ${feeMismatchCount}`);
  console.log(`  * NEGATIVE_REFUND:   ${negativeRefundCount}`);
  console.log(`  * PURE_EXCEPTION:    ${pureExceptionsCount}`);
  console.log(`- actual bundles produced: ${actualBundlesProduced}`);
  console.log(`- actual negative gateway rows: ${actualNegativeGatewayRows}`);
  console.log(`- matchGroupId occurrences in CSVs: ${matchGroupGrep}`);
  console.log(`- Fee Schedule Used:`, FEE_SCHEDULE);

  const sampleManyToOne = expectedMatches.find(m => m.caseType === "MANY_TO_ONE");
  if (sampleManyToOne) {
    console.log("\n--- SAMPLE MANY_TO_ONE GROUND-TRUTH ENTRY ---");
    console.log(JSON.stringify(sampleManyToOne, null, 2));
  }
}

generateSyntheticData();

export { generateSyntheticData };
