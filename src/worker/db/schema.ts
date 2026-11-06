// Data model from SPEC.md §5. Ids are ULIDs (text), money is integer pence,
// dates are YYYY-MM-DD text, timestamps ISO 8601 text.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const bool = (name: string) => integer(name, { mode: "boolean" });

export const ORG_TYPES = ["parish", "diocese", "pastoral_area", "circuit", "trust"] as const;
export const ROLES = [
  "pcc_admin",
  "churchwarden",
  "treasurer",
  "member",
  "inspector",
  "estates_admin",
  "estates",
] as const;
export type Role = (typeof ROLES)[number];

export const organisation = sqliteTable(
  "organisation",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type", { enum: ORG_TYPES }).notNull(),
    parentId: text("parent_id"),
    apcmDate: text("apcm_date"),
    timezone: text("timezone").notNull().default("Europe/London"),
    ...timestamps,
  },
  (t) => [index("organisation_parent_idx").on(t.parentId)],
);

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  passwordChangedAt: text("password_changed_at"),
  ...timestamps,
});

export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => organisation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    buildingId: text("building_id"),
    receivesReminders: bool("receives_reminders").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("membership_user_idx").on(t.userId),
    uniqueIndex("membership_unique").on(t.userId, t.orgId, t.role, t.buildingId),
  ],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(), // SHA-256 of the cookie token
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const authToken = sqliteTable("auth_token", {
  id: text("id").primaryKey(), // SHA-256 of the emailed token
  kind: text("kind", { enum: ["invite", "password_reset"] }).notNull(),
  email: text("email").notNull(),
  userId: text("user_id"),
  orgId: text("org_id"),
  role: text("role", { enum: ROLES }),
  buildingId: text("building_id"),
  invitedBy: text("invited_by"),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  ...timestamps,
});

export const loginAttempt = sqliteTable(
  "login_attempt",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    attemptedAt: text("attempted_at").notNull(),
    ok: bool("ok").notNull(),
  },
  (t) => [index("login_attempt_email_idx").on(t.email, t.attemptedAt)],
);

export type Fitting = { id: string; kind: string; location: string };
export type KeyContact = { name: string; role: string; phone?: string; email?: string };

export const building = sqliteTable(
  "building",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["church", "hall", "house", "other"] }).notNull().default("church"),
    listing: text("listing", {
      enum: ["grade_i", "grade_ii_star", "grade_ii", "unlisted", "locally_listed"],
    }),
    diocese: text("diocese"),
    address: text("address"),
    postcode: text("postcode"),
    hasLift: bool("has_lift").notNull().default(false),
    hasWaterSystems: bool("has_water_systems").notNull().default(false),
    inspectorName: text("inspector_name"),
    insurer: text("insurer"),
    architect: text("architect"),
    keyContacts: json<KeyContact[]>("key_contacts").notNull().default([]),
    fittings: json<Fitting[]>("fittings").notNull().default([]),
    ...timestamps,
  },
  (t) => [index("building_org_idx").on(t.orgId)],
);

export const DOCUMENT_TYPES = [
  "certificate",
  "invoice",
  "quote",
  "insurance_schedule",
  "report",
  "qi_report",
  "photo",
  "survey",
  "fabric_report",
  "other",
] as const;

export const contractor = sqliteTable(
  "contractor",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trade: text("trade"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    accreditation: text("accreditation"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("contractor_org_idx").on(t.orgId)],
);

export const document = sqliteTable(
  "document",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    type: text("type", { enum: DOCUMENT_TYPES }).notNull(),
    title: text("title").notNull(),
    r2Key: text("r2_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    documentDate: text("document_date"),
    expiresOn: text("expires_on"),
    contractorId: text("contractor_id"),
    amountPence: integer("amount_pence"),
    uploadedBy: text("uploaded_by").notNull(),
    extracted: json<Record<string, unknown>>("extracted"),
    extractionConfirmedAt: text("extraction_confirmed_at"),
    ...timestamps,
  },
  (t) => [index("document_building_idx").on(t.buildingId)],
);

export const complianceItem = sqliteTable(
  "compliance_item",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequencyMonths: integer("frequency_months").notNull(),
    anchor: text("anchor", { enum: ["none", "apcm", "insurance_renewal"] }).notNull().default("none"),
    doneBy: text("done_by"),
    note: text("note"),
    nextDueOverride: text("next_due_override"),
    selfCheck: bool("self_check").notNull().default(false),
    fittingKind: text("fitting_kind"),
    active: bool("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("compliance_item_building_idx").on(t.buildingId)],
);

export type ChecklistResult = { fittingId: string; ok: boolean; note?: string };

export const complianceOccurrence = sqliteTable(
  "compliance_occurrence",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    complianceItemId: text("compliance_item_id")
      .notNull()
      .references(() => complianceItem.id, { onDelete: "cascade" }),
    doneOn: text("done_on").notNull(),
    doneByUserId: text("done_by_user_id"),
    doneByText: text("done_by_text"),
    documentId: text("document_id"),
    checklist: json<ChecklistResult[]>("checklist"),
    notes: text("notes"),
    status: text("status", { enum: ["complete", "partial"] }).notNull().default("complete"),
    ...timestamps,
  },
  (t) => [index("occurrence_item_idx").on(t.complianceItemId, t.doneOn)],
);

export const qiReport = sqliteTable(
  "qi_report",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    inspectedOn: text("inspected_on"),
    inspectorName: text("inspector_name"),
    pageCount: integer("page_count"),
    nextDueOn: text("next_due_on"),
    status: text("status", { enum: ["reading", "review", "current", "previous", "failed"] })
      .notNull()
      .default("reading"),
    rawExtraction: json<unknown>("raw_extraction"),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version"),
    readAt: text("read_at"),
    ...timestamps,
  },
  (t) => [index("qi_report_building_idx").on(t.buildingId)],
);

export const job = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    doneOn: text("done_on"),
    contractorId: text("contractor_id"),
    costPence: integer("cost_pence"),
    status: text("status", { enum: ["planned", "done"] }).notNull().default("done"),
    taskId: text("task_id"),
    complianceOccurrenceId: text("compliance_occurrence_id"),
    instructedByOrgId: text("instructed_by_org_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("job_building_idx").on(t.buildingId, t.doneOn)],
);

export const jobDocument = sqliteTable(
  "job_document",
  {
    jobId: text("job_id").notNull().references(() => job.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.documentId] })],
);

export const task = sqliteTable(
  "task",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    qiReportId: text("qi_report_id").notNull().references(() => qiReport.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    text: text("text").notNull(),
    originalText: text("original_text").notNull(),
    location: text("location"),
    trade: text("trade"),
    band: text("band", { enum: ["A", "B", "C", "D", "M"] }).notNull(),
    estimateLowPence: integer("estimate_low_pence"),
    estimateHighPence: integer("estimate_high_pence"),
    pageNumber: integer("page_number"),
    permission: text("permission", {
      enum: ["none", "like_for_like", "list_a", "list_b", "faculty", "tbc"],
    })
      .notNull()
      .default("tbc"),
    confidence: json<Record<string, number>>("confidence"),
    status: text("status", { enum: ["not_started", "quoted", "in_progress", "waiting", "done"] })
      .notNull()
      .default("not_started"),
    waitingOnTaskId: text("waiting_on_task_id"),
    jobId: text("job_id"),
    ...timestamps,
  },
  (t) => [index("task_building_idx").on(t.buildingId, t.band)],
);

export const logbookEntry = sqliteTable(
  "logbook_entry",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    jobId: text("job_id"),
    entryDate: text("entry_date").notNull(),
    work: text("work").notNull(),
    who: text("who"),
    costPence: integer("cost_pence"),
    permissionRef: text("permission_ref"),
    status: text("status", { enum: ["draft", "approved"] }).notNull().default("draft"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    ...timestamps,
  },
  (t) => [index("logbook_building_idx").on(t.buildingId, t.entryDate)],
);

export const fabricReport = sqliteTable(
  "fabric_report",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    inspectionDate: text("inspection_date"),
    inspectedBy: text("inspected_by"),
    accompaniedBy: text("accompanied_by"),
    conditionText: text("condition_text"),
    matters: json<{ text: string; confirmed: boolean }[]>("matters").notNull().default([]),
    terrierConfirmed: bool("terrier_confirmed").notNull().default(false),
    status: text("status", { enum: ["draft", "exported"] }).notNull().default("draft"),
    exportedDocumentIds: json<string[]>("exported_document_ids").notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("fabric_report_year").on(t.buildingId, t.year)],
);

export const estatesNote = sqliteTable(
  "estates_note",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(), // the diocese
    buildingId: text("building_id").notNull().references(() => building.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").notNull(),
    sharedWithParish: bool("shared_with_parish").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("estates_note_building_idx").on(t.buildingId)],
);

export const programme = sqliteTable("programme", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  windowStart: text("window_start"),
  windowEnd: text("window_end"),
  buildingIds: json<string[]>("building_ids").notNull().default([]),
  estimateLowPence: integer("estimate_low_pence"),
  estimateHighPence: integer("estimate_high_pence"),
  status: text("status", { enum: ["suggested", "tendering", "instructed", "done"] })
    .notNull()
    .default("suggested"),
  ...timestamps,
});

export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: text("id").primaryKey(),
    buildingId: text("building_id").notNull(),
    sentOn: text("sent_on").notNull(),
    recipients: json<string[]>("recipients").notNull(),
    itemIds: json<string[]>("item_ids").notNull(),
  },
  (t) => [uniqueIndex("reminder_once_per_day").on(t.buildingId, t.sentOn)],
);

export const aiCall = sqliteTable("ai_call", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  buildingId: text("building_id"),
  purpose: text("purpose", { enum: ["qi_extraction", "document_reading", "assistant"] }).notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costPence: integer("cost_pence").notNull(),
  ok: bool("ok").notNull(),
  createdAt: timestamps.createdAt,
});

export const auditEvent = sqliteTable(
  "audit_event",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    userId: text("user_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    summary: json<Record<string, unknown>>("summary"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)],
);
