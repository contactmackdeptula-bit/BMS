// Compliance status rules (SPEC.md §5 complianceItem, UI-HANDOFF §8).
// One implementation, used by the API, the screens and the reminder emails, so
// they always agree. Pure functions on YYYY-MM-DD strings; no time zones inside.

export type Anchor = "none" | "apcm" | "insurance_renewal";
export type ComplianceStatus = "overdue" | "due_soon" | "on_track" | "not_recorded";

export const DUE_SOON_DAYS = 90;

const pad = (n: number) => String(n).padStart(2, "0");
const parts = (d: string) => d.slice(0, 10).split("-").map(Number) as [number, number, number];
const toUtc = (d: string) => {
  const [y, m, day] = parts(d);
  return Date.UTC(y, m - 1, day);
};

/** Adds whole months, clamping to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

export function addDaysTo(date: string, days: number): string {
  const t = new Date(toUtc(date) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (positive when b is later). */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

/** Today's date in a time zone, as YYYY-MM-DD. */
export function todayIn(timeZone = "Europe/London", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type ItemFacts = {
  frequencyMonths: number;
  anchor: Anchor;
  nextDueOverride: string | null;
  selfCheck: boolean;
};

export type OccurrenceFacts = { doneOn: string; status: "complete" | "partial"; documentId: string | null };

export type AnchorDates = { apcm: string | null; insuranceRenewal: string | null };

export type ItemState = {
  lastDone: string | null;
  nextDue: string | null;
  status: ComplianceStatus;
  /** Days until due (negative when overdue); null when there is no record. */
  days: number | null;
  missingEvidence: boolean;
};

/**
 * Next due date:
 *   1. a manual override, if set;
 *   2. for anchored items, the next anchor date not yet covered by a check
 *      (see the window rule below);
 *   3. otherwise last done + frequency.
 * With no record at all and no anchor, there is no due date: the item shows
 * "No record yet" rather than being called overdue on day one.
 */
export function nextDueFor(item: ItemFacts, lastDone: string | null, anchors: AnchorDates): string | null {
  if (item.nextDueOverride) return item.nextDueOverride;
  const anchorDate =
    item.anchor === "apcm" ? anchors.apcm : item.anchor === "insurance_renewal" ? anchors.insuranceRenewal : null;
  if (anchorDate) {
    if (!lastDone) return anchorDate;
    // Each anchor date has a window: the `frequency` before it. A check done in
    // that window counts for that anchor (an inspection in March counts for the
    // April APCM). Due = the earliest anchor whose window opens after last done,
    // found by stepping the anchor date forward or back by the frequency.
    const opensAfterLastDone = (due: string) => addMonths(due, -item.frequencyMonths) >= lastDone;
    let due = anchorDate;
    for (let i = 0; i < 200 && !opensAfterLastDone(due); i++) due = addMonths(due, item.frequencyMonths);
    for (let i = 0; i < 200 && opensAfterLastDone(addMonths(due, -item.frequencyMonths)); i++) {
      due = addMonths(due, -item.frequencyMonths);
    }
    return due;
  }
  return lastDone ? addMonths(lastDone, item.frequencyMonths) : null;
}

export function itemState(
  item: ItemFacts,
  occurrences: OccurrenceFacts[],
  anchors: AnchorDates,
  today: string,
): ItemState {
  const complete = occurrences.filter((o) => o.status === "complete").sort((a, b) => (a.doneOn < b.doneOn ? 1 : -1));
  const latest = complete[0] ?? null;
  const lastDone = latest?.doneOn ?? null;
  const nextDue = nextDueFor(item, lastDone, anchors);
  const missingEvidence = Boolean(latest && !item.selfCheck && !latest.documentId);
  if (!nextDue) return { lastDone, nextDue, status: "not_recorded", days: null, missingEvidence };
  const days = daysBetween(today, nextDue);
  const status: ComplianceStatus = days < 0 ? "overdue" : days <= DUE_SOON_DAYS ? "due_soon" : "on_track";
  return { lastDone, nextDue, status, days, missingEvidence };
}

/** The words on the status pill; reminder emails use the same words (UI-HANDOFF §14). */
export function statusLabel(s: Pick<ItemState, "status" | "days">): string {
  if (s.status === "not_recorded" || s.days == null) return "No record yet";
  if (s.status === "overdue") return `Overdue ${-s.days} ${-s.days === 1 ? "day" : "days"}`;
  if (s.status === "due_soon") return s.days === 0 ? "Due today" : `Due in ${s.days} ${s.days === 1 ? "day" : "days"}`;
  return "On track";
}

export function frequencyLabel(months: number, anchor: Anchor): string {
  if (anchor === "apcm" && months === 12) return "Yearly, before APCM";
  if (months === 1) return "Monthly";
  if (months === 6) return "Twice yearly";
  if (months === 12) return "Yearly";
  if (months % 12 === 0) return `Every ${months / 12} years`;
  return `Every ${months} months`;
}

/**
 * Reminder rule (UI-HANDOFF §8): 60, 30 and 7 days before, on the day it becomes
 * overdue, then weekly while overdue.
 */
export function reminderDue(state: ItemState): boolean {
  if (state.days == null) return false;
  if (state.days === 60 || state.days === 30 || state.days === 7) return true;
  if (state.days < 0) return (-state.days - 1) % 7 === 0;
  return false;
}
