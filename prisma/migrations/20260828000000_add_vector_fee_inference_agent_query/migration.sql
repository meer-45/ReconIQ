-- Enable pgvector extension (required for referenceEmbedding and actionEmbedding columns)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add FEE_INFERENCE and AGENT_QUERY to MatchMethod enum
ALTER TYPE "MatchMethod" ADD VALUE IF NOT EXISTS 'FEE_INFERENCE';
ALTER TYPE "MatchMethod" ADD VALUE IF NOT EXISTS 'AGENT_QUERY';

-- Add ExceptionClassification enum (may already exist from db push — safe to skip)
DO $$ BEGIN
  CREATE TYPE "ExceptionClassification" AS ENUM ('AMBIGUOUS_MATCH', 'DUPLICATE', 'MISSING_COUNTERPART', 'TIMING_LAG', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add MatchGroupStatus enum (may already exist from db push — safe to skip)
DO $$ BEGIN
  CREATE TYPE "MatchGroupStatus" AS ENUM ('MATCHED', 'PENDING_REVIEW', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add referenceEmbedding column to TransactionRecord (vector for pgvector similarity search)
ALTER TABLE "TransactionRecord"
  ADD COLUMN IF NOT EXISTS "referenceEmbedding" vector(1536);

-- Add runId column to MatchGroup (batch tracking)
ALTER TABLE "MatchGroup"
  ADD COLUMN IF NOT EXISTS "runId" TEXT;

-- Fix status column type: migrate from TEXT to MatchGroupStatus enum
-- First ensure existing values match the enum
UPDATE "MatchGroup" SET "status" = 'MATCHED'       WHERE lower("status") = 'matched';
UPDATE "MatchGroup" SET "status" = 'PENDING_REVIEW' WHERE lower("status") = 'pending_review';
UPDATE "MatchGroup" SET "status" = 'REJECTED'       WHERE lower("status") = 'rejected';

-- Alter column type only if it's still TEXT (must drop default first, re-add after)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MatchGroup'
      AND column_name = 'status'
      AND data_type   = 'text'
  ) THEN
    ALTER TABLE "MatchGroup" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "MatchGroup"
      ALTER COLUMN "status" TYPE "MatchGroupStatus"
      USING "status"::"MatchGroupStatus";
    ALTER TABLE "MatchGroup" ALTER COLUMN "status" SET DEFAULT 'MATCHED'::"MatchGroupStatus";
  END IF;
END $$;

-- Add classification column to UnresolvedException as enum type
-- (may have been TEXT from db push)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'UnresolvedException'
      AND column_name = 'classification'
      AND data_type   = 'text'
  ) THEN
    ALTER TABLE "UnresolvedException"
      ALTER COLUMN "classification" TYPE "ExceptionClassification"
      USING "classification"::"ExceptionClassification";
  END IF;
END $$;

-- Add missing columns to UnresolvedException
ALTER TABLE "UnresolvedException"
  ADD COLUMN IF NOT EXISTS "runId" TEXT,
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "candidateMetadata" JSONB,
  ADD COLUMN IF NOT EXISTS "totalAmountPaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "transactionRecordIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Add ExampleBank table for LLM fine-tuning examples
CREATE TABLE IF NOT EXISTS "ExampleBank" (
  "exampleBankId"     TEXT        NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exceptionSnapshot" JSONB       NOT NULL,
  "correctAction"     JSONB       NOT NULL,
  "actionEmbedding"   vector(1536),
  CONSTRAINT "ExampleBank_pkey" PRIMARY KEY ("exampleBankId")
);
