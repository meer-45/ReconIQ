// runMetrics.ts — CLI entry point for the metrics engine.
// Usage: bun run src/metrics/runMetrics.ts
// Outputs: src/metrics/metrics_report.json + formatted table to stdout.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { computeMetrics } from "./computeMetrics";
import { MetricsReportSchema } from "./metricsSchema";

const METRICS_DIR = join(process.cwd(), "src", "metrics");
const OUT_PATH    = join(METRICS_DIR, "metrics_report.json");

// ── Table renderer ─────────────────────────────────────────────────────────────
function pct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "  N/A  ";
  return `${(v * 100).toFixed(decimals)}%`.padStart(7);
}

function num(v: number, width = 7): string {
  return String(v).padStart(width);
}

function renderTable(report: ReturnType<typeof computeMetrics>): void {
  const COL_METHOD = 15;
  const COL_NUM    = 9;
  const COL_PCT    = 9;
  const LINE       = "─".repeat(COL_METHOD + COL_NUM * 2 + COL_PCT * 2 + 4 * 3 + 1);

  const header = [
    "Method".padEnd(COL_METHOD),
    "Matches".padStart(COL_NUM),
    "GW Recs".padStart(COL_NUM),
    "Precision".padStart(COL_PCT),
    "Recall".padStart(COL_PCT),
  ].join(" │ ");

  console.log(`\n${"═".repeat(LINE.length)}`);
  console.log("  ReconIQ — Pipeline Metrics Report");
  console.log(`  Generated: ${report.generatedAt}`);
  console.log(`${"═".repeat(LINE.length)}`);
  console.log(`\n  ${header}`);
  console.log(`  ${LINE}`);

  for (const m of report.methods) {
    const row = [
      m.method.padEnd(COL_METHOD),
      num(m.matchedBankRecords, COL_NUM),
      num(m.matchedGatewayRecords, COL_NUM),
      pct(m.precision, 1).padStart(COL_PCT),
      pct(m.recall, 1).padStart(COL_PCT),
    ].join(" │ ");
    console.log(`  ${row}`);

    if (m.note) {
      // Wrap note at 80 chars
      const notePrefix = " ".repeat(COL_METHOD + 4);
      const noteWords  = m.note.split(" ");
      let line = "";
      const noteLines: string[] = [];
      for (const w of noteWords) {
        if ((line + w).length > 76) { noteLines.push(line.trim()); line = ""; }
        line += w + " ";
      }
      if (line.trim()) noteLines.push(line.trim());
      for (const nl of noteLines) {
        console.log(`  ${" ".repeat(COL_METHOD)}    ↳ ${nl}`);
      }
    }
  }

  console.log(`  ${LINE}`);

  // Total match rate
  console.log(`\n  Total match rate (fuzzy proposals / bank CSV):  ${pct(report.totalMatchRate, 2).trim()}`);
  console.log(`  (${report.methods.find(m => m.method === "AI_FUZZY")?.matchedBankRecords ?? 0} of ${report.totalBankRecords} bank records have at least one fuzzy proposal)`);

  // Cost of unmatched
  console.log(`\n  Cost of unmatched cash: ${report.unmatchedCash.unmatchedAmountFormatted}`);
  console.log(`  (${report.unmatchedCash.unmatchedBankRecords} of ${report.unmatchedCash.totalBankRecords} bank records, ${pct(report.unmatchedCash.unmatchedAmountFraction, 1).trim()} of total bank-side volume)`);

  // LLM breakdown
  const llm = report.llmBreakdown;
  console.log(`\n  LLM Classification breakdown (${llm.totalHypotheses} hypotheses, 0 committed):`);
  console.log(`    TIMING_LAG          : ${llm.TIMING_LAG}`);
  console.log(`    MISSING_COUNTERPART : ${llm.MISSING_COUNTERPART}`);
  console.log(`    OTHER               : ${llm.OTHER}`);
  console.log(`    DUPLICATE           : ${llm.DUPLICATE}`);
  console.log(`    Avg confidence      : ${(llm.avgConfidence * 100).toFixed(1)}%`);
  console.log(`    Cache hits          : ${llm.cacheHits} / ${llm.totalHypotheses}`);

  // GT summary
  const gt = report.groundTruth;
  console.log(`\n  Ground Truth (${gt.totalExpectedMatches} entries in ground_truth.json):`);
  for (const [algo, cnt] of Object.entries(gt.byAlgorithm)) {
    console.log(`    ${algo.padEnd(16)}: ${cnt}`);
  }

  console.log(`\n${"═".repeat(LINE.length)}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main(): void {
  console.log("Computing metrics…");

  const report = computeMetrics();

  // Validate with Zod before writing
  const parsed = MetricsReportSchema.safeParse(report);
  if (!parsed.success) {
    console.error("Zod validation of metrics report failed:");
    console.error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    process.exit(1);
  }

  // Write JSON
  mkdirSync(METRICS_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(`✓ Report written to ${OUT_PATH}\n`);

  // Render table
  renderTable(report);
}

main();
