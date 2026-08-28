// web/src/components/PipelineTraceModal.tsx — Staged pipeline execution trace modal streaming over WebSocket.

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  X,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Zap,
} from "lucide-react";

export interface TraceStageEvent {
  stage:           "exact" | "subset_sum" | "fee_inference" | "embedding" | "classify" | "done";
  status?:         string;
  note?:           string;
  candidateId?:    string;
  classification?: string;
  confidence?:     number;
  matchGroupId?:   string | null;
  exceptionId?:    string | null;
}

interface PipelineTraceModalProps {
  transactionId: string;
  isOpen:        boolean;
  onClose:       () => void;
}

const STAGES = [
  { id: "exact",         label: "Layer 1a: Exact Matching",       desc: "Deterministic 1:1 normalized reference lookup within 3d window" },
  { id: "subset_sum",    label: "Layer 1b: Subset-Sum DP",        desc: "Dynamic programming knapsack bundle matching (Many-to-One)" },
  { id: "fee_inference", label: "Layer 1.5: Fee Schedule",        desc: "MDR/GST rate model inference (3.3646% rate schedule)" },
  { id: "embedding",     label: "Layer 2a: TF-IDF Embedding",     desc: "Character trigram cosine similarity candidate disambiguation" },
  { id: "classify",      label: "Layer 2b: LLM Classification",   desc: "Gemini Flash root-cause hypothesis generation" },
];

export const PipelineTraceModal: React.FC<PipelineTraceModalProps> = ({
  transactionId,
  isOpen,
  onClose,
}) => {
  const [stages, setStages] = useState<Map<string, TraceStageEvent>>(new Map());
  const [currentStage, setCurrentStage] = useState<string>("exact");
  const [isDone, setIsDone] = useState<boolean>(false);
  const [finalResult, setFinalResult] = useState<TraceStageEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const startTrace = useCallback(() => {
    setStages(new Map());
    setCurrentStage("exact");
    setIsDone(false);
    setFinalResult(null);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const wsUrl = `${protocol}//${host}:3000/ws`;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type:          "subscribe",
          channel:       "trace",
          transactionId: transactionId,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "trace_stage" && data.transactionId === transactionId) {
          const stageEvent: TraceStageEvent = data;

          if (stageEvent.stage === "done") {
            setIsDone(true);
            setFinalResult(stageEvent);
          } else {
            setCurrentStage(stageEvent.stage);
            setStages((prev) => {
              const next = new Map(prev);
              next.set(stageEvent.stage, stageEvent);
              return next;
            });
          }
        }
      } catch {
        /* ignore parse errors */
      }
    };
  }, [transactionId]);

  useEffect(() => {
    if (isOpen) {
      startTrace();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }
  }, [isOpen, startTrace]);

  if (!isOpen) return null;

  const getStageIcon = (stageId: string) => {
    const event = stages.get(stageId);
    if (!event) {
      return <Clock className="h-4 w-4 text-muted animate-pulse" />;
    }

    if (event.status === "matched" || event.status === "candidate_found") {
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    }
    if (event.status === "proposal") {
      return <Sparkles className="h-4 w-4 text-amber-500" />;
    }
    return <XCircle className="h-4 w-4 text-muted" />;
  };

  const getStatusBadge = (event?: TraceStageEvent) => {
    if (!event || !event.status) {
      return (
        <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-mono text-muted">
          Evaluating…
        </span>
      );
    }

    switch (event.status) {
      case "matched":
        return (
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            MATCHED
          </span>
        );
      case "candidate_found":
        return (
          <span className="rounded bg-purple-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-purple-600 dark:text-purple-400 border border-purple-500/20">
            CANDIDATE FOUND
          </span>
        );
      case "proposal":
        return (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
            PROPOSAL: {event.classification}
          </span>
        );
      case "ambiguous_bundle":
        return (
          <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
            AMBIGUOUS BUNDLE
          </span>
        );
      case "skipped":
        return (
          <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-mono text-muted">
            BYPASSED
          </span>
        );
      default:
        return (
          <span className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/20">
            {event.status.toUpperCase()}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="border-b border-border bg-accent/40 px-6 py-4 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-semibold text-primary-500 border border-primary-500/20">
                <Zap className="h-3.5 w-3.5" />
                Live Pipeline Trace
              </span>
              <span className="text-xs font-mono text-muted">300ms Staged Replay</span>
            </div>
            <h2 className="text-base font-bold font-mono text-foreground flex items-center gap-2">
              <span>{transactionId}</span>
            </h2>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted hover:text-foreground hover:bg-accent transition-colors"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border">
            {STAGES.map((stage, idx) => {
              const event = stages.get(stage.id);
              const isCurrent = currentStage === stage.id && !isDone;
              const isRevealed = !!event;

              return (
                <div key={stage.id} className="relative group">
                  {/* Timeline node icon */}
                  <div
                    className={`absolute -left-6 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-card border-2 shadow-sm transition-colors ${
                      isRevealed
                        ? event.status === "matched"
                          ? "border-emerald-500 text-emerald-500"
                          : "border-primary-500 text-primary-500"
                        : "border-border text-muted"
                    }`}
                  >
                    {getStageIcon(stage.id)}
                  </div>

                  {/* Stage Card */}
                  <div
                    className={`rounded-xl border p-4 transition-all ${
                      isCurrent
                        ? "border-primary-500 bg-primary-500/5 shadow-md shadow-primary-500/10"
                        : isRevealed
                        ? "border-border bg-card shadow-sm"
                        : "border-border/40 bg-accent/20 opacity-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-foreground">{stage.label}</span>
                        {getStatusBadge(event)}
                      </div>
                      <span className="text-[10px] font-mono text-muted uppercase">Stage {idx + 1}/5</span>
                    </div>

                    <p className="text-xs text-muted mt-1 leading-relaxed">
                      {event?.note || stage.desc}
                    </p>

                    {/* Candidate Link if present */}
                    {event?.candidateId && (
                      <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-2 text-xs">
                        <span className="text-muted">Discovered Candidate:</span>
                        <Link
                          to={`/transactions/${encodeURIComponent(event.candidateId)}`}
                          onClick={onClose}
                          className="font-mono font-bold text-primary-500 hover:underline flex items-center gap-1 bg-primary-500/10 px-2 py-0.5 rounded"
                        >
                          <span>{event.candidateId}</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    )}

                    {/* Classification confidence if present */}
                    {event?.confidence !== undefined && (
                      <div className="mt-2 text-xs font-mono text-muted flex items-center gap-2">
                        <span>Confidence:</span>
                        <strong className="text-foreground">{(event.confidence * 100).toFixed(0)}%</strong>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Terminal Result Banner */}
          {isDone && finalResult && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2 mt-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  Terminal State: {finalResult.status}
                </span>
                <span className="text-xs font-mono text-muted">Complete</span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {finalResult.matchGroupId && (
                  <div>
                    <span className="text-muted">Reconciled in: </span>
                    <Link
                      to={`/match-groups/${encodeURIComponent(finalResult.matchGroupId)}`}
                      onClick={onClose}
                      className="font-mono font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      {finalResult.matchGroupId}
                    </Link>
                  </div>
                )}
                {finalResult.exceptionId && (
                  <div>
                    <span className="text-muted">Flagged in: </span>
                    <Link
                      to={`/exceptions/${encodeURIComponent(finalResult.exceptionId)}`}
                      onClick={onClose}
                      className="font-mono font-bold text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      {finalResult.exceptionId}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Replay Button */}
        <div className="border-t border-border bg-card px-6 py-3.5 flex items-center justify-between">
          <span className="text-xs font-mono text-muted">
            {isDone ? "Trace finished (5 stages evaluated)" : `Evaluating ${currentStage}…`}
          </span>

          <button
            onClick={startTrace}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-accent px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent/80 transition-colors shadow-sm"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Replay Trace</span>
          </button>
        </div>
      </div>
    </div>
  );
};
