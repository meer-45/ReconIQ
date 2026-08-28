// getExceptionsByClassification.ts — returns exceptions filtered by classification or type.
// Merges fuzzy_match_results.newExceptions with llm_classification_results for full context.

import { readFileSync } from "fs";
import { join, resolve } from "path";
import { getBankRecords } from "./getTransactionById";

const RESULTS_DIR = resolve(__dirname, "../../matching");

export type ExceptionClassification =
  | "TIMING_LAG"
  | "MISSING_COUNTERPART"
  | "DUPLICATE"
  | "OTHER"
  | "FUZZY_LOW_CONFIDENCE"   // raw fuzzy exception type (not yet LLM-classified)
  | "AMBIGUOUS_MATCH"        // subset-sum ambiguous exceptions
  | "UNMATCHED";             // bank records with no match or proposal at all

export interface UnresolvedException {
  exceptionId:          string;
  bankRecordId:         string;
  externalReference:    string;         // bank record ref — populated from CSV
  amountPaise:          number;
  transactionDate:      string;
  exceptionType:        string;         // FUZZY_LOW_CONFIDENCE | AMBIGUOUS_MATCH
  classification?:      string;         // LLM classification if classified
  rootCauseHypothesis?: string;
  confidence?:          number;
  topCandidates:        Array<{ gatewayId: string; similarity: number; ref: string }>;
}

function loadFuzzyExceptions(): UnresolvedException[] {
  const fuzzyRaw = JSON.parse(readFileSync(join(RESULTS_DIR, "fuzzy_match_results.json"), "utf-8"));
  const llmRaw   = JSON.parse(readFileSync(join(RESULTS_DIR, "llm_classification_results.json"), "utf-8"));

  // Build lookup: bankRecordId → CSV fields
  const bankMap = new Map(getBankRecords().map(r => [r.transactionRecordId, r]));

  if (Array.isArray(fuzzyRaw.newExceptions) && fuzzyRaw.newExceptions.length > 0) {
    const llmByException = new Map<string, { classification: string; rootCauseHypothesis: string; confidence: number }>();
    for (const c of (llmRaw.fuzzyClassifications ?? [])) {
      llmByException.set(c.exceptionId, {
        classification:      c.classification,
        rootCauseHypothesis: c.rootCauseHypothesis,
        confidence:          c.confidence,
      });
    }

    return fuzzyRaw.newExceptions.map((ex: any): UnresolvedException => {
      const llm  = llmByException.get(ex.exceptionId);
      const bank = bankMap.get(ex.bankRecordId);
      return {
        exceptionId:          ex.exceptionId,
        bankRecordId:         ex.bankRecordId,
        externalReference:    bank?.externalReference  ?? "",
        amountPaise:          bank?.amountPaise        ?? 0,
        transactionDate:      bank?.transactionDate    ?? "",
        exceptionType:        ex.exceptionType,
        classification:       llm?.classification,
        rootCauseHypothesis:  llm?.rootCauseHypothesis,
        confidence:           llm?.confidence,
        topCandidates:        ex.candidateMetadata?.topCandidates ?? [],
      };
    });
  }

  // Fallback / direct mapping from llm_classification_results.json
  return (llmRaw.fuzzyClassifications ?? []).map((c: any): UnresolvedException => {
    const bank = bankMap.get(c.bankRecordId);
    return {
      exceptionId:          c.exceptionId,
      bankRecordId:         c.bankRecordId,
      externalReference:    bank?.externalReference  ?? "",
      amountPaise:          bank?.amountPaise        ?? 0,
      transactionDate:      bank?.transactionDate    ?? "",
      exceptionType:        "FUZZY_LOW_CONFIDENCE",
      classification:       c.classification,
      rootCauseHypothesis:  c.rootCauseHypothesis,
      confidence:           c.confidence,
      topCandidates:        [],
    };
  });
}

function loadSubsetSumExceptions(): UnresolvedException[] {
  const ssRaw  = JSON.parse(readFileSync(join(RESULTS_DIR, "subset_sum_results.json"), "utf-8"));
  const llmRaw = JSON.parse(readFileSync(join(RESULTS_DIR, "llm_classification_results.json"), "utf-8"));

  const llmBySsBank = new Map<string, { classification: string; rootCauseHypothesis: string; confidence: number }>();
  for (const c of (llmRaw.subsetSumClassifications ?? [])) {
    llmBySsBank.set(c.bankRecordId, {
      classification:      c.classification,
      rootCauseHypothesis: c.rootCauseHypothesis,
      confidence:          c.confidence,
    });
  }

  return (ssRaw.exceptions ?? []).map((ex: any): UnresolvedException => {
    const bankId = ex.bankRecord?.transactionRecordId ?? "";
    const llm    = llmBySsBank.get(bankId);
    return {
      exceptionId:         `ss_ex_${bankId}`,
      bankRecordId:        bankId,
      externalReference:   ex.bankRecord?.externalReference ?? "",
      amountPaise:         ex.bankRecord?.amountPaise       ?? 0,
      transactionDate:     ex.bankRecord?.transactionDate   ?? "",
      exceptionType:       "AMBIGUOUS_MATCH",
      classification:      llm?.classification,
      rootCauseHypothesis: llm?.rootCauseHypothesis,
      confidence:          llm?.confidence,
      topCandidates:       [],  // SS exceptions have candidate subsets, not simple pairs
    };
  });
}

function loadUnmatchedExceptions(): UnresolvedException[] {
  // "UNMATCHED" = bank records in current CSV with no fuzzy proposal and no SS exception
  const fuzzyRaw = JSON.parse(readFileSync(join(RESULTS_DIR, "fuzzy_match_results.json"), "utf-8"));
  const ssRaw    = JSON.parse(readFileSync(join(RESULTS_DIR, "subset_sum_results.json"), "utf-8"));

  const proposed  = new Set<string>((fuzzyRaw.newMatches ?? []).map((m: any) => m.bankRecordId));
  const ssEx      = new Set<string>((ssRaw.exceptions   ?? []).map((e: any) => e.bankRecord?.transactionRecordId));

  return getBankRecords()
    .filter(r => !proposed.has(r.transactionRecordId) && !ssEx.has(r.transactionRecordId))
    .map(r => ({
      exceptionId:      `unmatched_${r.transactionRecordId}`,
      bankRecordId:     r.transactionRecordId,
      externalReference: r.externalReference,
      amountPaise:      r.amountPaise,
      transactionDate:  r.transactionDate,
      exceptionType:    "UNMATCHED",
      topCandidates:    [],
    }));
}

// Module-level cache
let _fuzzy:     UnresolvedException[] | null = null;
let _ss:        UnresolvedException[] | null = null;
let _unmatched: UnresolvedException[] | null = null;

export function getExceptionsByClassification(cls: ExceptionClassification): UnresolvedException[] {
  if (!_fuzzy)     _fuzzy     = loadFuzzyExceptions();
  if (!_ss)        _ss        = loadSubsetSumExceptions();
  if (!_unmatched) _unmatched = loadUnmatchedExceptions();

  if (cls === "FUZZY_LOW_CONFIDENCE") {
    return _fuzzy.filter(e => e.exceptionType === "FUZZY_LOW_CONFIDENCE");
  }
  if (cls === "AMBIGUOUS_MATCH") {
    return _ss;
  }
  if (cls === "UNMATCHED") {
    return _unmatched;
  }
  // LLM classification filter — search across fuzzy + SS exceptions
  return [..._fuzzy, ..._ss].filter(e => e.classification === cls);
}
