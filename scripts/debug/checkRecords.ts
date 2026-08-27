import { sql } from "bun";

async function main() {
  try {
    const count = await sql`SELECT count(*) FROM "TransactionRecord"`;
    console.log("Total TransactionRecord rows in DB:", count[0].count);

    const bySource = await sql`SELECT "dataSource", count(*) FROM "TransactionRecord" GROUP BY "dataSource"`;
    console.log("Breakdown by source:", bySource);
  } catch (err) {
    console.error("Error querying TransactionRecord:", err);
  }
}

main();
