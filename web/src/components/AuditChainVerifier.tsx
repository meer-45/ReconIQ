// web/src/components/AuditChainVerifier.tsx — Interactive audit chain verification button and live badge in the global footer.

import React, { useState } from "react";
import { api } from "../api/client";
import { type VerifyChainResponse } from "../api/schemas";
import { ShieldCheck, ShieldAlert, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";

export const AuditChainVerifier: React.FC = () => {
  const [verifying, setVerifying] = useState<boolean>(false);
  const [result, setResult] = useState<VerifyChainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    try {
      setVerifying(true);
      setError(null);
      const res = await api.verifyChain();
      setResult(res);
    } catch (err: any) {
      setError(err.message || "Verification request failed");
      setResult(null);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Verify Trigger Button */}
      <button
        type="button"
        id="btn-verify-audit-chain"
        onClick={handleVerify}
        disabled={verifying}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-accent px-3 py-1.5 text-xs font-semibold text-foreground transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed hover:border-primary-500/40"
      >
        {verifying ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary-500" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <span>{verifying ? "Verifying cryptographic chain…" : "Verify audit chain"}</span>
      </button>

      {/* Result Badge: OK */}
      {result && result.ok && (
        <div
          id="badge-verify-chain-ok"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in"
        >
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="font-mono font-bold">MAIN CHAIN OK ({result.mainChainRows} rows)</span>
          <span className="text-[10px] opacity-80">· 0 breaks</span>
        </div>
      )}

      {/* Result Badge: FAIL / BREAK */}
      {result && !result.ok && (
        <div
          id="badge-verify-chain-fail"
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 animate-fade-in"
          title={result.error || "Hash link mismatch detected"}
        >
          <ShieldAlert className="h-3.5 w-3.5 text-rose-500 shrink-0" />
          <span className="font-mono font-bold">CHAIN BREAK</span>
          <span className="text-[10px] opacity-80">({result.status})</span>
        </div>
      )}

      {/* Network / Execution Error */}
      {error && (
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 animate-fade-in">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span>Error: {error}</span>
        </div>
      )}
    </div>
  );
};
