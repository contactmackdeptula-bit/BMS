import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditEvent } from "../db/schema";
import { ulid } from "./ids";

export type AuditInput = {
  orgId: string | null;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  summary?: Record<string, unknown>;
};

export async function audit(db: DrizzleD1Database, e: AuditInput) {
  await db.insert(auditEvent).values({ id: ulid(), ...e, summary: e.summary ?? null });
}
