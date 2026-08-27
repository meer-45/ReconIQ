// web/src/components/Navbar.tsx — Main navigation bar with brand, routes, and theme switcher.

import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext";
import {
  ShieldCheck,
  LayoutDashboard,
  AlertTriangle,
  Sun,
  Moon,
  Database,
} from "lucide-react";

export const Navbar: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const navItems = [
    { label: "Overview", path: "/", icon: LayoutDashboard },
    { label: "Exceptions", path: "/exceptions", icon: AlertTriangle },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-md shadow-primary-500/20 group-hover:bg-primary-500 transition-colors">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-foreground">
                Recon<span className="text-primary-500">IQ</span>
              </span>
              <span className="hidden sm:inline-block ml-2 rounded bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary-500 uppercase tracking-wider">
                Hash-Chained
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path);

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary-500/10 text-primary-600 dark:text-primary-400 font-semibold"
                      : "text-muted hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-3">
          {/* Status Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <Database className="h-3 w-3" />
            <span>Postgres Seeded</span>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-accent transition-colors"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
