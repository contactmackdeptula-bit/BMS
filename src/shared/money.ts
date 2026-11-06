// Money is stored as integer pence. Shared by the API and the screens.

export function formatPounds(pence: number | null | undefined): string {
  if (pence == null) return "";
  return `£${Math.round(pence / 100).toLocaleString("en-GB")}`;
}

export function formatRangeText(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null && high == null) return "";
  if (low == null || high == null || low === high) return formatPounds(low ?? high);
  return `${formatPounds(low)} to ${formatPounds(high)}`;
}

/** Reads what people type ("1,150", "£1150.50", "380") as pence; null when empty, NaN when unreadable. */
export function parsePounds(input: string): number | null {
  const cleaned = input.replace(/[£,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}
