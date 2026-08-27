// web/src/components/QaFloatingBar.tsx — Floating Q&A Agent FAB and Chat Panel with clickable citations, latency/tool metadata, and localStorage history.

import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { type QaResponse } from "../api/schemas";
import {
  X,
  Send,
  Bot,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Clock,
  Wrench,
  Trash2,
  Minimize2,
} from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  citedIds?: string[];
  auditTrailId?: string;
  confidence?: number;
  toolCallsMade?: string[];
  latencyMs?: number;
  timestamp: string;
}

const STORAGE_KEY = "reconiq_qa_chat_history_v1";

export const QaFloatingBar: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return [
      {
        id: "msg_welcome",
        sender: "agent",
        text: "Hello! I'm ReconIQ's Q&A agent. Ask me anything about transactions, match rates, or exception root causes.",
        timestamp: new Date().toISOString(),
      },
    ];
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Persist last 5 Q&A pairs in localStorage (1 welcome + 10 user/agent messages)
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const toSave = messages.slice(-11);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch { /* ignore */ }
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setLoading(true);

    const t0 = Date.now();
    try {
      const res: QaResponse = await api.askQa(trimmed);
      const latencyMs = Date.now() - t0;

      const agentMsg: ChatMessage = {
        id: `agent_${Date.now()}`,
        sender: "agent",
        text: res.answer,
        citedIds: res.citedTransactionRecordIds || [],
        auditTrailId: res.auditTrailId,
        confidence: res.confidence,
        toolCallsMade: res.toolCallsMade || [],
        latencyMs,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `error_${Date.now()}`,
        sender: "agent",
        text: `Error contacting Q&A Agent: ${err.message || "Request failed"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    const welcome: ChatMessage = {
      id: `welcome_${Date.now()}`,
      sender: "agent",
      text: "Chat history cleared. How can I help you investigate?",
      timestamp: new Date().toISOString(),
    };
    setMessages([welcome]);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Helper to render text with auto-linked IDs
  const renderFormattedText = (text: string) => {
    // Replace markdown or citations with inline badges
    const words = text.split(/(\s+)/);
    return words.map((word, i) => {
      const clean = word.replace(/[.,:;()]/g, "");
      if (clean.startsWith("tx_")) {
        return (
          <Link
            key={i}
            to={`/transactions/${encodeURIComponent(clean)}`}
            className="font-mono text-primary-500 hover:underline bg-primary-500/10 px-1 py-0.5 rounded"
          >
            {word}
          </Link>
        );
      }
      if (clean.startsWith("mg_")) {
        return (
          <Link
            key={i}
            to={`/match-groups/${encodeURIComponent(clean)}`}
            className="font-mono text-emerald-500 hover:underline bg-emerald-500/10 px-1 py-0.5 rounded"
          >
            {word}
          </Link>
        );
      }
      return word;
    });
  };

  return (
    <>
      {/* ── Bottom-Right Floating Action Button (FAB) ────────────────────── */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-xl shadow-primary-500/30 hover:bg-primary-500 hover:scale-105 active:scale-95 transition-all"
        aria-label="Open Q&A Agent"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {/* ── Chat Panel ──────────────────────────────────────────────────── */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-96 md:w-[440px] max-h-[600px] h-[520px] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden backdrop-blur-xl animate-fade-in">
          {/* Panel Header */}
          <div className="border-b border-border bg-accent/40 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                  <span>ReconIQ Q&A Agent</span>
                  <span className="rounded bg-primary-500/10 px-1.5 py-0.2 text-[9px] font-mono font-semibold text-primary-500">
                    Gemini 3.5
                  </span>
                </h3>
                <p className="text-[11px] text-muted">Audited & Hash-Chained Queries</p>
              </div>
            </div>

            <div className="flex items-center gap-1 text-muted">
              <button
                onClick={handleClearHistory}
                className="p-1.5 hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                title="Clear history"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                title="Minimize"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col space-y-1.5 ${
                  msg.sender === "user" ? "items-end" : "items-start"
                }`}
              >
                {/* Message Bubble */}
                <div
                  className={`rounded-2xl p-3.5 max-w-[85%] leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-primary-600 text-white rounded-br-none"
                      : "bg-accent/70 text-foreground border border-border/70 rounded-bl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap">
                    {msg.sender === "agent"
                      ? renderFormattedText(msg.text)
                      : msg.text}
                  </p>

                  {/* Cited IDs Box */}
                  {msg.citedIds && msg.citedIds.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-border/60 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-muted block">
                        Cited Transaction IDs:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {msg.citedIds.map((id) => (
                          <Link
                            key={id}
                            to={`/transactions/${encodeURIComponent(id)}`}
                            className="font-mono text-[10px] bg-card px-1.5 py-0.5 rounded border border-border/80 text-primary-500 hover:underline flex items-center gap-0.5"
                          >
                            <span>{id}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Subtle Metadata Footer (Demo Talking Point) */}
                {msg.sender === "agent" && msg.latencyMs !== undefined && (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted px-1">
                    <span className="flex items-center gap-0.5 font-mono">
                      <Clock className="h-3 w-3" />
                      {msg.latencyMs}ms
                    </span>
                    {msg.toolCallsMade && msg.toolCallsMade.length > 0 && (
                      <span className="flex items-center gap-0.5 font-mono bg-accent px-1 py-0.2 rounded">
                        <Wrench className="h-3 w-3 text-primary-500" />
                        {msg.toolCallsMade.length} tools
                      </span>
                    )}
                    {msg.auditTrailId && (
                      <span className="font-mono text-muted truncate max-w-[120px]" title={msg.auditTrailId}>
                        at_{msg.auditTrailId.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted bg-accent/40 p-3 rounded-2xl rounded-bl-none w-fit border border-border/60">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary-500" />
                <span>Q&A agent investigating ledger…</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Query Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-border bg-card p-3 flex items-center gap-2"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about txns, matches, timing lags…"
              disabled={loading}
              className="flex-1 rounded-xl border border-border bg-accent/40 px-3.5 py-2 text-xs text-foreground placeholder-muted focus:outline-none focus:border-primary-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!question.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-40 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
};
