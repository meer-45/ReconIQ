import { sql } from "bun";
import { join } from "path";
import { readFileSync } from "fs";

// Copy the exact same parseCsvLine and loadTransactionsFromCsv from exact.ts
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

function loadTransactionsFromCsv(filepath: string, dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT" | "MERCHANT_LEDGER") {
  const csvContent = readFileSync(filepath, 'utf-8');
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

async function main() {
  try {
    console.log("Starting data ingestion with Bun.sql...");

    const dataDir = join(process.cwd(), 'data');

    const bankRecords = loadTransactionsFromCsv(join(dataDir, "bank_statement.csv"), "BANK_STATEMENT");
    const gatewayRecords = loadTransactionsFromCsv(join(dataDir, "gateway_settlement.csv"), "GATEWAY_SETTLEMENT");
    const merchantRecords = loadTransactionsFromCsv(join(dataDir, "merchant_ledger.csv"), "MERCHANT_LEDGER");

    const allRecords = [...bankRecords, ...gatewayRecords, ...merchantRecords];

    console.log(`Loaded ${bankRecords.length} bank records, ${gatewayRecords.length} gateway records, ${merchantRecords.length} merchant records.`);

    // Clear existing data
    await sql`DELETE FROM "TransactionRecord"`;
    console.log("Cleared existing TransactionRecord records.");

    // Insert records one by one (could be batched, but for simplicity and reliability we do one by one)
    let inserted = 0;
    for (const record of allRecords) {
      await sql`INSERT INTO "TransactionRecord" (
          "transactionRecordId",
          "dataSource",
          "externalReference",
          "amountPaise",
          "currencyCode",
          "transactionDate",
          "ingestedAt",
          "rawDescription",
          "rawPayload",
          "matchGroupId"
        ) VALUES (
          ${record.transactionRecordId},
          ${record.dataSource},
          ${record.externalReference},
          ${record.amountPaise},
          ${record.currencyCode},
          ${record.transactionDate},
          ${record.ingestedAt},
          ${record.rawDescription},
          ${record.rawPayload},
          ${record.matchGroupId}
        )`;
      inserted++;
      if (inserted % 100 === 0) {
        console.log(`Inserted ${inserted} / ${allRecords.length} records...`);
      }
    }

    console.log("Data ingestion completed.");

    // Verify count
    const countResult = await sql`SELECT count(*) FROM "TransactionRecord"`;
    console.log(`Total TransactionRecord rows in DB: ${countResult[0].count}`);
  } catch (err) {
    console.error("Error during data ingestion:", err);
  }
}

main();