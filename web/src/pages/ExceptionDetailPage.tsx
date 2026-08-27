// web/src/pages/ExceptionDetailPage.tsx — Interactive Exception Detail with AMBIGUOUS_MATCH side-by-side candidates, score breakdowns, human approval, and rejection.

import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { type ExceptionDetailResponse } from "../api/schemas";
import { formatInr, formatDate } from "../utils/formatters";
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Check,
  Layers,
  Bot,
  XCircle,
  Award,
  Sparkles,
  UserCheck,
} from "lucide-react";

interface CandidateRecord {
  transactionRecordId: string;
  externalReference: string;
  amountPaise: number;
  transactionDate?: string;
}

interface CandidateSubset {
  candidateIndex: number;
  gatewayRecords: CandidateRecord[];
  sumPaise: number;
  deltaPaise: number;
  finalScore: number;
  amountPrecision?: number;
  dateProximity?: number;
  subsetSizePenalty?: number;
}

export const ExceptionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ExceptionDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getException(id);
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load exception detail");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleApproveCandidate = async (chosenIndex: number) => {
    if (!id || !data) return;
    try {
      setActionLoading(true);
      const res = await api.approveException(id, {
        chosenCandidateIndex: chosenIndex,
        actorId: "human_analyst_1",
      });
      setToastMessage(`✓ Match Approved! Created MatchGroup: ${res.matchGroupId}`);
      setTimeout(() => {
        navigate(`/match-groups/${encodeURIComponent(res.matchGroupId)}`);
      }, 1000);
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!id || !data) return;
    if (!confirm("Are you sure you want to reject this exception?")) return;
    try {
      setActionLoading(true);
      await api.rejectException(id, {
        actorId: "human_analyst_1",
        reason: "Manual rejection: none of the candidates matched the bank record",
      });
      setToastMessage("✓ Exception marked as REJECTED.");
      fetchDetail();
    } catch (err: any) {
      alert(`Rejection failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkResolved = async () => {
    if (!id || !data) return;
    try {
      setActionLoading(true);
      await api.resolveException(id, {
        actorId: "human_analyst_1",
        reason: `Manually reviewed and resolved based on hypothesis: ${data.rootCauseHypothesis || "Verified"}`,
      });
      setToastMessage("✓ Exception marked as RESOLVED.");
      fetchDetail();
    } catch (err: any) {
      alert(`Resolution failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <RefreshCw className="h-5 w-5 animate-spin text-primary-500" />
          <span className="text-sm font-medium">Loading exception details…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-4">
        <Link to="/exceptions" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Exceptions
        </Link>
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-600 dark:text-red-400">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6" />
            <div>
              <h3 className="font-semibold">Exception Not Found</h3>
              <p className="text-sm text-red-500/80">{error || `No exception found with ID: ${id}`}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Parse candidate subsets if available
  const isAmbiguous = data.classification === "AMBIGUOUS_MATCH";
  const rawMeta: any = data.candidateMetadata;
  const candidates: CandidateSubset[] =
    rawMeta?.candidates && Array.isArray(rawMeta.candidates)
      ? rawMeta.candidates
      : [];

  const bankTx = data.transactions.find((t) => t.dataSource === "BANK_STATEMENT") || data.transactions[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* ── Breadcrumb & Top Bar ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <Link to="/exceptions" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Exceptions</span>
        </Link>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 font-semibold text-sm flex items-center gap-2 shadow-sm animate-fade-in">
            <CheckCircle2 className="h-5 w-5" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2.5 py-1 text-xs font-mono font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {data.classification || "UNRESOLVED"}
              </span>
              <span className="text-xs font-mono text-muted">
                Risk Score: <strong className="text-foreground">{data.riskScore.toFixed(2)}</strong>
              </span>
              <span className="text-xs font-mono text-muted">
                Total Amount: <strong className="text-foreground">{data.totalAmountPaise > 0 ? formatInr(data.totalAmountPaise) : formatInr(bankTx?.amountPaise)}</strong>
              </span>
              {data.isResolved ? (
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Resolved by {data.resolvedBy || "analyst"}
                </span>
              ) : (
                <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/20">
                  Pending Human Review
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground">
              {data.unresolvedExceptionId}
            </h1>
          </div>

          {/* Quick Action for Non-Ambiguous Exceptions */}
          {!isAmbiguous && !data.isResolved && (
            <button
              onClick={handleMarkResolved}
              disabled={actionLoading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
              <span>Mark Resolved</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Root Cause Hypothesis & LLM Context ──────────────────────────── */}
      <section className="rounded-xl border border-primary-500/20 bg-primary-500/5 p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-primary-500 uppercase tracking-wider">
            <Bot className="h-4 w-4" />
            <span>AI Root Cause Hypothesis (Gemini Flash)</span>
          </div>
          {rawMeta?.confidence && (
            <span className="text-xs font-mono font-semibold text-primary-500">
              Confidence: {(rawMeta.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-foreground leading-relaxed">
          {data.rootCauseHypothesis || "No automated hypothesis available. Manual disambiguation recommended."}
        </p>

        {/* Evidence Refs if present */}
        {rawMeta?.evidenceRefs && Array.isArray(rawMeta.evidenceRefs) && rawMeta.evidenceRefs.length > 0 && (
          <div className="pt-2 border-t border-primary-500/10 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted font-semibold">Cited Evidence IDs:</span>
            {rawMeta.evidenceRefs.map((refId: string) => (
              <Link
                key={refId}
                to={`/transactions/${encodeURIComponent(refId)}`}
                className="font-mono text-primary-500 hover:underline bg-primary-500/10 px-2 py-0.5 rounded border border-primary-500/20"
              >
                {refId}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Bank Statement Anchor ─────────────────────────────────────────── */}
      {bankTx && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Anchor Bank Transaction Record
            </span>
            <span className="font-mono text-sm font-bold text-foreground">
              {formatInr(bankTx.amountPaise)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted block">Transaction ID:</span>
              <Link to={`/transactions/${encodeURIComponent(bankTx.transactionRecordId)}`} className="font-mono font-bold text-primary-500 hover:underline">
                {bankTx.transactionRecordId}
              </Link>
            </div>
            <div>
              <span className="text-muted block">Reference / UTR:</span>
              <span className="font-mono font-semibold text-foreground">{bankTx.externalReference}</span>
            </div>
            <div>
              <span className="text-muted block">Date:</span>
              <span className="font-mono text-foreground">{formatDate(bankTx.transactionDate)}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── AMBIGUOUS_MATCH: Side-by-Side Candidate Cards ────────────────── */}
      {isAmbiguous && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <span>Competing Candidate Subsets ({candidates.length})</span>
              </h2>
              <p className="text-xs text-muted">
                Multiple valid subsets sum to the bank amount. Select the correct bundle or reject both.
              </p>
            </div>

            {!data.isResolved && (
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                <span>Reject Both Candidates</span>
              </button>
            )}
          </div>

          {candidates.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-muted">
              <p className="text-sm font-medium">No candidates in metadata. Review linked records below.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {candidates.map((cand, idx) => {
                const isWinner = idx === 0; // Highest score is index 0

                return (
                  <div
                    key={cand.candidateIndex ?? idx}
                    className={`rounded-2xl border-2 bg-card p-6 flex flex-col justify-between space-y-6 shadow-sm transition-all relative ${
                      isWinner
                        ? "border-emerald-500/80 shadow-emerald-500/10 dark:bg-emerald-950/10"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    {/* Winner Badge */}
                    {isWinner && (
                      <div className="absolute -top-3 right-6 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-0.5 text-[11px] font-bold text-white shadow-md">
                        <Award className="h-3.5 w-3.5" />
                        <span>Recommended Winner</span>
                      </div>
                    )}

                    <div className="space-y-4">
                      {/* Candidate Header */}
                      <div className="flex items-center justify-between border-b border-border pb-3">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider text-muted">
                            Candidate #{idx + 1}
                          </span>
                          <div className="text-xl font-bold font-mono text-foreground mt-0.5">
                            {formatInr(cand.sumPaise)}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-muted block">Score</span>
                          <span className="font-mono text-base font-extrabold text-foreground">
                            {cand.finalScore?.toFixed(4) || "—"}
                          </span>
                        </div>
                      </div>

                      {/* Score Breakdown */}
                      <div className="rounded-xl bg-accent/50 p-3 text-xs space-y-1.5 border border-border/50">
                        <div className="flex items-center justify-between text-muted">
                          <span>Amount Precision:</span>
                          <span className="font-mono font-bold text-foreground">
                            {cand.amountPrecision !== undefined ? `${(cand.amountPrecision * 100).toFixed(1)}%` : "100.0%"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted">
                          <span>Date Proximity:</span>
                          <span className="font-mono font-bold text-foreground">
                            {cand.dateProximity !== undefined ? `${(cand.dateProximity * 100).toFixed(1)}%` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted">
                          <span>Subset Size Penalty:</span>
                          <span className="font-mono font-bold text-foreground">
                            {cand.subsetSizePenalty !== undefined ? `${(cand.subsetSizePenalty * 100).toFixed(1)}%` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted pt-1 border-t border-border/40">
                          <span>Net Delta to Bank:</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatInr(cand.deltaPaise || 0)}
                          </span>
                        </div>
                      </div>

                      {/* Member Gateway Records */}
                      <div className="space-y-2">
                        <span className="text-xs font-bold text-muted uppercase tracking-wider block">
                          Bundle Transactions ({cand.gatewayRecords?.length || 0})
                        </span>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {(cand.gatewayRecords || []).map((gw) => (
                            <div
                              key={gw.transactionRecordId}
                              className="rounded-lg bg-accent/40 p-2 text-xs flex items-center justify-between border border-border/40"
                            >
                              <div className="space-y-0.5">
                                <Link
                                  to={`/transactions/${encodeURIComponent(gw.transactionRecordId)}`}
                                  className="font-mono font-semibold text-primary-500 hover:underline block"
                                >
                                  {gw.transactionRecordId}
                                </Link>
                                <span className="font-mono text-[11px] text-muted">{gw.externalReference}</span>
                              </div>
                              <span className="font-mono font-bold text-foreground">
                                {formatInr(gw.amountPaise)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Approve Button */}
                    {!data.isResolved && (
                      <button
                        onClick={() => handleApproveCandidate(idx)}
                        disabled={actionLoading}
                        className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold shadow-md transition-all disabled:opacity-50 ${
                          isWinner
                            ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20"
                            : "bg-primary-600 hover:bg-primary-500 text-white shadow-primary-500/20"
                        }`}
                      >
                        {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        <span>Approve Candidate #{idx + 1}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Linked Transactions List (Fallback/Detailed View) ─────────────── */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary-500" />
          <span>All Linked Transaction Records ({data.transactions.length})</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.transactions.map((tx) => (
            <div key={tx.transactionRecordId} className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <Link
                  to={`/transactions/${encodeURIComponent(tx.transactionRecordId)}`}
                  className="font-mono text-xs font-bold text-primary-500 hover:underline"
                >
                  {tx.transactionRecordId}
                </Link>
                <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  {formatInr(tx.amountPaise)}
                </span>
              </div>
              <div className="text-xs space-y-1 text-muted">
                <p><strong>Source:</strong> {tx.dataSource}</p>
                <p className="font-mono"><strong>Ref:</strong> {tx.externalReference}</p>
                <p><strong>Date:</strong> {formatDate(tx.transactionDate)}</p>
                {tx.rawDescription && <p className="truncate"><strong>Desc:</strong> {tx.rawDescription}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
