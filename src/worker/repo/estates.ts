// Diocesan estates console (UI-HANDOFF §11): one view over every building in an
// estates organisation's tree, computed from the records each parish keeps.
// Estates users read parish records; they write only their own notes and
// programmes.
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { addDaysTo, itemState, todayIn } from "../../shared/compliance";
import {
  building,
  complianceItem,
  complianceOccurrence,
  contractor,
  document,
  estatesNote,
  job,
  membership,
  organisation,
  programme,
  qiReport,
  task,
  user,
} from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound, str } from "../lib/http";
import { ulid } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { BuildingScope, OrgScope } from "../tenancy";

/**
 * Typical cost bands per check, in pence, for programme estimates. Starting
 * figures for southern England in 2026, to be replaced by each diocese's own
 * rates once they have them; shown as estimates, never quotes.
 */
export const TYPICAL_COST: Record<string, [number, number]> = {
  lightning_protection: [35000, 50000],
  eicr: [75000, 120000],
  emergency_lighting_annual: [20000, 35000],
  gutters: [30000, 40000],
  gas_boiler: [15000, 25000],
  pat: [12000, 25000],
  fire_extinguishers: [8000, 15000],
  tree_survey: [30000, 60000],
  quinquennial: [80000, 150000],
  fire_risk_review: [0, 30000],
  lift: [15000, 30000],
  legionella: [25000, 45000],
};
const PROGRAMME_MIN_BUILDINGS = 5;
const PROGRAMME_WINDOW_DAYS = 120;

type Estate = Awaited<ReturnType<typeof loadEstate>>;

/** Every organisation below this one, with each parish's pastoral area. */
async function tree(db: DrizzleD1Database, rootId: string) {
  const rows = await db.all<{ id: string; name: string; type: string; parent_id: string | null }>(sql`
    WITH RECURSIVE down(id, depth) AS (
      SELECT id, 0 FROM organisation WHERE id = ${rootId}
      UNION ALL SELECT o.id, down.depth + 1 FROM organisation o JOIN down ON o.parent_id = down.id WHERE down.depth < 10
    ) SELECT o.id, o.name, o.type, o.parent_id FROM organisation o JOIN down ON down.id = o.id`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const areaOf = (orgId: string): { id: string; name: string } | null => {
    let cur = byId.get(orgId);
    for (let i = 0; cur && i < 10; i++) {
      if (cur.type === "pastoral_area") return { id: cur.id, name: cur.name };
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return null;
  };
  return { orgs: rows, areaOf, areas: rows.filter((r) => r.type === "pastoral_area").map((r) => ({ id: r.id, name: r.name })) };
}

export async function loadEstate(scope: OrgScope, areaId?: string | null) {
  if (scope.kind !== "estates") throw forbidden();
  const db = scope.db;
  const today = todayIn(scope.org.timezone);
  const t = await tree(db, scope.org.id);
  const orgIds = t.orgs.map((o) => o.id);
  let buildings = orgIds.length ? await db.select().from(building).where(inArray(building.orgId, orgIds)).orderBy(building.name).all() : [];
  if (areaId) buildings = buildings.filter((b) => t.areaOf(b.orgId)?.id === areaId);
  const ids = buildings.map((b) => b.id);
  const orgName = new Map(t.orgs.map((o) => [o.id, o.name]));
  const apcmByOrg = new Map((orgIds.length ? await db.select({ id: organisation.id, apcm: organisation.apcmDate }).from(organisation).where(inArray(organisation.id, orgIds)).all() : []).map((o) => [o.id, o.apcm]));

  // Compliance, computed in memory from two bulk reads.
  const items = ids.length ? await db.select().from(complianceItem).where(and(inArray(complianceItem.buildingId, ids), eq(complianceItem.active, true))).all() : [];
  const occs = items.length ? await db.select().from(complianceOccurrence).where(inArray(complianceOccurrence.complianceItemId, items.map((i) => i.id))).all() : [];
  const occsByItem = new Map<string, typeof occs>();
  for (const o of occs) occsByItem.set(o.complianceItemId, [...(occsByItem.get(o.complianceItemId) ?? []), o]);
  const states = items.map((i) => {
    const b = buildings.find((x) => x.id === i.buildingId)!;
    return { item: i, state: itemState(i, occsByItem.get(i.id) ?? [], { apcm: apcmByOrg.get(b.orgId) ?? null, insuranceRenewal: b.insuranceRenewsOn }, today) };
  });

  // Current quinquennial reports and their open tasks.
  const reports = ids.length ? await db.select().from(qiReport).where(and(inArray(qiReport.buildingId, ids), eq(qiReport.status, "current"))).all() : [];
  const tasks = reports.length ? await db.select().from(task).where(inArray(task.qiReportId, reports.map((r) => r.id))).all() : [];
  const openTasks = tasks.filter((x) => x.status !== "done" && x.band !== "M");
  const mid = (x: { estimateLowPence: number | null; estimateHighPence: number | null }) =>
    x.estimateLowPence == null && x.estimateHighPence == null ? 0 : Math.round(((x.estimateLowPence ?? x.estimateHighPence ?? 0) + (x.estimateHighPence ?? x.estimateLowPence ?? 0)) / 2);

  // Parish contacts: the first PCC admin, else a churchwarden.
  const parishOrgIds = [...new Set(buildings.map((b) => b.orgId))];
  const contacts = parishOrgIds.length
    ? await db
        .select({ orgId: membership.orgId, role: membership.role, name: user.name, email: user.email })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(and(inArray(membership.orgId, parishOrgIds), inArray(membership.role, ["pcc_admin", "churchwarden"])))
        .all()
    : [];

  const rows = buildings.map((b) => {
    const mine = states.filter((s) => s.item.buildingId === b.id);
    const report = reports.find((r) => r.buildingId === b.id) ?? null;
    const open = openTasks.filter((x) => x.buildingId === b.id);
    const qiItem = mine.find((s) => s.item.templateKey === "quinquennial");
    const surveyDue = report?.nextDueOn ?? qiItem?.state.nextDue ?? null;
    const contact = contacts.filter((c) => c.orgId === b.orgId).sort((x, y) => (x.role === "pcc_admin" ? -1 : 1) - (y.role === "pcc_admin" ? -1 : 1))[0];
    return {
      id: b.id,
      name: b.name,
      parish: orgName.get(b.orgId) ?? "",
      area: t.areaOf(b.orgId),
      listing: b.listing,
      hasCalendar: mine.length > 0,
      overdue: mine.filter((s) => s.state.status === "overdue").map((s) => s.item.name),
      openA: open.filter((x) => x.band === "A").length,
      openB: open.filter((x) => x.band === "B").length,
      backlogPence: open.reduce((s, x) => s + mid(x), 0),
      surveyDue,
      surveyOverdue: Boolean(surveyDue && surveyDue < today),
      contact: contact ? { name: contact.name, email: contact.email, role: contact.role } : null,
    };
  });
  rows.sort((a, b) => b.openA - a.openA || b.overdue.length - a.overdue.length || a.name.localeCompare(b.name));

  return { today, t, buildings, rows, states, openTasks, tasks, reports, mid, ids };
}

export async function overview(scope: OrgScope, areaId?: string | null) {
  const e = await loadEstate(scope, areaId);
  const { today, rows } = e;

  // Overdue checks: total, churches, the most common.
  const overdueStates = e.states.filter((s) => s.state.status === "overdue");
  const commonCounts = new Map<string, number>();
  for (const s of overdueStates) commonCounts.set(s.item.name, (commonCounts.get(s.item.name) ?? 0) + 1);
  const common = [...commonCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  // Certificates lapsing this quarter.
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const qStart = `${today.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  const qEnd = addDaysTo(`${today.slice(0, 4)}-${String(q * 3 + 3).padStart(2, "0")}-01`, 40).slice(0, 7) + "-01";
  const lapsing = e.ids.length
    ? await scope.db
        .select({ type: document.type, n: sql<number>`count(*)` })
        .from(document)
        .where(and(inArray(document.buildingId, e.ids), gte(document.expiresOn, qStart), lte(document.expiresOn, addDaysTo(qEnd, -1))))
        .groupBy(document.type)
        .all()
    : [];

  // Backlog at the surveyors' estimates (midpoints), by trade, and what was cleared this year.
  const backlog = e.openTasks.reduce((s, x) => s + e.mid(x), 0);
  const byTrade = new Map<string, number>();
  for (const x of e.openTasks) byTrade.set(x.trade || "Other", (byTrade.get(x.trade || "Other") ?? 0) + e.mid(x));
  const topTrade = [...byTrade.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const doneThisYear = e.tasks.filter((x) => x.status === "done" && x.updatedAt >= `${today.slice(0, 4)}-01-01`).reduce((s, x) => s + e.mid(x), 0);

  // Survey cycle: five years, overdue surveys counted in this year.
  const year = Number(today.slice(0, 4));
  const cycle = Array.from({ length: 5 }, (_, i) => {
    const y = year + i;
    const due = rows.filter((r) => r.surveyDue && Number(r.surveyDue.slice(0, 4)) === y && !r.surveyOverdue).length;
    const overdue = i === 0 ? rows.filter((r) => r.surveyOverdue).length : 0;
    return { year: y, due, overdue };
  });

  return {
    today,
    areas: e.t.areas,
    stats: {
      overdue: { count: overdueStates.length, churches: new Set(overdueStates.map((s) => s.item.buildingId)).size, common: common ? { name: common[0], count: common[1] } : null },
      lapsing: { count: lapsing.reduce((s, l) => s + l.n, 0), byType: lapsing },
      openActions: { count: e.openTasks.length, a: e.openTasks.filter((x) => x.band === "A").length, b: e.openTasks.filter((x) => x.band === "B").length },
      backlog: { pence: backlog, clearedThisYearPence: doneThisYear, topTrade: topTrade && backlog ? { trade: topTrade[0], share: Math.round((topTrade[1] / backlog) * 100) } : null },
    },
    cycle,
    programmes: suggestProgrammes(e),
    rows,
    buildingCount: rows.length,
  };
}

/** Same check due within one window at several churches: instruct it once. */
function suggestProgrammes(e: Estate) {
  const horizon = addDaysTo(e.today, PROGRAMME_WINDOW_DAYS);
  const groups = new Map<string, { name: string; buildings: { id: string; name: string; nextDue: string; overdue: boolean; area: string | null }[] }>();
  for (const s of e.states) {
    const key = s.item.templateKey;
    if (!key || key.startsWith("qi:") || s.item.selfCheck || !s.state.nextDue || s.state.nextDue > horizon) continue;
    const row = e.rows.find((r) => r.id === s.item.buildingId)!;
    const g = groups.get(key) ?? { name: s.item.name, buildings: [] };
    g.buildings.push({ id: row.id, name: row.name, nextDue: s.state.nextDue, overdue: s.state.status === "overdue", area: row.area?.name ?? null });
    groups.set(key, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.buildings.length >= PROGRAMME_MIN_BUILDINGS)
    .map(([key, g]) => {
      const band = TYPICAL_COST[key];
      const areas = [...new Set(g.buildings.map((b) => b.area).filter(Boolean))];
      return {
        key,
        title: g.name.replace(/ (test|review|service|inspection)$/i, (m) => `${m}s`),
        churches: g.buildings.length,
        overdue: g.buildings.filter((b) => b.overdue).length,
        areas,
        windowEnd: horizon,
        estimateLowPence: band ? band[0] * g.buildings.length : null,
        estimateHighPence: band ? band[1] * g.buildings.length : null,
        buildings: g.buildings.sort((a, b) => a.nextDue.localeCompare(b.nextDue)),
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.churches - a.churches);
}

export async function backlog(scope: OrgScope, areaId?: string | null) {
  const e = await loadEstate(scope, areaId);
  const byBuilding = new Map(e.rows.map((r) => [r.id, r]));
  return e.openTasks
    .map((x) => ({ id: x.id, buildingId: x.buildingId, church: byBuilding.get(x.buildingId)?.name ?? "", area: byBuilding.get(x.buildingId)?.area?.name ?? null, ref: x.ref, band: x.band, text: x.text, trade: x.trade, permission: x.permission, status: x.status, estimateLowPence: x.estimateLowPence, estimateHighPence: x.estimateHighPence }))
    .sort((a, b) => a.band.localeCompare(b.band) || a.church.localeCompare(b.church));
}

export async function spend(scope: OrgScope, year: number, areaId?: string | null) {
  const e = await loadEstate(scope, areaId);
  if (e.ids.length === 0) return [];
  const rows = await scope.db
    .select({ buildingId: job.buildingId, total: sql<number>`coalesce(sum(${job.costPence}), 0)`, n: sql<number>`count(*)` })
    .from(job)
    .where(and(inArray(job.buildingId, e.ids), eq(job.status, "done"), gte(job.doneOn, `${year}-01-01`), lte(job.doneOn, `${year}-12-31`)))
    .groupBy(job.buildingId)
    .all();
  return e.rows.map((r) => ({ id: r.id, name: r.name, area: r.area?.name ?? null, totalPence: rows.find((x) => x.buildingId === r.id)?.total ?? 0, jobs: rows.find((x) => x.buildingId === r.id)?.n ?? 0 }));
}

export async function contractorsUsed(scope: OrgScope) {
  const e = await loadEstate(scope);
  if (e.ids.length === 0) return [];
  return scope.db
    .select({ name: contractor.name, trade: contractor.trade, phone: contractor.phone, email: contractor.email, jobs: sql<number>`count(${job.id})`, totalPence: sql<number>`coalesce(sum(${job.costPence}), 0)`, churches: sql<number>`count(distinct ${job.buildingId})` })
    .from(job)
    .innerJoin(contractor, eq(contractor.id, job.contractorId))
    .where(inArray(job.buildingId, e.ids))
    .groupBy(contractor.id)
    .orderBy(sql`count(${job.id}) desc`)
    .all();
}

// ---------- Programmes ----------
export async function listProgrammes(scope: OrgScope) {
  return scope.db.select().from(programme).where(eq(programme.orgId, scope.org.id)).all();
}

export async function saveProgramme(scope: OrgScope, body: Record<string, unknown>) {
  if (!scope.roles.some((r) => r === "estates" || r === "estates_admin")) throw forbidden();
  const e = await loadEstate(scope);
  const buildingIds = Array.isArray(body.buildingIds) ? body.buildingIds.map(str).filter((id) => e.ids.includes(id)) : [];
  if (buildingIds.length === 0) throw badRequest("Choose the churches in this programme.");
  const title = str(body.title).slice(0, 200);
  if (!title) throw badRequest("Give the programme a title.");
  const id = ulid();
  await scope.db.insert(programme).values({
    id,
    orgId: scope.org.id,
    type: str(body.type).slice(0, 60) || "other",
    title,
    windowStart: e.today,
    windowEnd: str(body.windowEnd) || null,
    buildingIds,
    estimateLowPence: Number.isInteger(body.estimateLowPence) ? (body.estimateLowPence as number) : null,
    estimateHighPence: Number.isInteger(body.estimateHighPence) ? (body.estimateHighPence as number) : null,
    status: "tendering",
  });
  await audit(scope.db, { orgId: scope.org.id, userId: scope.userId, entity: "programme", entityId: id, action: "created", summary: { title, churches: buildingIds.length } });
  return id;
}

export async function setProgrammeStatus(scope: OrgScope, id: string, status: string) {
  if (!["suggested", "tendering", "instructed", "done"].includes(status)) throw badRequest("Unknown status.");
  const row = await scope.db.select({ id: programme.id }).from(programme).where(and(eq(programme.id, id), eq(programme.orgId, scope.org.id))).get();
  if (!row) throw notFound();
  await scope.db.update(programme).set({ status: status as "tendering", updatedAt: nowIso() }).where(eq(programme.id, id));
}

// ---------- Estates notes (on a building, from the building scope) ----------
async function estatesOrgFor(scope: BuildingScope): Promise<string | null> {
  if (!scope.roles.some((r) => r === "estates" || r === "estates_admin")) return null;
  const rows = await scope.db.all<{ id: string }>(sql`
    WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM organisation WHERE id = ${scope.orgId}
      UNION ALL SELECT o.id, o.parent_id, up.depth + 1 FROM organisation o JOIN up ON o.id = up.parent_id WHERE up.depth < 10
    )
    SELECT up.id FROM up JOIN membership m ON m.org_id = up.id
    WHERE m.user_id = ${scope.userId} AND m.role IN ('estates', 'estates_admin') ORDER BY up.depth LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** Estates users see their diocese's notes; parish users see only notes shared with them. */
export async function listNotes(scope: BuildingScope) {
  const diocese = await estatesOrgFor(scope);
  const where = diocese
    ? and(eq(estatesNote.buildingId, scope.buildingId), eq(estatesNote.orgId, diocese))
    : and(eq(estatesNote.buildingId, scope.buildingId), eq(estatesNote.sharedWithParish, true));
  const rows = await scope.db
    .select({ id: estatesNote.id, body: estatesNote.body, sharedWithParish: estatesNote.sharedWithParish, createdAt: estatesNote.createdAt, author: user.name })
    .from(estatesNote)
    .leftJoin(user, eq(user.id, estatesNote.authorId))
    .where(where)
    .orderBy(sql`${estatesNote.createdAt} desc`)
    .all();
  return { notes: rows, canWrite: Boolean(diocese) };
}

export async function addNote(scope: BuildingScope, body: string, shared: boolean) {
  scope.require("estates.write");
  const diocese = await estatesOrgFor(scope);
  if (!diocese) throw forbidden();
  const text = body.trim().slice(0, 4000);
  if (!text) throw badRequest("Write the note.");
  const id = ulid();
  await scope.db.insert(estatesNote).values({ id, orgId: diocese, buildingId: scope.buildingId, body: text, authorId: scope.userId, sharedWithParish: shared });
  await audit(scope.db, { orgId: diocese, userId: scope.userId, entity: "estates_note", entityId: id, action: "created", summary: { buildingId: scope.buildingId, shared } });
  return id;
}

export async function setNoteShared(scope: BuildingScope, noteId: string, shared: boolean) {
  const diocese = await estatesOrgFor(scope);
  if (!diocese) throw forbidden();
  const row = await scope.db
    .select({ id: estatesNote.id })
    .from(estatesNote)
    .where(and(eq(estatesNote.id, noteId), eq(estatesNote.buildingId, scope.buildingId), eq(estatesNote.orgId, diocese)))
    .get();
  if (!row) throw notFound();
  await scope.db.update(estatesNote).set({ sharedWithParish: shared, updatedAt: nowIso() }).where(eq(estatesNote.id, noteId));
}

