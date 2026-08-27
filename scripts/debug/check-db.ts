import { PrismaClient } from "../generated/prisma/client.ts";

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Checking database extensions...");
    const extensions: any[] = await prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    if (extensions.length === 0) {
      console.log("pgvector extension not found. Enabling...");
      await prisma.$queryRaw`CREATE EXTENSION IF NOT EXISTS vector`;
      console.log("pgvector extension enabled.");
    } else {
      console.log("pgvector extension is already enabled.");
    }

    console.log("Checking TransactionRecord table...");
    const columns: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'TransactionRecord' AND column_name = 'referenceEmbedding'
    `;

    if (columns.length === 0) {
      console.log("referenceEmbedding column missing in TransactionRecord. Adding...");
      await prisma.$queryRaw`ALTER TABLE "TransactionRecord" ADD COLUMN IF NOT EXISTS "referenceEmbedding" vector(1536)`;
      console.log("referenceEmbedding column added.");
    } else {
      console.log(`referenceEmbedding column exists with type: ${columns[0].data_type}`);
    }
  } catch (error) {
    console.error("Database check failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
