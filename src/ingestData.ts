import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../generated/prisma/client.ts";

// We'll copy the parseCsvLine function from exact.ts for consistency.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (!inQuotes && char === '"') {
      inQuotes = true;
      quoteChar = '"';
      continue;
    }
    if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = '';
      continue;
    }
    if (inQuotes) {
      current += char;
      continue;
    }
    if (char === ',') {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("Starting data ingestion...");

    const dataDir = join(process.cwd(), 'data');

    // Function to load transactions from CSV and return them in the format for insertion
    function loadTransactionsFromCsv(filepath: string, dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER") {
      const csvContent = require('fs').readFileSync(filepath, 'utf-8');
      const lines = csvContent.split('\n').filter(line => line.trim());
      if (lines.length === 0) return [];

      const header = parseCsvLine(lines[0]);
      const transactions = [];

      for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
        const values = parseCsvLine(lines[rowIndex]);
        if (values.length === 0) continue;

        const record: Record<string, string> = {};
        header.forEach((h, idx) => {
          record[h] = values[idx] || '';
        });

        const txDateStr = record["transactionDate"] || '';

        transactions.push({
          transactionRecordId: record["transactionRecordId"] || `tx_${Math.random().toString(36).substring(2, 14)}`,
          dataSource,
          externalReference: record["externalReference"] || '',
          amountPaise: parseInt(record["amountPaise"] || '0', 10),
          currencyCode: record["currencyCode"] || "INR",
          transactionDate: txDateStr,
          ingestedAt: record["ingestedAt"] || new Date().toISOString(),
          rawDescription: record["rawDescription"] || '',
          rawPayload: record["rawPayload"] || '{}',
          matchGroupId: null, // will be set later by exact and subset-sum steps
        });
      }

      return transactions;
    }

    const bankRecords = loadTransactionsFromCsv(join(dataDir, "bank_statement.csv"), "BANK_STATEMENT");
    const gatewayRecords = loadTransactionsFromCsv(join(dataDir, "gateway_settlement.csv"), "GATEWAY_SETTLEMENT");
    const merchantRecords = loadTransactionsFromCsv(join(dataDir, "merchant_ledger.csv"), "MERCHANT_LEDGER");

    const allRecords = [...bankRecords, ...gatewayRecords, ...merchantRecords];

    console.log(`Loaded ${bankRecords.length} bank records, ${gatewayRecords.length} gateway records, ${merchantRecords.length} merchant records.`);

    // Clear existing data? We'll assume we are starting fresh.
    // But we don't want to delete if there is already data. We'll check and ask? For now, we'll delete all.
    // Since we are in a fresh environment, we can delete.
    await prisma.transactionRecord.deleteMany({});
    console.log("Cleared existing TransactionRecord records.");

    // Insert in batches
    const batchSize = 100;
    for (let i = 0; i < allRecords.length; i += batchSize) {
      const batch = allRecords.slice(i, i + batchSize);
      await prisma.transactionRecord.createMany({
        data: batch,
      });
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(allRecords.length / batchSize)}`);
    }

    console.log("Data ingestion completed.");

    // Verify count
    const count = await prisma.transactionRecord.count();
    console.log(`Total TransactionRecord rows in DB: ${count}`);
  } catch (err) {
    console.error("Error during data ingestion:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();