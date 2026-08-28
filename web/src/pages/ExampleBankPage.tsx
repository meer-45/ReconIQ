// web/src/pages/ExampleBankPage.tsx — Read-only audit & debug table for ExampleBank few-shot cases.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { formatInr, formatDate } from "../utils/formatters";
import {
  Database,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

interface ExampleItem {
  exampleBankId:     string;
  createdAt:         string;
  exceptionSnapshot: Record<string, any>;
  correctAction:     Record<string, any>;
}

export const ExampleBankPage: React.FC = () => {
  const [examples, setExamples] = useState<ExampleItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExamples = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getExampleBankList({ limit: 50 });
      setExamples(res.examples || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      setError(err.message || "Failed to load ExampleBank records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExamples();
  }, []);

  const getActionBadge = (action: Record<string, any>) => {
    switch (action.type) {
      case "APPROVE_CANDIDATE":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="h-3.5 w-3.5" />
            APPROVE CANDIDATE #{action.chosenCandidateIndex ?? 0}
          </span>
        );
      case "REJECT":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2.5 py-1 text-xs font-mono font-bold text-rose-600 dark:text-rose-400 border border-rose-500/20">
            <XCircle className="h-3.5 w-3.5" />
            REJECT ALL
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2.5 py-1 text-xs font-mono font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <ShieldCheck className="h-3.5 w-3.5" />
            MARK RESOLVED
          </span>
        );
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Overview</span>
        </Link>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-600 dark:text-purple-400 border border-purple-500/20">
                <Sparkles className="h-3.5 w-3.5" />
                Self-Healing Memory
              </span>
              <span className="text-xs font-mono text-muted">Cosine Threshold ≥ 0.55</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
              <Database className="h-7 w-7 text-primary-500" />
              <span>ExampleBank Audit Repository</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted max-w-2xl">
              Human-approved decisions indexed via TF-IDF character trigrams to dynamically inform future LLM v2 classifications without model fine-tuning.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-card border border-border px-4 py-2 rounded-xl text-right">
              <span className="text-[10px] font-mono text-muted uppercase block">Total Saved Cases</span>
              <span className="text-xl font-bold font-mono text-foreground">{total}</span>
            </div>
            <button
              onClick={fetchExamples}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors shadow-sm"
              title="Refresh repository"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-primary-500" : "text-muted"}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Content Table ─────────────────────────────────────────────────── */}
      {loading && examples.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="flex items-center gap-3 text-muted">
            <RefreshCw className="h-5 w-5 animate-spin text-primary-500" />
            <span className="text-sm font-medium">Loading ExampleBank records…</span>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-600 dark:text-red-400">
          <h3 className="font-semibold">Unable to load ExampleBank</h3>
          <p className="text-xs text-red-500/80 mt-1">{error}</p>
        </div>
      ) : examples.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center space-y-3">
          <Database className="h-10 w-10 text-muted mx-auto" />
          <h3 className="text-base font-bold text-foreground">No Examples In Bank Yet</h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            Manually approve, resolve, or reject ambiguous exceptions in the dashboard to automatically store them into the few-shot memory pool.
          </p>
          <Link
            to="/exceptions"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-primary-500 transition-colors mt-2"
          >
            <span>Browse Exceptions to Approve</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-accent/50 text-xs uppercase font-semibold text-muted">
                <tr>
                  <th className="px-6 py-3.5">Example ID & Timestamp</th>
                  <th className="px-6 py-3.5">Exception Snapshot</th>
                  <th className="px-6 py-3.5">Human Decision Action</th>
                  <th className="px-6 py-3.5 text-right">Amount</th>
                  <th className="px-6 py-3.5">Auditor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {examples.map((ex) => {
                  const snap = ex.exceptionSnapshot || {};
                  const act = ex.correctAction || {};
                  const amt = snap.totalAmountPaise || snap.amountPaise || snap.bank?.amountPaise || 0;

                  return (
                    <tr key={ex.exampleBankId} className="hover:bg-accent/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <span className="font-mono font-bold text-xs text-foreground block">
                            {ex.exampleBankId}
                          </span>
                          <span className="text-[10px] font-mono text-muted">
                            {formatDate(ex.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-sm">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-mono font-bold text-muted border border-border">
                              {snap.classification || snap.type || "AMBIGUOUS"}
                            </span>
                            {snap.exceptionId && (
                              <Link
                                to={`/exceptions/${encodeURIComponent(snap.exceptionId)}`}
                                className="font-mono text-xs text-primary-500 hover:underline"
                              >
                                {snap.exceptionId.slice(0, 14)}…
                              </Link>
                            )}
                          </div>
                          <p className="text-xs text-muted truncate">
                            {snap.rootCauseHypothesis || snap.priorLayerSummary || "No hypothesis recorded"}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {getActionBadge(act)}
                          {act.humanNote && (
                            <p className="text-[11px] text-muted italic">"{act.humanNote}"</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-xs text-foreground">
                        {formatInr(amt)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 text-xs font-mono text-muted bg-accent px-2 py-0.5 rounded">
                          {act.actorId || "human_analyst"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
