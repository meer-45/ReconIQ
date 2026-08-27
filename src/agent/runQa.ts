// runQa.ts — CLI entry point for the Q&A agent.
// Usage: bun run src/agent/runQa.ts "<question>"

import { runQaAgent } from "./qaAgent";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: bun run src/agent/runQa.ts "<question>"');
    process.exit(1);
  }

  console.log(`\n┌─ ReconIQ Q&A ─────────────────────────────────────────────────`);
  console.log(`│ Q: ${question}`);
  console.log(`└───────────────────────────────────────────────────────────────\n`);

  const t0 = Date.now();
  let result: Awaited<ReturnType<typeof runQaAgent>>;
  try {
    result = await runQaAgent(question);
  } catch (err: any) {
    console.error(`FATAL: ${err.message ?? err}`);
    process.exit(1);
  }

  const { answer, auditRow, cacheHit, latencyMs } = result;

  // Answer
  console.log(`Answer:`);
  console.log(`  ${answer.answer.split("\n").join("\n  ")}`);

  // Cited IDs
  if (answer.citedIds.length > 0) {
    console.log(`\nCited IDs (${answer.citedIds.length}):`);
    for (const id of answer.citedIds.slice(0, 20)) {
      console.log(`  • ${id}`);
    }
    if (answer.citedIds.length > 20) {
      console.log(`  … and ${answer.citedIds.length - 20} more`);
    }
  }

  // Metadata footer
  console.log(`\n┌─ Metadata ─────────────────────────────────────────────────────`);
  console.log(`│ Confidence:   ${(answer.confidence * 100).toFixed(0)}%`);
  console.log(`│ Cache hit:    ${cacheHit}`);
  console.log(`│ Latency:      ${latencyMs}ms`);
  console.log(`│ Tools called: ${answer.toolCallsMade.length}`);
  for (const t of answer.toolCallsMade) {
    console.log(`│   → ${t}`);
  }
  console.log(`│ Audit row:    ${auditRow.auditTrailId}`);
  console.log(`│   rowHash:    ${auditRow.rowHash.slice(0, 32)}…`);
  console.log(`└───────────────────────────────────────────────────────────────\n`);
}

main();
