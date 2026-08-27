// web/src/pages/ExceptionDetailPage.tsx — Exception detail stub and human approval flow.

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
} from "lucide-react";

export const ExceptionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ExceptionDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<boolean>(false);
  const [approvalSuccess, setApprovalSuccess] = useState<string | null>(null);

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

  const handleApprove = async (chosenIndex: number = 0) => {
    if (!id || !data) return;
    try {
      setApproving(true);
      const res = await api.approveException(id, {
        chosenCandidateIndex: chosenIndex,
        actorId: "human_analyst_1",
      });
      setApprovalSuccess(`Approved! Created MatchGroup: ${res.matchGroupId}`);
      setTimeout(() => {
        navigate(`/match-groups/${encodeURIComponent(res.matchGroupId)}`);
      }, 1200);
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setApproving(false);
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Breadcrumb & Header */}
      <div className="space-y-4">
        <Link to="/exceptions" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Exceptions</span>
        </Link>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2.5 py-1 text-xs font-mono font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {data.classification || "AMBIGUOUS_MATCH"}
              </span>
              <span className="text-xs font-mono text-muted">
                Risk Score: <strong className="text-foreground">{data.riskScore.toFixed(2)}</strong>
              </span>
              {data.isResolved && (
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Resolved by {data.resolvedBy}
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-mono text-foreground">
              {data.unresolvedExceptionId}
            </h1>
          </div>

          {!data.isResolved && (
            <button
              onClick={() => handleApprove(0)}
              disabled={approving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              {approving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span>Approve & Form MatchGroup</span>
            </button>
          )}
        </div>
      </div>

      {/* Success notification */}
      {approvalSuccess && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 font-medium text-sm flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          <span>{approvalSuccess}</span>
        </div>
      )}

      {/* Root Cause Hypothesis Box */}
      <div className="rounded-xl border border-primary-500/20 bg-primary-500/5 p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-primary-500 uppercase tracking-wider">
          <Bot className="h-4 w-4" />
          <span>AI Root Cause Hypothesis (Gemini Flash)</span>
        </div>
        <p className="text-sm font-medium text-foreground leading-relaxed">
          {data.rootCauseHypothesis || "No hypothesis available for this exception."}
        </p>
      </div>

      {/* Linked Transactions */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary-500" />
          <span>Involved Transaction Records ({data.transactions.length})</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.transactions.map((tx) => (
            <div key={tx.transactionRecordId} className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="font-mono text-xs font-bold text-foreground">{tx.transactionRecordId}</span>
                <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  {formatInr(tx.amountPaise)}
                </span>
              </div>
              <div className="text-xs space-y-1 text-muted">
                <p><strong>Source:</strong> {tx.dataSource}</p>
                <p className="font-mono"><strong>Ref:</strong> {tx.externalReference}</p>
                <p><strong>Date:</strong> {formatDate(tx.transactionDate)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
