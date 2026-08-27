import { sql } from "bun";

async function main() {
  try {
    console.log("Checking AuditTrail table...");

    const countResult = await sql`SELECT count(*) FROM "AuditTrail"`;
    const count = Number(countResult[0].count);
    console.log(`Total audit trail entries: ${count}`);

    if (count > 0) {
      const latest = await sql`
        SELECT "auditTrailId", "method", "actorId", "decisionTimestamp"
        FROM "AuditTrail"
        ORDER BY "decisionTimestamp" DESC
        LIMIT 5
      `;
      console.log("\nLatest 5 audit trail entries:");
      for (const row of latest) {
        console.log(`  ${row.auditTrailId} [${row.method}] by ${row.actorId} at ${row.decisionTimestamp}`);
      }
    }

    // Check for exact and subset-sum method entries
    const methodCounts = await sql`
      SELECT "method", count(*) as count
      FROM "AuditTrail"
      GROUP BY "method"
    `;
    console.log("\nAudit trail entries by method:");
    for (const row of methodCounts) {
      console.log(`  ${row.method}: ${row.count}`);
    }

  } catch (err) {
    console.error("Error checking audit trail:", err);
  }
}

main();