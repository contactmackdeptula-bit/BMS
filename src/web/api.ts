export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("We couldn't reach the server. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? "Something went wrong. Please try again.", res.status);
  return json as T;
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function upload(buildingId: string, file: File, meta: { type: string; title?: string; documentDate?: string | null }) {
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("That file is over 50 MB.", 400);
  let res: Response;
  try {
    res = await fetch(`/api/buildings/${buildingId}/documents`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-fabric-upload": "1",
        "x-document-type": meta.type,
        "x-document-title": encodeURIComponent(meta.title || file.name.replace(/\.[^.]+$/, "")),
        ...(meta.documentDate ? { "x-document-date": meta.documentDate } : {}),
      },
      body: file,
    });
  } catch {
    throw new ApiError("The upload didn't reach the server. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; document?: UploadedDocument };
  if (!res.ok || !json.document) throw new ApiError(json.error ?? "The upload failed. Please try again.", res.status);
  return json.document;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  upload,
};

export type UploadedDocument = { id: string; title: string; type: string; documentDate: string | null };

export type ComplianceStatus = "overdue" | "due_soon" | "on_track" | "not_recorded";
export type ComplianceItem = {
  id: string;
  templateKey: string | null;
  name: string;
  frequencyMonths: number;
  anchor: "none" | "apcm" | "insurance_renewal";
  frequencyLabel: string;
  doneBy: string | null;
  note: string | null;
  selfCheck: boolean;
  fittingKind: string | null;
  nextDueOverride: string | null;
  lastDone: string | null;
  nextDue: string | null;
  status: ComplianceStatus;
  days: number | null;
  statusLabel: string;
  missingEvidence: boolean;
  evidence:
    | { kind: "document"; document: UploadedDocument }
    | { kind: "person"; name: string | null }
    | null;
  partial: { doneOn: string; checklist: { fittingId: string; ok: boolean }[] | null } | null;
};
export type Calendar = {
  today: string;
  items: ComplianceItem[];
  months: { key: string; label: string; fullLabel: string; count: number; tone: "danger" | "warn" | "ok" | "neutral" }[];
  counts: Record<"all" | "overdue" | "due_soon" | "on_track" | "not_recorded" | "missing_evidence", number>;
  anchors: { apcm: string | null; insuranceRenewal: string | null };
  canWrite: boolean;
};
export type ItemDetail = {
  item: ComplianceItem;
  history: {
    id: string;
    doneOn: string;
    doneByText: string | null;
    status: "complete" | "partial";
    notes: string | null;
    checklist: { fittingId: string; ok: boolean }[] | null;
    documentId: string | null;
    documentTitle: string | null;
    recordedBy: string | null;
  }[];
  fittings: { id: string; kind: string; location: string }[];
};

// ---------- Shapes returned by the API ----------
export type Role = "pcc_admin" | "churchwarden" | "treasurer" | "member" | "inspector" | "estates_admin" | "estates";

export type Me = {
  user: { id: string; email: string; name: string };
  organisations: { id: string; name: string; type: string; apcmDate: string | null; role: Role }[];
  buildings: { id: string; orgId: string; name: string; kind: string; roles: Role[]; viaEstates: boolean }[];
  product: { name: string; tagline: string };
};

export type Building = {
  id: string;
  orgId: string;
  name: string;
  kind: "church" | "hall" | "house" | "other";
  listing: string | null;
  diocese: string | null;
  address: string | null;
  postcode: string | null;
  hasLift: boolean;
  hasWaterSystems: boolean;
  inspectorName: string | null;
  insurer: string | null;
  insuranceRenewsOn: string | null;
  architect: string | null;
  fittings: { id: string; kind: string; location: string }[];
  keyContacts: { name: string; role: string; phone?: string; email?: string }[];
};

export type BuildingAccess = { roles: Role[]; canEdit: boolean; viaEstates: boolean };
