// getTransactionById.ts — look up any TransactionRecord by ID from current CSVs.

import { readFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");

export interface TransactionRecord {
  transactionRecordId: string;
  dataSource:          "BANK_STATEMENT" | "GATEWAY_SETTLEMENT";
  externalReference:   string;
  amountPaise:         number;
  currencyCode:        string;
  transactionDate:     string;
  ingestedAt:          string;
  rawDescription:      string;
  rawPayload:          string;
}

function parseCsv(path: string, dataSource: "BANK_STATEMENT" | "GATEWAY_SETTLEMENT"): TransactionRecord[] {
  const lines  = readFileSync(path, "utf-8").split("\n").filter(l => l.trim());
  const header = lines[0].replace(/"/g, "").split(",");
  const idx    = (f: string) => header.indexOf(f);
  const records: TransactionRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(",");
    if (v.length <= idx("transactionRecordId")) continue;
    const g = (f: string) => v[idx(f)]?.replace(/"/g, "") ?? "";
    records.push({
      transactionRecordId: g("transactionRecordId"),
      dataSource,
      externalReference:   g("externalReference"),
      amountPaise:         parseInt(g("amountPaise"), 10) || 0,
      currencyCode:        g("currencyCode"),
      transactionDate:     g("transactionDate"),
      ingestedAt:          g("ingestedAt"),
      rawDescription:      g("rawDescription"),
      rawPayload:          g("rawPayload"),
    });
  }
  return records;
}

// Module-level cache — loaded once per process
let _bank:    TransactionRecord[] | null = null;
let _gateway: TransactionRecord[] | null = null;

function allRecords(): TransactionRecord[] {
  if (!_bank)    _bank    = parseCsv(join(DATA_DIR, "bank_statement.csv"),    "BANK_STATEMENT");
  if (!_gateway) _gateway = parseCsv(join(DATA_DIR, "gateway_settlement.csv"), "GATEWAY_SETTLEMENT");
  return [..._bank, ..._gateway];
}

export function getTransactionById(id: string): TransactionRecord | null {
  return allRecords().find(r => r.transactionRecordId === id) ?? null;
}

/** Exposed for reuse by other tools. */
export function getBankRecords():    TransactionRecord[] { return allRecords().filter(r => r.dataSource === "BANK_STATEMENT"); }
export function getGatewayRecords(): TransactionRecord[] { return allRecords().filter(r => r.dataSource === "GATEWAY_SETTLEMENT"); }
