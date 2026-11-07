// Mounted at /api/buildings/:buildingId — the annual fabric report.
import { Hono, type Context } from "hono";
import { todayIn } from "../../shared/compliance";
import type { AppEnv } from "../app-env";
import { badRequest, readJson, unauthorised } from "../lib/http";
import { defaultReportYear, exportReport, getReport, inputFields, reportYears, saveDraft } from "../repo/fabric-report";
import { buildingScope } from "../tenancy";

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.use("*", async (c, next) => {
  if (!c.get("user")) throw unauthorised();
  await next();
});

const scopeOf = (c: Context<AppEnv>) => buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId") ?? "");
const yearOf = (v: string | undefined) => {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest("Choose a report year.");
  return y;
};

reportRoutes.get("/:buildingId/fabric-report", async (c) => {
  const scope = await scopeOf(c);
  const defaultYear = defaultReportYear(todayIn("Europe/London"));
  const year = c.req.query("year") ? yearOf(c.req.query("year")) : defaultYear;
  return c.json({ ...(await getReport(scope, year)), defaultYear, years: await reportYears(scope), canEdit: scope.can("building.edit") });
});

reportRoutes.put("/:buildingId/fabric-report/:year", async (c) => {
  const scope = await scopeOf(c);
  await saveDraft(scope, yearOf(c.req.param("year")), inputFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

reportRoutes.post("/:buildingId/fabric-report/:year/export", async (c) => {
  const scope = await scopeOf(c);
  const format = c.req.query("format");
  if (format !== "docx" && format !== "pdf") throw badRequest("Choose Word or PDF.");
  const out = await exportReport(scope, yearOf(c.req.param("year")), format);
  return new Response(out.bytes, {
    headers: {
      "content-type": out.mimeType,
      "content-disposition": `attachment; filename="${out.filename.replace(/"/g, "")}"`,
      "x-document-id": out.documentId,
      "cache-control": "no-store",
    },
  });
});
