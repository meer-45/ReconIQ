// web/src/pages/ExceptionsPage.tsx — Exceptions table with filtering, sorting, risk meters, and navigation.

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { type ExceptionItem } from "../api/schemas";
import { formatInr, formatDate } from "../utils/formatters";
import {
  AlertTriangle,
  Filter,
  ArrowUpDown,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

export const ExceptionsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const classificationParam = searchParams.get("classification") || "ALL";
  const sortByParam         = searchParams.get("sortBy") || "riskScore";
  const orderParam          = (searchParams.get("order") || "desc") as "asc" | "desc";

  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExceptions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getExceptions({
        classification: classificationParam === "ALL" ? undefined : classificationParam,
        sortBy: sortByParam,
        order: orderParam,
        limit: 50,
      });
      setExceptions(res.exceptions);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || "Failed to load exceptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExceptions();
  }, [classificationParam, sortByParam, orderParam]);

  const handleClassificationChange = (cls: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cls === "ALL") next.delete("classification");
      else next.set("classification", cls);
      return next;
    });
  };

  const handleSortToggle = (field: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (sortByParam === field) {
        next.set("order", orderParam === "desc" ? "asc" : "desc");
      } else {
        next.set("sortBy", field);
        next.set("order", "desc");
      }
      return next;
    });
  };

  const getBadgeStyle = (classification?: string | null) => {
    switch (classification) {
      case "TIMING_LAG":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "MISSING_COUNTERPART":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
      case "DUPLICATE":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
      case "AMBIGUOUS_MATCH":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      default:
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 0.7) return "bg-rose-500 text-rose-500";
    if (score >= 0.4) return "bg-amber-500 text-amber-500";
    return "bg-emerald-500 text-emerald-500";
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* ── Page Header & Controls ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <span>Unresolved Exceptions</span>
          </h1>
          <p className="text-sm text-muted">
            {total} items requiring review or root-cause disambiguation
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Classification Filter */}
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm">
            <Filter className="h-3.5 w-3.5 text-muted" />
            <select
              value={classificationParam}
              onChange={(e) => handleClassificationChange(e.target.value)}
              className="bg-transparent font-medium text-foreground focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-card text-foreground">All Classifications ({total})</option>
              <option value="TIMING_LAG" className="bg-card text-foreground">TIMING_LAG (21)</option>
              <option value="MISSING_COUNTERPART" className="bg-card text-foreground">MISSING_COUNTERPART</option>
              <option value="AMBIGUOUS_MATCH" className="bg-card text-foreground">AMBIGUOUS_MATCH</option>
              <option value="DUPLICATE" className="bg-card text-foreground">DUPLICATE</option>
              <option value="OTHER" className="bg-card text-foreground">OTHER</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchExceptions}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Exceptions Table ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex items-center gap-3 text-muted">
              <RefreshCw className="h-5 w-5 animate-spin text-primary-500" />
              <span className="text-sm font-medium">Loading exceptions…</span>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">
            <p className="font-semibold">Error loading exceptions</p>
            <p className="text-xs text-muted mt-1">{error}</p>
          </div>
        ) : exceptions.length === 0 ? (
          <div className="p-12 text-center text-muted space-y-2">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
            <p className="font-medium text-foreground">No unresolved exceptions found</p>
            <p className="text-xs">No records matched the selected classification filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-accent/50 text-xs uppercase font-semibold text-muted">
                <tr>
                  <th className="px-6 py-3.5">ID</th>
                  <th className="px-6 py-3.5">Classification</th>
                  <th className="px-6 py-3.5">Root Cause Hypothesis</th>
                  <th
                    className="px-6 py-3.5 text-right cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSortToggle("totalAmountPaise")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Total Amount</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3.5 text-right cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSortToggle("riskScore")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Risk Score</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th className="px-6 py-3.5">Created At</th>
                  <th className="px-6 py-3.5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {exceptions.map((ex) => (
                  <tr
                    key={ex.unresolvedExceptionId}
                    onClick={() => navigate(`/exceptions/${encodeURIComponent(ex.unresolvedExceptionId)}`)}
                    className="hover:bg-accent/50 transition-colors cursor-pointer group"
                  >
                    {/* ID */}
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs font-semibold text-foreground group-hover:text-primary-500 transition-colors">
                        {ex.unresolvedExceptionId.slice(0, 16)}
                      </span>
                    </td>

                    {/* Classification */}
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono font-semibold border ${getBadgeStyle(
                          ex.classification
                        )}`}
                      >
                        {ex.classification || "UNCLASSIFIED"}
                      </span>
                    </td>

                    {/* Root Cause Hypothesis */}
                    <td className="px-6 py-4 max-w-xs sm:max-w-md">
                      <p className="text-xs text-muted truncate">
                        {ex.rootCauseHypothesis || "Awaiting LLM hypothesis generation or manual review"}
                      </p>
                    </td>

                    {/* Amount */}
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold text-foreground">
                      {ex.totalAmountPaise > 0 ? formatInr(ex.totalAmountPaise) : "—"}
                    </td>

                    {/* Risk Score Meter */}
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 bg-accent rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full ${getRiskColor(ex.riskScore)}`}
                            style={{ width: `${Math.min(100, ex.riskScore * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs font-bold text-foreground">
                          {ex.riskScore.toFixed(2)}
                        </span>
                      </div>
                    </td>

                    {/* Created At */}
                    <td className="px-6 py-4 text-xs font-mono text-muted whitespace-nowrap">
                      {formatDate(ex.createdAt)}
                    </td>

                    {/* Action Arrow */}
                    <td className="px-6 py-4 text-right text-muted group-hover:text-foreground">
                      <ChevronRight className="h-4 w-4 inline-block transform group-hover:translate-x-0.5 transition-transform" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
