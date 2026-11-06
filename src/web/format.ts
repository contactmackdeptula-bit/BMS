// Formatting rules from UI-HANDOFF §13: dates as "14 Oct 2026", money as £n,nnn,
// £n.nm in estates stats, ranges as "£a to £b", blank when unknown.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatMoney(pence: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (pence == null) return "";
  const pounds = pence / 100;
  if (opts.compact && Math.abs(pounds) >= 1_000_000) return `£${(pounds / 1_000_000).toFixed(1)}m`;
  if (opts.compact && Math.abs(pounds) >= 100_000) return `£${Math.round(pounds / 1000)}k`;
  return `£${Math.round(pounds).toLocaleString("en-GB")}`;
}

export function formatRange(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null && high == null) return "";
  if (low == null || high == null || low === high) return formatMoney(low ?? high);
  return `${formatMoney(low)} to ${formatMoney(high)}`;
}

export const LISTING_LABELS: Record<string, string> = {
  grade_i: "Grade I listed",
  grade_ii_star: "Grade II* listed",
  grade_ii: "Grade II listed",
  unlisted: "Unlisted",
  locally_listed: "Locally listed",
};

export const ROLE_LABELS: Record<string, string> = {
  pcc_admin: "PCC admin",
  churchwarden: "Churchwarden",
  treasurer: "Treasurer",
  member: "Member",
  inspector: "Inspecting architect",
  estates_admin: "Estates admin",
  estates: "Estates team",
};
