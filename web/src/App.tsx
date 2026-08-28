// web/src/App.tsx — Root application routing, shell, and floating Q&A bar.

import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./theme/ThemeContext";
import { Navbar } from "./components/Navbar";
import { OverviewPage } from "./pages/OverviewPage";
import { ExceptionsPage } from "./pages/ExceptionsPage";
import { ExceptionDetailPage } from "./pages/ExceptionDetailPage";
import { MatchGroupDetailPage } from "./pages/MatchGroupDetailPage";
import { TransactionDetailPage } from "./pages/TransactionDetailPage";
import { ExampleBankPage } from "./pages/ExampleBankPage";
import { QaFloatingBar } from "./components/QaFloatingBar";

import { AuditChainVerifier } from "./components/AuditChainVerifier";

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <Router>
        <div className="min-h-screen bg-background text-foreground flex flex-col transition-colors duration-200 relative">
          <Navbar />
          <main className="flex-1 pb-16">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/exceptions" element={<ExceptionsPage />} />
              <Route path="/exceptions/:id" element={<ExceptionDetailPage />} />
              <Route path="/match-groups/:id" element={<MatchGroupDetailPage />} />
              <Route path="/transactions/:id" element={<TransactionDetailPage />} />
              <Route path="/example-bank" element={<ExampleBankPage />} />
            </Routes>
          </main>

          {/* Floating Q&A Bar on ALL routes */}
          <QaFloatingBar />

          <footer className="border-t border-border py-5 bg-card text-xs text-muted">
            <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
                <span className="font-mono font-semibold text-foreground">ReconIQ Engine · SHA-256 Cryptographic Audit Ledger</span>
                <span className="hidden sm:inline text-muted/60">|</span>
                <span>Deterministic matching & AI exception resolution</span>
              </div>
              <AuditChainVerifier />
            </div>
          </footer>
        </div>
      </Router>
    </ThemeProvider>
  );
};

export default App;
