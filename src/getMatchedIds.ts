import { readFileSync } from "fs";
import { join } from "path";

interface ExactMatchResults {
  matchGroups: { matchGroupId: string }[];
  auditTrailEntries: {
    auditTrailId: string;
    transactionRecordId: string;
    matchGroupId: string;
  }[];
  matchedPairs: { bankId: string; gatewayId: string }[];
}

interface SubsetSumResults {
  matches: {
    bankRecord: { transactionRecordId: string };
    gatewaySubset: { transactionRecordId: string }[];
  }[];
  exceptions: {
    bankRecord: { transactionRecordId: string };
    candidates: {
      gatewaySubset: { transactionRecordId: string }[];
    }[];
  }[];
  auditTrail: {
    auditTrailId: string;
    transactionRecordId: string;
    matchGroupId: string | null;
  }[];
}

// Load exact match results
const exactPath = join(process.cwd(), 'src', 'matching', 'exact_match_results.json');
const exactResults: ExactMatchResults = JSON.parse(readFileSync(exactPath, 'utf-8'));

// Load subset sum results
const subsetSumPath = join(process.cwd(), 'src', 'matching', 'subset_sum_results.json');
const subsetSumResults: SubsetSumResults = JSON.parse(readFileSync(subsetSumPath, 'utf-8'));

// Collect matched transaction IDs from exact results
const exactMatchedIds = new Set<string>();
exactResults.auditTrailEntries.forEach(entry => {
  if (entry.transactionRecordId) {
    exactMatchedIds.add(entry.transactionRecordId);
  }
});

// Also from matchedPairs? The auditTrailEntries should already cover both bank and gateway.
// But let's also add from matchedPairs to be safe.
exactResults.matchedPairs.forEach(pair => {
  exactMatchedIds.add(pair.bankId);
  exactMatchedIds.add(pair.gatewayId);
});

// Collect matched transaction IDs from subset sum results
const subsetSumMatchedIds = new Set<string>();
subsetSumResults.auditTrail.forEach(entry => {
  if (entry.transactionRecordId && entry.matchGroupId) {
    subsetSumMatchedIds.add(entry.transactionRecordId);
  }
});

// Also from matches
subsetSumResults.matches.forEach(match => {
  subsetSumMatchedIds.add(match.bankRecord.transactionRecordId);
  match.gatewaySubset.forEach(gw => {
    subsetSumMatchedIds.add(gw.transactionRecordId);
  });
});

// Exceptions are not matched, so we don't add them.

// Combine
const allMatchedIds = new Set([...exactMatchedIds, ...subsetSumMatchedIds]);

console.log(`Exact matched IDs: ${exactMatchedIds.size}`);
console.log(`Subset-sum matched IDs: ${subsetSumMatchedIds.size}`);
console.log(`Total unique matched IDs: ${allMatchedIds.size}`);

// Output as JSON array for use in other scripts
console.log(JSON.stringify(Array.from(allMatchedIds)));