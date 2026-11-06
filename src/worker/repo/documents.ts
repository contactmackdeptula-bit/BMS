import { and, desc, eq, inArray } from "drizzle-orm";
import { DOCUMENT_TYPES, complianceItem, complianceOccurrence, document, job, jobDocument, user } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/http";
import { ulid } from "../lib/ids";
import type { BuildingScope } from "../tenancy";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

// Magic numbers, so a file can't claim to be a PDF when it isn't (SPEC.md §3.9).
function sniff(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip"; // docx and xlsx are zip files
  const ftyp = String.fromCharCode(...bytes.slice(4, 12));
  if (ftyp.startsWith("ftypheic") || ftyp.startsWith("ftypheix") || ftyp.startsWith("ftypmif1") || ftyp.startsWith("ftyphe")) return "image/heic";
  return null;
}

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export async function uploadDocument(
  scope: BuildingScope,
  input: { body: ArrayBuffer; mimeType: string; type: string; title: string; documentDate?: string | null; expiresOn?: string | null },
) {
  scope.require("records.write");
  if (!ALLOWED_TYPES.has(input.mimeType)) throw badRequest("Upload a PDF, a photo, or a Word or Excel file.");
  if (input.body.byteLength === 0) throw badRequest("That file is empty.");
  if (input.body.byteLength > MAX_UPLOAD_BYTES) throw badRequest("That file is over 50 MB.");
  const sniffed = sniff(new Uint8Array(input.body.slice(0, 16)));
  const ok =
    sniffed === input.mimeType ||
    (sniffed === "zip" && input.mimeType.includes("openxmlformats")) ||
    (sniffed === "image/heic" && input.mimeType.startsWith("image/hei"));
  if (!ok) throw badRequest("That file's contents don't match its type.");
  if (!DOCUMENT_TYPES.includes(input.type as DocumentType)) throw badRequest("Unknown document type.");
  const title = input.title.trim().slice(0, 200) || "Untitled document";
  for (const d of [input.documentDate, input.expiresOn]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest("Use a valid date.");

  const id = ulid();
  const r2Key = `org/${scope.orgId}/building/${scope.buildingId}/${id}.${ALLOWED_TYPES.get(input.mimeType)}`;
  await scope.env.FILES.put(r2Key, input.body, { httpMetadata: { contentType: input.mimeType } });
  await scope.db.insert(document).values({
    id,
    orgId: scope.orgId,
    buildingId: scope.buildingId,
    type: input.type as DocumentType,
    title,
    r2Key,
    mimeType: input.mimeType,
    sizeBytes: input.body.byteLength,
    documentDate: input.documentDate ?? null,
    expiresOn: input.expiresOn ?? null,
    uploadedBy: scope.userId,
  });
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "document", entityId: id, action: "uploaded", summary: { title, type: input.type } });
  return { id, title, type: input.type, documentDate: input.documentDate ?? null };
}

export async function findDocument(scope: BuildingScope, documentId: string) {
  const row = await scope.db
    .select()
    .from(document)
    .where(and(eq(document.id, documentId), eq(document.buildingId, scope.buildingId)))
    .get();
  if (!row) throw notFound();
  return row;
}

export async function readDocumentFile(scope: BuildingScope, documentId: string) {
  const row = await findDocument(scope, documentId);
  const obj = await scope.env.FILES.get(row.r2Key);
  if (!obj) throw notFound();
  return { row, obj };
}

// ---------- Listing and editing ----------
export async function listDocuments(scope: BuildingScope) {
  const docs = await scope.db
    .select({
      id: document.id,
      type: document.type,
      title: document.title,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      documentDate: document.documentDate,
      expiresOn: document.expiresOn,
      contractorId: document.contractorId,
      amountPence: document.amountPence,
      createdAt: document.createdAt,
      uploadedBy: user.name,
    })
    .from(document)
    .leftJoin(user, eq(user.id, document.uploadedBy))
    .where(eq(document.buildingId, scope.buildingId))
    .orderBy(desc(document.documentDate), desc(document.createdAt))
    .all();
  const ids = docs.map((d) => d.id);
  // Where each document is used: a job, or a compliance record.
  const jobUses = ids.length
    ? await scope.db
        .select({ documentId: jobDocument.documentId, label: job.title })
        .from(jobDocument)
        .innerJoin(job, eq(job.id, jobDocument.jobId))
        .where(inArray(jobDocument.documentId, ids))
        .all()
    : [];
  const checkUses = ids.length
    ? await scope.db
        .select({ documentId: complianceOccurrence.documentId, label: complianceItem.name })
        .from(complianceOccurrence)
        .innerJoin(complianceItem, eq(complianceItem.id, complianceOccurrence.complianceItemId))
        .where(inArray(complianceOccurrence.documentId, ids))
        .all()
    : [];
  return docs.map((d) => ({
    ...d,
    usedFor: [...jobUses, ...checkUses].filter((u) => u.documentId === d.id).map((u) => u.label),
  }));
}

export async function updateDocument(scope: BuildingScope, documentId: string, body: Record<string, unknown>) {
  scope.require("records.write");
  const row = await findDocument(scope, documentId);
  const set: Partial<typeof document.$inferInsert> = {};
  const date = (v: unknown) => {
    if (v && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) throw badRequest("Use a valid date.");
    return (v as string) || null;
  };
  if ("title" in body) {
    const t = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!t) throw badRequest("Give the document a title.");
    set.title = t;
  }
  if ("type" in body) {
    if (!DOCUMENT_TYPES.includes(body.type as DocumentType)) throw badRequest("Unknown document type.");
    set.type = body.type as DocumentType;
  }
  if ("documentDate" in body) set.documentDate = date(body.documentDate);
  if ("expiresOn" in body) set.expiresOn = date(body.expiresOn);
  if (Object.keys(set).length === 0) return;
  await scope.db.update(document).set({ ...set, updatedAt: new Date().toISOString() }).where(eq(document.id, row.id));
  await audit(scope.db, { orgId: scope.orgId, userId: scope.userId, entity: "document", entityId: row.id, action: "updated", summary: { fields: Object.keys(set) } });
}
