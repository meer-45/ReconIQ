import { sql } from "bun";

async function main() {
  try {
    console.log("Checking if vector extension exists...");
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
    console.log("pgvector extension enabled.");

    console.log("Checking if TransactionRecord table exists...");
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'TransactionRecord'
      );
    `;
    console.log("TransactionRecord exists:", tableExists[0].exists);

    if (tableExists[0].exists) {
      console.log("Adding referenceEmbedding column if missing...");
      await sql`ALTER TABLE "TransactionRecord" ADD COLUMN IF NOT EXISTS "referenceEmbedding" vector(1536);`;
      console.log("referenceEmbedding column added / verified.");
    } else {
      console.log("TransactionRecord table does not exist. Pushing Prisma schema...");
    }
  } catch (err) {
    console.error("Error setting up pgvector:", err);
  }
}

main();
