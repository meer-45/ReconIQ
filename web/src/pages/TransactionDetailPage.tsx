// web/src/pages/TransactionDetailPage.tsx — Transaction detail with match link or Counterfactual "Nearest Miss" ranking.

import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { type TransactionDetailResponse, type NearestMissResponse } from "../api/schemas";
import { formatInr, formatDate } from "../utils/formatters";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  FileText,
  Compass,
} from "lucide-react";

export const TransactionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [transaction, setTransaction] = useState<TransactionDetailResponse | null>(null);
  const [nearestMiss, setNearestMiss] = useState<NearestMissResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactionData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const tx = await api.getTransaction(id);
      setTransaction(tx);

      // If unmatched, fetch counterfactual nearest misses
      if (!tx.matchGroupId) {
        try {
          const nm = await api.getNearestMiss(id);
          setNearestMiss(nm);
        } catch {
          /* non-fatal */
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to load transaction details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactionData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <RefreshCw className="h-5 w-5 animate-spin text-primary-500" />
          <span className="text-sm font-medium">Loading transaction details…</span>
        </div>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </Link>
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-600 dark:text-red-400">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6" />
            <div>
              <h3 className="font-semibold">Transaction Not Found</h3>
              <p className="text-sm text-red-500/80">{error || `No transaction record exists with ID: ${id}`}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isMatched = !!transaction.matchGroupId;

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "BANK_STATEMENT":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
      case "GATEWAY_SETTLEMENT":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      default:
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* ── Breadcrumb & Top Bar ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Overview</span>
        </Link>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-mono font-bold border ${getSourceBadge(transaction.dataSource)}`}>
                {transaction.dataSource}
              </span>
              {isMatched ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Matched
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/20">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Unmatched Residual
                </span>
              )}
              {transaction.exceptionId && (
                <Link
                  to={`/exceptions/${encodeURIComponent(transaction.exceptionId)}`}
                  className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:underline"
                >
                  In Exception {transaction.exceptionId.slice(0, 10)}…
                </Link>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground">
              {transaction.transactionRecordId}
            </h1>
          </div>

          <div className="text-right">
            <span className="text-xs uppercase font-bold text-muted block">Amount</span>
            <div className="text-2xl font-extrabold font-mono text-foreground">
              {formatInr(transaction.amountPaise)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Transaction Core Card ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary-500" />
          <span>Transaction Details</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="bg-accent/40 p-3 rounded-lg border border-border/40 space-y-1">
            <span className="text-muted block">External Reference / UTR</span>
            <span className="font-mono font-bold text-foreground">{transaction.externalReference}</span>
          </div>
          <div className="bg-accent/40 p-3 rounded-lg border border-border/40 space-y-1">
            <span className="text-muted block">Transaction Date</span>
            <span className="font-mono font-semibold text-foreground">{formatDate(transaction.transactionDate)}</span>
          </div>
          <div className="bg-accent/40 p-3 rounded-lg border border-border/40 space-y-1">
            <span className="text-muted block">Ingested Timestamp</span>
            <span className="font-mono text-muted">{formatDate(transaction.ingestedAt)}</span>
          </div>
          <div className="bg-accent/40 p-3 rounded-lg border border-border/40 space-y-1">
            <span className="text-muted block">Currency</span>
            <span className="font-mono font-bold text-foreground">{transaction.currencyCode}</span>
          </div>
        </div>

        {transaction.rawDescription && (
          <div className="bg-accent/30 p-3 rounded-lg border border-border/40 text-xs">
            <span className="text-muted font-semibold block mb-1">Raw Description / Narrative:</span>
            <p className="font-mono text-foreground">{transaction.rawDescription}</p>
          </div>
        )}
      </section>

      {/* ── If Matched: Link to MatchGroup ───────────────────────────────── */}
      {isMatched && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Reconciled Match Group
            </span>
            <p className="text-sm text-foreground font-mono font-semibold">
              Match Group ID: {transaction.matchGroupId}
            </p>
          </div>

          <Link
            to={`/match-groups/${encodeURIComponent(transaction.matchGroupId!)}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-500 transition-colors"
          >
            <span>View Explainability & Hash Chain</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      {/* ── If Unmatched: Counterfactual "Nearest Miss" Card ───────────────── */}
      {!isMatched && (
        <section className="rounded-2xl border border-primary-500/30 bg-gradient-to-br from-primary-500/5 via-card to-card p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Compass className="h-5 w-5 text-primary-500" />
                <span>Counterfactual Nearest Misses (Why not matched?)</span>
              </h2>
              <p className="text-xs text-muted max-w-2xl">
                Top 3 candidates from opposite data sources within ±7 days, ranked by amount closeness (60%) and character n-gram text similarity (40%).
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 rounded bg-primary-500/10 px-2 py-0.5 text-xs font-mono font-semibold text-primary-500 border border-primary-500/20">
              TF-IDF Cosine
            </span>
          </div>

          {!nearestMiss || nearestMiss.candidates.length === 0 ? (
            <div className="p-8 text-center text-muted bg-accent/30 rounded-xl border border-border/40">
              <p className="text-sm font-medium">No close candidate records found within the ±7 day window.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {nearestMiss.candidates.map((cand, idx) => (
                <div
                  key={cand.id}
                  className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm hover:border-primary-500/50 transition-colors flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-border/60 pb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted">
                        Rank #{idx + 1}
                      </span>
                      <span className="font-mono text-xs font-extrabold text-primary-500 bg-primary-500/10 px-2 py-0.5 rounded">
                        Score: {(cand.score * 100).toFixed(1)}%
                      </span>
                    </div>

                    <div className="space-y-1">
                      <Link
                        to={`/transactions/${encodeURIComponent(cand.id)}`}
                        className="font-mono text-xs font-bold text-foreground hover:text-primary-500 transition-colors block"
                      >
                        {cand.id}
                      </Link>
                      <div className="text-xs text-muted flex items-center justify-between font-mono">
                        <span>Amount Delta:</span>
                        <span className="font-bold text-foreground">{formatInr(cand.delta)}</span>
                      </div>
                    </div>

                    <p className="text-xs text-muted bg-accent/50 p-2 rounded-lg border border-border/40 leading-relaxed">
                      {cand.reason}
                    </p>
                  </div>

                  <Link
                    to={`/transactions/${encodeURIComponent(cand.id)}`}
                    className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-primary-500 hover:text-primary-400 pt-2 border-t border-border/40"
                  >
                    <span>Inspect Candidate</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
