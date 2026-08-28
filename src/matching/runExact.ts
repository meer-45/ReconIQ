// src/matching/runExact.ts — Runner entry point for exact matching layer

import { join } from "path";
import { writeFileSync } from "fs";
import { runExactMatch } from "./exact";

async function main() {
  const dataDir = join(process.cwd(), "data");
  const gtPath = join(process.cwd(), "data", "ground_truth.json");

  const results = await runExactMatch(dataDir, gtPath);
  const outPath = join(process.cwd(), "src", "matching", "exact_match_results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nExact match results written to ${outPath}`);
}

main().catch((err) => {
  console.error("Error in runExact:", err);
  process.exit(1);
});
