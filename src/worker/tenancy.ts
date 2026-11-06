// Tenancy and permissions (SPEC.md §3 and §4).
//
// Route handlers never query church data tables directly. They ask this module
// for a scope (`buildingScope`, `orgScope`, `listBuildings`), which resolves what
// the signed-in user may see from their memberships and throws 404 for anything
// else, so ids from other churches never leak. `scripts/check-tenancy.mjs`
// fails the build if a route file imports the schema directly.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { building, membership, organisation, type Role } from "./db/schema";
import { forbidden, notFound } from "./lib/http";

export type Action =
  | "building.read"
  | "building.edit" // building profile
  | "records.write" // log jobs, upload documents, record checks
  | "org.manageUsers"
  | "org.createBuilding"
  | "estates.write"; // estates notes and programmes

const PARISH_ROLES: Role[] = ["pcc_admin", "churchwarden", "treasurer", "member"];
const ESTATES_ROLES: Role[] = ["estates_admin", "estates"];

const GRANTS: Record<Role, Action[]> = {
  pcc_admin: ["building.read", "building.edit", "records.write", "org.manageUsers", "org.createBuilding"],
  churchwarden: ["building.read", "building.edit", "records.write"],
  treasurer: ["building.read", "records.write"],
  member: ["building.read", "records.write"],
  inspector: ["building.read"],
  estates_admin: ["building.read", "estates.write", "org.manageUsers", "org.createBuilding"],
  estates: ["building.read", "estates.write"],
};

/** Which roles a user may grant when inviting someone into an organisation. */
export const INVITABLE_ROLES: Record<"parish" | "estates", Role[]> = {
  parish: [...PARISH_ROLES, "inspector"],
  estates: ESTATES_ROLES,
};

export const roleCan = (roles: Role[], action: Action) => roles.some((r) => GRANTS[r].includes(action));

type Membership = { orgId: string; role: Role; buildingId: string | null };

async function membershipsOf(db: DrizzleD1Database, userId: string): Promise<Membership[]> {
  return db
    .select({ orgId: membership.orgId, role: membership.role, buildingId: membership.buildingId })
    .from(membership)
    .where(eq(membership.userId, userId))
    .all();
}

/** The organisation and all its ancestors, nearest first. */
async function ancestorIds(db: DrizzleD1Database, orgId: string): Promise<string[]> {
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM organisation WHERE id = ${orgId}
      UNION ALL
      SELECT o.id, o.parent_id, up.depth + 1 FROM organisation o JOIN up ON o.id = up.parent_id
      WHERE up.depth < 10
    ) SELECT id FROM up ORDER BY depth`);
  return rows.map((r) => r.id);
}

/** The organisation and all its descendants. */
async function descendantIds(db: DrizzleD1Database, orgIds: string[]): Promise<string[]> {
  if (orgIds.length === 0) return [];
  const seeds = sql.join(orgIds.map((id) => sql`${id}`), sql`, `);
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE down(id, depth) AS (
      SELECT id, 0 FROM organisation WHERE id IN (${seeds})
      UNION
      SELECT o.id, down.depth + 1 FROM organisation o JOIN down ON o.parent_id = down.id
      WHERE down.depth < 10
    ) SELECT DISTINCT id FROM down`);
  return rows.map((r) => r.id);
}

/** Roles the user holds that apply to one building, through its org or an ancestor org. */
function rolesForBuilding(ms: Membership[], b: { id: string; orgId: string }, ancestors: string[]): Role[] {
  const roles = new Set<Role>();
  for (const m of ms) {
    if (m.orgId === b.orgId && PARISH_ROLES.includes(m.role)) roles.add(m.role);
    if (m.role === "inspector" && m.buildingId === b.id) roles.add(m.role);
    if (ESTATES_ROLES.includes(m.role) && ancestors.includes(m.orgId)) roles.add(m.role);
  }
  return [...roles];
}

export type BuildingRow = typeof building.$inferSelect;

export class BuildingScope {
  constructor(
    readonly db: DrizzleD1Database,
    readonly userId: string,
    readonly building: BuildingRow,
    readonly roles: Role[],
  ) {}
  get buildingId() {
    return this.building.id;
  }
  get orgId() {
    return this.building.orgId;
  }
  can(action: Action) {
    return roleCan(this.roles, action);
  }
  require(action: Action) {
    if (!this.can(action)) throw forbidden();
    return this;
  }
  /** Shell to show: estates users reach parish buildings through the estates console. */
  get viaEstates() {
    return !this.roles.some((r) => PARISH_ROLES.includes(r) || r === "inspector");
  }
}

export async function buildingScope(
  db: DrizzleD1Database,
  userId: string,
  buildingId: string,
): Promise<BuildingScope> {
  const b = await db.select().from(building).where(eq(building.id, buildingId)).get();
  if (!b) throw notFound();
  const [ms, ancestors] = await Promise.all([membershipsOf(db, userId), ancestorIds(db, b.orgId)]);
  const roles = rolesForBuilding(ms, b, ancestors);
  if (roles.length === 0) throw notFound();
  return new BuildingScope(db, userId, b, roles);
}

export type AccessibleBuilding = Pick<BuildingRow, "id" | "orgId" | "name" | "kind"> & {
  roles: Role[];
  viaEstates: boolean;
};

export async function listBuildings(db: DrizzleD1Database, userId: string): Promise<AccessibleBuilding[]> {
  const ms = await membershipsOf(db, userId);
  const parishOrgs = ms.filter((m) => PARISH_ROLES.includes(m.role)).map((m) => m.orgId);
  const inspectorBuildings = ms.filter((m) => m.role === "inspector" && m.buildingId).map((m) => m.buildingId!);
  const estatesOrgs = await descendantIds(
    db,
    ms.filter((m) => ESTATES_ROLES.includes(m.role)).map((m) => m.orgId),
  );
  const orgIds = [...new Set([...parishOrgs, ...estatesOrgs])];
  const conds = [];
  if (orgIds.length) conds.push(inArray(building.orgId, orgIds));
  if (inspectorBuildings.length) conds.push(inArray(building.id, inspectorBuildings));
  if (conds.length === 0) return [];
  const rows = await db
    .select({ id: building.id, orgId: building.orgId, name: building.name, kind: building.kind })
    .from(building)
    .where(conds.length === 1 ? conds[0] : sql`(${conds[0]}) OR (${conds[1]})`)
    .orderBy(building.name)
    .all();
  const out: AccessibleBuilding[] = [];
  for (const b of rows) {
    const roles = rolesForBuilding(ms, b, await ancestorIds(db, b.orgId));
    if (roles.length === 0) continue;
    out.push({ ...b, roles, viaEstates: !roles.some((r) => PARISH_ROLES.includes(r) || r === "inspector") });
  }
  return out;
}

export type OrgScope = {
  db: DrizzleD1Database;
  userId: string;
  org: typeof organisation.$inferSelect;
  roles: Role[];
  kind: "parish" | "estates";
};

/** Org-level scope from a direct membership of that organisation. */
export async function orgScope(
  db: DrizzleD1Database,
  userId: string,
  orgId: string,
  action: Action,
): Promise<OrgScope> {
  const org = await db.select().from(organisation).where(eq(organisation.id, orgId)).get();
  if (!org) throw notFound();
  const roles = (
    await db
      .select({ role: membership.role })
      .from(membership)
      .where(and(eq(membership.userId, userId), eq(membership.orgId, orgId)))
      .all()
  ).map((r) => r.role);
  if (roles.length === 0) throw notFound();
  if (!roleCan(roles, action)) throw forbidden();
  const kind = roles.some((r) => ESTATES_ROLES.includes(r)) ? "estates" : "parish";
  return { db, userId, org, roles, kind };
}

/** Organisations the user is a direct member of, for the /me payload. */
export async function myOrganisations(db: DrizzleD1Database, userId: string) {
  return db
    .select({
      id: organisation.id,
      name: organisation.name,
      type: organisation.type,
      apcmDate: organisation.apcmDate,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(organisation, eq(organisation.id, membership.orgId))
    .where(eq(membership.userId, userId))
    .all();
}
