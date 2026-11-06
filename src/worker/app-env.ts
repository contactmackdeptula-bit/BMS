import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SessionUser } from "./auth/session";
import type { Env } from "./env";

export type AppEnv = {
  Bindings: Env;
  Variables: { db: DrizzleD1Database; user: SessionUser | null };
};
