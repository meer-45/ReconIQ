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

export class FuzzyTracer {
  private runId:   string;
  private logPath: string;

  constructor(runId: string) {
    this.runId   = runId;
    const logsDir = join(process.cwd(), "logs");
    mkdirSync(logsDir, { recursive: true });
    this.logPath = join(logsDir, `fuzzy-trace-${runId}.jsonl`);
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
}
