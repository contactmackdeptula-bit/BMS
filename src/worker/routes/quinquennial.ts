// Mounted at /api/buildings/:buildingId — quinquennial reports and their recommendations.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app-env";
import { badRequest, readJson, str, unauthorised } from "../lib/http";
import {
  createReport,
  createTask,
  deleteTask,
  discardReport,
  overview,
  publishReport,
  reportFields,
  taskFields,
  updateReport,
  updateTask,
} from "../repo/quinquennial";
import { buildingScope } from "../tenancy";

export const quinquennialRoutes = new Hono<AppEnv>();

quinquennialRoutes.use("*", async (c, next) => {
  if (!c.get("user")) throw unauthorised();
  await next();
});

const scopeOf = (c: Context<AppEnv>) => buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId") ?? "");

quinquennialRoutes.get("/:buildingId/quinquennial", async (c) => {
  const scope = await scopeOf(c);
  return c.json({
    ...(await overview(scope, c.req.query("report") || undefined)),
    canEdit: scope.can("building.edit"),
    canWrite: scope.can("records.write"),
  });
});

quinquennialRoutes.post("/:buildingId/quinquennial", async (c) => {
  const scope = await scopeOf(c);
  const body = await readJson(c.req.raw);
  const documentId = str(body.documentId);
  if (!documentId) throw badRequest("Upload the report first.");
  return c.json({ id: await createReport(scope, documentId, reportFields(body)) }, 201);
});

quinquennialRoutes.patch("/:buildingId/quinquennial/:reportId", async (c) => {
  const scope = await scopeOf(c);
  await updateReport(scope, c.req.param("reportId"), reportFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

quinquennialRoutes.post("/:buildingId/quinquennial/:reportId/publish", async (c) => {
  const scope = await scopeOf(c);
  return c.json(await publishReport(scope, c.req.param("reportId")));
});

quinquennialRoutes.post("/:buildingId/quinquennial/:reportId/discard", async (c) => {
  const scope = await scopeOf(c);
  await discardReport(scope, c.req.param("reportId"));
  return c.json({ ok: true });
});

quinquennialRoutes.post("/:buildingId/quinquennial/:reportId/tasks", async (c) => {
  const scope = await scopeOf(c);
  return c.json({ id: await createTask(scope, c.req.param("reportId"), taskFields(await readJson(c.req.raw))) }, 201);
});

quinquennialRoutes.patch("/:buildingId/tasks/:taskId", async (c) => {
  const scope = await scopeOf(c);
  await updateTask(scope, c.req.param("taskId"), taskFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

quinquennialRoutes.post("/:buildingId/tasks/:taskId/delete", async (c) => {
  const scope = await scopeOf(c);
  await deleteTask(scope, c.req.param("taskId"));
  return c.json({ ok: true });
});
