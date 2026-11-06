import { and, eq, isNull } from "drizzle-orm";
import { authToken, building, membership, user, type Role } from "../db/schema";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { badRequest } from "../lib/http";
import { ulid } from "../lib/ids";
import { addDays } from "../lib/time";
import { INVITABLE_ROLES, type OrgScope } from "../tenancy";
import { buildingFields, type BuildingInput } from "./building";

const INVITE_DAYS = 7;

export async function listMembers(scope: OrgScope) {
  return scope.db
    .select({ userId: user.id, name: user.name, email: user.email, role: membership.role, buildingId: membership.buildingId, receivesReminders: membership.receivesReminders })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.orgId, scope.org.id))
    .orderBy(user.name)
    .all();
}

export async function listPendingInvites(scope: OrgScope) {
  const rows = await scope.db
    .select({ email: authToken.email, role: authToken.role, expiresAt: authToken.expiresAt })
    .from(authToken)
    .where(and(eq(authToken.orgId, scope.org.id), eq(authToken.kind, "invite"), isNull(authToken.usedAt)))
    .all();
  const now = new Date();
  return rows.filter((r) => new Date(r.expiresAt) > now);
}

/** Creates an invitation and returns the raw token for the email link. */
export async function createInvite(
  scope: OrgScope,
  input: { email: string; role: Role; buildingId?: string | null },
): Promise<string> {
  if (!INVITABLE_ROLES[scope.kind].includes(input.role)) throw badRequest("That role can't be given here.");
  let buildingId: string | null = null;
  if (input.role === "inspector") {
    if (!input.buildingId) throw badRequest("Choose which building the inspector can see.");
    const b = await scope.db
      .select({ id: building.id })
      .from(building)
      .where(and(eq(building.id, input.buildingId), eq(building.orgId, scope.org.id)))
      .get();
    if (!b) throw badRequest("That building isn't in this organisation.");
    buildingId = b.id;
  }
  const token = randomToken();
  await scope.db.insert(authToken).values({
    id: await sha256(token),
    kind: "invite",
    email: input.email,
    orgId: scope.org.id,
    role: input.role,
    buildingId,
    invitedBy: scope.userId,
    expiresAt: addDays(new Date(), INVITE_DAYS).toISOString(),
  });
  await audit(scope.db, {
    orgId: scope.org.id,
    userId: scope.userId,
    entity: "invite",
    entityId: input.email,
    action: "created",
    summary: { role: input.role, buildingId },
  });
  return token;
}

export async function createBuilding(scope: OrgScope, input: BuildingInput & { name: string }) {
  if (scope.kind !== "parish") throw badRequest("Buildings are added by the parish.");
  const id = ulid();
  await scope.db.insert(building).values({ id, orgId: scope.org.id, ...input });
  await audit(scope.db, { orgId: scope.org.id, userId: scope.userId, entity: "building", entityId: id, action: "created", summary: { name: input.name } });
  return id;
}

export { buildingFields };
