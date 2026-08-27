// embedding.test.ts — contract tests for character n-gram TF-IDF embedding layer
// Tests written FIRST per spec. Do not modify assertions to make code pass.

import { describe, test, expect } from "bun:test";
import {
  normalizeReference,
  characterNgrams,
  computeEmbedding,
  cosineSimilarity,
  batchSimilarity,
} from "./embedding";

describe("normalizeReference", () => {
  test("strips spaces, non-alphanumeric, uppercases", () => {
    expect(normalizeReference("  pay_abc-123  ")).toBe("PAYABC123");
  });

  test("empty string stays empty", () => {
    expect(normalizeReference("")).toBe("");
  });

  test("already normalized stays the same", () => {
    expect(normalizeReference("RZPAY4892")).toBe("RZPAY4892");
  });
});

describe("characterNgrams", () => {
  test("short string still yields trigrams via sentinels", () => {
    const grams = characterNgrams("AB", 3);
    // sentinels: ^AB$ -> ^AB, AB$  (and ^A if we slide)
    expect(grams.length).toBeGreaterThan(0);
  });

  test("default n=3 produces sliding window trigrams", () => {
    const grams = characterNgrams("ABCD", 3);
    // padded: ^^ABCD$$  -> ^^A, ^AB, ABC, BCD, CD$, D$$
    expect(grams).toContain("ABC");
    expect(grams).toContain("BCD");
  });
});

describe("cosineSimilarity", () => {
  test("identical strings → similarity = 1.0 (within 1e-9)", () => {
    const ref = "RZPAYSETTLE4892";
    const a = computeEmbedding(ref);
    const b = computeEmbedding(ref);
    const sim = cosineSimilarity(a, b);
    expect(Math.abs(sim - 1.0)).toBeLessThan(1e-9);
  });

  test("case-only difference → similarity = 1.0 after normalization", () => {
    const a = computeEmbedding(normalizeReference("RAZPAY-SET-4892"));
    const b = computeEmbedding(normalizeReference("razpay-set-4892"));
    const sim = cosineSimilarity(a, b);
    expect(Math.abs(sim - 1.0)).toBeLessThan(1e-9);
  });

  test("typo reference: RAZPAY-SET-4892 vs RZPAY-SETT-4892 → similarity > 0.6", () => {
    const a = computeEmbedding(normalizeReference("RAZPAY-SET-4892"));
    const b = computeEmbedding(normalizeReference("RZPAY-SETT-4892"));
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.6);
  });

  test("completely disjoint strings AAAA vs ZZZZ → similarity < 0.1", () => {
    const a = computeEmbedding(normalizeReference("AAAA"));
    const b = computeEmbedding(normalizeReference("ZZZZ"));
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeLessThan(0.1);
  });

  test("empty string on either side → returns 0, does not throw", () => {
    const a = computeEmbedding("");
    const b = computeEmbedding("RZPAY4892");
    expect(cosineSimilarity(a, b)).toBe(0);
    expect(cosineSimilarity(b, a)).toBe(0);
    expect(cosineSimilarity(a, a)).toBe(0);
  });
});

describe("batchSimilarity", () => {
  test("returns results sorted descending by score", () => {
    const results = batchSimilarity("RZPAY4892", [
      "RZPAY4892",   // identical → 1.0
      "AAABBBCCC",   // unrelated
      "RZPAY4893",   // near typo
    ]);
    expect(results.length).toBe(3);
    // must be sorted descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
    // top result is identical
    expect(results[0].score).toBeCloseTo(1.0, 9);
  });

  test("empty corpus → returns empty array", () => {
    const results = batchSimilarity("RZPAY4892", []);
    expect(results).toEqual([]);
  });
});
