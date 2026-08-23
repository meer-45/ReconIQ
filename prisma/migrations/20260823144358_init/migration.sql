-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('BANK_STATEMENT', 'GATEWAY_SETTLEMENT', 'MERCHANT_LEDGER');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('EXACT', 'SUBSET_SUM', 'AI_FUZZY', 'AI_CLASSIFIED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'AI', 'HUMAN');

-- CreateTable
CREATE TABLE "TransactionRecord" (
    "transactionRecordId" TEXT NOT NULL,
    "dataSource" "DataSource" NOT NULL,
    "externalReference" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawDescription" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "matchGroupId" TEXT,

    CONSTRAINT "TransactionRecord_pkey" PRIMARY KEY ("transactionRecordId")
);

-- CreateTable
CREATE TABLE "MatchGroup" (
    "matchGroupId" TEXT NOT NULL,
    "method" "MatchMethod" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" TEXT NOT NULL DEFAULT 'matched',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MatchGroup_pkey" PRIMARY KEY ("matchGroupId")
);

-- CreateTable
CREATE TABLE "AuditTrail" (
    "auditTrailId" TEXT NOT NULL,
    "decisionTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "MatchMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" "ActorType" NOT NULL,
    "actorId" TEXT,
    "transactionRecordId" TEXT,
    "matchGroupId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AuditTrail_pkey" PRIMARY KEY ("auditTrailId")
);

-- CreateTable
CREATE TABLE "UnresolvedException" (
    "unresolvedExceptionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" TEXT,
    "rootCauseHypothesis" TEXT,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "transactionRecordId" TEXT,

    CONSTRAINT "UnresolvedException_pkey" PRIMARY KEY ("unresolvedExceptionId")
);

-- CreateIndex
CREATE INDEX "TransactionRecord_dataSource_transactionDate_idx" ON "TransactionRecord"("dataSource", "transactionDate");

-- CreateIndex
CREATE INDEX "TransactionRecord_matchGroupId_idx" ON "TransactionRecord"("matchGroupId");

-- CreateIndex
CREATE INDEX "TransactionRecord_externalReference_idx" ON "TransactionRecord"("externalReference");

-- CreateIndex
CREATE INDEX "MatchGroup_method_idx" ON "MatchGroup"("method");

-- CreateIndex
CREATE INDEX "MatchGroup_status_createdAt_idx" ON "MatchGroup"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditTrail_decisionTimestamp_idx" ON "AuditTrail"("decisionTimestamp");

-- CreateIndex
CREATE INDEX "AuditTrail_method_actor_idx" ON "AuditTrail"("method", "actor");

-- CreateIndex
CREATE INDEX "UnresolvedException_isResolved_riskScore_idx" ON "UnresolvedException"("isResolved", "riskScore");

-- CreateIndex
CREATE INDEX "UnresolvedException_classification_idx" ON "UnresolvedException"("classification");

-- AddForeignKey
ALTER TABLE "TransactionRecord" ADD CONSTRAINT "TransactionRecord_matchGroupId_fkey" FOREIGN KEY ("matchGroupId") REFERENCES "MatchGroup"("matchGroupId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTrail" ADD CONSTRAINT "AuditTrail_transactionRecordId_fkey" FOREIGN KEY ("transactionRecordId") REFERENCES "TransactionRecord"("transactionRecordId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTrail" ADD CONSTRAINT "AuditTrail_matchGroupId_fkey" FOREIGN KEY ("matchGroupId") REFERENCES "MatchGroup"("matchGroupId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedException" ADD CONSTRAINT "UnresolvedException_transactionRecordId_fkey" FOREIGN KEY ("transactionRecordId") REFERENCES "TransactionRecord"("transactionRecordId") ON DELETE SET NULL ON UPDATE CASCADE;
