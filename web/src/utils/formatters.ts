// web/src/utils/formatters.ts — Indian currency formatting, percentages, and hash truncation.

/**
 * Formats paise (integer) to Indian Rupee standard format: ₹XX,XX,XXX.XX
 * E.g. 348598406 paise -> "₹34,85,984.06"
 */
export function formatInr(amountPaise: number | null | undefined): string {
  if (amountPaise === null || amountPaise === undefined || isNaN(amountPaise)) {
    return "₹0.00";
  }
  const rupees = amountPaise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Formats a fraction (0.0 - 1.0) into a percentage string: "68.4%"
 */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || isNaN(fraction)) {
    return "—";
  }
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Formats an ISO date string to readable format: "27 Aug 2026, 17:12"
 */
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return isoString;
  }
}

/**
 * Truncates a hash for display: "ba2fcf13…"
 */
export function truncateHash(hash: string | null | undefined, chars: number = 8): string {
  if (!hash) return "—";
  if (hash.length <= chars) return hash;
  return `${hash.slice(0, chars)}…`;
}
