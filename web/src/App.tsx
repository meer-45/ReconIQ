// web/src/App.tsx — Root application routing and shell.

import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./theme/ThemeContext";
import { Navbar } from "./components/Navbar";
import { OverviewPage } from "./pages/OverviewPage";
import { ExceptionsPage } from "./pages/ExceptionsPage";
import { ExceptionDetailPage } from "./pages/ExceptionDetailPage";
import { MatchGroupDetailPage } from "./pages/MatchGroupDetailPage";

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <Router>
        <div className="min-h-screen bg-background text-foreground flex flex-col transition-colors duration-200">
          <Navbar />
          <main className="flex-1 pb-16">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/exceptions" element={<ExceptionsPage />} />
              <Route path="/exceptions/:id" element={<ExceptionDetailPage />} />
              <Route path="/match-groups/:id" element={<MatchGroupDetailPage />} />
            </Routes>
          </main>
          <footer className="border-t border-border py-6 bg-card text-center text-xs text-muted">
            <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="font-mono">ReconIQ Engine · SHA-256 Cryptographic Audit Ledger</span>
              <span>Deterministic matching & AI-assisted exception resolution</span>
            </div>
          </footer>
        </div>
      </Router>
    </ThemeProvider>
  );
};

export default App;
