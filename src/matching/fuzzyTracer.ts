// fuzzyTracer.ts — per-batch telemetry scaffolding for Layer 2a (and Day 7 LLM layer)
// Writes to logs/fuzzy-trace-<runId>.jsonl. No npm dependency. No Langfuse.
// Shape is designed so Day 7 can add: tokens, costRupees, modelId — zero interface churn.

import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";

export interface TracerEntry {
  runId:              string;
  batchLabel:         string;
  wallClockMs:        number;
  embeddingsComputed: number;
  similaritiesComputed: number;
  proposalsEmitted:   number;
  // Day 7 placeholders — null today, filled when LLM lands
  tokens:             null;
  costRupees:         null;
  modelId:            null;
  timestamp:          string;
}

export interface LlmTracerEntry {
  runId:              string;
  batchLabel:         string;
  wallClockMs:        number;
  modelId:            string | null;
  promptTokens:       number;
  completionTokens:   number;
  costRupees:         number;
  cacheHit:           boolean;
  timestamp:          string;
}

export class FuzzyTracer {
  private runId:      string;
  private logPath:    string;
  private llmLogPath: string;

  constructor(runId: string) {
    this.runId      = runId;
    const logsDir    = join(process.cwd(), "logs");
    mkdirSync(logsDir, { recursive: true });
    this.logPath    = join(logsDir, `fuzzy-trace-${runId}.jsonl`);
    this.llmLogPath = join(logsDir, `llm-trace-${runId}.jsonl`);
  }

  log(entry: Omit<TracerEntry, "runId" | "timestamp" | "tokens" | "costRupees" | "modelId">): void {
    const full: TracerEntry = {
      runId:      this.runId,
      ...entry,
      tokens:     null,
      costRupees: null,
      modelId:    null,
      timestamp:  new Date().toISOString(),
    };
    appendFileSync(this.logPath, JSON.stringify(full) + "\n", "utf-8");
  }

  /** Extended for Day 7 — logs LLM call telemetry to a separate file */
  logLlm(entry: Omit<LlmTracerEntry, "runId" | "timestamp">): void {
    const full: LlmTracerEntry = {
      runId:     this.runId,
      ...entry,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(this.llmLogPath, JSON.stringify(full) + "\n", "utf-8");
  }
}
