// src/api/server.test.ts — Smoke tests for ReconIQ Bun HTTP API server.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { handleRequest } from "./server";
import { prisma, closePrisma } from "../persistence/db";

describe("ReconIQ API Server Smoke Tests", () => {
  let sampleExceptionId: string;
  let sampleTransactionId: string;
  let sampleMatchGroupId: string;

  beforeAll(async () => {
    // Pick sample real IDs from the seeded Postgres DB
    const ex = await prisma.unresolvedException.findFirst();
    if (ex) sampleExceptionId = ex.unresolvedExceptionId;

    const tx = await prisma.transactionRecord.findFirst({
      where: { dataSource: "BANK_STATEMENT", matchGroupId: null },
    });
    if (tx) sampleTransactionId = tx.transactionRecordId;

    const mg = await prisma.matchGroup.findFirst();
    if (mg) sampleMatchGroupId = mg.matchGroupId;
  }, 30000);

  afterAll(async () => {
    await closePrisma();
  });

  // ── 1. GET /api/overview ───────────────────────────────────────────────────
  it("GET /api/overview returns cost-of-unmatched-cash matching Day 8 metrics report", async () => {
    const req = new Request("http://localhost:3000/api/overview", { method: "GET" });
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.costOfUnmatchedCashPaise).toBe(348598406);
    expect(data.costOfUnmatchedCashInr).toBe("₹34,85,984.06");
    expect(data.unmatchedCount).toBe(169);
    expect(typeof data.totalMatchRate).toBe("number");
    expect(data.matchRateByMethod).toBeDefined();
    expect(data.matchRateByMethod.EXACT).toBeGreaterThan(0);
  });

  // ── 2. GET /api/exceptions?classification=TIMING_LAG ────────────────────────
  it("GET /api/exceptions?classification=TIMING_LAG returns 21 rows", async () => {
    const req = new Request("http://localhost:3000/api/exceptions?classification=TIMING_LAG", { method: "GET" });
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(21);
    expect(data.exceptions.length).toBe(21);
    for (const item of data.exceptions) {
      expect(item.classification).toBe("TIMING_LAG");
      expect(item.unresolvedExceptionId).toBeDefined();
      expect(typeof item.riskScore).toBe("number");
    }
  });

  // ── 3. GET /api/exceptions/:id ──────────────────────────────────────────────
  it("GET /api/exceptions/:id returns 200 for a real ID and 404 for garbage ID", async () => {
    expect(sampleExceptionId).toBeDefined();

    // Real ID
    const reqReal = new Request(`http://localhost:3000/api/exceptions/${sampleExceptionId}`, { method: "GET" });
    const resReal = await handleRequest(reqReal);
    expect(resReal.status).toBe(200);
    const dataReal = await resReal.json();
    expect(dataReal.unresolvedExceptionId).toBe(sampleExceptionId);
    expect(Array.isArray(dataReal.transactions)).toBe(true);

    // Garbage ID
    const reqGarbage = new Request("http://localhost:3000/api/exceptions/non_existent_garbage_id_12345", { method: "GET" });
    const resGarbage = await handleRequest(reqGarbage);
    expect(resGarbage.status).toBe(404);
    const dataGarbage = await resGarbage.json();
    expect(dataGarbage.error).toBe("Exception not found");
    expect(dataGarbage.requestId).toBeDefined();
  });

  // ── 4. POST /api/exceptions/:id/approve on resolved exception returns 409 ───
  it("POST /api/exceptions/:id/approve on a resolved exception returns 409", async () => {
    // Create a temporary resolved exception for this test
    const testExId = `test_resolved_ex_${Date.now()}`;
    await prisma.unresolvedException.create({
      data: {
        unresolvedExceptionId: testExId,
        classification:        "OTHER",
        isResolved:            true,
        resolvedAt:            new Date(),
        resolvedBy:            "test_actor",
        totalAmountPaise:      1000,
        riskScore:             0.5,
      },
    });

    const req = new Request(`http://localhost:3000/api/exceptions/${testExId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chosenCandidateIndex: 0, actorId: "reviewer_1" }),
    });
    const res = await handleRequest(req);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Exception already resolved");
    expect(data.requestId).toBeDefined();

    // Clean up
    await prisma.unresolvedException.delete({ where: { unresolvedExceptionId: testExId } });
  });

  // ── 5. GET /api/transactions/:id ───────────────────────────────────────────
  it("GET /api/transactions/:id returns 200 for real transaction and 404 for missing", async () => {
    expect(sampleTransactionId).toBeDefined();

    const req = new Request(`http://localhost:3000/api/transactions/${sampleTransactionId}`, { method: "GET" });
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.transactionRecordId).toBe(sampleTransactionId);
    expect(data.dataSource).toBe("BANK_STATEMENT");
    expect(typeof data.amountPaise).toBe("number");

    const reqFake = new Request("http://localhost:3000/api/transactions/fake_tx_id_999", { method: "GET" });
    const resFake = await handleRequest(reqFake);
    expect(resFake.status).toBe(404);
  });

  // ── 6. GET /api/transactions/:id/nearest-miss ──────────────────────────────
  it("GET /api/transactions/:id/nearest-miss returns top 3 ranked candidates", async () => {
    expect(sampleTransactionId).toBeDefined();

    const req = new Request(`http://localhost:3000/api/transactions/${sampleTransactionId}/nearest-miss`, { method: "GET" });
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.candidates)).toBe(true);
    expect(data.candidates.length).toBeLessThanOrEqual(3);

    for (const c of data.candidates) {
      expect(c.id).toBeDefined();
      expect(typeof c.delta).toBe("number");
      expect(typeof c.score).toBe("number");
      expect(typeof c.reason).toBe("string");
    }
  });

  // ── 7. GET /api/match-groups/:id ───────────────────────────────────────────
  it("GET /api/match-groups/:id returns match group detail and linked audit trail", async () => {
    expect(sampleMatchGroupId).toBeDefined();

    const req = new Request(`http://localhost:3000/api/match-groups/${sampleMatchGroupId}`, { method: "GET" });
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matchGroupId).toBe(sampleMatchGroupId);
    expect(Array.isArray(data.transactions)).toBe(true);
    expect(Array.isArray(data.auditTrail)).toBe(true);
  });

  // ── 8. CORS & 404 Handling ─────────────────────────────────────────────────
  it("OPTIONS preflight returns CORS headers, unknown path returns 404 with requestId", async () => {
    const reqOptions = new Request("http://localhost:3000/api/overview", { method: "OPTIONS" });
    const resOptions = await handleRequest(reqOptions);
    expect(resOptions.status).toBe(204);
    expect(resOptions.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");

    const req404 = new Request("http://localhost:3000/api/unknown/endpoint", { method: "GET" });
    const res404 = await handleRequest(req404);
    expect(res404.status).toBe(404);
    const data404 = await res404.json();
    expect(data404.error).toContain("Endpoint not found");
    expect(data404.requestId).toBeDefined();
  });
});
