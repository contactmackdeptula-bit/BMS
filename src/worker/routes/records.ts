// Mounted at /api/buildings/:buildingId — jobs, logbook, contractors, documents, dashboard.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app-env";
import { badRequest, readJson, unauthorised } from "../lib/http";
import { contractorFields, createContractor, deleteContractor, getContractor, listContractors, updateContractor } from "../repo/contractors";
import { dashboard } from "../repo/dashboard";
import { listDocuments, updateDocument } from "../repo/documents";
import {
  approveLogbookEntry,
  createJob,
  deleteJob,
  jobFields,
  listJobs,
  listLogbook,
  logbookFields,
  spendSummary,
  updateJob,
  updateLogbookEntry,
} from "../repo/jobs";
import { buildingScope } from "../tenancy";

export const recordRoutes = new Hono<AppEnv>();

recordRoutes.use("*", async (c, next) => {
  if (!c.get("user")) throw unauthorised();
  await next();
});

const scopeOf = (c: Context<AppEnv>) => buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId") ?? "");

recordRoutes.get("/:buildingId/dashboard", async (c) => {
  const scope = await scopeOf(c);
  return c.json({ ...(await dashboard(scope)), canWrite: scope.can("records.write") });
});

// ---------- Jobs ----------
recordRoutes.get("/:buildingId/jobs", async (c) => {
  const scope = await scopeOf(c);
  const year = Number(c.req.query("year")) || undefined;
  const status = c.req.query("status");
  const jobs = await listJobs(scope, {
    year,
    status: status === "planned" || status === "done" ? status : undefined,
    contractorId: c.req.query("contractorId") || undefined,
  });
  const summaryYear = year ?? new Date().getUTCFullYear();
  return c.json({
    jobs,
    spend: await spendSummary(scope, summaryYear),
    drafts: await listLogbook(scope, "draft"),
    canWrite: scope.can("records.write"),
    canApprove: scope.can("building.edit"),
  });
});

recordRoutes.post("/:buildingId/jobs", async (c) => {
  const scope = await scopeOf(c);
  const input = jobFields(await readJson(c.req.raw));
  if (!input.title) throw badRequest("Say what the job was.");
  return c.json({ id: await createJob(scope, { ...input, title: input.title }) }, 201);
});

recordRoutes.patch("/:buildingId/jobs/:jobId", async (c) => {
  const scope = await scopeOf(c);
  await updateJob(scope, c.req.param("jobId"), jobFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

recordRoutes.post("/:buildingId/jobs/:jobId/delete", async (c) => {
  const scope = await scopeOf(c);
  await deleteJob(scope, c.req.param("jobId"));
  return c.json({ ok: true });
});

// ---------- Logbook ----------
recordRoutes.get("/:buildingId/logbook", async (c) => {
  const scope = await scopeOf(c);
  const status = c.req.query("status");
  return c.json({ entries: await listLogbook(scope, status === "draft" || status === "approved" ? status : undefined) });
});

recordRoutes.patch("/:buildingId/logbook/:entryId", async (c) => {
  const scope = await scopeOf(c);
  await updateLogbookEntry(scope, c.req.param("entryId"), logbookFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

recordRoutes.post("/:buildingId/logbook/:entryId/approve", async (c) => {
  const scope = await scopeOf(c);
  await approveLogbookEntry(scope, c.req.param("entryId"));
  return c.json({ ok: true });
});

// ---------- Contractors (the organisation's address book) ----------
recordRoutes.get("/:buildingId/contractors", async (c) => {
  const scope = await scopeOf(c);
  return c.json({ contractors: await listContractors(scope), canWrite: scope.can("records.write") });
});

recordRoutes.post("/:buildingId/contractors", async (c) => {
  const scope = await scopeOf(c);
  const input = contractorFields(await readJson(c.req.raw));
  if (!input.name) throw badRequest("Give the contractor a name.");
  return c.json({ id: await createContractor(scope, { ...input, name: input.name }) }, 201);
});

recordRoutes.get("/:buildingId/contractors/:contractorId", async (c) => {
  const scope = await scopeOf(c);
  return c.json(await getContractor(scope, c.req.param("contractorId")));
});

recordRoutes.patch("/:buildingId/contractors/:contractorId", async (c) => {
  const scope = await scopeOf(c);
  await updateContractor(scope, c.req.param("contractorId"), contractorFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

recordRoutes.post("/:buildingId/contractors/:contractorId/delete", async (c) => {
  const scope = await scopeOf(c);
  await deleteContractor(scope, c.req.param("contractorId"));
  return c.json({ ok: true });
});

// ---------- Documents ----------
recordRoutes.get("/:buildingId/documents", async (c) => {
  const scope = await scopeOf(c);
  return c.json({ documents: await listDocuments(scope), canWrite: scope.can("records.write") });
});

recordRoutes.patch("/:buildingId/documents/:documentId", async (c) => {
  const scope = await scopeOf(c);
  await updateDocument(scope, c.req.param("documentId"), await readJson(c.req.raw));
  return c.json({ ok: true });
});
