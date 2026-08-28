// db.ts — singleton Prisma client with pg driver adapter (Prisma v7 requirement).
// Import this instead of constructing PrismaClient directly anywhere in the codebase.

import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config();
dotenv.config({ path: resolve(__dirname, "../../.env") });
import { Pool }       from "pg";
import { PrismaPg }   from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },   // Neon requires SSL
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

// Graceful shutdown — call this in long-running processes
export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
