// embedding.ts — Character n-gram TF-IDF embedding for fuzzy reference matching (Layer 2a)
//
// WHY CHARACTER N-GRAMS + TF-IDF:
//   - Deterministic: same input always produces identical output. No API calls, no model weights,
//     no randomness. This is critical for audit-trail reproducibility and hash-chain integrity.
//   - Zero external dependency: pure TypeScript, runs locally, no network required.
//   - Zero API cost: no OpenAI/Gemini/embedding model spend. Ideal for high-volume batch disambiguation.
//   - Typo-tolerant: character-level overlap captures transpositions ("RAZPAY" vs "RZPAY"),
//     insertions ("SETT" vs "SET"), and deletions. Word-level n-grams would miss these.
//   - Short-string robust: ^ and $ sentinel padding ensures short references (5–15 chars) still
//     yield meaningful gram distributions instead of near-empty sparse vectors.
//   - L2-normalized vectors: cosine similarity reduces to a simple dot product, making similarity
//     comparisons O(overlap_size) on sparse maps, not O(full_dim).
//
// PRODUCTION NOTE: Real production would swap computeEmbedding() for OpenAI text-embedding-3-small
// or Gemini text-embedding-004 via API, and store vectors in pgvector. That swap-in lands at Day 9
// when Postgres and pgvector are wired up. Today's layer uses identical interfaces so the swap
// is a one-file change with zero interface churn.

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Uppercase and strip all non-alphanumeric characters.
 * "  pay_abc-123  " → "PAYABC123"
 */
export function normalizeReference(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

// ── N-gram generation ─────────────────────────────────────────────────────────

/**
 * Slide a window of width n over the string, padded with ^ (start) and $ (end) sentinels.
 * Default n=3. Short strings still produce grams because of the double-sentinel padding:
 *   "AB" with n=3 → padded "^^AB$$" → ["^^A","^AB","AB$","B$$"]
 *
 * This ensures even 2-character references produce a non-empty gram set.
 */
export function characterNgrams(s: string, n: number = 3): string[] {
  if (n <= 0) return [];
  // Pad with (n-1) copies of ^ at start and $ at end so every character is covered
  const padding = n - 1;
  const padded = "^".repeat(padding) + s + "$".repeat(padding);
  const grams: string[] = [];
  for (let i = 0; i <= padded.length - n; i++) {
    grams.push(padded.slice(i, i + n));
  }
  return grams;
}

// ── Embedding computation ─────────────────────────────────────────────────────

/**
 * Compute a TF vector of trigrams from ref, then L2-normalize it.
 * Returns an empty Map for empty strings. L2 normalization means cosine = dot product.
 */
export function computeEmbedding(ref: string): Map<string, number> {
  const normalized = normalizeReference(ref);
  if (normalized.length === 0) return new Map<string, number>();

  const grams = characterNgrams(normalized, 3);
  if (grams.length === 0) return new Map<string, number>();

  // Term frequency count
  const tf = new Map<string, number>();
  for (const gram of grams) {
    tf.set(gram, (tf.get(gram) ?? 0) + 1);
  }

  // L2 normalize so cosine(a,b) = dot(a,b)
  let norm = 0;
  for (const v of tf.values()) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return new Map<string, number>();

  const embedding = new Map<string, number>();
  for (const [gram, count] of tf.entries()) {
    embedding.set(gram, count / norm);
  }
  return embedding;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

/**
 * Dot product of two L2-normalized sparse vectors = cosine similarity.
 * Returns 0 if either vector is empty (avoids division-by-zero, does not throw).
 */
export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>
): number {
  if (a.size === 0 || b.size === 0) return 0;

  // Iterate over the smaller map for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];

  let dot = 0;
  for (const [gram, va] of smaller.entries()) {
    const vb = larger.get(gram);
    if (vb !== undefined) {
      dot += va * vb;
    }
  }
  // Clamp to [0,1] to avoid floating-point drift past 1.0
  return Math.min(1.0, Math.max(0.0, dot));
}

// ── Batch similarity ──────────────────────────────────────────────────────────

/**
 * Embed query, embed every corpus item, return sorted descending by score.
 */
export function batchSimilarity(
  query: string,
  corpus: string[]
): { ref: string; score: number }[] {
  const queryEmb = computeEmbedding(normalizeReference(query));

  const results = corpus.map((ref) => ({
    ref,
    score: cosineSimilarity(queryEmb, computeEmbedding(normalizeReference(ref))),
  }));

  results.sort((a, b) => b.score - a.score);
  return results;
}
