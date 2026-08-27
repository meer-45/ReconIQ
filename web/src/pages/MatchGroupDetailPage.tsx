// web/src/pages/MatchGroupDetailPage.tsx — The Explainability Page: Linked transactions and vertical cryptographic AuditTrail hash chain.

import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { type MatchGroupDetailResponse } from "../api/schemas";
import { formatInr, formatDate } from "../utils/formatters";
import {
  ShieldCheck,
  Link2,
  Calendar,
  Layers,
  FileText,
  User,
  Bot,
  Terminal,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Copy,
  Check,
  CheckCircle2,
  Key,
} from "lucide-react";

export const MatchGroupDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<MatchGroupDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const fetchMatchGroup = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getMatchGroup(id);
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load match group details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatchGroup();
  }, [id]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(label);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const toggleExpand = (auditId: string) => {
    setExpandedRowId((prev) => (prev === auditId ? null : auditId));
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <RefreshCw className="h-5 w-5 animate-spin text-primary-500" />
          <span className="text-sm font-medium">Loading match group explainability trail…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
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
              <h3 className="font-semibold">Match Group Not Found</h3>
              <p className="text-sm text-red-500/80">{error || `No match group exists with ID: ${id}`}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Group transactions by dataSource
  const bankTxs    = data.transactions.filter((t) => t.dataSource === "BANK_STATEMENT");
  const gatewayTxs = data.transactions.filter((t) => t.dataSource === "GATEWAY_SETTLEMENT");
  const ledgerTxs  = data.transactions.filter((t) => t.dataSource === "MERCHANT_LEDGER");

  const getMethodBadge = (method: string) => {
    switch (method) {
      case "EXACT":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
      case "SUBSET_SUM":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "FEE_INFERENCE":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "AI_FUZZY":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      default:
        return "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20";
    }
  };

  const getActorIcon = (actor: string) => {
    switch (actor) {
      case "AI":
        return <Bot className="h-4 w-4 text-purple-400" />;
      case "HUMAN":
        return <User className="h-4 w-4 text-emerald-400" />;
      default:
        return <Terminal className="h-4 w-4 text-blue-400" />;
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* ── Breadcrumb & Header ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Overview</span>
        </Link>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-mono font-bold border ${getMethodBadge(data.method)}`}>
                {data.method}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {data.status}
              </span>
              <span className="text-xs font-mono text-muted">
                Confidence: <strong className="text-foreground">{(data.confidenceScore * 100).toFixed(0)}%</strong>
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground flex items-center gap-2">
              <span>{data.matchGroupId}</span>
              <button
                onClick={() => handleCopy(data.matchGroupId, "mgId")}
                className="text-muted hover:text-foreground transition-colors"
                title="Copy MatchGroup ID"
              >
                {copiedHash === "mgId" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </h1>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <Calendar className="h-4 w-4" />
            <span>Resolved: {formatDate(data.resolvedAt || data.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* ── Two-Panel Split Layout ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── Left Panel: Linked TransactionRecords (5 cols) ───────────────── */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary-500" />
              <span>Linked Transactions ({data.transactions.length})</span>
            </h2>
            <span className="text-xs font-mono text-muted">Multi-Source Bundle</span>
          </div>

          {/* Bank Statement Records */}
          {bankTxs.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Bank Statement ({bankTxs.length})
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {formatInr(bankTxs.reduce((s, t) => s + t.amountPaise, 0))}
                </span>
              </div>
              <div className="space-y-2">
                {bankTxs.map((tx) => (
                  <div key={tx.transactionRecordId} className="rounded-lg bg-accent/40 p-3 text-xs space-y-1.5 border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-foreground">{tx.transactionRecordId}</span>
                      <span className="font-mono font-bold text-foreground">{formatInr(tx.amountPaise)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span className="font-mono">Ref: {tx.externalReference}</span>
                      <span>{formatDate(tx.transactionDate)}</span>
                    </div>
                    {tx.rawDescription && (
                      <p className="text-[11px] text-muted truncate">{tx.rawDescription}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gateway Settlement Records */}
          {gatewayTxs.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Gateway Settlement ({gatewayTxs.length})
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {formatInr(gatewayTxs.reduce((s, t) => s + t.amountPaise, 0))}
                </span>
              </div>
              <div className="space-y-2">
                {gatewayTxs.map((tx) => (
                  <div key={tx.transactionRecordId} className="rounded-lg bg-accent/40 p-3 text-xs space-y-1.5 border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-foreground">{tx.transactionRecordId}</span>
                      <span className="font-mono font-bold text-foreground">{formatInr(tx.amountPaise)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span className="font-mono">Ref: {tx.externalReference}</span>
                      <span>{formatDate(tx.transactionDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Merchant Ledger Records */}
          {ledgerTxs.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  Merchant Ledger ({ledgerTxs.length})
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {formatInr(ledgerTxs.reduce((s, t) => s + t.amountPaise, 0))}
                </span>
              </div>
              <div className="space-y-2">
                {ledgerTxs.map((tx) => (
                  <div key={tx.transactionRecordId} className="rounded-lg bg-accent/40 p-3 text-xs space-y-1.5 border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-foreground">{tx.transactionRecordId}</span>
                      <span className="font-mono font-bold text-foreground">{formatInr(tx.amountPaise)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span className="font-mono">Ref: {tx.externalReference}</span>
                      <span>{formatDate(tx.transactionDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Panel: Cryptographic AuditTrail Hash Chain (7 cols) ───── */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>Cryptographic Audit Trail ({data.auditTrail.length})</span>
            </h2>
            <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              <Key className="h-3 w-3" />
              SHA-256 Chained
            </span>
          </div>

          {/* Vertical Timeline */}
          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border">
            {data.auditTrail.map((row) => {
              const isExpanded = expandedRowId === row.auditTrailId;

              return (
                <div key={row.auditTrailId} className="relative group">
                  {/* Timeline Node Icon */}
                  <div className="absolute -left-6 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-card border-2 border-primary-500 shadow-sm text-primary-500">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary-500" />
                  </div>

                  {/* Audit Card */}
                  <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm hover:border-primary-500/50 transition-colors">
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono font-bold border ${getMethodBadge(row.method)}`}>
                          {row.method}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted bg-accent px-2 py-0.5 rounded">
                          {getActorIcon(row.actor)}
                          <span>{row.actor} ({row.actorId || "system"})</span>
                        </span>
                      </div>
                      <span className="text-xs font-mono text-muted">{formatDate(row.decisionTimestamp)}</span>
                    </div>

                    {/* Reason */}
                    <p className="text-xs sm:text-sm text-foreground font-medium leading-relaxed">
                      {row.reason}
                    </p>

                    {/* ── Demo Talking Point: Cryptographic Hash Chain Seal ────── */}
                    <div className="rounded-lg bg-accent/60 p-3 border border-border/80 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-muted flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5 text-primary-500" />
                          <span>Tamper-Evident Hash Seal</span>
                        </span>
                        <span className="font-mono text-[10px] text-muted">SHA-256 Ledger</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                        <div className="bg-card p-2 rounded border border-border/60">
                          <span className="text-[10px] text-muted uppercase block">Previous Hash</span>
                          <span className="font-semibold text-muted truncate block" title={row.previousRowHash}>
                            {row.previousRowHash.slice(0, 16)}…
                          </span>
                        </div>
                        <div className="bg-card p-2 rounded border border-primary-500/30">
                          <span className="text-[10px] text-primary-500 uppercase font-bold block">Current Row Hash</span>
                          <span className="font-bold text-foreground truncate block" title={row.rowHash}>
                            {row.rowHash.slice(0, 16)}…
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expandable JSON Metadata */}
                    {row.metadata && (
                      <div>
                        <button
                          onClick={() => toggleExpand(row.auditTrailId)}
                          className="flex items-center gap-1 text-xs font-mono text-primary-500 hover:text-primary-400 font-semibold"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>{isExpanded ? "Hide Metadata JSON" : "View Metadata JSON"}</span>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>

                        {isExpanded && (
                          <pre className="mt-2 rounded-lg bg-black/80 dark:bg-black/90 p-3 text-[11px] font-mono text-emerald-400 overflow-x-auto border border-border/80">
                            {typeof row.metadata === "string"
                              ? row.metadata
                              : JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
