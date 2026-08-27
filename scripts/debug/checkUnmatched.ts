import { sql } from "bun";

async function main() {
  try {
    console.log("Checking unmatched records after exact and subset-sum matching...");

    // Count total records
    const totalResult = await sql`SELECT count(*) FROM "TransactionRecord"`;
    const total = Number(totalResult[0].count);
    console.log(`Total records: ${total}`);

    // Count records with matchGroupId not null (matched)
    const matchedResult = await sql`SELECT count(*) FROM "TransactionRecord" WHERE "matchGroupId" IS NOT NULL`;
    const matched = Number(matchedResult[0].count);
    console.log(`Matched records: ${matched}`);

    // Count records with matchGroupId null (unmatched)
    const unmatchedResult = await sql`SELECT count(*) FROM "TransactionRecord" WHERE "matchGroupId" IS NULL`;
    const unmatched = Number(unmatchedResult[0].count);
    console.log(`Unmatched records: ${unmatched}`);

    // Breakdown by dataSource for unmatched records
    const unmatchedBySource = await sql`
      SELECT "dataSource", count(*)
      FROM "TransactionRecord"
      WHERE "matchGroupId" IS NULL
      GROUP BY "dataSource"
    `;
    console.log("Unmatched by source:");
    for (const row of unmatchedBySource) {
      console.log(`  ${row.dataSource}: ${row.count}`);
    }

    // Show some sample unmatched records
    const sampleUnmatched = await sql`
      SELECT "transactionRecordId", "dataSource", "externalReference", "amountPaise", "transactionDate"
      FROM "TransactionRecord"
      WHERE "matchGroupId" IS NULL
      LIMIT 5
    `;
    console.log("\nSample unmatched records:");
    for (const row of sampleUnmatched) {
      console.log(`  ${row.transactionRecordId} [${row.dataSource}] ${row.externalReference} ₹${row.amountPaise/100} on ${row.transactionDate}`);
    }

  } catch (err) {
    console.error("Error checking unmatched records:", err);
  }
}

main();