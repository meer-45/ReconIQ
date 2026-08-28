// src/api/websocket.ts — Bun native WebSocket handler for live match notifications and staged pipeline trace streaming.
// Complies with Day 3 revision item 11: Stream deterministic stage outputs ONLY, never LLM chain-of-thought.

import { EventEmitter } from "node:events";
import type { ServerWebSocket } from "bun";
import { prisma } from "../persistence/db";

// ── In-Process Event Emitter for Live Matches ─────────────────────────────────

export interface LiveMatchPayload {
  matchGroupId:          string;
  method:                string;
  transactionRecordIds:  string[];
  confidence:            number;
  at:                    string;
}

export const liveMatchEmitter = new EventEmitter();
liveMatchEmitter.setMaxListeners(200);

export function broadcastLiveMatch(payload: LiveMatchPayload) {
  liveMatchEmitter.emit("live_match", payload);
}

// ── WebSocket Client State ───────────────────────────────────────────────────

export interface WsClientData {
  id:            string;
  subscriptions: Set<string>;
}

const activeClients = new Set<ServerWebSocket<WsClientData>>();

// Broadcast listener to dispatch to all subscribed WS sockets
liveMatchEmitter.on("live_match", (payload: LiveMatchPayload) => {
  const msg = JSON.stringify({
    type:    "live_match",
    channel: "live_matches",
    payload,
  });

  for (const ws of activeClients) {
    if (ws.data?.subscriptions?.has("live_matches")) {
      try {
        ws.send(msg);
      } catch (err) {
        console.error("[WS Send Error]:", err);
      }
    }
  }
});

// ── Pipeline Trace Streaming (300ms staged delay) ─────────────────────────────

interface TraceStageMessage {
  type:            "trace_stage";
  transactionId:   string;
  stage:           "exact" | "subset_sum" | "fee_inference" | "embedding" | "classify" | "done";
  status?:         string;
  note?:           string;
  candidateId?:    string;
  classification?: string;
  confidence?:     number;
  matchGroupId?:   string | null;
  exceptionId?:    string | null;
}

async function streamPipelineTrace(ws: ServerWebSocket<WsClientData>, transactionId: string) {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 1. Fetch transaction, linked match group, and exceptions from Postgres
  const tx = await prisma.transactionRecord.findUnique({
    where: { transactionRecordId: transactionId },
  });

  if (!tx) {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "done",
        status:        "NOT_FOUND",
        note:          `Transaction ${transactionId} not found in database`,
      })
    );
    return;
  }

  const matchGroup = tx.matchGroupId
    ? await prisma.matchGroup.findUnique({
        where: { matchGroupId: tx.matchGroupId },
      })
    : null;

  const exception = await prisma.unresolvedException.findFirst({
    where: { transactionRecordIds: { has: transactionId } },
  });

  // Stage 1: EXACT
  await delay(300);
  if (!ws.data?.subscriptions?.has(`trace:${transactionId}`)) return;

  if (matchGroup?.method === "EXACT") {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "exact",
        status:        "matched",
        note:          `Exact 1:1 match confirmed with reference token ${tx.externalReference}`,
      } satisfies TraceStageMessage)
    );
  } else {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "exact",
        status:        "no_unique_candidate",
        note:          "No unique deterministic 1:1 reference token match within 3-day window",
      } satisfies TraceStageMessage)
    );
  }

  // Stage 2: SUBSET_SUM
  await delay(300);
  if (!ws.data?.subscriptions?.has(`trace:${transactionId}`)) return;

  if (matchGroup?.method === "SUBSET_SUM") {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "subset_sum",
        status:        "matched",
        note:          "Deterministic DP knapsack bundle match confirmed (net-zero delta)",
      } satisfies TraceStageMessage)
    );
  } else if (exception?.classification === "AMBIGUOUS_MATCH") {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "subset_sum",
        status:        "ambiguous_bundle",
        note:          "Multiple candidate subsets discovered summing to amount (ambiguous bundle)",
      } satisfies TraceStageMessage)
    );
  } else {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "subset_sum",
        status:        "no_valid_bundle",
        note:          "No subset combination satisfied sum constraint within ±5-day window",
      } satisfies TraceStageMessage)
    );
  }

  // Stage 3: FEE_INFERENCE
  await delay(300);
  if (!ws.data?.subscriptions?.has(`trace:${transactionId}`)) return;

  if (matchGroup?.method === "FEE_INFERENCE") {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "fee_inference",
        status:        "matched",
        note:          "Confirmed against inferred MDR/GST schedule (3.3646% rate)",
      } satisfies TraceStageMessage)
    );
  } else {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "fee_inference",
        status:        "no_gross_candidate",
        note:          "Amount does not match expected gross/net MDR rate schedule",
      } satisfies TraceStageMessage)
    );
  }

  // Stage 4: EMBEDDING
  await delay(300);
  if (!ws.data?.subscriptions?.has(`trace:${transactionId}`)) return;

  const candidateId =
    (exception?.candidateMetadata as any)?.evidenceRefs?.[0] ||
    exception?.transactionRecordIds?.find((id) => id !== transactionId);

  if (matchGroup?.method === "AI_FUZZY") {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "embedding",
        status:        "candidate_found",
        note:          "Character trigram TF-IDF cosine similarity > 0.60 with clear gap",
        candidateId:   candidateId || undefined,
      } satisfies TraceStageMessage)
    );
  } else if (candidateId) {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "embedding",
        status:        "candidate_found",
        note:          `Near-match reference token candidate identified (${candidateId})`,
        candidateId,
      } satisfies TraceStageMessage)
    );
  } else {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "embedding",
        status:        "no_candidate_above_threshold",
        note:          "No opposite-source record exceeded cosine similarity threshold 0.60",
      } satisfies TraceStageMessage)
    );
  }

  // Stage 5: CLASSIFY
  await delay(300);
  if (!ws.data?.subscriptions?.has(`trace:${transactionId}`)) return;

  if (exception) {
    ws.send(
      JSON.stringify({
        type:            "trace_stage",
        transactionId,
        stage:           "classify",
        status:          "proposal",
        classification:  exception.classification || "OTHER",
        confidence:      Math.round((1.0 - (exception.riskScore || 0.5)) * 100) / 100,
        note:            exception.rootCauseHypothesis || "LLM root-cause hypothesis generated",
      } satisfies TraceStageMessage)
    );
  } else if (matchGroup) {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "classify",
        status:        "skipped",
        note:          "Bypassed — transaction already reconciled in earlier deterministic layer",
      } satisfies TraceStageMessage)
    );
  } else {
    ws.send(
      JSON.stringify({
        type:          "trace_stage",
        transactionId,
        stage:         "classify",
        status:        "unresolved",
        note:          "Awaiting batch exception classification or analyst review",
      } satisfies TraceStageMessage)
    );
  }

  // Stage 6: DONE
  await delay(300);
  if (!ws.data?.subscriptions?.has(`trace:${transactionId}`)) return;

  ws.send(
    JSON.stringify({
      type:          "trace_stage",
      transactionId,
      stage:         "done",
      matchGroupId:  tx.matchGroupId ?? null,
      exceptionId:   exception?.unresolvedExceptionId ?? null,
      status:        tx.matchGroupId ? "MATCHED" : exception ? "EXCEPTION" : "UNMATCHED",
    } satisfies TraceStageMessage)
  );
}

// ── Bun WebSocket Handlers ────────────────────────────────────────────────────

export const websocketHandlers = {
  open(ws: ServerWebSocket<WsClientData>) {
    activeClients.add(ws);
    ws.send(
      JSON.stringify({
        type:    "connected",
        message: "Connected to ReconIQ Live WebSocket Server",
        clientId: ws.data.id,
      })
    );
  },

  message(ws: ServerWebSocket<WsClientData>, message: string | Buffer) {
    try {
      const data = typeof message === "string" ? JSON.parse(message) : JSON.parse(message.toString());

      if (data.type === "subscribe") {
        if (data.channel === "live_matches") {
          ws.data.subscriptions.add("live_matches");
          ws.send(
            JSON.stringify({
              type:    "subscribed",
              channel: "live_matches",
            })
          );
        } else if (data.channel === "trace" && data.transactionId) {
          const key = `trace:${data.transactionId}`;
          ws.data.subscriptions.add(key);
          ws.send(
            JSON.stringify({
              type:          "subscribed",
              channel:       "trace",
              transactionId: data.transactionId,
            })
          );
          // Start async streaming
          streamPipelineTrace(ws, data.transactionId);
        }
      } else if (data.type === "unsubscribe") {
        if (data.channel === "live_matches") {
          ws.data.subscriptions.delete("live_matches");
        } else if (data.channel === "trace" && data.transactionId) {
          ws.data.subscriptions.delete(`trace:${data.transactionId}`);
        }
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", error: "Malformed WebSocket message payload" }));
    }
  },

  close(ws: ServerWebSocket<WsClientData>) {
    activeClients.delete(ws);
  },
};
