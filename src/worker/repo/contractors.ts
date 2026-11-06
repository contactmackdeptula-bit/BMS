// Contractor address book (SPEC.md §5). Contractors belong to the organisation,
// so a parish with a church and a hall shares one address book.
import { and, desc, eq, sql } from "drizzle-orm";
import { contractor, job } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound, str } from "../lib/http";
import { ulid } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { BuildingScope } from "../tenancy";

const FIELDS = ["name", "trade", "contactName", "phone", "email", "website", "accreditation", "notes"] as const;
type ContractorInput = Partial<Record<Exclude<(typeof FIELDS)[number], "name">, string | null>> & { name?: string };

export function contractorFields(body: Record<string, unknown>): ContractorInput {
  const out: ContractorInput = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = str(body[f]).slice(0, f === "notes" ? 2000 : 200);
    if (f === "name") {
      if (!v) throw badRequest("Give the contractor a name.");
      out.name = v;
    } else out[f] = v || null;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw badRequest("That email address doesn't look right.");
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = `https://${out.website}`;
  return out;
}

export async function listContractors(scope: BuildingScope) {
  const rows = await scope.db
    .select({
      c: contractor,
      jobCount: sql<number>`count(${job.id})`,
      totalPence: sql<number>`coalesce(sum(${job.costPence}), 0)`,
      lastJobOn: sql<string | null>`max(${job.doneOn})`,
    })
    .from(contractor)
    .leftJoin(job, and(eq(job.contractorId, contractor.id), eq(job.orgId, contractor.orgId)))
    .where(eq(contractor.orgId, scope.orgId))
    .groupBy(contractor.id)
    .orderBy(contractor.name)
    .all();
  return rows.map((r) => ({ ...r.c, jobCount: r.jobCount, totalPence: r.totalPence, lastJobOn: r.lastJobOn }));
}

export async function contractorInOrg(scope: BuildingScope, id: string) {
  const row = await scope.db
    .select()
    .from(contractor)
    .where(and(eq(contractor.id, id), eq(contractor.orgId, scope.orgId)))
    .get();
  if (!row) throw badRequest("That contractor isn't in your address book.");
  return row;
}

export async function getContractor(scope: BuildingScope, id: string) {
  const row = await scope.db.select().from(contractor).where(and(eq(contractor.id, id), eq(contractor.orgId, scope.orgId))).get();
  if (!row) throw notFound();
  const jobs = await scope.db
    .select({ id: job.id, title: job.title, doneOn: job.doneOn, costPence: job.costPence, status: job.status, buildingId: job.buildingId })
    .from(job)
    .where(and(eq(job.contractorId, id), eq(job.orgId, scope.orgId)))
    .orderBy(desc(job.doneOn))
    .all();
  return { contractor: row, jobs };
}

export async function createContractor(scope: BuildingScope, input: ContractorInput & { name: string }) {
  scope.require("records.write");
  const id = ulid();
  await scope.db.insert(contractor).values({ id, orgId: scope.orgId, ...input });
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "contractor", entityId: id, action: "created", summary: { name: input.name } });
  return id;
}

export async function updateContractor(scope: BuildingScope, id: string, input: ContractorInput) {
  scope.require("records.write");
  const row = await scope.db.select({ id: contractor.id }).from(contractor).where(and(eq(contractor.id, id), eq(contractor.orgId, scope.orgId))).get();
  if (!row) throw notFound();
  await scope.db.update(contractor).set({ ...input, updatedAt: nowIso() }).where(eq(contractor.id, id));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "contractor", entityId: id, action: "updated", summary: { fields: Object.keys(input) } });
}

export async function deleteContractor(scope: BuildingScope, id: string) {
  scope.require("records.write");
  const { jobs } = await getContractor(scope, id);
  if (jobs.length) throw badRequest("This contractor has jobs on record, so they stay in the address book.");
  await scope.db.delete(contractor).where(and(eq(contractor.id, id), eq(contractor.orgId, scope.orgId)));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "contractor", entityId: id, action: "deleted" });
}
