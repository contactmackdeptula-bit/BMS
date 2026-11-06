// Compliance calendar data (SPEC.md §5, UI-HANDOFF §8).
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  addMonths,
  frequencyLabel,
  itemState,
  statusLabel,
  todayIn,
  type Anchor,
  type AnchorDates,
  type ComplianceStatus,
} from "../../shared/compliance";
import { DEFAULT_CHECKLIST, type Template } from "../compliance-defaults";
import { complianceItem, complianceOccurrence, document, organisation, user, type ChecklistResult } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound, str } from "../lib/http";
import { ulid } from "../lib/ids";
import { nowIso } from "../lib/time";
import type { BuildingScope } from "../tenancy";

type ItemRow = typeof complianceItem.$inferSelect;
type OccRow = typeof complianceOccurrence.$inferSelect;

const ANCHORS: Anchor[] = ["none", "apcm", "insurance_renewal"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function templateRow(scope: BuildingScope, t: Template) {
  return {
    id: ulid(),
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    templateKey: t.key,
    name: t.name,
    frequencyMonths: t.frequencyMonths,
    anchor: t.anchor,
    doneBy: t.doneBy,
    note: t.note,
    selfCheck: Boolean(t.selfCheck),
    fittingKind: t.fittingKind ?? null,
  };
}

/** Seeds the default checklist the first time a building's calendar is used. */
export async function ensureSeeded(scope: BuildingScope) {
  const existing = await scope.db
    .select({ id: complianceItem.id })
    .from(complianceItem)
    .where(eq(complianceItem.buildingId, scope.buildingId))
    .limit(1)
    .all();
  if (existing.length) return;
  const b = scope.building;
  const rows = DEFAULT_CHECKLIST.filter((t) => !t.when || b[t.when]).map((t) => templateRow(scope, t));
  // D1 limits bound parameters per statement, so insert in small batches.
  for (let i = 0; i < rows.length; i += 4) await scope.db.insert(complianceItem).values(rows.slice(i, i + 4));
}

/** Adds the lift or legionella item when the profile gains one (never removes: history matters). */
export async function syncOptionalItems(scope: BuildingScope) {
  const keys = (
    await scope.db
      .select({ key: complianceItem.templateKey })
      .from(complianceItem)
      .where(eq(complianceItem.buildingId, scope.buildingId))
      .all()
  ).map((r) => r.key);
  if (keys.length === 0) return; // not seeded yet; ensureSeeded will include them
  for (const t of DEFAULT_CHECKLIST) {
    if (t.when && scope.building[t.when] && !keys.includes(t.key)) {
      await scope.db.insert(complianceItem).values(templateRow(scope, t));
    }
  }
}

async function context(scope: BuildingScope) {
  const org = await scope.db
    .select({ apcmDate: organisation.apcmDate, timezone: organisation.timezone })
    .from(organisation)
    .where(eq(organisation.id, scope.orgId))
    .get();
  const anchors: AnchorDates = { apcm: org?.apcmDate ?? null, insuranceRenewal: scope.building.insuranceRenewsOn };
  return { anchors, today: todayIn(org?.timezone ?? "Europe/London") };
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type ItemView = ReturnType<typeof viewOf>;

function viewOf(
  item: ItemRow,
  occs: OccRow[],
  docs: Map<string, { id: string; title: string; type: string; documentDate: string | null }>,
  ctx: { anchors: AnchorDates; today: string },
) {
  const state = itemState(item, occs, ctx.anchors, ctx.today);
  const latest = occs
    .filter((o) => o.status === "complete")
    .sort((a, b) => (a.doneOn < b.doneOn ? 1 : -1))[0];
  const doc = latest?.documentId ? docs.get(latest.documentId) ?? null : null;
  const partial = occs.find((o) => o.status === "partial" && (!latest || o.doneOn > latest.doneOn)) ?? null;
  return {
    id: item.id,
    templateKey: item.templateKey,
    name: item.name,
    frequencyMonths: item.frequencyMonths,
    anchor: item.anchor,
    frequencyLabel: frequencyLabel(item.frequencyMonths, item.anchor),
    doneBy: item.doneBy,
    note: item.note,
    selfCheck: item.selfCheck,
    fittingKind: item.fittingKind,
    nextDueOverride: item.nextDueOverride,
    ...state,
    statusLabel: statusLabel(state),
    evidence: doc
      ? { kind: "document" as const, document: doc }
      : latest && item.selfCheck
        ? { kind: "person" as const, name: latest.doneByText }
        : null,
    partial: partial ? { doneOn: partial.doneOn, checklist: partial.checklist } : null,
  };
}

async function loadViews(scope: BuildingScope, items: ItemRow[]) {
  const ctx = await context(scope);
  const ids = items.map((i) => i.id);
  const occs = ids.length
    ? await scope.db.select().from(complianceOccurrence).where(inArray(complianceOccurrence.complianceItemId, ids)).all()
    : [];
  const docIds = [...new Set(occs.map((o) => o.documentId).filter((d): d is string => Boolean(d)))];
  const docRows = docIds.length
    ? await scope.db
        .select({ id: document.id, title: document.title, type: document.type, documentDate: document.documentDate })
        .from(document)
        .where(and(eq(document.buildingId, scope.buildingId), inArray(document.id, docIds)))
        .all()
    : [];
  const docs = new Map(docRows.map((d) => [d.id, d]));
  const byItem = new Map<string, OccRow[]>();
  for (const o of occs) byItem.set(o.complianceItemId, [...(byItem.get(o.complianceItemId) ?? []), o]);
  return { ctx, views: items.map((i) => viewOf(i, byItem.get(i.id) ?? [], docs, ctx)) };
}

const STATUS_ORDER: Record<ComplianceStatus, number> = { overdue: 0, due_soon: 1, not_recorded: 2, on_track: 3 };

export async function listCalendar(scope: BuildingScope) {
  await ensureSeeded(scope);
  const items = await scope.db
    .select()
    .from(complianceItem)
    .where(and(eq(complianceItem.buildingId, scope.buildingId), eq(complianceItem.active, true)))
    .all();
  const { ctx, views } = await loadViews(scope, items);
  views.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") ||
      a.name.localeCompare(b.name),
  );

  // Twelve months from this one; overdue items count in the current month.
  const start = `${ctx.today.slice(0, 7)}-01`;
  const months = Array.from({ length: 12 }, (_, i) => {
    const first = addMonths(start, i);
    const key = first.slice(0, 7);
    const m = Number(key.slice(5, 7)) - 1;
    const inMonth = views.filter((v) => v.nextDue && (v.nextDue.slice(0, 7) === key || (i === 0 && v.status === "overdue")));
    const tone = inMonth.some((v) => v.status === "overdue")
      ? "danger"
      : inMonth.some((v) => v.status === "due_soon")
        ? "warn"
        : inMonth.length
          ? "ok"
          : "neutral";
    return { key, label: MONTH_SHORT[m]!, fullLabel: `${MONTH_LONG[m]} ${key.slice(0, 4)}`, count: inMonth.length, tone };
  });

  const counts = {
    all: views.length,
    overdue: views.filter((v) => v.status === "overdue").length,
    due_soon: views.filter((v) => v.status === "due_soon").length,
    on_track: views.filter((v) => v.status === "on_track").length,
    not_recorded: views.filter((v) => v.status === "not_recorded").length,
    missing_evidence: views.filter((v) => v.missingEvidence).length,
  };
  return { today: ctx.today, items: views, months, counts, anchors: ctx.anchors };
}

async function itemRow(scope: BuildingScope, itemId: string) {
  const row = await scope.db
    .select()
    .from(complianceItem)
    .where(and(eq(complianceItem.id, itemId), eq(complianceItem.buildingId, scope.buildingId)))
    .get();
  if (!row) throw notFound();
  return row;
}

export async function getItem(scope: BuildingScope, itemId: string) {
  const row = await itemRow(scope, itemId);
  const { views } = await loadViews(scope, [row]);
  const history = await scope.db
    .select({
      id: complianceOccurrence.id,
      doneOn: complianceOccurrence.doneOn,
      doneByText: complianceOccurrence.doneByText,
      status: complianceOccurrence.status,
      notes: complianceOccurrence.notes,
      checklist: complianceOccurrence.checklist,
      documentId: complianceOccurrence.documentId,
      documentTitle: document.title,
      recordedBy: user.name,
    })
    .from(complianceOccurrence)
    .leftJoin(document, eq(document.id, complianceOccurrence.documentId))
    .leftJoin(user, eq(user.id, complianceOccurrence.doneByUserId))
    .where(eq(complianceOccurrence.complianceItemId, row.id))
    .orderBy(desc(complianceOccurrence.doneOn), desc(complianceOccurrence.createdAt))
    .all();
  return { item: views[0]!, history, fittings: scope.building.fittings.filter((f) => f.kind === row.fittingKind) };
}

type ItemInput = Partial<{ name: string; frequencyMonths: number; anchor: Anchor; doneBy: string | null; note: string | null; nextDueOverride: string | null }>;

export function itemFields(body: Record<string, unknown>): ItemInput {
  const out: ItemInput = {};
  if ("name" in body) {
    const name = str(body.name);
    if (!name || name.length > 200) throw badRequest("Give the item a name.");
    out.name = name;
  }
  if ("frequencyMonths" in body) {
    const f = Number(body.frequencyMonths);
    if (!Number.isInteger(f) || f < 1 || f > 120) throw badRequest("Frequency must be between 1 and 120 months.");
    out.frequencyMonths = f;
  }
  if ("anchor" in body) {
    if (!ANCHORS.includes(body.anchor as Anchor)) throw badRequest("Unknown anchor.");
    out.anchor = body.anchor as Anchor;
  }
  for (const k of ["doneBy", "note"] as const) if (k in body) out[k] = str(body[k]).slice(0, 500) || null;
  if ("nextDueOverride" in body) {
    if (body.nextDueOverride !== null && body.nextDueOverride !== "" && !isDate(body.nextDueOverride)) throw badRequest("Use a valid date.");
    out.nextDueOverride = (body.nextDueOverride as string) || null;
  }
  return out;
}

export async function createItem(scope: BuildingScope, input: ItemInput & { name: string; frequencyMonths: number }) {
  scope.require("records.write");
  await ensureSeeded(scope);
  const id = ulid();
  await scope.db.insert(complianceItem).values({
    id,
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    name: input.name,
    frequencyMonths: input.frequencyMonths,
    anchor: input.anchor ?? "none",
    doneBy: input.doneBy ?? null,
    note: input.note ?? null,
    nextDueOverride: input.nextDueOverride ?? null,
  });
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "compliance_item", entityId: id, action: "created", summary: { name: input.name } });
  return id;
}

export async function updateItem(scope: BuildingScope, itemId: string, input: ItemInput) {
  scope.require("records.write");
  const before = await itemRow(scope, itemId);
  if (Object.keys(input).length === 0) return;
  await scope.db.update(complianceItem).set({ ...input, updatedAt: nowIso() }).where(eq(complianceItem.id, before.id));
  // Frequency changes are logged with who made them (UI-HANDOFF §8).
  const summary: Record<string, unknown> = { fields: Object.keys(input) };
  if (input.frequencyMonths != null && input.frequencyMonths !== before.frequencyMonths) {
    summary.frequency = { from: before.frequencyMonths, to: input.frequencyMonths };
  }
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "compliance_item", entityId: before.id, action: "updated", summary });
}

export async function removeItem(scope: BuildingScope, itemId: string) {
  scope.require("records.write");
  const row = await itemRow(scope, itemId);
  // Kept, not deleted, so its history stays with the building.
  await scope.db.update(complianceItem).set({ active: false, updatedAt: nowIso() }).where(eq(complianceItem.id, row.id));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "compliance_item", entityId: row.id, action: "removed", summary: { name: row.name } });
}

export async function recordOccurrence(
  scope: BuildingScope,
  itemId: string,
  body: Record<string, unknown>,
  today?: string,
) {
  scope.require("records.write");
  const item = await itemRow(scope, itemId);
  const doneOn = body.doneOn;
  if (!isDate(doneOn)) throw badRequest("Enter the date it was done.");
  const todayStr = today ?? (await context(scope)).today;
  if (doneOn > todayStr) throw badRequest("The date can't be in the future.");
  const documentId = str(body.documentId) || null;
  if (documentId) {
    const d = await scope.db
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.id, documentId), eq(document.buildingId, scope.buildingId)))
      .get();
    if (!d) throw badRequest("That document isn't on this building.");
  }
  let checklist: ChecklistResult[] | null = null;
  if (Array.isArray(body.checklist)) {
    const fittingIds = new Set(scope.building.fittings.map((f) => f.id));
    checklist = body.checklist
      .filter((r: Record<string, unknown>) => fittingIds.has(str(r?.fittingId)))
      .map((r: Record<string, unknown>) => ({ fittingId: str(r.fittingId), ok: Boolean(r.ok), ...(str(r.note) ? { note: str(r.note) } : {}) }));
  }
  const expected = scope.building.fittings.filter((f) => f.kind === item.fittingKind).length;
  const partial = checklist != null && expected > 0 && checklist.filter((r) => r.ok).length < expected;
  const id = ulid();
  await scope.db.insert(complianceOccurrence).values({
    id,
    orgId: scope.orgId,
    complianceItemId: item.id,
    doneOn,
    doneByUserId: scope.userId,
    doneByText: str(body.doneByText).slice(0, 200) || null,
    documentId,
    checklist,
    notes: str(body.notes).slice(0, 2000) || null,
    status: partial ? "partial" : "complete",
  });
  // A completed record moves the date on, so any manual next-due date is cleared.
  if (!partial && item.nextDueOverride) {
    await scope.db.update(complianceItem).set({ nextDueOverride: null, updatedAt: nowIso() }).where(eq(complianceItem.id, item.id));
  }
  await audit(scope.db, {
    orgId: scope.orgId,
    userId: scope.userId,
    entity: "compliance_occurrence",
    entityId: id,
    action: "recorded",
    summary: { item: item.name, doneOn, partial, documentId },
  });
  return { id, partial };
}

/** Links a certificate to a record that was saved without one. */
export async function attachEvidence(scope: BuildingScope, occurrenceId: string, documentId: string) {
  scope.require("records.write");
  const occ = await scope.db
    .select({ id: complianceOccurrence.id, itemId: complianceOccurrence.complianceItemId })
    .from(complianceOccurrence)
    .innerJoin(complianceItem, eq(complianceItem.id, complianceOccurrence.complianceItemId))
    .where(and(eq(complianceOccurrence.id, occurrenceId), eq(complianceItem.buildingId, scope.buildingId)))
    .get();
  if (!occ) throw notFound();
  const d = await scope.db
    .select({ id: document.id })
    .from(document)
    .where(and(eq(document.id, documentId), eq(document.buildingId, scope.buildingId)))
    .get();
  if (!d) throw badRequest("That document isn't on this building.");
  await scope.db.update(complianceOccurrence).set({ documentId, updatedAt: nowIso() }).where(eq(complianceOccurrence.id, occ.id));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "compliance_occurrence", entityId: occ.id, action: "evidence_attached", summary: { documentId } });
}
