// Annual fabric report: facts from the records, the warden's draft, and exports
// (UI-HANDOFF §10). Exports regenerate from current data each time and save a
// copy to Documents.
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { buildFabricReport, CONDITION_TEMPLATE, type FabricFacts, type FabricInput } from "../../shared/fabric-report";
import { fabricReport, logbookEntry, organisation, qiReport, task } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, str } from "../lib/http";
import { ulid } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { BuildingScope } from "../tenancy";
import { listCalendar } from "./compliance";
import { uploadDocument } from "./documents";
import { listJobs } from "./jobs";
import { renderDocx, renderPdf } from "./fabric-report-render";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The report covers the calendar year before the spring APCM: until July, last year. */
export function defaultReportYear(today: string) {
  const y = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) < 7 ? y - 1 : y;
}

export async function gatherFacts(scope: BuildingScope, year: number): Promise<FabricFacts> {
  const org = await scope.db.select({ name: organisation.name, apcmDate: organisation.apcmDate }).from(organisation).where(eq(organisation.id, scope.orgId)).get();

  const jobs = await listJobs(scope, { year, status: "done" });
  const largest = [...jobs].sort((a, b) => (b.costPence ?? 0) - (a.costPence ?? 0)).slice(0, 4);

  const current = await scope.db.select().from(qiReport).where(and(eq(qiReport.buildingId, scope.buildingId), eq(qiReport.status, "current"))).get();
  const tasks = current ? await scope.db.select().from(task).where(eq(task.qiReportId, current.id)).all() : [];
  const isOpen = (t: (typeof tasks)[number]) => t.status !== "done" && t.band !== "M";
  const openA = tasks.filter((t) => isOpen(t) && t.band === "A");

  const cal = await listCalendar(scope);
  const recorded = cal.items.filter((i) => i.status !== "not_recorded");
  const overdue = cal.items.filter((i) => i.status === "overdue");

  const logbook = await scope.db
    .select({ entryDate: logbookEntry.entryDate, work: logbookEntry.work, who: logbookEntry.who, costPence: logbookEntry.costPence, permissionRef: logbookEntry.permissionRef })
    .from(logbookEntry)
    .where(and(eq(logbookEntry.buildingId, scope.buildingId), eq(logbookEntry.status, "approved"), gte(logbookEntry.entryDate, `${year}-01-01`), lte(logbookEntry.entryDate, `${year}-12-31`)))
    .orderBy(logbookEntry.entryDate)
    .all();

  // Suggestions for section 6. The warden confirms or deletes each one; none goes out unconfirmed.
  const suggestions: string[] = [];
  for (const t of openA) {
    const ask = t.permission === "list_b" ? " and to support a List B application" : t.permission === "faculty" ? " and to support a petition for a faculty" : "";
    suggestions.push(`The PCC is asked to note that quinquennial item ${t.ref}, ${t.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}, is urgent and remains outstanding${ask}.`);
  }
  for (const i of overdue.slice(0, 4)) {
    suggestions.push(`The PCC is asked to note that the ${i.name.replace(/^./, (c) => c.toLowerCase())} is overdue and to make sure it is arranged.`);
  }

  return {
    year,
    parish: org?.name ?? "",
    buildingName: scope.building.name,
    apcmDate: org?.apcmDate ?? null,
    productName: scope.env.PRODUCT_NAME,
    works: {
      count: jobs.length,
      totalPence: jobs.reduce((s, j) => s + (j.costPence ?? 0), 0),
      largest: largest.map((j) => ({ title: j.title, doneOn: j.doneOn, contractor: j.contractorName, costPence: j.costPence })),
    },
    qi: current
      ? {
          inspectedOn: current.inspectedOn,
          total: tasks.length,
          done: tasks.length - tasks.filter(isOpen).length,
          openA: openA.map((t) => ({ ref: t.ref, text: t.text, status: t.status, permission: t.permission })),
        }
      : null,
    checks: {
      inDate: recorded.filter((i) => i.status !== "overdue").length,
      recorded: recorded.length,
      notRecorded: cal.items.length - recorded.length,
      overdue: overdue.map((i) => ({ name: i.name, bookedFor: i.nextDueOverride })),
    },
    suggestedMatters: suggestions.slice(0, 8),
    logbook,
  };
}

async function draftRow(scope: BuildingScope, year: number) {
  return scope.db.select().from(fabricReport).where(and(eq(fabricReport.buildingId, scope.buildingId), eq(fabricReport.year, year))).get();
}

function inputOf(row: Awaited<ReturnType<typeof draftRow>>): FabricInput {
  return {
    inspectionDate: row?.inspectionDate ?? null,
    inspectedBy: row?.inspectedBy ?? null,
    accompaniedBy: row?.accompaniedBy ?? null,
    conditionText: row?.conditionText ?? null,
    matters: row?.matters ?? [],
    terrierConfirmed: row?.terrierConfirmed ?? false,
  };
}

export async function getReport(scope: BuildingScope, year: number) {
  const [facts, row] = await Promise.all([gatherFacts(scope, year), draftRow(scope, year)]);
  const input = inputOf(row);
  return {
    year,
    facts,
    input: { ...input, conditionText: input.conditionText ?? CONDITION_TEMPLATE },
    status: row?.status ?? "new",
    exportedDocumentIds: row?.exportedDocumentIds ?? [],
    updatedAt: row?.updatedAt ?? null,
  };
}

export function inputFields(body: Record<string, unknown>): Partial<FabricInput> {
  const out: Partial<FabricInput> = {};
  if ("inspectionDate" in body) {
    if (body.inspectionDate && !isDate(body.inspectionDate)) throw badRequest("Use a valid date.");
    out.inspectionDate = (body.inspectionDate as string) || null;
  }
  for (const k of ["inspectedBy", "accompaniedBy"] as const) if (k in body) out[k] = str(body[k]).slice(0, 300) || null;
  if ("conditionText" in body) out.conditionText = str(body.conditionText).slice(0, 8000) || null;
  if ("terrierConfirmed" in body) out.terrierConfirmed = Boolean(body.terrierConfirmed);
  if ("matters" in body) {
    if (!Array.isArray(body.matters)) throw badRequest("matters must be a list.");
    out.matters = body.matters
      .slice(0, 20)
      .map((m: Record<string, unknown>) => ({ text: str(m?.text).slice(0, 1500), confirmed: Boolean(m?.confirmed) }))
      .filter((m) => m.text);
  }
  return out;
}

export async function saveDraft(scope: BuildingScope, year: number, input: Partial<FabricInput>) {
  scope.require("building.edit");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest("Choose a report year.");
  const row = await draftRow(scope, year);
  if (row) {
    await scope.db.update(fabricReport).set({ ...input, status: "draft", updatedAt: nowIso() }).where(eq(fabricReport.id, row.id));
  } else {
    await scope.db.insert(fabricReport).values({ id: ulid(), orgId: scope.orgId, buildingId: scope.buildingId, year, ...input, matters: input.matters ?? [] });
  }
}

export async function exportReport(scope: BuildingScope, year: number, format: "docx" | "pdf") {
  scope.require("building.edit");
  const [facts, row] = await Promise.all([gatherFacts(scope, year), draftRow(scope, year)]);
  const text = buildFabricReport(facts, inputOf(row));
  const bytes = format === "docx" ? await renderDocx(text) : await renderPdf(text);
  const mimeType = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
  const title = `Annual fabric report ${year}${format === "docx" ? " (Word)" : ""}`;
  const doc = await uploadDocument(scope, { body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, mimeType, type: "fabric_report", title, documentDate: nowIso().slice(0, 10) });

  if (row) {
    await scope.db.update(fabricReport).set({ status: "exported", exportedDocumentIds: [...row.exportedDocumentIds, doc.id], updatedAt: nowIso() }).where(eq(fabricReport.id, row.id));
  } else {
    await scope.db.insert(fabricReport).values({ id: ulid(), orgId: scope.orgId, buildingId: scope.buildingId, year, status: "exported", exportedDocumentIds: [doc.id] });
  }
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "fabric_report", entityId: `${scope.buildingId}:${year}`, action: "exported", summary: { format, documentId: doc.id } });
  return { bytes, mimeType, filename: `${scope.building.name.replace(/[^\w ,.-]+/g, "")} fabric report ${year}.${format}`, documentId: doc.id };
}

export async function reportYears(scope: BuildingScope) {
  const rows = await scope.db.select({ year: fabricReport.year, status: fabricReport.status }).from(fabricReport).where(eq(fabricReport.buildingId, scope.buildingId)).orderBy(desc(fabricReport.year)).all();
  return rows;
}

