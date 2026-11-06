// Email + password auth (SPEC.md §3.6). Accounts are created only from invitations.
import { Hono } from "hono";
import { and, eq, gte, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { authToken, loginAttempt, membership, organisation, user } from "../db/schema";
import { audit } from "../lib/audit";
import { DUMMY_HASH, hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto";
import { sendEmail } from "../lib/email";
import { badRequest, normaliseEmail, readJson, str, unauthorised } from "../lib/http";
import { ulid } from "../lib/ids";
import { passwordProblem } from "../lib/password-policy";
import { addMinutes, nowIso } from "../lib/time";
import { endAllSessions, endSession, startSession } from "../auth/session";
import { listBuildings, myOrganisations } from "../tenancy";
import type { AppEnv } from "../app-env";

const LOCKOUT_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;
const RESET_MINUTES = 60;

export const authRoutes = new Hono<AppEnv>();

async function recentFailures(db: DrizzleD1Database, email: string) {
  const since = addMinutes(new Date(), -LOCKOUT_MINUTES).toISOString();
  const rows = await db
    .select({ id: loginAttempt.id })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.email, email), eq(loginAttempt.ok, false), gte(loginAttempt.attemptedAt, since)))
    .all();
  return rows.length;
}

/** Looks up an unused, unexpired emailed token. */
async function findToken(db: DrizzleD1Database, raw: string, kind: "invite" | "password_reset") {
  if (!raw) return null;
  const row = await db
    .select()
    .from(authToken)
    .where(and(eq(authToken.id, await sha256(raw)), eq(authToken.kind, kind), isNull(authToken.usedAt)))
    .get();
  if (!row || new Date(row.expiresAt) <= new Date()) return null;
  return row;
}

authRoutes.post("/login", async (c) => {
  const db = c.get("db");
  const body = await readJson(c.req.raw);
  const email = normaliseEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) throw badRequest("Enter your email and password.");

  if ((await recentFailures(db, email)) >= LOCKOUT_ATTEMPTS) {
    return c.json(
      { error: `Too many attempts. Wait ${LOCKOUT_MINUTES} minutes, or reset your password.` },
      429,
    );
  }
  const u = await db.select().from(user).where(eq(user.email, email)).get();
  const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
  await db.insert(loginAttempt).values({ email, attemptedAt: nowIso(), ok: Boolean(u && ok) });
  if (!u || !u.passwordHash || !ok) {
    return c.json({ error: "That email and password don't match." }, 401);
  }
  await startSession(c, db, u.id);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await endSession(c, c.get("db"));
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const u = c.get("user");
  if (!u) throw unauthorised();
  const db = c.get("db");
  const [organisations, buildings] = await Promise.all([myOrganisations(db, u.id), listBuildings(db, u.id)]);
  return c.json({
    user: u,
    organisations,
    buildings,
    product: { name: c.env.PRODUCT_NAME, tagline: c.env.PRODUCT_TAGLINE },
  });
});

authRoutes.post("/password/change", async (c) => {
  const u = c.get("user");
  if (!u) throw unauthorised();
  const db = c.get("db");
  const body = await readJson(c.req.raw);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const row = await db.select().from(user).where(eq(user.id, u.id)).get();
  if (!row?.passwordHash || !(await verifyPassword(current, row.passwordHash))) {
    throw badRequest("Your current password isn't right.");
  }
  const problem = passwordProblem(next, row.email);
  if (problem) throw badRequest(problem);
  await db
    .update(user)
    .set({ passwordHash: await hashPassword(next), passwordChangedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(user.id, u.id));
  await endAllSessions(db, u.id);
  await startSession(c, db, u.id);
  await audit(db, { orgId: null, userId: u.id, entity: "user", entityId: u.id, action: "password_changed" });
  return c.json({ ok: true });
});

authRoutes.post("/password/reset-request", async (c) => {
  const db = c.get("db");
  const email = normaliseEmail((await readJson(c.req.raw)).email);
  const u = email ? await db.select().from(user).where(eq(user.email, email)).get() : undefined;
  if (u?.passwordHash) {
    const token = randomToken();
    await db.insert(authToken).values({
      id: await sha256(token),
      kind: "password_reset",
      email,
      userId: u.id,
      expiresAt: addMinutes(new Date(), RESET_MINUTES).toISOString(),
    });
    await sendEmail(c.env, {
      to: email,
      subject: `Reset your ${c.env.PRODUCT_NAME} password`,
      text: `Someone asked to reset the password for this email address.\n\nTo choose a new password, open this link within the next hour:\n${c.env.APP_URL}/reset-password?token=${token}\n\nIf it wasn't you, ignore this email and your password stays the same.`,
    });
  }
  // Same answer whether or not the account exists.
  return c.json({ ok: true });
});

authRoutes.post("/password/reset", async (c) => {
  const db = c.get("db");
  const body = await readJson(c.req.raw);
  const t = await findToken(db, str(body.token), "password_reset");
  if (!t?.userId) throw badRequest("This link has expired or been used. Ask for a new one.");
  const password = typeof body.password === "string" ? body.password : "";
  const problem = passwordProblem(password, t.email);
  if (problem) throw badRequest(problem);
  await db.update(authToken).set({ usedAt: nowIso() }).where(eq(authToken.id, t.id));
  await db
    .update(user)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(user.id, t.userId));
  await endAllSessions(db, t.userId);
  await startSession(c, db, t.userId);
  await audit(db, { orgId: null, userId: t.userId, entity: "user", entityId: t.userId, action: "password_reset" });
  return c.json({ ok: true });
});

authRoutes.get("/invite", async (c) => {
  const db = c.get("db");
  const t = await findToken(db, str(c.req.query("token")), "invite");
  if (!t?.orgId) throw badRequest("This invitation has expired or been used. Ask for a new one.");
  const org = await db.select({ name: organisation.name }).from(organisation).where(eq(organisation.id, t.orgId)).get();
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, t.email)).get();
  return c.json({ email: t.email, organisation: org?.name ?? "", role: t.role, hasAccount: Boolean(existing) });
});

authRoutes.post("/invite/accept", async (c) => {
  const db = c.get("db");
  const body = await readJson(c.req.raw);
  const t = await findToken(db, str(body.token), "invite");
  if (!t?.orgId || !t.role) throw badRequest("This invitation has expired or been used. Ask for a new one.");

  let u = await db.select().from(user).where(eq(user.email, t.email)).get();
  if (u?.passwordHash) {
    // Existing account: they confirm with their current password.
    const password = typeof body.password === "string" ? body.password : "";
    if (!(await verifyPassword(password, u.passwordHash))) throw badRequest("That password isn't right.");
  } else {
    const name = str(body.name);
    if (!name) throw badRequest("Enter your name.");
    const password = typeof body.password === "string" ? body.password : "";
    const problem = passwordProblem(password, t.email);
    if (problem) throw badRequest(problem);
    const passwordHash = await hashPassword(password);
    if (u) {
      await db.update(user).set({ name, passwordHash, passwordChangedAt: nowIso() }).where(eq(user.id, u.id));
    } else {
      const id = ulid();
      await db.insert(user).values({ id, email: t.email, name, passwordHash, passwordChangedAt: nowIso() });
    }
    u = (await db.select().from(user).where(eq(user.email, t.email)).get())!;
  }

  await db.update(authToken).set({ usedAt: nowIso() }).where(eq(authToken.id, t.id));
  await db
    .insert(membership)
    .values({ id: ulid(), userId: u.id, orgId: t.orgId, role: t.role, buildingId: t.buildingId })
    .onConflictDoNothing();
  await audit(db, {
    orgId: t.orgId,
    userId: u.id,
    entity: "membership",
    entityId: u.id,
    action: "invite_accepted",
    summary: { role: t.role, invitedBy: t.invitedBy },
  });
  await startSession(c, db, u.id);
  return c.json({ ok: true });
});
