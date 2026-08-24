/*
  Warnings:

  - Added the required column `previousRowHash` to the `AuditTrail` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rowHash` to the `AuditTrail` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AuditTrail" ADD COLUMN     "previousRowHash" TEXT NOT NULL,
ADD COLUMN     "rowHash" TEXT NOT NULL;
