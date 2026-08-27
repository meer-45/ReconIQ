import { sql } from "bun";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// Load environment variables from .env file
function loadEnv() {
  try {
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const lineTrim = line.trim();
      if (lineTrim && !lineTrim.startsWith('#')) {
        const [key, ...valueParts] = lineTrim.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          // Remove surrounding quotes if present
          process.env[key.trim()] = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
        }
      }
    }
  } catch (err) {
    console.warn('Could not load .env file:', err.message);
  }
}
loadEnv();

// Copy the normalizeReference function from exact.ts
function normalizeReference(reference: string): string {
  if (!reference) return '';
  return reference
    .trim()
    .replace(/^(UTR|pay_|gtx_|ORD-)/i, '')
    .trim()
    .toUpperCase();
}

// Constants for fuzzy matching
const EMBEDDING_DIMENSION = 1536;
const AI_FUZZY_THRESHOLD = 0.85; // Minimum similarity to propose a match
const AI_FUZZY_AUTO_COMMIT_THRESHOLD = 0.95; // Similarity for auto-commit (above this -> MATCHED, below -> PENDING_REVIEW)

// Zod schema for validating the proposal shape
const ProposalSchema = z.object({
  matchGroup: z.object({
    matchGroupId: z.string(),
    method: z.literal("AI_FUZZY"),
    confidenceScore: z.number().min(0).max(1),
    status: z.enum(["MATCHED", "PENDING_REVIEW"]),
    createdAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
  }),
  bankRecord: z.object({
    transactionRecordId: z.string(),
    matchGroupId: z.string(),
  }),
  gatewayRecord: z.object({
    transactionRecordId: z.string(),
    matchGroupId: z.string(),
  }),
  auditTrailEntries: z.array(
    z.object({
      auditTrailId: z.string(),
      decisionTimestamp: z.string().datetime(),
      method: z.literal("AI_FUZZY"),
      reason: z.string(),
      actor: z.enum(["SYSTEM", "AI", "HUMAN"]),
      actorId: z.string(),
      transactionRecordId: z.string(),
      matchGroupId: z.string(),
      metadata: z.object({
        modelId: z.string(),
        embeddingDimension: z.number(),
        thresholdUsed: z.number(),
        similarityScore: z.number().min(0).max(1),
        bankReference: z.string(),
        gatewayReference: z.string(),
      }).nullable(),
      rowHash: z.string(),
      previousRowHash: z.string(),
    })
  ),
});

// Custom tracer for embedding calls
class EmbeddingTracer {
  private logFile: string;

  constructor(logFile: string = "./embedding-trace.log") {
    this.logFile = logFile;
  }

  trace(latencyMs: number, tokenCount: number, costInRupees: number, modelId: string) {
    const logEntry = `[${new Date().toISOString()}] Model: ${modelId}, Latency: ${latencyMs}ms, Tokens: ${tokenCount}, Cost: ₹${costInRupees.toFixed(4)}\n`;
    console.log(logEntry.trim());
    // Append to log file
    const { writeFileSync, appendFileSync, existsSync } = require("fs");
    if (!existsSync(this.logFile)) {
      writeFileSync(this.logFile, "");
    }
    appendFileSync(this.logFile, logEntry);
  }
}

const tracer = new EmbeddingTracer();

// Function to generate embedding using Gemini API (NO FALLBACK - throw on failure)
async function generateEmbedding(text: string, modelId: string = "embedding-001"): Promise<{ embedding: number[]; tokenCount: number }> {
  const startTime = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: {
        parts: [{ text }],
      },
    }),
  });

  if (!response.ok) {
    // Let's get the error body for debugging
    const errorText = await response.text();
    console.error(`Gemini API error: ${response.status} ${response.statusText}`);
    console.error(`URL: ${url}`);
    console.error(`Request body: ${JSON.stringify({ content: { parts: [{ text: text.substring(0, 50) + '...'} ] } })}`);
    console.error(`Response body: ${errorText}`);
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const endTime = Date.now();
  const latencyMs = endTime - startTime;

  // Extract embedding and token count from response
  // Based on Gemini API documentation:
  //   https://ai.google.dev/api/embed-content
  const embedding = data.embedding?.values;
  if (!embedding) {
    throw new Error("No embedding values in response");
  }

  // Token count: the Gemini API does not return token count in the embedding response.
  // We'll estimate by splitting the text into words (rough approximation).
  const tokenCount = text.trim().split(/\s+/).length;

  // Cost estimation: Gemini embedding-001 is free as of now? But we'll assume a cost for logging.
  // We'll set cost to 0 for now, but the tracer will log it.
  const costInRupees = 0; // Placeholder

  tracer.trace(latencyMs, tokenCount, costInRupees, modelId);

  return { embedding, tokenCount };
}

// Function to update a TransactionRecord with its embedding
async function updateRecordEmbedding(recordId: string, embedding: number[]) {
  // Convert embedding array to a format that PostgreSQL can accept as a vector
  // We'll use the string format: '[0.1,0.2,...]'
  const embeddingString = `[${embedding.join(",")}]`;
  await sql`
    UPDATE "TransactionRecord"
    SET "referenceEmbedding" = ${embeddingString}::vector
    WHERE "transactionRecordId" = ${recordId}
  `;
}

// Function to compute SHA-256 hash for audit trail chaining
function computeHash(previousRowHash: string, content: object): string {
  const crypto = require("node:crypto");
  const contentString = JSON.stringify(content);
  const hashInput = previousRowHash + contentString;
  return crypto.createHash('sha256').update(hashInput, 'utf8').digest('hex');
}

// Function to get matched transaction record IDs from exact and subset-sum results
function getMatchedIds(): Set<string> {
  // Load exact match results
  const exactPath = join(process.cwd(), 'src', 'matching', 'exact_match_results.json');
  const exactResults = JSON.parse(readFileSync(exactPath, 'utf-8'));

  // Load subset sum results
  const subsetSumPath = join(process.cwd(), 'src', 'matching', 'subset_sum_results.json');
  const subsetSumResults = JSON.parse(readFileSync(subsetSumPath, 'utf-8'));

  const matchedIds = new Set<string>();

  // From exact results: auditTrailEntries have transactionRecordId
  exactResults.auditTrailEntries.forEach(entry => {
    if (entry.transactionRecordId) {
      matchedIds.add(entry.transactionRecordId);
    }
  });

  // From subset sum results: auditTrail has transactionRecordId (if matchGroupId is not null)
  subsetSumResults.auditTrail.forEach(entry => {
    if (entry.transactionRecordId && entry.matchGroupId) {
      matchedIds.add(entry.transactionRecordId);
    }
  });

  return matchedIds;
}

// Main function
async function main() {
  try {
    console.log("Starting AI fuzzy matching layer...");

    // Step 0: Get matched transaction record IDs from exact and subset-sum results
    const matchedIds = getMatchedIds();
    console.log(`Found ${matchedIds.size} matched transaction record IDs from exact and subset-sum layers`);

    // Step 1: Get all bank and gateway records (we'll filter by matchedIds later)
    const allBanks = await sql`
      SELECT
        "transactionRecordId",
        "externalReference",
        "amountPaise",
        "transactionDate",
        "referenceEmbedding"
      FROM "TransactionRecord"
      WHERE
        "dataSource" = 'BANK_STATEMENT'
    `;
    const allGateways = await sql`
      SELECT
        "transactionRecordId",
        "externalReference",
        "amountPaise",
        "transactionDate",
        "referenceEmbedding"
      FROM "TransactionRecord"
      WHERE
        "dataSource" = 'GATEWAY_SETTLEMENT'
    `;

    // Filter out matched records
    const unmatchedBanks = allBanks.filter(bank => !matchedIds.has(bank.transactionRecordId));
    const unmatchedGateways = allGateways.filter(gateway => !matchedIds.has(gateway.transactionRecordId));

    console.log(`Found ${unmatchedBanks.length} unmatched bank records`);
    console.log(`Found ${unmatchedGateways.length} unmatched gateway records`);

    // Step 2: Generate embeddings for records that don't have them
    console.log("Generating embeddings for records missing embeddings...");

    // Process bank records
    for (const bank of unmatchedBanks) {
      if (!bank.referenceEmbedding) {
        const normalizedRef = normalizeReference(bank.externalReference);
        if (normalizedRef) {
          const { embedding } = await generateEmbedding(normalizedRef);
          await updateRecordEmbedding(bank.transactionRecordId, embedding);
          console.log(`Generated embedding for bank ${bank.transactionRecordId}`);
        } else {
          console.warn(`Skipping empty normalized reference for bank ${bank.transactionRecordId}`);
        }
      }
    }

    // Process gateway records
    for (const gateway of unmatchedGateways) {
      if (!gateway.referenceEmbedding) {
        const normalizedRef = normalizeReference(gateway.externalReference);
        if (normalizedRef) {
          const { embedding } = await generateEmbedding(normalizedRef);
          await updateRecordEmbedding(gateway.transactionRecordId, embedding);
          console.log(`Generated embedding for gateway ${gateway.transactionRecordId}`);
        } else {
          console.warn(`Skipping empty normalized reference for gateway ${gateway.transactionRecordId}`);
        }
      }
    }

    // Step 3: For each unmatched bank, find the nearest unmatched gateway
    console.log("Finding nearest gateway matches via cosine distance...");
    const proposals = [];

    for (const bank of unmatchedBanks) {
      // Skip if we don't have an embedding (should not happen after step 2, but just in case)
      if (!bank.referenceEmbedding) {
        console.warn(`Skipping bank ${bank.transactionRecordId} due to missing embedding`);
        continue;
      }

      // Query for the nearest unmatched gateway using the bank's embedding column.
      const nearest = await sql`
        SELECT
          g."transactionRecordId",
          g."externalReference",
          g."referenceEmbedding" <=> b."referenceEmbedding" as distance
        FROM "TransactionRecord" b
        JOIN "TransactionRecord" g ON
          g."dataSource" = 'GATEWAY_SETTLEMENT'
          AND g."matchGroupId" IS NULL
          AND g."referenceEmbedding" IS NOT NULL
        WHERE
          b."transactionRecordId" = ${bank.transactionRecordId}
          AND b."dataSource" = 'BANK_STATEMENT'
          AND b."matchGroupId" IS NULL
          AND b."referenceEmbedding" IS NOT NULL
        ORDER BY distance
        LIMIT 1
      `;

      if (nearest.length === 0) {
        console.log(`No unmatched gateway found for bank ${bank.transactionRecordId}`);
        continue;
      }

      const gatewayRow = nearest[0];
      const distance = Number(gatewayRow.distance);
      const similarity = 1 - distance; // Cosine similarity = 1 - cosine distance

      console.log(`Bank ${bank.transactionRecordId} <-> Gateway ${gatewayRow.transactionRecordId}: similarity = ${similarity.toFixed(4)}`);

      // Check if similarity meets the threshold for proposing a match
      if (similarity >= AI_FUZZY_THRESHOLD) {
        // Determine status based on auto-commit threshold
        const status = similarity >= AI_FUZZY_AUTO_COMMIT_THRESHOLD ? "MATCHED" : "PENDING_REVIEW";

        // Generate IDs
        const matchGroupId = generateRecordIdentifier();
        const nowISO = new Date().toISOString();

        // Create MatchGroup object
        const matchGroup = {
          matchGroupId,
          method: "AI_FUZZY",
          confidenceScore: similarity, // Use similarity as confidence score
          status,
          createdAt: nowISO,
          resolvedAt: status === "MATCHED" ? nowISO : null,
        };

        // We need to compute the hash chain for the audit trail entries.
        // We'll get the latest audit trail rowHash from the database to continue the chain.
        const latestAudit = await sql`
          SELECT "rowHash" FROM "AuditTrail" ORDER BY "decisionTimestamp" DESC LIMIT 1
        `;
        let previousRowHash = "0".repeat(64); // Genesis hash
        if (latestAudit.length > 0) {
          previousRowHash = latestAudit[0].rowHash;
        }

        // Bank audit trail entry
        const bankAuditId = generateRecordIdentifier();
        const bankAuditContent = {
          method: "AI_FUZZY",
          reason: `AI fuzzy match: similarity=${similarity.toFixed(4)}, threshold=${AI_FUZZY_THRESHOLD}`,
          actor: "AI",
          actorId: "embedding-001",
          transactionRecordId: bank.transactionRecordId,
          matchGroupId,
          metadata: {
            modelId: "embedding-001",
            embeddingDimension: EMBEDDING_DIMENSION,
            thresholdUsed: AI_FUZZY_THRESHOLD,
            similarityScore: similarity,
            bankReference: bank.externalReference,
            gatewayReference: gatewayRow.externalReference,
          },
          decisionTimestamp: nowISO,
        };
        const bankRowHash = computeHash(previousRowHash, bankAuditContent);
        const bankAuditEntry = {
          ...bankAuditContent,
          auditTrailId: bankAuditId,
          rowHash: bankRowHash,
          previousRowHash,
        };

        // Update previousRowHash for the next entry
        previousRowHash = bankRowHash;

        // Gateway audit trail entry
        const gatewayAuditId = generateRecordIdentifier();
        const gatewayAuditContent = {
          method: "AI_FUZZY",
          reason: `AI fuzzy match: similarity=${similarity.toFixed(4)}, threshold=${AI_FUZZY_THRESHOLD}`,
          actor: "AI",
          actorId: "embedding-001",
          transactionRecordId: gatewayRow.transactionRecordId,
          matchGroupId,
          metadata: {
            modelId: "embedding-001",
            embeddingDimension: EMBEDDING_DIMENSION,
            thresholdUsed: AI_FUZZY_THRESHOLD,
            similarityScore: similarity,
            bankReference: bank.externalReference,
            gatewayReference: gatewayRow.externalReference,
          },
          decisionTimestamp: nowISO,
        };
        const gatewayRowHash = computeHash(previousRowHash, gatewayAuditContent);
        const gatewayAuditEntry = {
          ...gatewayAuditContent,
          auditTrailId: gatewayAuditId,
          rowHash: gatewayRowHash,
          previousRowHash,
        };

        // Update previousRowHash (not needed further, but for completeness)
        previousRowHash = gatewayRowHash;

        // Create the proposal object for validation
        const proposal = {
          matchGroup,
          bankRecord: {
            transactionRecordId: bank.transactionRecordId,
            matchGroupId,
          },
          gatewayRecord: {
            transactionRecordId: gatewayRow.transactionRecordId,
            matchGroupId,
          },
          auditTrailEntries: [bankAuditEntry, gatewayAuditEntry],
        };

        // Validate the proposal with Zod
        let validationResult;
        try {
          validationResult = ProposalSchema.parse(proposal);
        } catch (zodError) {
          console.warn(`Zod validation failed for proposal (attempt 1): ${zodError.message}`);
          // Retry once
          try {
            validationResult = ProposalSchema.parse(proposal);
          } catch (retryError) {
            console.error(`Zod validation failed on retry: ${retryError.message}`);
            throw retryError; // Throw after retry fails
          }
        }

        // If validation passes, write to database
        console.log(`Writing proposal for bank ${bank.transactionRecordId} and gateway ${gatewayRow.transactionRecordId}`);

        // Insert MatchGroup
        await sql`
          INSERT INTO "MatchGroup" (
            "matchGroupId",
            "method",
            "confidenceScore",
            "status",
            "createdAt",
            "resolvedAt"
          ) VALUES (
            ${matchGroup.matchGroupId},
            ${matchGroup.method},
            ${matchGroup.confidenceScore},
            ${matchGroup.status},
            ${matchGroup.createdAt},
            ${matchGroup.resolvedAt}
          )
        `;

        // Update bank and gateway records to set their matchGroupId
        await sql`
          UPDATE "TransactionRecord"
          SET "matchGroupId" = ${matchGroup.matchGroupId}
          WHERE "transactionRecordId" = ${bank.transactionRecordId}
        `;

        await sql`
          UPDATE "TransactionRecord"
          SET "matchGroupId" = ${matchGroup.matchGroupId}
          WHERE "transactionRecordId" = ${gatewayRow.transactionRecordId}
        `;

        // Insert AuditTrail entries
        for (const entry of [bankAuditEntry, gatewayAuditEntry]) {
          await sql`
            INSERT INTO "AuditTrail" (
              "auditTrailId",
              "decisionTimestamp",
              "method",
              "reason",
              "actor",
              "actorId",
              "transactionRecordId",
              "matchGroupId",
              "metadata",
              "rowHash",
              "previousRowHash"
            ) VALUES (
              ${entry.auditTrailId},
              ${entry.decisionTimestamp},
              ${entry.method},
              ${entry.reason},
              ${entry.actor},
              ${entry.actorId},
              ${entry.transactionRecordId},
              ${entry.matchGroupId},
              ${JSON.stringify(entry.metadata)},
              ${entry.rowHash},
              ${entry.previousRowHash}
            )
          `;
        }

        proposals.push(proposal);
      } else {
        console.log(`Similarity ${similarity.toFixed(4)} below threshold ${AI_FUZZY_THRESHOLD}, skipping.`);
      }
    }

    console.log(`AI fuzzy matching complete. Created ${proposals.length} proposals.`);

    // Step 4: Output summary
    const matchedCount = proposals.filter(p => p.matchGroup.status === "MATCHED").length;
    const pendingCount = proposals.filter(p => p.matchGroup.status === "PENDING_REVIEW").length;
    console.log(`- Matched (auto-commit): ${matchedCount}`);
    console.log(`- Pending review: ${pendingCount}`);

  } catch (err) {
    console.error("Error in AI fuzzy matching:", err);
    process.exit(1);
  }
}

// Helper function to generate a random identifier (like in exact.ts)
function generateRecordIdentifier() {
  return `tx_${Math.random().toString(36).substring(2, 14)}`;
}

main();