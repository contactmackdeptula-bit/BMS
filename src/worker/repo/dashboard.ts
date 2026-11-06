// Church dashboard (UI-HANDOFF §7): what does this building need from me
// before the next PCC meeting. Everything here is derived server-side.
import { and, eq, sql } from "drizzle-orm";
import { contractor, document, qiReport, task } from "../db/schema";
import { formatRangeText } from "../../shared/money";
import type { BuildingScope } from "../tenancy";
import { listCalendar } from "./compliance";
import { listJobs, spendSummary } from "./jobs";

type Tone = "danger" | "warn" | "info" | "ok" | "neutral";
export type AttentionItem = {
  kind: "compliance" | "task" | "setup";
  pill: { tone: Tone; label: string };
  title: string;
  detail: string;
  action: { label: string; href: string };
};

const BANDS = ["A", "B", "C", "D", "M"] as const;

export async function dashboard(scope: BuildingScope) {
  const base = `/b/${scope.buildingId}`;
  const cal = await listCalendar(scope);
  const year = Number(cal.today.slice(0, 4));
  const [spend, recentJobs] = await Promise.all([spendSummary(scope, year), listJobs(scope, { status: "done", limit: 4 })]);

  // Quinquennial: the current report's tasks (empty until milestone 4 brings uploads).
  const current = await scope.db
    .select()
    .from(qiReport)
    .where(and(eq(qiReport.buildingId, scope.buildingId), eq(qiReport.status, "current")))
    .get();
  const tasks = current ? await scope.db.select().from(task).where(eq(task.qiReportId, current.id)).all() : [];
  const bands = BANDS.map((band) => {
    const inBand = tasks.filter((t) => t.band === band);
    return { band, total: inBand.length, done: inBand.filter((t) => t.status === "done").length };
  });
  const open = tasks.filter((t) => t.status !== "done");
  const qi = current
    ? {
        reportId: current.id,
        inspectedOn: current.inspectedOn,
        nextDueOn: current.nextDueOn,
        total: tasks.length,
        done: tasks.length - open.length,
        open: open.length,
        openA: open.filter((t) => t.band === "A").length,
        bands,
        estimateLowPence: open.reduce((s, t) => s + (t.estimateLowPence ?? 0), 0),
        estimateHighPence: open.reduce((s, t) => s + (t.estimateHighPence ?? 0), 0),
        needPermission: open.filter((t) => t.permission === "list_b" || t.permission === "faculty").length,
      }
    : null;

  // Needs attention: overdue checks, then due within 60 days, then open priority A tasks; at most five.
  const attention: AttentionItem[] = [];
  const actionLabel = (selfCheck: boolean, name: string) =>
    selfCheck ? "Record test" : /review|assessment/i.test(name) ? "Record review" : "Record";
  for (const i of cal.items.filter((i) => i.status === "overdue")) {
    attention.push({
      kind: "compliance",
      pill: { tone: "danger", label: i.statusLabel },
      title: i.name,
      detail: [i.lastDone && `Last done ${fmt(i.lastDone)}`, i.doneBy].filter(Boolean).join(" · "),
      action: { label: actionLabel(i.selfCheck, i.name), href: `${base}/compliance?item=${i.id}` },
    });
  }
  for (const i of cal.items.filter((i) => i.status === "due_soon" && (i.days ?? 99) <= 60)) {
    attention.push({
      kind: "compliance",
      pill: { tone: "warn", label: i.days === 0 ? "Due today" : `Due ${fmtShort(i.nextDue!)}` },
      title: i.name,
      detail: [i.lastDone && `Last done ${fmt(i.lastDone)}`, i.doneBy].filter(Boolean).join(" · "),
      action: { label: actionLabel(i.selfCheck, i.name), href: `${base}/compliance?item=${i.id}` },
    });
  }
  for (const t of open.filter((t) => t.band === "A")) {
    const permission = t.permission === "list_b" ? "Needs List B permission before work starts" : t.permission === "faculty" ? "Needs a faculty before work starts" : null;
    attention.push({
      kind: "task",
      pill: { tone: "danger", label: "Priority A" },
      title: `${t.text.length > 80 ? t.text.slice(0, 77) + "…" : t.text} (QI item ${t.ref})`,
      detail: [formatRangeText(t.estimateLowPence, t.estimateHighPence) && `Inspector estimate ${formatRangeText(t.estimateLowPence, t.estimateHighPence)}`, permission].filter(Boolean).join(" · "),
      action: { label: "Open task", href: `${base}/quinquennial?task=${t.id}` },
    });
  }

  // A new building: the three setup steps (UI-HANDOFF §13).
  const [hasInsurance, contractorCount] = await Promise.all([
    scope.db
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.buildingId, scope.buildingId), eq(document.type, "insurance_schedule")))
      .limit(1)
      .all(),
    scope.db.select({ n: sql<number>`count(*)` }).from(contractor).where(eq(contractor.orgId, scope.orgId)).get(),
  ]);
  const setup: AttentionItem[] = [];
  if (!current) setup.push({ kind: "setup", pill: { tone: "neutral", label: "Set up" }, title: "Add your quinquennial report", detail: "Its recommendations become a task list.", action: { label: "Add report", href: `${base}/quinquennial` } });
  if (hasInsurance.length === 0) setup.push({ kind: "setup", pill: { tone: "neutral", label: "Set up" }, title: "Upload your insurance schedule", detail: "Keep the policy with the building's records.", action: { label: "Upload", href: `${base}/documents?upload=insurance_schedule` } });
  if (!contractorCount?.n) setup.push({ kind: "setup", pill: { tone: "neutral", label: "Set up" }, title: "Add your contractors", detail: "The people you call for the boiler, the roof and the gutters.", action: { label: "Add contractors", href: `${base}/contractors` } });
  const isNew = !current && recentJobs.length === 0;

  const overdue = cal.items.filter((i) => i.status === "overdue");
  const dueSoon = cal.items.filter((i) => i.status === "due_soon").sort((a, b) => (a.nextDue ?? "").localeCompare(b.nextDue ?? ""));
  return {
    today: cal.today,
    stats: {
      overdue: { count: overdue.length, names: overdue.map((i) => i.name) },
      dueSoon: { count: dueSoon.length, next: dueSoon[0] ? { name: dueSoon[0].name, nextDue: dueSoon[0].nextDue } : null },
      notRecorded: cal.counts.not_recorded,
      spend,
    },
    attention: (isNew ? [...setup, ...attention] : [...attention, ...setup]).slice(0, 5),
    attentionTotal: attention.length + setup.length,
    qi,
    recentJobs,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m! - 1]} ${y}`;
}
function fmtShort(d: string) {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m! - 1]}`;
}
