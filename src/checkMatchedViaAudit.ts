import { sql } from "bun";

async function main() {
  try {
    console.log("Checking matched records via AuditTrail...");

    // Count distinct transactionRecordIds in AuditTrail where matchGroupId is not null
    const matchedViaAuditResult = await sql`
      SELECT COUNT(DISTINCT "transactionRecordId") as matched_count
      FROM "AuditTrail"
      WHERE "matchGroupId" IS NOT NULL
    `;
    const matchedCount = Number(matchedViaAuditResult[0].matched_count);
    console.log(`Distinct transaction records matched via AuditTrail: ${matchedCount}`);

    // Also get the breakdown by dataSource
    const matchedBySource = await sql`
      SELECT tr."dataSource", COUNT(DISTINCT tr."transactionRecordId") as count
      FROM "AuditTrail" at
      JOIN "TransactionRecord" tr ON tr."transactionRecordId" = at."transactionRecordId"
      WHERE at."matchGroupId" IS NOT NULL
      GROUP BY tr."dataSource"
    `;
    console.log("Matched by source (via AuditTrail):");
    for (const row of matchedBySource) {
      console.log(`  ${row.dataSource}: ${row.count}`);
    }

    // Total records
    const totalResult = await sql`SELECT count(*) FROM "TransactionRecord"`;
    const total = Number(totalResult[0].count);
    console.log(`Total records: ${total}`);

    // Unmatched count
    const unmatchedCount = total - matchedCount;
    console.log(`Unmatched records (not in any AuditTrail with matchGroupId): ${unmatchedCount}`);

  } catch (err) {
    console.error("Error checking matched via AuditTrail:", err);
  }
}

main();