// src/agent/exampleBank.ts — ExampleBank persistence & TF-IDF trigram retrieval for the self-heal loop.
// Reuses character n-gram cosine similarity from src/matching/embedding.ts. Zod-validates on write.

import { z } from "zod";
import { prisma } from "../persistence/db";
import { computeEmbedding, cosineSimilarity } from "../matching/embedding";

// ── Zod Schemas ───────────────────────────────────────────────────────────────

export const CorrectActionSchema = z.object({
  type:                 z.enum(["APPROVE_CANDIDATE", "REJECT", "MARK_RESOLVED"]),
  chosenCandidateIndex: z.number().optional(),
  classification:       z.string().optional(),
  humanNote:            z.string().optional(),
  actorId:              z.string().optional(),
});

export type CorrectAction = z.infer<typeof CorrectActionSchema>;

export const SaveExampleInputSchema = z.object({
  exceptionSnapshot: z.record(z.any()),
  correctAction:     CorrectActionSchema,
  actorId:           z.string().optional(),
});

export type SaveExampleInput = z.infer<typeof SaveExampleInputSchema>;

export interface ExampleBankRecord {
  exampleBankId:     string;
  createdAt:         string;
  exceptionSnapshot: Record<string, any>;
  correctAction:     CorrectAction;
  score?:            number;
}

// ── Canonicalization & Embedding ──────────────────────────────────────────────

/**
 * Pack classification + reference strings + amount bucket into a single canonical string,
 * then trigram-embed it using deterministic character n-grams.
 */
export function canonicalize(snapshot: Record<string, any>): string {
  const classification = snapshot.classification || snapshot.type || "UNRESOLVED";
  const hypothesis = snapshot.rootCauseHypothesis || snapshot.priorLayerSummary || "";
  const amt =
    snapshot.totalAmountPaise ||
    snapshot.amountPaise ||
    snapshot.bank?.amountPaise ||
    0;

  const amtBucket =
    amt < 100000 ? "UNDER_1K" : amt < 1000000 ? "1K_TO_10K" : amt < 5000000 ? "10K_TO_50K" : "ABOVE_50K";

  const tokens = [
    `TYPE_${classification}`,
    `TYPE_${classification}`,
    `BUCKET_${amtBucket}`,
    hypothesis,
  ];

  if (snapshot.bank?.ref) {
    tokens.push(String(snapshot.bank.ref).slice(0, 10));
  }
  if (snapshot.externalReference) {
    tokens.push(String(snapshot.externalReference).slice(0, 10));
  }

  return tokens.join(" ");
}

export function embedSnapshot(snapshot: Record<string, any>): Map<string, number> {
  const text = canonicalize(snapshot);
  return computeEmbedding(text);
}

// ── ExampleBank Methods ───────────────────────────────────────────────────────

/**
 * Save a human-approved/resolved decision snapshot to ExampleBank.
 */
export async function saveExample(input: SaveExampleInput): Promise<ExampleBankRecord> {
  const parsed = SaveExampleInputSchema.parse(input);
  const exampleBankId = `eb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date();

  await prisma.exampleBank.create({
    data: {
      exampleBankId,
      createdAt: now,
      exceptionSnapshot: parsed.exceptionSnapshot as any,
      correctAction:     parsed.correctAction as any,
    },
  });

  return {
    exampleBankId,
    createdAt: now.toISOString(),
    exceptionSnapshot: parsed.exceptionSnapshot,
    correctAction:     parsed.correctAction,
  };
}

/**
 * Retrieve top-k most similar past cases using TF-IDF trigram cosine similarity.
 */
export async function retrieveSimilar(
  exceptionSnapshot: Record<string, any>,
  k: number = 5
): Promise<Array<ExampleBankRecord & { score: number }>> {
  const queryEmb = embedSnapshot(exceptionSnapshot);
  if (queryEmb.size === 0) return [];

  const allExamples = await prisma.exampleBank.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const scored: Array<ExampleBankRecord & { score: number }> = allExamples.map((ex) => {
    const exSnapshot = (ex.exceptionSnapshot as Record<string, any>) || {};
    const exEmb = embedSnapshot(exSnapshot);
    const score = cosineSimilarity(queryEmb, exEmb);
    return {
      exampleBankId:     ex.exampleBankId,
      createdAt:         ex.createdAt.toISOString(),
      exceptionSnapshot: exSnapshot,
      correctAction:     ex.correctAction as any,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Get total number of saved examples.
 */
export async function getExampleCount(): Promise<number> {
  return await prisma.exampleBank.count();
}

/**
 * List recent examples with pagination for debug/audit.
 */
export async function listExamples(limit: number = 20, offset: number = 0) {
  const [examples, total] = await Promise.all([
    prisma.exampleBank.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.exampleBank.count(),
  ]);

  return {
    examples: examples.map((ex) => ({
      exampleBankId:     ex.exampleBankId,
      createdAt:         ex.createdAt.toISOString(),
      exceptionSnapshot: ex.exceptionSnapshot as Record<string, any>,
      correctAction:     ex.correctAction as any,
    })),
    total,
  };
}
