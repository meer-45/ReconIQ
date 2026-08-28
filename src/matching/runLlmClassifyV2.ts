// src/matching/runLlmClassifyV2.ts — CLI entry for Layer 2b v2 classification.
// Injects few-shot examples from ExampleBank, writes to Postgres, and extends the main hash chain.

import "dotenv/config";
import { prisma, closePrisma } from "../persistence/db";
import { getMainChainTailHash } from "../api/server";
import { classifyExceptionV2, type PromptInputV2 } from "./llmClassifyV2";

async function main() {
  console.log("=== ReconIQ LLM Classify V2 (Self-Healing Few-Shot Loop) ===");

  // 1. Fetch pending unresolved exceptions
  const exceptions = await prisma.unresolvedException.findMany({
    where: { isResolved: false },
    orderBy: { createdAt: "asc" },
    take: 20, // process a batch of 20 exceptions
  });

  console.log(`Found ${exceptions.length} unresolved exceptions to evaluate.`);
  if (exceptions.length === 0) {
    console.log("No unresolved exceptions found. Exiting.");
    await closePrisma();
    return;
  }

  // 2. Fetch current main chain tail hash
  let currHash = await getMainChainTailHash();
  console.log(`Starting hash-chain from tail: ${currHash.slice(0, 16)}…`);

  let withFewShotCount = 0;
  let totalProcessed = 0;

  for (const ex of exceptions) {
    const candidateMeta = (ex.candidateMetadata as any) || {};
    const bankId = ex.transactionRecordIds[0] || ex.unresolvedExceptionId;

    // Fetch bank transaction record for details
    const tx = await prisma.transactionRecord.findUnique({
      where: { transactionRecordId: bankId },
    });

    const topCandidates: Array<{ id: string; ref: string; amountPaise: number; similarity?: number }> = [];
    if (Array.isArray(candidateMeta.candidates)) {
      for (const c of candidateMeta.candidates.slice(0, 3)) {
        if (Array.isArray(c.gatewayRecords)) {
          for (const g of c.gatewayRecords) {
            topCandidates.push({
              id:          g.transactionRecordId,
              ref:         g.externalReference,
              amountPaise: g.amountPaise,
              similarity:  c.finalScore,
            });
          }
        }
      }
    } else if (Array.isArray(candidateMeta.evidenceRefs)) {
      for (const refId of candidateMeta.evidenceRefs) {
        topCandidates.push({
          id:          refId,
          ref:         refId,
          amountPaise: ex.totalAmountPaise,
          similarity:  0.65,
        });
      }
    }

    const promptInput: PromptInputV2 = {
      bankId,
      bankRef:           tx?.externalReference || "UNKNOWN_REF",
      amountPaise:       ex.totalAmountPaise,
      date:              tx?.transactionDate ? tx.transactionDate.toISOString().slice(0, 10) : "2026-08-20",
      topCandidates,
      priorLayerSummary: ex.rootCauseHypothesis || `Flagged with ${ex.classification || "AMBIGUOUS_MATCH"}`,
      exceptionSnapshot: {
        exceptionId:          ex.unresolvedExceptionId,
        classification:       ex.classification,
        totalAmountPaise:     ex.totalAmountPaise,
        transactionRecordIds: ex.transactionRecordIds,
        candidateMetadata:    ex.candidateMetadata,
        rootCauseHypothesis:  ex.rootCauseHypothesis,
      },
    };

    const { classification, auditRow } = await classifyExceptionV2(
      ex.unresolvedExceptionId,
      bankId,
      promptInput,
      currHash
    );

    currHash = auditRow.rowHash;
    totalProcessed++;

    if (classification.fewShotExampleIds && classification.fewShotExampleIds.length > 0) {
      withFewShotCount++;
      console.log(
        `  ✓ Exception ${ex.unresolvedExceptionId}: ${classification.classification} (confidence ${(classification.confidence * 100).toFixed(0)}%) [Injected ${classification.fewShotExampleIds.length} few-shot examples: ${classification.fewShotExampleIds.join(", ")} | scores: ${classification.fewShotScores?.join(", ")}]`
      );
    } else {
      console.log(
        `  - Exception ${ex.unresolvedExceptionId}: ${classification.classification} (confidence ${(classification.confidence * 100).toFixed(0)}%) [Fallback v1]`
      );
    }

    // Write audit row to Postgres
    await prisma.auditTrail.create({
      data: {
        auditTrailId:        auditRow.auditTrailId,
        decisionTimestamp:   new Date(auditRow.decisionTimestamp),
        method:              "AI_CLASSIFIED",
        reason:              auditRow.reason,
        actor:               "AI",
        actorId:             auditRow.actorId,
        transactionRecordId: auditRow.transactionRecordId,
        matchGroupId:        null,
        metadata:            JSON.parse(auditRow.metadata),
        rowHash:             auditRow.rowHash,
        previousRowHash:     auditRow.previousRowHash,
      },
    });

    // Update exception with new hypothesis and classification
    await prisma.unresolvedException.update({
      where: { unresolvedExceptionId: ex.unresolvedExceptionId },
      data: {
        classification:      classification.classification as any,
        rootCauseHypothesis: classification.rootCauseHypothesis,
      },
    });
  }

  console.log("\n=== LLM Classify V2 Summary ===");
  console.log(`  Total Processed:           ${totalProcessed}`);
  console.log(`  With Few-Shot Injected:    ${withFewShotCount}`);
  console.log(`  New Chain Tail:            ${currHash}`);

  await closePrisma();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
}
