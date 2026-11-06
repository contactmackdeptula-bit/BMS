import { describe, expect, it } from "vitest";
import {
  addMonths,
  frequencyLabel,
  itemState,
  nextDueFor,
  reminderDue,
  statusLabel,
  todayIn,
  type ItemFacts,
} from "../src/shared/compliance";

const yearly: ItemFacts = { frequencyMonths: 12, anchor: "none", nextDueOverride: null, selfCheck: false };
const noAnchors = { apcm: null, insuranceRenewal: null };
const done = (doneOn: string, documentId: string | null = "doc") => ({ doneOn, status: "complete" as const, documentId });

describe("addMonths", () => {
  it("adds months and clamps to month end", () => {
    expect(addMonths("2026-10-14", 12)).toBe("2027-10-14");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2022-03-03", 60)).toBe("2027-03-03");
  });
});

describe("next due and status", () => {
  it("is last done plus frequency", () => {
    const s = itemState(yearly, [done("2025-10-14")], noAnchors, "2026-11-06");
    expect(s).toMatchObject({ lastDone: "2025-10-14", nextDue: "2026-10-14", status: "overdue", days: -23 });
    expect(statusLabel(s)).toBe("Overdue 23 days");
  });

  it("is due soon within 90 days, on track after", () => {
    expect(itemState(yearly, [done("2025-12-12")], noAnchors, "2026-11-06")).toMatchObject({ status: "due_soon", days: 36 });
    expect(statusLabel({ status: "due_soon", days: 36 })).toBe("Due in 36 days");
    expect(itemState(yearly, [done("2026-10-28")], noAnchors, "2026-11-06").status).toBe("on_track");
    // Day 90 is still "due soon"; day 91 is on track.
    expect(itemState(yearly, [done("2026-02-04")], noAnchors, "2026-11-06").status).toBe("due_soon");
    expect(itemState(yearly, [done("2026-02-05")], noAnchors, "2026-11-06").status).toBe("on_track");
  });

  it("calls the due day itself due, and the next day overdue by 1 day", () => {
    expect(statusLabel(itemState(yearly, [done("2025-11-06")], noAnchors, "2026-11-06"))).toBe("Due today");
    expect(statusLabel(itemState(yearly, [done("2025-11-05")], noAnchors, "2026-11-06"))).toBe("Overdue 1 day");
  });

  it("uses the latest complete occurrence and ignores partial ones", () => {
    const s = itemState(
      { ...yearly, frequencyMonths: 1 },
      [done("2026-09-01"), done("2026-10-01"), { doneOn: "2026-11-01", status: "partial", documentId: null }],
      noAnchors,
      "2026-11-06",
    );
    expect(s.lastDone).toBe("2026-10-01");
    expect(s.nextDue).toBe("2026-11-01");
  });

  it("says 'No record yet' instead of overdue when nothing has been recorded", () => {
    const s = itemState(yearly, [], noAnchors, "2026-11-06");
    expect(s).toMatchObject({ status: "not_recorded", nextDue: null, days: null });
    expect(statusLabel(s)).toBe("No record yet");
  });

  it("lets a manual next-due date win", () => {
    const s = itemState({ ...yearly, nextDueOverride: "2026-11-12" }, [done("2025-10-14")], noAnchors, "2026-11-06");
    expect(s).toMatchObject({ nextDue: "2026-11-12", status: "due_soon", days: 6 });
  });
});

describe("anchored items", () => {
  const apcmItem: ItemFacts = { ...yearly, anchor: "apcm" };
  it("is due on the APCM date when not yet done this cycle", () => {
    expect(nextDueFor(apcmItem, "2026-04-02", { apcm: "2027-04-26", insuranceRenewal: null })).toBe("2027-04-26");
    expect(nextDueFor(apcmItem, null, { apcm: "2027-04-26", insuranceRenewal: null })).toBe("2027-04-26");
  });
  it("counts a March inspection for the April APCM, so the next is due by the following APCM", () => {
    expect(nextDueFor(apcmItem, "2027-03-20", { apcm: "2027-04-26", insuranceRenewal: null })).toBe("2028-04-26");
  });
  it("still rolls forward when the APCM date on file is last year's", () => {
    expect(nextDueFor(apcmItem, "2026-04-02", { apcm: "2026-04-26", insuranceRenewal: null })).toBe("2027-04-26");
  });
  it("doesn't hide missed years when the last check was long ago", () => {
    expect(nextDueFor(apcmItem, "2022-03-01", { apcm: "2027-04-26", insuranceRenewal: null })).toBe("2023-04-26");
  });
  it("falls back to last done + frequency with no anchor date set", () => {
    expect(nextDueFor(apcmItem, "2026-04-02", noAnchors)).toBe("2027-04-02");
  });
  it("uses the insurance renewal date", () => {
    const item: ItemFacts = { ...yearly, anchor: "insurance_renewal" };
    expect(nextDueFor(item, "2026-01-01", { apcm: null, insuranceRenewal: "2027-01-01" })).toBe("2027-01-01");
  });
});

describe("missing evidence", () => {
  it("flags a completed check with no document, unless it's a self-check", () => {
    expect(itemState(yearly, [done("2026-10-01", null)], noAnchors, "2026-11-06").missingEvidence).toBe(true);
    expect(itemState({ ...yearly, selfCheck: true }, [done("2026-10-01", null)], noAnchors, "2026-11-06").missingEvidence).toBe(false);
    expect(itemState(yearly, [done("2026-10-01")], noAnchors, "2026-11-06").missingEvidence).toBe(false);
  });
});

describe("reminders", () => {
  const at = (days: number) => ({ lastDone: null, nextDue: null, status: "due_soon" as const, days, missingEvidence: false });
  it("fires at 60, 30 and 7 days, the first overdue day, then weekly", () => {
    const fired = [];
    for (let d = 70; d >= -30; d--) if (reminderDue(at(d))) fired.push(d);
    expect(fired).toEqual([60, 30, 7, -1, -8, -15, -22, -29]);
  });
});

describe("labels and dates", () => {
  it("words frequencies the way the calendar does", () => {
    expect(frequencyLabel(1, "none")).toBe("Monthly");
    expect(frequencyLabel(6, "none")).toBe("Twice yearly");
    expect(frequencyLabel(12, "apcm")).toBe("Yearly, before APCM");
    expect(frequencyLabel(60, "none")).toBe("Every 5 years");
  });
  it("finds today in London, including across midnight UTC in summer", () => {
    expect(todayIn("Europe/London", new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(todayIn("Europe/London", new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });
});
