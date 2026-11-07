// The annual fabric report (UI-HANDOFF §10), built from records.
// One function turns the facts and the warden's own words into the report's
// text, so the on-screen preview and the Word and PDF exports always match.
import { formatPounds } from "./money";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[m! - 1]} ${y}`;
};
const monthOf = (d: string | null) => (d ? MONTHS[Number(d.slice(5, 7)) - 1]! : "");

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export const CONDITION_TEMPLATE =
  "The building remains in [good / fair / poor] condition overall. [Say what has changed since last year, the most pressing problem, and anything being watched.]";

/** Facts the server gathers from the records for one report year. */
export type FabricFacts = {
  year: number;
  parish: string;
  buildingName: string;
  apcmDate: string | null;
  productName: string;
  works: {
    count: number;
    totalPence: number;
    largest: { title: string; doneOn: string | null; contractor: string | null; costPence: number | null }[];
  };
  qi: null | {
    inspectedOn: string | null;
    total: number;
    done: number;
    openA: { ref: string; text: string; status: string; permission: string }[];
  };
  checks: {
    inDate: number;
    recorded: number;
    notRecorded: number;
    overdue: { name: string; bookedFor: string | null }[];
  };
  suggestedMatters: string[];
  logbook: { entryDate: string; work: string; who: string | null; costPence: number | null; permissionRef: string | null }[];
};

/** What the warden fills in or confirms. */
export type FabricInput = {
  inspectionDate: string | null;
  inspectedBy: string | null;
  accompaniedBy: string | null;
  conditionText: string | null;
  matters: { text: string; confirmed: boolean }[];
  terrierConfirmed: boolean;
};

export type ReportSection = {
  n: number;
  heading: string;
  paragraphs: string[];
  /** For the checklist on screen: complete, or needs the warden. */
  state: "ok" | "warn";
  fact: string;
};

export type FabricReportText = {
  title: string;
  subtitle: string;
  presented: string;
  sections: ReportSection[];
  appendix: FabricFacts["logbook"];
  footer: string;
};

const STATUS_WORDS: Record<string, string> = {
  not_started: "not yet started",
  quoted: "quote received",
  in_progress: "in progress",
  waiting: "waiting on other work",
};
const PERMISSION_WORDS: Record<string, string> = {
  list_b: "List B application needed",
  faculty: "faculty needed",
};

export function buildFabricReport(facts: FabricFacts, input: FabricInput): FabricReportText {
  const sections: ReportSection[] = [];

  // 1 Inspection
  const who = input.inspectedBy?.trim() || "the churchwardens";
  const accompanied = input.accompaniedBy?.trim();
  const s1 = input.inspectionDate
    ? `The fabric of the church was inspected on ${longDate(input.inspectionDate)} by ${who}${accompanied ? `, accompanied by ${lower(accompanied)}` : ""}, in accordance with Canon F 13 and the Care of Churches and Ecclesiastical Jurisdiction Measure 1991.`
    : "[Add the date of the churchwardens' inspection.]";
  sections.push({ n: 1, heading: "Inspection", paragraphs: [s1], state: input.inspectionDate ? "ok" : "warn", fact: input.inspectionDate ? longDate(input.inspectionDate) : "Date needed" });

  // 2 Condition, the warden's own words
  const condition = input.conditionText?.trim() || CONDITION_TEMPLATE;
  const conditionDone = !condition.includes("[");
  sections.push({ n: 2, heading: "Condition", paragraphs: condition.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), state: conditionDone ? "ok" : "warn", fact: conditionDone ? "Written" : "Draft, please edit" });

  // 3 Works carried out during the year
  const w = facts.works;
  let s3: string;
  if (w.count === 0) s3 = "No works were recorded during the year.";
  else {
    const items = w.largest.map((j) => {
      const bits = [monthOf(j.doneOn), j.contractor, j.costPence != null ? formatPounds(j.costPence) : null].filter(Boolean);
      return `${lower(j.title)}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    });
    const rest = w.count - w.largest.length;
    const list = items.length > 1 ? `${items.slice(0, -1).join(", ")}${rest > 0 ? ", " : " and "}${items[items.length - 1]}` : items[0];
    s3 = `${countWord(w.count)} ${plural(w.count, "item")} of work ${w.count === 1 ? "was" : "were"} completed at a total cost of ${formatPounds(w.totalPence)}, including ${list}${rest > 0 ? `, and ${rest} smaller ${plural(rest, "item")}` : ""}.`;
  }
  sections.push({ n: 3, heading: "Works carried out during the year", paragraphs: [s3], state: "ok", fact: w.count ? `${w.count} ${plural(w.count, "job")}, ${formatPounds(w.totalPence)}` : "None recorded" });

  // 4 Quinquennial inspection
  let s4: string[];
  let qiFact: string;
  if (!facts.qi) {
    s4 = ["No quinquennial inspection report is held in the records."];
    qiFact = "No report on record";
  } else {
    const q = facts.qi;
    const intro = `Of the ${q.total} recommendations in the report of ${longDate(q.inspectedOn) || "the last inspection"}, ${q.done} ${q.done === 1 ? "has" : "have"} been completed.`;
    if (q.openA.length === 0) s4 = [`${intro} No urgent items remain open.`];
    else {
      const names = q.openA.map((t) => {
        const extra = [STATUS_WORDS[t.status], PERMISSION_WORDS[t.permission]].filter(Boolean).join("; ");
        return `${lower(t.text.replace(/\.$/, ""))} (item ${t.ref}${extra ? `, ${extra}` : ""})`;
      });
      s4 = [`${intro} ${countWord(q.openA.length)} urgent ${plural(q.openA.length, "item remains", "items remain")} open: ${names.join("; ")}.`];
    }
    qiFact = `${q.done} of ${q.total} done, ${q.openA.length} urgent open`;
  }
  sections.push({ n: 4, heading: "Quinquennial inspection", paragraphs: s4, state: "ok", fact: qiFact });

  // 5 Statutory and insurance checks
  const c = facts.checks;
  const parts: string[] = [];
  if (c.recorded === 0) parts.push("No recurring checks have been recorded yet.");
  else {
    parts.push(`${countWord(c.inDate)} of ${c.recorded} recurring checks ${c.inDate === 1 ? "is" : "are"} in date.`);
    if (c.overdue.length) {
      const booked = c.overdue.filter((o) => o.bookedFor);
      const notBooked = c.overdue.filter((o) => !o.bookedFor);
      const name = (o: { name: string }) => lower(o.name);
      const phrases = [
        ...booked.map((o) => `the ${name(o)} (booked for ${longDate(o.bookedFor)})`),
        ...notBooked.map((o) => `the ${name(o)}`),
      ];
      parts.push(`${phrases.length === 1 ? "The following was" : "The following were"} overdue at the date of this report: ${phrases.join("; ")}.`);
    }
  }
  if (c.notRecorded > 0) parts.push(`${countWord(c.notRecorded)} further ${plural(c.notRecorded, "check has", "checks have")} no record yet.`);
  sections.push({ n: 5, heading: "Statutory and insurance checks", paragraphs: [parts.join(" ")], state: "ok", fact: c.recorded ? `${c.inDate} of ${c.recorded} in date` : "None recorded" });

  // 6 Matters for the PCC: only what the warden has confirmed goes in
  const confirmed = input.matters.filter((m) => m.confirmed && m.text.trim());
  const pendingSuggestions = facts.suggestedMatters.filter((s) => !input.matters.some((m) => m.text === s));
  sections.push({
    n: 6,
    heading: "Matters for the attention of the PCC",
    paragraphs: confirmed.length ? confirmed.map((m) => m.text.trim()) : ["There are no matters for the particular attention of the PCC this year."],
    state: pendingSuggestions.length ? "warn" : "ok",
    fact: pendingSuggestions.length ? `${pendingSuggestions.length} suggested, confirm` : `${confirmed.length} confirmed`,
  });

  // 7 Terrier, inventory and logbook
  const n = facts.logbook.length;
  const logSentence = `${countWord(n)} ${plural(n, "entry was", "entries were")} made in the logbook during the year${n ? "; they are listed in the appendix" : ""}.`;
  sections.push({
    n: 7,
    heading: "Terrier, inventory and logbook",
    paragraphs: [input.terrierConfirmed ? `The terrier and inventory have been checked and are accurate. ${logSentence}` : logSentence],
    state: input.terrierConfirmed ? "ok" : "warn",
    fact: `${n} logbook ${plural(n, "entry", "entries")}${input.terrierConfirmed ? "" : ", confirm terrier"}`,
  });

  return {
    title: "Annual Report on the Fabric, Goods and Ornaments",
    subtitle: `${facts.buildingName} · Year ending 31 December ${facts.year}`,
    presented: facts.apcmDate ? `Presented to the Annual Parochial Church Meeting, ${longDate(facts.apcmDate)}` : "Presented to the Annual Parochial Church Meeting",
    sections,
    appendix: facts.logbook,
    footer: `Generated from records held in ${facts.productName} · Signed by the churchwardens`,
  };
}

export const formatLongDate = longDate;
