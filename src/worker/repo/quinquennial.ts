// Quinquennial inspection reports and their recommendations (SPEC.md §5, UI-HANDOFF §9).
//
// Milestone 4 builds the whole flow with recommendations typed in by hand. AI
// reading (SPEC.md §7.1) will fill the same "review" step later: a report is
// created in `review`, its items are checked and edited, then it is published as
// `current` (the previous current report becomes `previous`).
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { complianceItem, document, job, qiReport, task } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound, str } from "../lib/http";
import { ulid } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { BuildingScope } from "../tenancy";
import { ensureSeeded, recordOccurrence } from "./compliance";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const BANDS = ["A", "B", "C", "D", "M"] as const;
const PERMISSIONS = ["none", "like_for_like", "list_a", "list_b", "faculty", "tbc"] as const;
const STATUSES = ["not_started", "quoted", "in_progress", "waiting", "done"] as const;
type Band = (typeof BANDS)[number];

async function reportRow(scope: BuildingScope, id: string) {
  const r = await scope.db.select().from(qiReport).where(and(eq(qiReport.id, id), eq(qiReport.buildingId, scope.buildingId))).get();
  if (!r) throw notFound();
  return r;
}

async function taskRow(scope: BuildingScope, id: string) {
  const t = await scope.db.select().from(task).where(and(eq(task.id, id), eq(task.buildingId, scope.buildingId))).get();
  if (!t) throw notFound();
  return t;
}

export async function overview(scope: BuildingScope, reportId?: string) {
  const reports = await scope.db
    .select({ r: qiReport, title: document.title, pages: qiReport.pageCount })
    .from(qiReport)
    .leftJoin(document, eq(document.id, qiReport.documentId))
    .where(eq(qiReport.buildingId, scope.buildingId))
    .orderBy(desc(qiReport.inspectedOn), desc(qiReport.createdAt))
    .all();
  const list = reports.map(({ r, title }) => ({
    id: r.id,
    documentId: r.documentId,
    documentTitle: title,
    inspectedOn: r.inspectedOn,
    inspectorName: r.inspectorName,
    pageCount: r.pageCount,
    nextDueOn: r.nextDueOn,
    status: r.status,
  }));
  // Show the report asked for, else one being reviewed, else the current one.
  const shown =
    (reportId && list.find((r) => r.id === reportId)) || list.find((r) => r.status === "review") || list.find((r) => r.status === "current") || null;
  const tasks = shown
    ? await scope.db
        .select({ t: task, jobTitle: job.title, jobDoneOn: job.doneOn })
        .from(task)
        .leftJoin(job, eq(job.id, task.jobId))
        .where(eq(task.qiReportId, shown.id))
        .orderBy(asc(task.band), asc(task.ref))
        .all()
    : [];
  return {
    reports: list,
    report: shown,
    tasks: tasks
      .map(({ t, jobTitle, jobDoneOn }) => ({ ...t, job: t.jobId ? { id: t.jobId, title: jobTitle, doneOn: jobDoneOn } : null }))
      .sort((a, b) => a.band.localeCompare(b.band) || refCompare(a.ref, b.ref)),
  };
}

/** "2.6" before "2.10"; non-numeric refs fall back to text order. */
function refCompare(a: string, b: string) {
  const pa = a.split(/[.\s]/).map(Number);
  const pb = b.split(/[.\s]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (Number.isNaN(x) || Number.isNaN(y)) return a.localeCompare(b);
    if (x !== y) return x - y;
  }
  return 0;
}

export function reportFields(body: Record<string, unknown>) {
  const out: Partial<{ inspectedOn: string | null; inspectorName: string | null; pageCount: number | null; nextDueOn: string | null }> = {};
  for (const k of ["inspectedOn", "nextDueOn"] as const) {
    if (k in body) {
      if (body[k] && !isDate(body[k])) throw badRequest("Use a valid date.");
      out[k] = (body[k] as string) || null;
    }
  }
  if ("inspectorName" in body) out.inspectorName = str(body.inspectorName).slice(0, 200) || null;
  if ("pageCount" in body) {
    const n = body.pageCount === null || body.pageCount === "" ? null : Number(body.pageCount);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 2000)) throw badRequest("Enter the number of pages.");
    out.pageCount = n;
  }
  return out;
}

export async function createReport(scope: BuildingScope, documentId: string, input: ReturnType<typeof reportFields>) {
  scope.require("building.edit");
  const doc = await scope.db.select({ id: document.id }).from(document).where(and(eq(document.id, documentId), eq(document.buildingId, scope.buildingId))).get();
  if (!doc) throw badRequest("Upload the report first.");
  const pending = await scope.db.select({ id: qiReport.id }).from(qiReport).where(and(eq(qiReport.buildingId, scope.buildingId), eq(qiReport.status, "review"))).all();
  if (pending.length) throw badRequest("Finish the report you're already entering first.");
  const id = ulid();
  await scope.db.insert(qiReport).values({ id, orgId: scope.orgId, buildingId: scope.buildingId, documentId, status: "review", ...input });
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "qi_report", entityId: id, action: "created", summary: { inspectedOn: input.inspectedOn ?? null } });
  return id;
}

export async function updateReport(scope: BuildingScope, id: string, input: ReturnType<typeof reportFields>) {
  scope.require("building.edit");
  await reportRow(scope, id);
  await scope.db.update(qiReport).set({ ...input, updatedAt: nowIso() }).where(eq(qiReport.id, id));
}

/** Deletes a report still being entered (a mistake), with its items. Published reports stay. */
export async function discardReport(scope: BuildingScope, id: string) {
  scope.require("building.edit");
  const r = await reportRow(scope, id);
  if (r.status !== "review" && r.status !== "failed") throw badRequest("Only a report that hasn't been published can be discarded.");
  await scope.db.delete(qiReport).where(eq(qiReport.id, r.id)); // tasks cascade
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "qi_report", entityId: id, action: "discarded" });
}

/** Routine (band M) items become recurring checks on the compliance calendar. */
async function routineToCalendar(scope: BuildingScope, t: typeof task.$inferSelect) {
  // Seed the standard checklist first, or this item would make the building look already seeded.
  await ensureSeeded(scope);
  const key = `qi:${t.id}`;
  const exists = await scope.db.select({ id: complianceItem.id }).from(complianceItem).where(and(eq(complianceItem.buildingId, scope.buildingId), eq(complianceItem.templateKey, key))).get();
  if (exists) return;
  const name = t.text.length > 120 ? `${t.text.slice(0, 117)}…` : t.text;
  await scope.db.insert(complianceItem).values({
    id: ulid(),
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    templateKey: key,
    name,
    frequencyMonths: 12,
    anchor: "none",
    doneBy: null,
    note: `From quinquennial item ${t.ref}${t.location ? `, ${t.location}` : ""}. Change how often on the calendar if the inspector suggested another interval.`,
  });
}

export async function publishReport(scope: BuildingScope, id: string) {
  scope.require("building.edit");
  const r = await reportRow(scope, id);
  if (r.status !== "review") throw badRequest("This report is already published.");
  if (!r.inspectedOn) throw badRequest("Add the date of the inspection before publishing.");
  const tasks = await scope.db.select().from(task).where(eq(task.qiReportId, r.id)).all();
  if (tasks.length === 0) throw badRequest("Add the inspector's recommendations before publishing.");

  // Only a newer inspection replaces the current report; an older one is filed as previous.
  const current = await scope.db.select().from(qiReport).where(and(eq(qiReport.buildingId, scope.buildingId), eq(qiReport.status, "current"))).get();
  const becomesCurrent = !current || (current.inspectedOn ?? "") <= r.inspectedOn;
  if (becomesCurrent && current) {
    await scope.db.update(qiReport).set({ status: "previous", updatedAt: nowIso() }).where(eq(qiReport.id, current.id));
  }
  await scope.db
    .update(qiReport)
    .set({ status: becomesCurrent ? "current" : "previous", readAt: nowIso(), updatedAt: nowIso() })
    .where(eq(qiReport.id, r.id));

  if (becomesCurrent) {
    await ensureSeeded(scope);
    for (const t of tasks.filter((t) => t.band === "M")) await routineToCalendar(scope, t);
    // The inspection itself is a compliance check: record it with the report as evidence.
    const qiItem = await scope.db
      .select({ id: complianceItem.id })
      .from(complianceItem)
      .where(and(eq(complianceItem.buildingId, scope.buildingId), eq(complianceItem.templateKey, "quinquennial"), eq(complianceItem.active, true)))
      .get();
    if (qiItem) await recordOccurrence(scope, qiItem.id, { doneOn: r.inspectedOn, documentId: r.documentId, doneByText: r.inspectorName ?? "", notes: "Quinquennial report published" });
  }
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "qi_report", entityId: id, action: "published", summary: { tasks: tasks.length, current: becomesCurrent } });
  return { current: becomesCurrent };
}

type TaskInput = Partial<{
  ref: string;
  text: string;
  location: string | null;
  trade: string | null;
  band: Band;
  estimateLowPence: number | null;
  estimateHighPence: number | null;
  pageNumber: number | null;
  permission: (typeof PERMISSIONS)[number];
  status: (typeof STATUSES)[number];
  waitingOnTaskId: string | null;
}>;

export function taskFields(body: Record<string, unknown>): TaskInput {
  const out: TaskInput = {};
  if ("ref" in body) {
    const r = str(body.ref).slice(0, 20);
    if (!r) throw badRequest("Give the item its reference from the report, like 3.2.");
    out.ref = r;
  }
  if ("text" in body) {
    const t = str(body.text);
    if (!t) throw badRequest("Copy in the inspector's recommendation.");
    out.text = t.slice(0, 4000);
  }
  for (const k of ["location", "trade"] as const) if (k in body) out[k] = str(body[k]).slice(0, 200) || null;
  if ("band" in body) {
    if (!BANDS.includes(body.band as Band)) throw badRequest("Choose the inspector's priority band.");
    out.band = body.band as Band;
  }
  for (const k of ["estimateLowPence", "estimateHighPence", "pageNumber"] as const) {
    if (k in body) {
      const n = body[k] === null || body[k] === "" ? null : Number(body[k]);
      if (n !== null && (!Number.isInteger(n) || n < 0)) throw badRequest(k === "pageNumber" ? "Enter a page number." : "Enter the estimate in pounds.");
      out[k] = n;
    }
  }
  if ("permission" in body) {
    if (!PERMISSIONS.includes(body.permission as never)) throw badRequest("Unknown permission.");
    out.permission = body.permission as TaskInput["permission"];
  }
  if ("status" in body) {
    if (!STATUSES.includes(body.status as never)) throw badRequest("Unknown status.");
    out.status = body.status as TaskInput["status"];
  }
  if ("waitingOnTaskId" in body) out.waitingOnTaskId = str(body.waitingOnTaskId) || null;
  if (out.estimateLowPence != null && out.estimateHighPence != null && out.estimateLowPence > out.estimateHighPence) {
    throw badRequest("The low estimate is above the high one.");
  }
  return out;
}

async function checkWaitingOn(scope: BuildingScope, reportId: string, selfId: string | null, waitingOn: string | null | undefined) {
  if (!waitingOn) return;
  if (waitingOn === selfId) throw badRequest("An item can't wait on itself.");
  const other = await scope.db.select({ id: task.id }).from(task).where(and(eq(task.id, waitingOn), eq(task.qiReportId, reportId))).get();
  if (!other) throw badRequest("That item isn't in this report.");
}

export async function createTask(scope: BuildingScope, reportId: string, input: TaskInput) {
  scope.require("building.edit");
  const r = await reportRow(scope, reportId);
  if (!input.ref || !input.text || !input.band) throw badRequest("Each item needs its reference, the recommendation and a priority band.");
  await checkWaitingOn(scope, r.id, null, input.waitingOnTaskId);
  const id = ulid();
  const values = {
    id,
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    qiReportId: r.id,
    ref: input.ref,
    text: input.text,
    originalText: input.text,
    band: input.band,
    location: input.location ?? null,
    trade: input.trade ?? null,
    estimateLowPence: input.estimateLowPence ?? null,
    estimateHighPence: input.estimateHighPence ?? null,
    pageNumber: input.pageNumber ?? null,
    permission: input.permission ?? "tbc",
    status: input.status ?? "not_started",
    waitingOnTaskId: input.waitingOnTaskId ?? null,
  };
  await scope.db.insert(task).values(values);
  if (r.status === "current" && values.band === "M") await routineToCalendar(scope, { ...values, confidence: null, jobId: null, createdAt: "", updatedAt: "" });
  return id;
}

export async function updateTask(scope: BuildingScope, taskId: string, input: TaskInput) {
  // Progress (status, waiting on) is records work; changing the inspector's wording or band is a churchwarden's.
  const editsWording = ["ref", "text", "band", "location", "estimateLowPence", "estimateHighPence", "pageNumber"].some((k) => k in input);
  scope.require(editsWording ? "building.edit" : "records.write");
  const t = await taskRow(scope, taskId);
  // Done means a job is on record (UI-HANDOFF §9): log the job, which completes the item.
  if (input.status === "done" && !t.jobId) throw badRequest("Log the job that did this work, and the item is marked done.");
  await checkWaitingOn(scope, t.qiReportId, t.id, input.waitingOnTaskId);
  const status = input.waitingOnTaskId ? "waiting" : input.status;
  await scope.db.update(task).set({ ...input, ...(status ? { status } : {}), updatedAt: nowIso() }).where(eq(task.id, t.id));
  const report = await reportRow(scope, t.qiReportId);
  if (report.status === "current" && input.band === "M") await routineToCalendar(scope, { ...t, ...input, band: "M" } as typeof task.$inferSelect);
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "task", entityId: t.id, action: "updated", summary: { fields: Object.keys(input), status: status ?? null } });
}

export async function deleteTask(scope: BuildingScope, taskId: string) {
  scope.require("building.edit");
  const t = await taskRow(scope, taskId);
  const r = await reportRow(scope, t.qiReportId);
  if (r.status !== "review") throw badRequest("Items on a published report can't be deleted; mark them done instead.");
  await scope.db.update(task).set({ waitingOnTaskId: null }).where(and(eq(task.qiReportId, r.id), eq(task.waitingOnTaskId, t.id)));
  await scope.db.delete(task).where(eq(task.id, t.id));
}

/** Called when a job for a task is completed: the task is done. */
export async function completeTaskFromJob(scope: BuildingScope, taskId: string, jobId: string) {
  const t = await taskRow(scope, taskId);
  await scope.db.update(task).set({ status: "done", jobId, updatedAt: nowIso() }).where(eq(task.id, t.id));
  // Anything waiting on this item can now start.
  await scope.db
    .update(task)
    .set({ status: "not_started", waitingOnTaskId: null, updatedAt: nowIso() })
    .where(and(eq(task.waitingOnTaskId, t.id), ne(task.status, "done")));
}

export async function taskInBuilding(scope: BuildingScope, taskId: string) {
  return taskRow(scope, taskId);
}

export { refCompare };
