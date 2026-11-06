import { eq } from "drizzle-orm";
import { building, type Fitting, type KeyContact } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, str } from "../lib/http";
import { nowIso } from "../lib/time";
import type { BuildingScope } from "../tenancy";
import { syncOptionalItems } from "./compliance";

const KINDS = ["church", "hall", "house", "other"] as const;
const LISTINGS = ["grade_i", "grade_ii_star", "grade_ii", "unlisted", "locally_listed"] as const;
const TEXT_FIELDS = ["name", "diocese", "address", "postcode", "inspectorName", "insurer", "architect"] as const;
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export type BuildingInput = Partial<{
  name: string;
  kind: (typeof KINDS)[number];
  listing: (typeof LISTINGS)[number] | null;
  diocese: string | null;
  address: string | null;
  postcode: string | null;
  inspectorName: string | null;
  insurer: string | null;
  insuranceRenewsOn: string | null;
  architect: string | null;
  hasLift: boolean;
  hasWaterSystems: boolean;
  keyContacts: KeyContact[];
  fittings: Fitting[];
}>;

/** Validates a building profile body, keeping only known fields. */
export function buildingFields(body: Record<string, unknown>): BuildingInput {
  const out: BuildingInput = {};
  for (const f of TEXT_FIELDS) {
    if (f in body) {
      const v = str(body[f]);
      if (v.length > 300) throw badRequest(`${f} is too long.`);
      if (f === "name") {
        if (!v) throw badRequest("The building needs a name.");
        out.name = v;
      } else out[f] = v || null;
    }
  }
  if ("kind" in body) {
    if (!KINDS.includes(body.kind as never)) throw badRequest("Unknown building kind.");
    out.kind = body.kind as BuildingInput["kind"];
  }
  if ("listing" in body) {
    if (body.listing !== null && !LISTINGS.includes(body.listing as never)) throw badRequest("Unknown listing.");
    out.listing = body.listing as BuildingInput["listing"];
  }
  if ("insuranceRenewsOn" in body) {
    if (body.insuranceRenewsOn && !isDate(body.insuranceRenewsOn)) throw badRequest("Use a valid renewal date.");
    out.insuranceRenewsOn = (body.insuranceRenewsOn as string) || null;
  }
  for (const f of ["hasLift", "hasWaterSystems"] as const) {
    if (f in body) out[f] = Boolean(body[f]);
  }
  if ("keyContacts" in body) {
    if (!Array.isArray(body.keyContacts)) throw badRequest("keyContacts must be a list.");
    out.keyContacts = body.keyContacts.slice(0, 50).map((k: Record<string, unknown>) => ({
      name: str(k?.name),
      role: str(k?.role),
      ...(str(k?.phone) ? { phone: str(k.phone) } : {}),
      ...(str(k?.email) ? { email: str(k.email) } : {}),
    }));
  }
  if ("fittings" in body) {
    if (!Array.isArray(body.fittings)) throw badRequest("fittings must be a list.");
    out.fittings = body.fittings
      .slice(0, 200)
      .map((f: Record<string, unknown>) => ({
        id: str(f?.id) || crypto.randomUUID(),
        kind: str(f?.kind) || "emergency_light",
        location: str(f?.location).slice(0, 120),
      }))
      .filter((f) => f.location);
  }
  return out;
}

export function getProfile(scope: BuildingScope) {
  return scope.building;
}

export async function updateProfile(scope: BuildingScope, input: BuildingInput) {
  scope.require("building.edit");
  const changed = Object.keys(input);
  if (changed.length === 0) return scope.building;
  await scope.db
    .update(building)
    .set({ ...input, updatedAt: nowIso() })
    .where(eq(building.id, scope.buildingId));
  await audit(scope.db, {
    orgId: scope.orgId,
    userId: scope.userId,
    entity: "building",
    entityId: scope.buildingId,
    action: "updated",
    summary: { fields: changed },
  });
  const updated = (await scope.db.select().from(building).where(eq(building.id, scope.buildingId)).get())!;
  if ("hasLift" in input || "hasWaterSystems" in input) await syncOptionalItems(scope.withBuilding(updated));
  return updated;
}
