// Synthetic data generator for ReconIQ hackathon
// Produces 3 CSV files and ground truth mapping with enterprise-grade data
// Simulates realistic payment reconciliation scenarios across bank statements, gateway settlements, and merchant ledger entries

import { writeFileSync } from "fs";
import { join } from "path";

// Data generation utilities for enterprise naming conventions
const generateRecordIdentifier = () => `tx_${Math.random().toString(36).substring(2, 14)}`;
const generateReferenceCode = () => `ref_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
const generateAccountNumber = () => `acc_${Math.random().toString(36).substring(2, 14).toUpperCase()}`;
const generateInvoiceNumber = () => `inv_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
const generateGatewayTransactionIdentifier = () => `gtx_${Math.random().toString(36).substring(2, 14).toUpperCase()}`;
const generateProductServiceIdentifier = () => `prod_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
const generateCustomerIdentifier = () => `cust_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
const generateProviderName = () => {
  const providers = ["STRIPE", "PAYPAL", "RAZORPAY", "SQUARE", "BRAINTREE"];
  return providers[Math.floor(Math.random() * providers.length)];
};
const generateTransactionStatus = () => {
  const statuses = ["SUCCESS", "FAILED", "PENDING", "REFUNDED", "PARTIALLY_REFUNDED"];
  return statuses[Math.floor(Math.random() * statuses.length)];
};
const generateMatchingAlgorithm = () => {
  const algorithms = ["EXACT", "SUBSET_SUM", "AI_FUZZY", "AI_CLASSIFIED", "MANUAL"];
  return algorithms[Math.floor(Math.random() * algorithms.length)];
};
const generateActorType = () => {
  const actors = ["SYSTEM", "AI", "HUMAN"];
  return actors[Math.floor(Math.random() * actors.length)];
};
const generateExceptionClassification = () => {
  const classifications = ["DUPLICATE", "MISSING_COUNTERPART", "TIMING_LAG", "OTHER"];
  return classifications[Math.floor(Math.random() * classifications.length)];
};
const generateRiskAssessment = () => Number((Math.random() * 100 / 100).toFixed(2)); // 0.00 to 1.00
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

// Generate Bank Statement records (500-600 rows)
function generateBankStatementRecords() {
  const bankStatementRecords = [];
  const numberOfBankRecords = 550;

  for (let recordIndex = 0; recordIndex < numberOfBankRecords; recordIndex++) {
    const isReconciled = Math.random() > 0.3; // 70% reconciled, 30% unresolved
    const amountInPaise = Math.floor(Math.random() * (5000000 - 100000 + 1)) + 100000; // ₹1,000 to ₹50,000
    const transactionDate = generateRandomDate(Math.floor(Math.random() * 60)); // Last 60 days
    const externalReferenceCode = generateReferenceCode();
    const rawDescription = `BANK_CREDIT: ${amountInPaise / 100} INR - ${generatePaymentDescription()}`;

    const bankStatementRecord = {
      transactionRecordId: generateRecordIdentifier(),
      dataSource: "BANK_STATEMENT",
      externalReference: externalReferenceCode,
      amountPaise: amountInPaise,
      currencyCode: "INR",
      transactionDate: transactionDate,
      ingestedAt: generateRandomTimestamp(Math.floor(Math.random() * 10)),
      rawDescription: rawDescription,
      rawPayload: JSON.stringify({
        sourceAccountNumber: generateAccountNumber(),
        destinationAccountNumber: "DEST_ACC_12345",
        clearingCode: "CLG_001",
        settlementMethod: "AUTO",
        sourceBank: "HDFC",
        swiftCode: "HDFCINBB"
      }),
      matchGroupId: null,
      unresolvedExceptionIds: []
    };

    bankStatementRecords.push(bankStatementRecord);
  }

  return bankStatementRecords;
}

// Generate Gateway Settlement records (500-600 rows)
function generateGatewaySettlementRecords() {
  const gatewaySettlementRecords = [];
  const numberOfGatewayRecords = 550;

  for (let recordIndex = 0; recordIndex < numberOfGatewayRecords; recordIndex++) {
    const status = generateTransactionStatus();
    // Some records should have negative amounts (refunds/chargebacks)
    const isRefund = Math.random() > 0.8; // 20% chance of refund/chargeback
    const baseAmountInPaise = Math.floor(Math.random() * (2000000 - 50000 + 1)) + 50000;
    const amountInPaise = isRefund ? -Math.floor(baseAmountInPaise * Math.random()) : baseAmountInPaise; // ₹500 to ₹20,000, sometimes negative
    const gatewayFeeInPaise = isRefund ? Math.floor(Math.abs(amountInPaise) * 0.029) : Math.floor(amountInPaise * 0.029);
    const netAmountInPaise = amountInPaise - gatewayFeeInPaise;

    const settlementDate = generateRandomDate(Math.floor(Math.random() * 60));
    const isReconciled = Math.random() > 0.25; // 75% reconciled, 25% unresolved

    const hasTypo = Math.random() > 0.95;
    const externalReferenceCode = hasTypo ?
      `${generateGatewayTransactionIdentifier()}X` :
      generateGatewayTransactionIdentifier();

    const gatewaySettlementRecord = {
      transactionRecordId: generateRecordIdentifier(),
      dataSource: "GATEWAY_SETTLEMENT",
      externalReference: externalReferenceCode,
      amountPaise: amountInPaise,
      currencyCode: "INR",
      transactionDate: settlementDate,
      ingestedAt: generateRandomTimestamp(Math.floor(Math.random() * 10)),
      rawDescription: `${generateProviderName()} ${isRefund ? 'REFUND' : 'PAYMENT'}: ${Math.abs(amountInPaise) / 100} INR - ${generatePaymentDescription()}`,
      rawPayload: JSON.stringify({
        merchantIdentifier: generateRecordIdentifier(),
        gatewayProvider: generateProviderName(),
        gatewayAccountIdentifier: generateRecordIdentifier(),
        cardLast4Digits: `${Math.floor(Math.random() * 9000) + 1000}`,
        status: status
      }),
      matchGroupId: null,
      unresolvedExceptionIds: []
    };

    gatewaySettlementRecords.push(gatewaySettlementRecord);
  }

  return gatewaySettlementRecords;
}

// Generate Merchant Ledger records (500-600 rows)
function generateMerchantLedgerRecords() {
  const merchantLedgerRecords = [];
  const numberOfLedgerRecords = 550;

  for (let recordIndex = 0; recordIndex < numberOfLedgerRecords; recordIndex++) {
    const amountInPaise = Math.floor(Math.random() * (2000000 - 50000 + 1)) + 50000;
    const commissionRateInPaise = Math.floor(amountInPaise * 0.03);
    const netAmountInPaise = amountInPaise - commissionRateInPaise;

    const entryDate = generateRandomDate(Math.floor(Math.random() * 60));
    const isReconciled = Math.random() > 0.3;

    const hasFeeMismatch = Math.random() > 0.9;
    const discrepancyReason = hasFeeMismatch ? "GATEWAY_FEE_ADJUSTMENT" : null;

    const merchantLedgerRecord = {
      transactionRecordId: generateRecordIdentifier(),
      dataSource: "MERCHANT_LEDGER",
      externalReference: generateInvoiceNumber(),
      amountPaise: amountInPaise,
      currencyCode: "INR",
      transactionDate: entryDate,
      ingestedAt: generateRandomTimestamp(Math.floor(Math.random() * 10)),
      rawDescription: `MERCHANT_LEDGER: ${amountInPaise / 100} INR - ${generatePaymentDescription()}`,
      rawPayload: JSON.stringify({
        merchantIdentifier: "MERCHANT_001",
        customerIdentifier: generateCustomerIdentifier(),
        productServiceIdentifier: generateProductServiceIdentifier(),
        description: generatePaymentDescription(),
        referenceNumber: generateReferenceCode(),
        commissionRateInPaise: commissionRateInPaise
      }),
      matchGroupId: null,
      unresolvedExceptionIds: []
    };

    merchantLedgerRecords.push(merchantLedgerRecord);
  }

  return merchantLedgerRecords;
}

// Create three categories of matches: many-to-one (SUBSET_SUM), 1:1 exact (EXACT), and reserve unmatched
function createMatchGroups(bankStatementRecords: any[], gatewaySettlementRecords: any[], merchantLedgerRecords: any[]) {
  // Shuffle arrays to randomize selection
  const shuffledBankRecords = [...bankStatementRecords].sort(() => 0.5 - Math.random());
  const shuffledGatewayRecords = [...gatewaySettlementRecords].sort(() => 0.5 - Math.random());
  const shuffledMerchantLedgerRecords = [...merchantLedgerRecords].sort(() => 0.5 - Math.random());

  const usedGatewayRecords = new Set(); // Track which gateway records have been used in matches
  const usedMerchantLedgerRecords = new Set(); // Track which merchant ledger records have been used in matches
  let exactMatchesCreated = 0;
  let manyToOneMatchesCreated = 0;

  // Reserve 35-40% of bank records for 1:1 exact matches
  const targetExactMatches = Math.floor(bankStatementRecords.length * 0.375); // 37.5% of bank records for exact matches

  for (let i = 0; i < targetExactMatches; i++) {
    // Find an unused gateway record FIRST (not the other way around)
    const availableGatewayRecords = shuffledGatewayRecords.filter(record =>
      !usedGatewayRecords.has(record.transactionRecordId)
    );

    if (availableGatewayRecords.length === 0) break; // No more unused gateways

    // Pick a random unused gateway record
    const selectedGateway = availableGatewayRecords[
      Math.floor(Math.random() * availableGatewayRecords.length)
    ];

    // Find an unmatched bank record from the existing pool
    const availableBankRecords = bankStatementRecords.filter(record =>
      !record.matchGroupId
    );

    if (availableBankRecords.length === 0) break; // No more unmatched bank records

    // Pick a random unmatched bank record
    const selectedBankRecord = availableBankRecords[
      Math.floor(Math.random() * availableBankRecords.length)
    ];

    // Set the bank record's amount to match the gateway exactly (same as many-to-one logic)
    selectedBankRecord.amountPaise = selectedGateway.amountPaise;

    // Assign the matchGroupId to both records
    const matchGroupId = generateRecordIdentifier();
    selectedBankRecord.matchGroupId = matchGroupId;
    selectedGateway.matchGroupId = matchGroupId;
    usedGatewayRecords.add(selectedGateway.transactionRecordId);

    exactMatchesCreated++;
  }

  // Process remaining bank records for many-to-one bundles (approximately 25% of total)
  const remainingBankRecords = bankStatementRecords.filter(record => !record.matchGroupId);
  const targetManyToOneMatches = Math.floor(bankStatementRecords.length * 0.25); // 25% of bank records for many-to-one

  for (let i = 0; i < targetManyToOneMatches && i < remainingBankRecords.length; i++) {
    const bankRecord = remainingBankRecords[i];
    if (!bankRecord.matchGroupId) {
      // Select 2-6 gateway settlement records to bundle into this match
      const numberOfGatewayRecords = Math.floor(Math.random() * 5) + 2; // 2-6 records
      const availableGatewayRecords = shuffledGatewayRecords.filter(record =>
        !usedGatewayRecords.has(record.transactionRecordId) &&
        record.transactionRecordId !== bankRecord.transactionRecordId
      );

      if (availableGatewayRecords.length >= numberOfGatewayRecords) {
        const selectedGatewayRecords = availableGatewayRecords.slice(0, numberOfGatewayRecords);

        // Calculate the sum of selected gateway records (including their fees)
        const gatewaySum = selectedGatewayRecords.reduce((sum, record) => sum + record.amountPaise, 0);
        const totalGatewayFees = Math.floor(Math.abs(gatewaySum) * 0.03); // Assume ~3% total fee
        const targetBankAmount = gatewaySum + totalGatewayFees;

        // Set the bank record's amount to match the gateway sum (plus fees)
        bankRecord.amountPaise = targetBankAmount;

        // Assign the matchGroupId to all matched records
        const matchGroupId = generateRecordIdentifier();
        bankRecord.matchGroupId = matchGroupId;
        selectedGatewayRecords.forEach(gatewayRecord => {
          gatewayRecord.matchGroupId = matchGroupId;
          usedGatewayRecords.add(gatewayRecord.transactionRecordId);
        });

        // For roughly half of the match groups, also include a merchant ledger record
        if (Math.random() > 0.5) {
          const availableMerchantRecords = shuffledMerchantLedgerRecords.filter(record =>
            !usedMerchantLedgerRecords.has(record.transactionRecordId) &&
            record.transactionRecordId !== bankRecord.transactionRecordId &&
            !selectedGatewayRecords.some(gateway => gateway.transactionRecordId === record.transactionRecordId)
          );

          if (availableMerchantRecords.length > 0) {
            const selectedMerchantRecord = availableMerchantRecords[0];
            selectedMerchantRecord.matchGroupId = matchGroupId;
            usedMerchantLedgerRecords.add(selectedMerchantRecord.transactionRecordId);
          }
        }

        manyToOneMatchesCreated++;
      }
    }
  }

  return {
    exactMatchesCreated,
    manyToOneMatchesCreated,
    usedGatewayRecords,
    usedMerchantLedgerRecords
  };
}

// Generate Audit Trail entries for reconciliation decisions
function generateAuditTrailEntries(bankStatementRecords: any[], gatewaySettlementRecords: any[], merchantLedgerRecords: any[]) {
  const auditTrailEntries = [];

  // Create decisions for reconciled bank statement records
  const reconciledBankRecords = bankStatementRecords.filter(record => record.matchGroupId);
  reconciledBankRecords.forEach((record, index) => {
    for (let decisionCount = 0; decisionCount < Math.floor(Math.random() * 3) + 1; decisionCount++) {
      const method = record.matchGroupId ? "EXACT" : generateMatchingAlgorithm();
      const auditTrailEntry = {
        auditTrailId: generateRecordIdentifier(),
        decisionTimestamp: generateRandomTimestamp(Math.floor(Math.random() * 10)),
        method: method,
        reason: method === "EXACT" ? "Exact amount and date match" : `Automatic reconciliation using ${method} method`,
        actor: generateActorType(),
        actorIdentifier: generateRecordIdentifier(),
        transactionRecordId: record.transactionRecordId,
        matchGroupId: record.matchGroupId,
        metadata: JSON.stringify({
          confidenceScore: generateRiskAssessment(),
          ruleApplied: method === "EXACT" ? "amount_and_date_exact_match" : "amount_and_date_match"
        })
      };
      auditTrailEntries.push(auditTrailEntry);
    }
  });

  // Create decisions for reconciled gateway settlement records
  const reconciledGatewayRecords = gatewaySettlementRecords.filter(record => record.matchGroupId);
  reconciledGatewayRecords.forEach((record, index) => {
    for (let decisionCount = 0; decisionCount < Math.floor(Math.random() * 2) + 1; decisionCount++) {
      const method = record.matchGroupId ? "EXACT" : generateMatchingAlgorithm();
      const auditTrailEntry = {
        auditTrailId: generateRecordIdentifier(),
        decisionTimestamp: generateRandomTimestamp(Math.floor(Math.random() * 10)),
        method: method,
        reason: record.amountPaise < 0 ? "Refund/chargeback matching" : `Exact ${record.matchGroupId ? "EXACT" : generateMatchingAlgorithm()} match`,
        actor: generateActorType(),
        actorIdentifier: generateRecordIdentifier(),
        transactionRecordId: record.transactionRecordId,
        matchGroupId: record.matchGroupId,
        metadata: JSON.stringify({
          gatewayFeeInPaise: Math.floor(Math.abs(record.amountPaise) * 0.029),
          netAmount: record.amountPaise - Math.floor(Math.abs(record.amountPaise) * 0.029)
        })
      };
      auditTrailEntries.push(auditTrailEntry);
    }
  });

  return auditTrailEntries;
}

// Generate Unresolved Exception entries for unmatched/invalid records
function generateUnresolvedExceptions(bankStatementRecords: any[], gatewaySettlementRecords: any[], merchantLedgerRecords: any[]) {
  const unresolvedExceptions = [];

  // Create unmatched residual exceptions for bank statement records
  const unmatchedBankRecords = bankStatementRecords.filter(record => !record.matchGroupId);
  unmatchedBankRecords.forEach((record, index) => {
    if (index < 50) {
      const exception = {
        unresolvedExceptionId: generateRecordIdentifier(),
        createdAt: generateRandomTimestamp(Math.floor(Math.random() * 10)),
        classification: generateExceptionClassification(),
        rootCauseHypothesis: `Unable to find counterpart for ${record.dataSource} transaction with reference ${record.externalReference}`,
        riskScore: generateRiskAssessment(),
        isResolved: false,
        resolvedAt: null,
        resolvedBy: null,
        transactionRecordId: record.transactionRecordId,
        expectedAmountPaise: 0
      };
      unresolvedExceptions.push(exception);
    }
  });

  // Create data quality exceptions for all record sources (ONLY for unmatched records)
  const allUnmatchedRecords = [
    ...bankStatementRecords.filter(r => !r.matchGroupId).map(record => ({ ...record, sourceType: "BankStatement" as const })),
    ...gatewaySettlementRecords.filter(r => !r.matchGroupId).map(record => ({ ...record, sourceType: "GatewaySettlement" as const })),
    ...merchantLedgerRecords.filter(r => !r.matchGroupId).map(record => ({ ...record, sourceType: "MerchantLedgerEntry" as const }))
  ];

  for (let exceptionIndex = 0; exceptionIndex < Math.floor(allUnmatchedRecords.length * 0.2); exceptionIndex++) {
    const randomRecord = allUnmatchedRecords[Math.floor(Math.random() * allUnmatchedRecords.length)];
    const exceptionClassification = generateExceptionClassification();

    const exception = {
      unresolvedExceptionId: generateRecordIdentifier(),
      createdAt: generateRandomTimestamp(Math.floor(Math.random() * 10)),
      classification: exceptionClassification,
      rootCauseHypothesis: exceptionClassification === "DUPLICATE" ? `Duplicate entry detected for ${randomRecord.sourceType}` :
                           exceptionClassification === "MISSING_COUNTERPART" ? `Counterpart transaction missing for ${randomRecord.sourceType}` :
                           `Data quality issue in ${randomRecord.sourceType}`,
      riskScore: generateRiskAssessment(),
      isResolved: false,
      resolvedAt: null,
      resolvedBy: null,
      transactionRecordId: randomRecord.transactionRecordId,
      expectedAmountPaise: randomRecord.amountPaise
    };
    unresolvedExceptions.push(exception);
  }

  return unresolvedExceptions;
}

// Generate ground truth mapping for expected matches
function generateGroundTruth(bankStatementRecords: any[], gatewaySettlementRecords: any[], merchantLedgerRecords: any[]) {
  const groundTruth = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    totalExpectedMatches: 0,
    expectedMatches: []
  };

  // Create simulated matches based on grouping
  const processedMatchGroups = new Set();

  bankStatementRecords.forEach(bankRecord => {
    if (bankRecord.matchGroupId && !processedMatchGroups.has(bankRecord.matchGroupId)) {
      const matchGroupId = bankRecord.matchGroupId;
      processedMatchGroups.add(matchGroupId);

      // Find all gateway settlement records in this match group
      const gatewayRecordsInGroup = gatewaySettlementRecords.filter(gs => gs.matchGroupId === matchGroupId);

      // Find merchant ledger record if it exists in this match group
      const merchantRecordInGroup = merchantLedgerRecords.find(ml => ml.matchGroupId === matchGroupId);

      // Determine matching algorithm
      const matchingAlgorithm = gatewayRecordsInGroup.length === 1 ? "EXACT" : "SUBSET_SUM";

      // Create ground truth entry for each gateway record in the group
      gatewayRecordsInGroup.forEach(gatewayRecord => {
        const expectedMatch = {
          bankStatementRecordId: bankRecord.transactionRecordId,
          gatewaySettlementRecordId: gatewayRecord.transactionRecordId,
          merchantLedgerRecordId: merchantRecordInGroup?.transactionRecordId || null,
          matchingAlgorithm: matchingAlgorithm,
          confidenceScore: matchingAlgorithm === "EXACT" ? 0.99 : 0.95,
          expectedMatchedAt: bankRecord.ingestedAt
        };

        groundTruth.expectedMatches.push(expectedMatch);
        groundTruth.totalExpectedMatches++;
      });
    }
  });

  return groundTruth;
}

// Strip internal-only fields before CSV export
function prepareForCsvExport<T extends Record<string, any>>(data: T[]): T[] {
  return data.map(record => {
    const { matchGroupId, unresolvedExceptionIds, ...csvSafeRecord } = record;
    return csvSafeRecord;
  });
}

// Write CSV files with proper escaping
function writeCsvFile<T extends Record<string, any>>(data: T[], filename: string): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const escapedHeaders = headers.map(header => header.replace(/"/g, '""'));
  const csvContent = [
    escapedHeaders.map(header => `"${header}"`).join(','),
    ...data.map(row => {
      return headers.map(header => {
        const value = row[header];
        const stringValue = String(value);

        if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    })
  ].join('\n');

  const path = join(process.cwd(), 'scripts', filename);
  writeFileSync(path, csvContent);
  console.log(`Generated ${filename} with ${data.length} rows`);
}

// Main function to generate all data files
function main() {
  console.log("Starting synthetic data generation for ReconIQ hackathon...");

  // Step 1: Generate all raw transaction records independently
  const bankStatementRecords = generateBankStatementRecords();
  const gatewaySettlementRecords = generateGatewaySettlementRecords();
  const merchantLedgerRecords = generateMerchantLedgerRecords();

  // Step 2: Create three categories of match groups
  const { exactMatchesCreated, manyToOneMatchesCreated, usedGatewayRecords, usedMerchantLedgerRecords } = createMatchGroups(
    bankStatementRecords, gatewaySettlementRecords, merchantLedgerRecords
  );

  // Step 3: Generate audit trail and exception data
  const auditTrailEntries = generateAuditTrailEntries(bankStatementRecords, gatewaySettlementRecords, merchantLedgerRecords);
  const unresolvedExceptions = generateUnresolvedExceptions(bankStatementRecords, gatewaySettlementRecords, merchantLedgerRecords);

  // Step 4: Generate ground truth based on the created match groups
  const groundTruth = generateGroundTruth(bankStatementRecords, gatewaySettlementRecords, merchantLedgerRecords);

  // Step 5: Prepare CSV files (strip internal-only fields)
  const bankCsvData = prepareForCsvExport(bankStatementRecords);
  const gatewayCsvData = prepareForCsvExport(gatewaySettlementRecords);
  const merchantCsvData = prepareForCsvExport(merchantLedgerRecords);

  // Step 6: Write all files
  writeCsvFile(bankCsvData, 'bank_statement.csv');
  writeCsvFile(gatewayCsvData, 'gateway_settlement.csv');
  writeCsvFile(merchantCsvData, 'merchant_ledger.csv');

  const auditTrailPath = join(process.cwd(), 'scripts', 'audit_trail_entries.json');
  writeFileSync(auditTrailPath, JSON.stringify(auditTrailEntries, null, 2));
  console.log(`Generated audit_trail_entries.json with ${auditTrailEntries.length} records`);

  const exceptionsPath = join(process.cwd(), 'scripts', 'unresolved_exceptions.json');
  writeFileSync(exceptionsPath, JSON.stringify(unresolvedExceptions, null, 2));
  console.log(`Generated unresolved_exceptions.json with ${unresolvedExceptions.length} records`);

  const groundTruthPath = join(process.cwd(), 'ground_truth.json');
  writeFileSync(groundTruthPath, JSON.stringify(groundTruth, null, 2));
  console.log(`Generated ground_truth.json with ${groundTruth.totalExpectedMatches} expected matches`);

  console.log("\nData generation complete!");
  console.log(`\nSummary:`);
  console.log("- Bank statement records: " + bankStatementRecords.length + " rows (generated)");
  console.log("- Gateway settlement records: " + gatewaySettlementRecords.length + " rows (generated)");
  console.log("- Merchant ledger records: " + merchantLedgerRecords.length + " rows (generated)");
  console.log("- Exact 1:1 matches created: " + exactMatchesCreated);
  console.log("- Many-to-one matches created: " + manyToOneMatchesCreated);
  console.log("- Audit trail entries: " + auditTrailEntries.length + " records");
  console.log("- Unresolved exceptions: " + unresolvedExceptions.length + " records");
  console.log("- Ground truth expected matches: " + groundTruth.totalExpectedMatches);
  console.log("- Gateway records used in matches: " + usedGatewayRecords.size);
  console.log("- Merchant ledger records used in matches: " + usedMerchantLedgerRecords.size);

  // Statistics about match categories
  const manyToOneBankRecords = bankStatementRecords.filter(r => r.matchGroupId &&
    groundTruth.expectedMatches.some(m => m.bankStatementRecordId === r.transactionRecordId && m.matchingAlgorithm === "SUBSET_SUM")
  ).length;
  const exactBankRecords = bankStatementRecords.filter(r => r.matchGroupId &&
    groundTruth.expectedMatches.some(m => m.bankStatementRecordId === r.transactionRecordId && m.matchingAlgorithm === "EXACT")
  ).length;
  const unmatchedBankRecords = bankStatementRecords.filter(r => !r.matchGroupId).length;

  console.log("\nMatch Category Statistics:");
  console.log("- Exact 1:1 matches: " + exactBankRecords + " bank records");
  console.log("- Many-to-one (SUBSET_SUM) matches: " + manyToOneBankRecords + " bank records");
  console.log("- Unmatched (exceptions) bank records: " + unmatchedBankRecords);

  // Verify data integrity
  const totalMatchedRecords = Array.from(usedGatewayRecords).length + Array.from(usedMerchantLedgerRecords).length;
  const totalExceptionRecords = unresolvedExceptions.length;
  const hasConflictingRecords = bankStatementRecords.some(r => r.matchGroupId && unresolvedExceptions.some(e => e.transactionRecordId === r.transactionRecordId));

  console.log("\nData Integrity Check:");
  console.log("- Total matched records: " + totalMatchedRecords);
  console.log("- Total exception records: " + totalExceptionRecords);
  console.log("- Records with both match and exception: " + (hasConflictingRecords ? "YES (ERROR)" : "NO (GOOD)"));

  // Check for negative amount examples in the data
  const negativeAmountExamples = [];
  bankStatementRecords.forEach(record => {
    if (record.amountPaise < 0) negativeAmountExamples.push(record);
  });
  gatewaySettlementRecords.forEach(record => {
    if (record.amountPaise < 0) negativeAmountExamples.push(record);
  });
  merchantLedgerRecords.forEach(record => {
    if (record.amountPaise < 0) negativeAmountExamples.push(record);
  });

  if (negativeAmountExamples.length > 0) {
    console.log("\nNegative amount examples found: " + negativeAmountExamples.length + " (refunds/chargebacks)");
    negativeAmountExamples.slice(0, 3).forEach((record, index) => {
      console.log("  Example " + (index + 1) + ": " + record.dataSource + " - Amount: " + record.amountPaise + " (ref): " + record.externalReference);
    });
  }

  // Sample ground truth analysis
  const sampleManyToOneMatches = groundTruth.expectedMatches.filter(m => m.matchingAlgorithm === "SUBSET_SUM" && m.merchantLedgerRecordId);
  console.log("\nSample Analysis - Many-to-One with Merchant Ledger:");
  console.log("- Total many-to-one matches with merchant ledger: " + sampleManyToOneMatches.length);
  if (sampleManyToOneMatches.length > 0) {
    console.log("\nSample entries (bank -> [gateways] + merchant):");
    sampleManyToOneMatches.slice(0, 3).forEach((match, index) => {
      const gatewayCount = groundTruth.expectedMatches.filter(m => m.bankStatementRecordId === match.bankStatementRecordId && m.matchingAlgorithm === "SUBSET_SUM").length;
      console.log("  Match " + (index + 1) + ": " + match.bankStatementRecordId + " -> " + gatewayCount + " gateways + " + (match.merchantLedgerRecordId ? "merchant" : "none"));
    });
  }
}

// Run if executed directly
main();

export {
  main,
  generateBankStatementRecords,
  generateGatewaySettlementRecords,
  generateMerchantLedgerRecords,
  generateAuditTrailEntries,
  generateUnresolvedExceptions,
  generateGroundTruth
};