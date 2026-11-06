import { and, eq } from "drizzle-orm";
import { DOCUMENT_TYPES, document } from "../db/schema";
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
  input: { body: ArrayBuffer; mimeType: string; type: string; title: string; documentDate?: string | null },
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
  if (input.documentDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.documentDate)) throw badRequest("Use a valid date.");

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
