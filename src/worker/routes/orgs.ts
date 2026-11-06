import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { ROLES, type Role } from "../db/schema";
import { sendEmail } from "../lib/email";
import { badRequest, looksLikeEmail, normaliseEmail, readJson, str, unauthorised } from "../lib/http";
import { buildingFields, createBuilding, createInvite, listMembers, listPendingInvites, setReminderRecipient, updateOrgSettings } from "../repo/org";
import { orgScope } from "../tenancy";

export const orgRoutes = new Hono<AppEnv>();

orgRoutes.use("*", async (c, next) => {
  if (!c.get("user")) throw unauthorised();
  await next();
});

orgRoutes.get("/:orgId/members", async (c) => {
  const scope = await orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId"), "org.manageUsers");
  const [members, invites] = await Promise.all([listMembers(scope), listPendingInvites(scope)]);
  return c.json({ members, invites });
});

orgRoutes.post("/:orgId/invitations", async (c) => {
  const scope = await orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId"), "org.manageUsers");
  const body = await readJson(c.req.raw);
  const email = normaliseEmail(body.email);
  if (!looksLikeEmail(email)) throw badRequest("Enter a valid email address.");
  if (!ROLES.includes(body.role as Role)) throw badRequest("Choose a role.");
  const token = await createInvite(scope, {
    email,
    role: body.role as Role,
    buildingId: str(body.buildingId) || null,
  });
  const inviter = c.get("user")!.name;
  await sendEmail(c.env, {
    to: email,
    subject: `${inviter} has invited you to ${c.env.PRODUCT_NAME} for ${scope.org.name}`,
    text: `${inviter} has invited you to help look after the buildings of ${scope.org.name} using ${c.env.PRODUCT_NAME}.\n\nOpen this link within 7 days to set your password and sign in:\n${c.env.APP_URL}/invite?token=${token}\n\nIf you weren't expecting this, you can ignore it.`,
  });
  return c.json({ ok: true }, 201);
});

orgRoutes.post("/:orgId/buildings", async (c) => {
  const scope = await orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId"), "org.createBuilding");
  const input = buildingFields(await readJson(c.req.raw));
  if (!input.name) throw badRequest("The building needs a name.");
  const id = await createBuilding(scope, { ...input, name: input.name });
  return c.json({ id }, 201);
});

orgRoutes.patch("/:orgId", async (c) => {
  const scope = await orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId"), "org.manageUsers");
  const body = await readJson(c.req.raw);
  await updateOrgSettings(scope, "apcmDate" in body ? { apcmDate: str(body.apcmDate) || null } : {});
  return c.json({ ok: true });
});

orgRoutes.patch("/:orgId/members/:userId", async (c) => {
  const scope = await orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId"), "org.manageUsers");
  const body = await readJson(c.req.raw);
  await setReminderRecipient(scope, c.req.param("userId"), Boolean(body.receivesReminders));
  return c.json({ ok: true });
});
