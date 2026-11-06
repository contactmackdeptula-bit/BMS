// Mounted at /api/buildings/:buildingId — compliance calendar and documents.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app-env";
import { badRequest, readJson, str, unauthorised } from "../lib/http";
import {
  attachEvidence,
  createItem,
  getItem,
  itemFields,
  listCalendar,
  recordOccurrence,
  removeItem,
  updateItem,
} from "../repo/compliance";
import { MAX_UPLOAD_BYTES, readDocumentFile, uploadDocument } from "../repo/documents";
import { buildingScope } from "../tenancy";

export const complianceRoutes = new Hono<AppEnv>();

complianceRoutes.use("*", async (c, next) => {
  if (!c.get("user")) throw unauthorised();
  await next();
});

const scopeOf = (c: Context<AppEnv>) =>
  buildingScope(c.get("db"), c.env, c.get("user")!.id, c.req.param("buildingId") ?? "");

complianceRoutes.get("/:buildingId/compliance", async (c) => {
  const scope = await scopeOf(c);
  return c.json({ ...(await listCalendar(scope)), canWrite: scope.can("records.write") });
});

complianceRoutes.post("/:buildingId/compliance", async (c) => {
  const scope = await scopeOf(c);
  const input = itemFields(await readJson(c.req.raw));
  if (!input.name) throw badRequest("Give the item a name.");
  if (!input.frequencyMonths) throw badRequest("Choose how often it's done.");
  const id = await createItem(scope, { ...input, name: input.name, frequencyMonths: input.frequencyMonths });
  return c.json({ id }, 201);
});

complianceRoutes.get("/:buildingId/compliance/:itemId", async (c) => {
  const scope = await scopeOf(c);
  return c.json(await getItem(scope, c.req.param("itemId")));
});

complianceRoutes.patch("/:buildingId/compliance/:itemId", async (c) => {
  const scope = await scopeOf(c);
  await updateItem(scope, c.req.param("itemId"), itemFields(await readJson(c.req.raw)));
  return c.json({ ok: true });
});

complianceRoutes.post("/:buildingId/compliance/:itemId/remove", async (c) => {
  const scope = await scopeOf(c);
  await removeItem(scope, c.req.param("itemId"));
  return c.json({ ok: true });
});

complianceRoutes.post("/:buildingId/compliance/:itemId/occurrences", async (c) => {
  const scope = await scopeOf(c);
  return c.json(await recordOccurrence(scope, c.req.param("itemId"), await readJson(c.req.raw)), 201);
});

complianceRoutes.post("/:buildingId/occurrences/:occurrenceId/evidence", async (c) => {
  const scope = await scopeOf(c);
  await attachEvidence(scope, c.req.param("occurrenceId"), str((await readJson(c.req.raw)).documentId));
  return c.json({ ok: true });
});

// Upload: the file is the raw request body; details travel in headers. The
// custom X-Fabric-Upload header can't be sent cross-site without a CORS
// preflight, which this API never grants (see the guard in index.ts).
complianceRoutes.post("/:buildingId/documents", async (c) => {
  const scope = await scopeOf(c);
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) throw badRequest("That file is over 50 MB.");
  const body = await c.req.arrayBuffer();
  const doc = await uploadDocument(scope, {
    body,
    mimeType: (c.req.header("content-type") ?? "").split(";")[0]!.trim(),
    type: c.req.header("x-document-type") ?? "other",
    title: decodeURIComponent(c.req.header("x-document-title") ?? ""),
    documentDate: c.req.header("x-document-date") || null,
    expiresOn: c.req.header("x-document-expires") || null,
  });
  return c.json({ document: doc }, 201);
});

complianceRoutes.get("/:buildingId/documents/:documentId/file", async (c) => {
  const scope = await scopeOf(c);
  const { row, obj } = await readDocumentFile(scope, c.req.param("documentId"));
  const safeName = row.title.replace(/[^\w .-]+/g, "_").slice(0, 100) || "document";
  const ext = row.r2Key.split(".").pop();
  return new Response(obj.body, {
    headers: {
      "content-type": row.mimeType,
      "content-length": String(row.sizeBytes),
      "content-disposition": `inline; filename="${safeName}.${ext}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
