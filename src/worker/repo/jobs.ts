// Job log and logbook (SPEC.md §5, UI-HANDOFF §10 "Logbook entries").
// Every completed job with at least one document gets a draft logbook entry;
// churchwardens approve drafts on the Jobs page.
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { complianceItem, contractor, document, job, jobDocument, logbookEntry } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound, str } from "../lib/http";
import { ulid } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { BuildingScope } from "../tenancy";
import { recordOccurrence } from "./compliance";
import { contractorInOrg } from "./contractors";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export type JobInput = Partial<{
  title: string;
  doneOn: string | null;
  contractorId: string | null;
  costPence: number | null;
  status: "planned" | "done";
  notes: string | null;
}> & { documentIds?: string[]; complianceItemId?: string | null };

export function jobFields(body: Record<string, unknown>): JobInput {
  const out: JobInput = {};
  if ("title" in body) {
    const t = str(body.title);
    if (!t || t.length > 300) throw badRequest("Say what the job was.");
    out.title = t;
  }
  if ("doneOn" in body) {
    if (body.doneOn && !isDate(body.doneOn)) throw badRequest("Use a valid date.");
    out.doneOn = (body.doneOn as string) || null;
  }
  if ("contractorId" in body) out.contractorId = str(body.contractorId) || null;
  if ("costPence" in body) {
    if (body.costPence === null || body.costPence === "") out.costPence = null;
    else {
      const n = Number(body.costPence);
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000_00) throw badRequest("Enter the cost in pounds, like 1,150.");
      out.costPence = n;
    }
  }
  if ("status" in body) {
    if (body.status !== "planned" && body.status !== "done") throw badRequest("Unknown job status.");
    out.status = body.status;
  }
  if ("notes" in body) out.notes = str(body.notes).slice(0, 4000) || null;
  if ("documentIds" in body) {
    if (!Array.isArray(body.documentIds)) throw badRequest("documentIds must be a list.");
    out.documentIds = body.documentIds.map(str).filter(Boolean).slice(0, 20);
  }
  if ("complianceItemId" in body) out.complianceItemId = str(body.complianceItemId) || null;
  return out;
}

async function documentsOnBuilding(scope: BuildingScope, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await scope.db
    .select({ id: document.id })
    .from(document)
    .where(and(eq(document.buildingId, scope.buildingId), inArray(document.id, ids)))
    .all();
  if (rows.length !== new Set(ids).size) throw badRequest("A document isn't on this building.");
  return rows.map((r) => r.id);
}

async function jobRow(scope: BuildingScope, id: string) {
  const row = await scope.db.select().from(job).where(and(eq(job.id, id), eq(job.buildingId, scope.buildingId))).get();
  if (!row) throw notFound();
  return row;
}

/** Creates the draft logbook entry for a done job with paperwork, once. */
async function draftLogbookIfDue(scope: BuildingScope, jobId: string) {
  const j = await jobRow(scope, jobId);
  if (j.status !== "done") return;
  const hasDoc = await scope.db.select({ id: jobDocument.documentId }).from(jobDocument).where(eq(jobDocument.jobId, j.id)).limit(1).all();
  if (hasDoc.length === 0) return;
  const existing = await scope.db.select({ id: logbookEntry.id }).from(logbookEntry).where(eq(logbookEntry.jobId, j.id)).limit(1).all();
  if (existing.length) return;
  const who = j.contractorId
    ? (await scope.db.select({ name: contractor.name }).from(contractor).where(eq(contractor.id, j.contractorId)).get())?.name ?? null
    : null;
  await scope.db.insert(logbookEntry).values({
    id: ulid(),
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    jobId: j.id,
    entryDate: j.doneOn ?? nowIso().slice(0, 10),
    work: j.title,
    who,
    costPence: j.costPence,
  });
}

export async function createJob(scope: BuildingScope, input: JobInput & { title: string }) {
  scope.require("records.write");
  if (input.contractorId) await contractorInOrg(scope, input.contractorId);
  const docs = await documentsOnBuilding(scope, input.documentIds ?? []);
  const status = input.status ?? "done";
  if (status === "done" && !input.doneOn) throw badRequest("Enter the date the job was done.");
  const id = ulid();

  // "Job done" can also record a compliance check (a boiler service is both).
  let complianceOccurrenceId: string | null = null;
  if (input.complianceItemId && status === "done") {
    const item = await scope.db
      .select({ id: complianceItem.id })
      .from(complianceItem)
      .where(and(eq(complianceItem.id, input.complianceItemId), eq(complianceItem.buildingId, scope.buildingId)))
      .get();
    if (!item) throw badRequest("That check isn't on this building.");
    complianceOccurrenceId = (
      await recordOccurrence(scope, item.id, { doneOn: input.doneOn, documentId: docs[0] ?? null, notes: `Job: ${input.title}` })
    ).id;
  }

  await scope.db.insert(job).values({
    id,
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    title: input.title,
    doneOn: input.doneOn ?? null,
    contractorId: input.contractorId ?? null,
    costPence: input.costPence ?? null,
    status,
    notes: input.notes ?? null,
    complianceOccurrenceId,
  });
  for (const d of docs) await scope.db.insert(jobDocument).values({ jobId: id, documentId: d }).onConflictDoNothing();
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "job", entityId: id, action: "created", summary: { title: input.title, costPence: input.costPence ?? null } });
  await draftLogbookIfDue(scope, id);
  return id;
}

export async function updateJob(scope: BuildingScope, id: string, input: JobInput) {
  scope.require("records.write");
  const before = await jobRow(scope, id);
  if (input.contractorId) await contractorInOrg(scope, input.contractorId);
  const { documentIds, complianceItemId: _ignored, ...fields } = input;
  const next = { ...before, ...fields };
  if (next.status === "done" && !next.doneOn) throw badRequest("Enter the date the job was done.");
  if (Object.keys(fields).length) await scope.db.update(job).set({ ...fields, updatedAt: nowIso() }).where(eq(job.id, id));
  if (documentIds) {
    // Adds paperwork; existing links stay.
    for (const d of await documentsOnBuilding(scope, documentIds)) {
      await scope.db.insert(jobDocument).values({ jobId: id, documentId: d }).onConflictDoNothing();
    }
  }
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "job", entityId: id, action: "updated", summary: { fields: Object.keys(input) } });
  await draftLogbookIfDue(scope, id);
}

export async function deleteJob(scope: BuildingScope, id: string) {
  scope.require("records.write");
  const j = await jobRow(scope, id);
  const approved = await scope.db
    .select({ id: logbookEntry.id })
    .from(logbookEntry)
    .where(and(eq(logbookEntry.jobId, j.id), eq(logbookEntry.status, "approved")))
    .all();
  if (approved.length) throw badRequest("This job is in the approved logbook, so it can't be deleted.");
  await scope.db.delete(logbookEntry).where(eq(logbookEntry.jobId, j.id));
  await scope.db.delete(job).where(eq(job.id, j.id)); // job_document rows cascade
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "job", entityId: id, action: "deleted", summary: { title: j.title } });
}

export type JobView = Awaited<ReturnType<typeof listJobs>>[number];

export async function listJobs(scope: BuildingScope, filter: { year?: number; status?: "planned" | "done"; contractorId?: string; limit?: number } = {}) {
  const conds = [eq(job.buildingId, scope.buildingId)];
  if (filter.year) {
    conds.push(gte(job.doneOn, `${filter.year}-01-01`), lte(job.doneOn, `${filter.year}-12-31`));
  }
  if (filter.status) conds.push(eq(job.status, filter.status));
  if (filter.contractorId) conds.push(eq(job.contractorId, filter.contractorId));
  const rows = await scope.db
    .select({ j: job, contractorName: contractor.name })
    .from(job)
    .leftJoin(contractor, eq(contractor.id, job.contractorId))
    .where(and(...conds))
    .orderBy(sql`${job.status} = 'done'`, desc(job.doneOn), desc(job.createdAt))
    .limit(filter.limit ?? 500)
    .all();
  const ids = rows.map((r) => r.j.id);
  const docs = ids.length
    ? await scope.db
        .select({ jobId: jobDocument.jobId, id: document.id, type: document.type, title: document.title })
        .from(jobDocument)
        .innerJoin(document, eq(document.id, jobDocument.documentId))
        .where(inArray(jobDocument.jobId, ids))
        .all()
    : [];
  const logs = ids.length
    ? await scope.db.select({ jobId: logbookEntry.jobId, status: logbookEntry.status }).from(logbookEntry).where(inArray(logbookEntry.jobId, ids)).all()
    : [];
  return rows.map(({ j, contractorName }) => {
    const paperwork = docs.filter((d) => d.jobId === j.id).map(({ jobId: _j, ...d }) => d);
    const logbook = logs.find((l) => l.jobId === j.id)?.status ?? null;
    return {
      ...j,
      contractorName,
      paperwork,
      awaitingInvoice: j.status === "done" && !paperwork.some((d) => d.type === "invoice"),
      logbook,
    };
  });
}

export async function spendSummary(scope: BuildingScope, year: number) {
  const jobs = await listJobs(scope, { year, status: "done" });
  return {
    year,
    totalPence: jobs.reduce((s, j) => s + (j.costPence ?? 0), 0),
    jobCount: jobs.length,
    awaitingInvoice: jobs.filter((j) => j.awaitingInvoice).length,
  };
}

// ---------- Logbook ----------
export async function listLogbook(scope: BuildingScope, status?: "draft" | "approved") {
  const conds = [eq(logbookEntry.buildingId, scope.buildingId)];
  if (status) conds.push(eq(logbookEntry.status, status));
  return scope.db.select().from(logbookEntry).where(and(...conds)).orderBy(desc(logbookEntry.entryDate)).all();
}

export function logbookFields(body: Record<string, unknown>) {
  const out: Partial<{ entryDate: string; work: string; who: string | null; costPence: number | null; permissionRef: string | null }> = {};
  if ("entryDate" in body) {
    if (!isDate(body.entryDate)) throw badRequest("Use a valid date.");
    out.entryDate = body.entryDate;
  }
  if ("work" in body) {
    const w = str(body.work);
    if (!w) throw badRequest("Describe the work.");
    out.work = w.slice(0, 1000);
  }
  if ("who" in body) out.who = str(body.who).slice(0, 200) || null;
  if ("permissionRef" in body) out.permissionRef = str(body.permissionRef).slice(0, 200) || null;
  if ("costPence" in body) {
    const n = body.costPence === null || body.costPence === "" ? null : Number(body.costPence);
    if (n !== null && (!Number.isInteger(n) || n < 0)) throw badRequest("Enter a valid cost.");
    out.costPence = n;
  }
  return out;
}

async function entryRow(scope: BuildingScope, id: string) {
  const row = await scope.db.select().from(logbookEntry).where(and(eq(logbookEntry.id, id), eq(logbookEntry.buildingId, scope.buildingId))).get();
  if (!row) throw notFound();
  return row;
}

export async function updateLogbookEntry(scope: BuildingScope, id: string, input: ReturnType<typeof logbookFields>) {
  scope.require("records.write");
  const row = await entryRow(scope, id);
  if (row.status === "approved") throw badRequest("Approved logbook entries can't be changed.");
  await scope.db.update(logbookEntry).set({ ...input, updatedAt: nowIso() }).where(eq(logbookEntry.id, id));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "logbook_entry", entityId: id, action: "updated", summary: { fields: Object.keys(input) } });
}

/** Churchwardens and the PCC admin approve entries into the logbook. */
export async function approveLogbookEntry(scope: BuildingScope, id: string) {
  scope.require("building.edit");
  const row = await entryRow(scope, id);
  if (row.status === "approved") return;
  await scope.db
    .update(logbookEntry)
    .set({ status: "approved", approvedBy: scope.userId, approvedAt: nowIso(), updatedAt: nowIso() })
    .where(and(eq(logbookEntry.id, id), isNull(logbookEntry.approvedAt)));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "logbook_entry", entityId: id, action: "approved", summary: { work: row.work } });
}
