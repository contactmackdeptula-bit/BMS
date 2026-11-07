// Estates console: mounted at /api/orgs (organisation-level) and /api/buildings (notes).
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app-env";
import { readJson, str, unauthorised } from "../lib/http";
import { addNote, backlog, contractorsUsed, listNotes, listProgrammes, overview, saveProgramme, setNoteShared, setProgrammeStatus, spend } from "../repo/estates";
import { buildingScope, orgScope } from "../tenancy";

export const estatesRoutes = new Hono<AppEnv>();
export const notesRoutes = new Hono<AppEnv>();

for (const r of [estatesRoutes, notesRoutes]) {
  r.use("*", async (c, next) => {
    if (!c.get("user")) throw unauthorised();
    await next();
  });
}

const readScope = (c: Context<AppEnv>) => orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId") ?? "", "building.read");
const writeScope = (c: Context<AppEnv>) => orgScope(c.get("db"), c.get("user")!.id, c.req.param("orgId") ?? "", "estates.write");
const area = (c: Context<AppEnv>) => c.req.query("area") || null;

estatesRoutes.get("/:orgId/estate", async (c) => c.json(await overview(await readScope(c), area(c))));
estatesRoutes.get("/:orgId/estate/backlog", async (c) => c.json({ tasks: await backlog(await readScope(c), area(c)) }));
estatesRoutes.get("/:orgId/estate/spend", async (c) => {
  const year = Number(c.req.query("year")) || new Date().getUTCFullYear();
  return c.json({ year, rows: await spend(await readScope(c), year, area(c)) });
});
estatesRoutes.get("/:orgId/estate/contractors", async (c) => c.json({ contractors: await contractorsUsed(await readScope(c)) }));
estatesRoutes.get("/:orgId/estate/programmes", async (c) => c.json({ programmes: await listProgrammes(await readScope(c)) }));
estatesRoutes.post("/:orgId/estate/programmes", async (c) => c.json({ id: await saveProgramme(await writeScope(c), await readJson(c.req.raw)) }, 201));
estatesRoutes.patch("/:orgId/estate/programmes/:id", async (c) => {
  await setProgrammeStatus(await writeScope(c), c.req.param("id"), str((await readJson(c.req.raw)).status));
  return c.json({ ok: true });
});

/** The board report: one row per church, as a spreadsheet. */
estatesRoutes.get("/:orgId/estate/board-report.csv", async (c) => {
  const scope = await readScope(c);
  const o = await overview(scope, area(c));
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Quote everything and neutralise spreadsheet formulas.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const lines = [
    ["Church", "Parish", "Pastoral area", "Listing", "Overdue checks", "Overdue items", "Open A", "Open B", "Backlog midpoint (£)", "Survey due", "Parish contact"].map(cell).join(","),
    ...o.rows.map((r) =>
      [r.name, r.parish, r.area?.name ?? "", r.listing ?? "", r.overdue.length, r.overdue.join("; "), r.openA, r.openB, Math.round(r.backlogPence / 100), r.surveyDue ?? "", r.contact ? `${r.contact.name} <${r.contact.email}>` : ""]
        .map(cell)
        .join(","),
    ),
  ];
  return new Response(lines.join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${scope.org.name.replace(/[^\w ,.-]+/g, "")} board report ${o.today}.csv"` },
  });
});

notesRoutes.get("/:buildingId/estates-notes", async (c) => {
  const scope = await buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId"));
  return c.json(await listNotes(scope));
});
notesRoutes.post("/:buildingId/estates-notes", async (c) => {
  const scope = await buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId"));
  const body = await readJson(c.req.raw);
  return c.json({ id: await addNote(scope, str(body.body), Boolean(body.sharedWithParish)) }, 201);
});
notesRoutes.patch("/:buildingId/estates-notes/:noteId", async (c) => {
  const scope = await buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId"));
  await setNoteShared(scope, c.req.param("noteId"), Boolean((await readJson(c.req.raw)).sharedWithParish));
  return c.json({ ok: true });
});
