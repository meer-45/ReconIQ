// src/matching/runExact.ts — Runner entry point for exact matching layer

import { join, resolve } from "path";
import { writeFileSync } from "fs";
import { runExactMatch } from "./exact";

async function main() {
  const dataDir = resolve(__dirname, "../../data");
  const gtPath = resolve(__dirname, "../../data/ground_truth.json");

  const results = await runExactMatch(dataDir, gtPath);
  const outPath = resolve(__dirname, "exact_match_results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nExact match results written to ${outPath}`);
}

main().catch((err) => {
  console.error("Error in runExact:", err);
  process.exit(1);
});
