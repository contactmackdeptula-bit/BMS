import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { session, user } from "../db/schema";
import { randomToken, sha256 } from "../lib/crypto";
import { addDays } from "../lib/time";

export const SESSION_COOKIE = "fabric_session";
const SESSION_DAYS = 30;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000; // refresh expiry at most once a day

export type SessionUser = { id: string; email: string; name: string };

const cookieOptions = (c: Context) => ({
  httpOnly: true,
  secure: new URL(c.req.url).protocol === "https:",
  sameSite: "Lax" as const,
  path: "/",
});

export async function startSession(c: Context, db: DrizzleD1Database, userId: string) {
  const token = randomToken();
  const now = new Date();
  const expires = addDays(now, SESSION_DAYS);
  await db.insert(session).values({
    id: await sha256(token),
    userId,
    expiresAt: expires.toISOString(),
    lastSeenAt: now.toISOString(),
  });
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), expires });
}

export async function endSession(c: Context, db: DrizzleD1Database) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(session).where(eq(session.id, await sha256(token)));
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c));
}

export async function endAllSessions(db: DrizzleD1Database, userId: string) {
  await db.delete(session).where(eq(session.userId, userId));
}

/** Returns the signed-in user, or null. Slides the session expiry forward. */
export async function readSession(c: Context, db: DrizzleD1Database): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256(token);
  const row = await db
    .select({ s: session, u: { id: user.id, email: user.email, name: user.name } })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(eq(session.id, id))
    .get();
  if (!row) return null;
  const now = new Date();
  if (new Date(row.s.expiresAt) <= now) {
    await db.delete(session).where(eq(session.id, id));
    return null;
  }
  if (now.getTime() - new Date(row.s.lastSeenAt).getTime() > SLIDE_AFTER_MS) {
    const expires = addDays(now, SESSION_DAYS);
    await db
      .update(session)
      .set({ lastSeenAt: now.toISOString(), expiresAt: expires.toISOString() })
      .where(eq(session.id, id));
    setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), expires });
  }
  return row.u;
}
