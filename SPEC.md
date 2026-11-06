# SPEC — Church buildings platform ("Fabric", working name)

Status: **rebuilt 6 Nov 2026** from the design handoff (`docs/UI-HANDOFF.md`) and the decisions recorded in it. The original SPEC.md of 26 Oct 2026 was not saved anywhere retrievable. Items marked **[ASSUMPTION]** were not in any surviving record and need confirming.

This file governs stack, data model, tenancy, security and milestones. `docs/UI-HANDOFF.md` governs screens, components, tokens, states and AI touchpoints. Where they disagree, stop and ask.

---

## 1. What the product is

A records and planning tool for the people who look after church buildings: churchwardens, treasurers, parish administrators, fabric committees and diocesan estates teams. It keeps each building's compliance calendar, quinquennial (QI) actions, job log, documents and contractors in one place, and drafts the annual fabric report for the APCM.

**Name.** Not "building management system": the Church of England's national Building Management Portal (live 6 Oct 2026) owns that name. "Fabric" is a placeholder. The product name, tagline and footer wording come from configuration (`PRODUCT_NAME`, `PRODUCT_TAGLINE`), never literals in code.

**Pilot.** St Peter and St Paul, Fareham, and St John the Evangelist, Fareham, with a third church planned. Each PCC's data is walled off from every other from day one.

### In scope for v1
- Building records and profile
- Compliance calendar with reminders
- Quinquennial report → task list (AI extraction with human review)
- Job log, contractor address book, documents, logbook entries
- Annual fabric report builder with Word and PDF export
- Phone layout for the warden on site, with offline queue
- Multi-building / diocesan estates console

### Out of scope for v1
Contractor accounts or logins, quoting, payments, collective purchasing, Maintenance Days, user-supplied AI keys or AI sign-in.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Files | Cloudflare R2 (documents, report PDFs, photos) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| API | Hono on Workers **[ASSUMPTION]** |
| Front end | React + TypeScript + Vite, React Router, served as Workers static assets from the same Worker **[ASSUMPTION]** |
| Styling | Plain CSS with the custom properties in UI-HANDOFF §4; no CSS framework |
| Scheduled jobs | Workers Cron Triggers (daily reminder run) |
| Background work | Cloudflare Queues for QI extraction and document reading |
| Email | Transactional email through a provider adapter (Brevo first, as it is already in use) **[ASSUMPTION]** |
| Exports | `.docx` generated server-side (`docx` package); PDF rendered from the same HTML with Cloudflare Browser Rendering **[ASSUMPTION]** |
| AI | Claude API, called only from the Worker on the product's own account. Model and prompt versions are config. |
| Tests | Vitest (unit + Workers pool for D1), Playwright for end-to-end |
| Fonts | Inter and Source Serif 4, self-hosted woff2 |

Environments: `dev` (local, `wrangler dev` with local D1/R2), `staging`, `production`. Secrets via `wrangler secret`: `ANTHROPIC_API_KEY`, `EMAIL_API_KEY`, `SESSION_SECRET`.

---

## 3. Tenancy and security

1. **Organisation is the tenant.** Every row that holds church data carries `orgId` (and `buildingId` where relevant). Every query goes through a repository layer that takes the session's resolved scope and adds the `orgId`/`buildingId` filter; raw table access from route handlers is not allowed. A lint rule or test enforces this.
2. **Access is by membership.** A user sees a building only through a `membership` on that building's organisation (or an ancestor organisation with an estates role, see 4). No membership → 404, not 403, so ids don't leak.
3. **Diocese over parish.** A diocese organisation can be the parent of a parish organisation. Estates roles on the diocese can **read** the parish's records and **write their own** estates notes and programmes. They cannot edit parish records. Estates notes are never shown to parish users unless explicitly shared (`estatesNote.sharedWithParish`).
4. **Parish users never see the estates shell** or other parishes.
5. **Files.** R2 keys are `org/{orgId}/building/{buildingId}/{documentId}`. Files are only ever served through the Worker after a scope check, with short-lived signed URLs. No public bucket.
6. **Auth.** Passwordless email magic link, 15-minute single-use token, session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), 30-day sliding sessions **[ASSUMPTION]**. Invitations only; no open sign-up in v1.
7. **Audit.** Every create/update/delete writes an `auditEvent` (who, what, before/after summary, when). Frequency changes on compliance items are logged explicitly (UI-HANDOFF §8).
8. **AI data handling.** The PCC is the controller, the product the processor, the AI provider a sub-processor on API terms with no training on customer data. Named in the privacy notice and the pilot agreement. Contractor contact details are personal data under the same notice.
9. **Uploads.** Max 50 MB per file; allowed types PDF, JPEG, PNG, HEIC, DOCX, XLSX. Content type checked server-side.
10. **No real documents uploaded** until the pilot PCC has signed the data and ownership agreement.

---

## 4. Roles

| Role | Scope | Can |
|---|---|---|
| `pcc_admin` | parish org | Everything in the church shell, plus users, roles, reminder recipients and settings |
| `churchwarden` | parish org | Read/write all building records; approve logbook entries; build and export the fabric report |
| `treasurer` | parish org | Read all; write jobs and costs; upload documents |
| `member` | parish org | Read all; upload documents; log jobs and checklist results (fabric volunteer, incumbent, administrator, PCC secretary) |
| `inspector` | one building | Read-only on Quinquennial and Documents (inspecting architect) **[ASSUMPTION: invited, read-only]** |
| `estates_admin` | diocese org | Organisation settings and users; everything `estates` can do |
| `estates` | diocese org | Read every descendant building; write estates notes, programmes, and diocese-instructed jobs |

A job instructed by the diocese is stored with `instructedByOrgId` = the diocese and shows on the parish job log flagged "instructed by the diocese".

---

## 5. Data model

All ids are text (ULID). All tables have `createdAt`, `updatedAt` (ISO 8601 text). Money is stored as integer pence. Dates are `YYYY-MM-DD` text.

### organisation
| field | type | notes |
|---|---|---|
| id | text pk | |
| name | text | |
| type | enum `parish` \| `diocese` \| `pastoral_area` \| `circuit` \| `trust` | |
| parentId | text fk organisation, null | diocese → pastoral area → parish |
| apcmDate | date, null | next APCM; anchors the churchwardens' inspection and fabric report |
| timezone | text | default `Europe/London` |

### user, membership, session, magicLinkToken
- `user`: id, email (unique), name, phone (null).
- `membership`: id, userId, orgId, role (see 4), buildingId (null except for `inspector`), receivesReminders (bool).
- `session`, `magicLinkToken`: standard; tokens stored hashed.

### building
| field | type | notes |
|---|---|---|
| id | text pk | |
| orgId | fk organisation | |
| name | text | "St Peter and St Paul, Fareham" |
| kind | enum `church` \| `hall` \| `house` \| `other` | |
| listing | enum `grade_i` \| `grade_ii_star` \| `grade_ii` \| `unlisted` \| `locally_listed` | |
| diocese | text | display name |
| address, postcode | text | |
| hasLift | bool | seeds lift inspection |
| hasWaterSystems | bool | seeds legionella assessment |
| inspectorName, insurer, architect | text, null | building profile |
| keyContacts | json | `[{name, role, phone, email}]` |
| fittings | json | `[{id, kind: "emergency_light" \| ..., location}]` for phone self-checks |

### document
id, orgId, buildingId, type (enum: `certificate`, `invoice`, `quote`, `insurance_schedule`, `report`, `qi_report`, `photo`, `survey`, `fabric_report`, `other`), title, r2Key, mimeType, sizeBytes, documentDate (null), expiresOn (null), contractorId (null), amountPence (null), uploadedBy, extracted (json, null — AI suggestions, see 7), extractionConfirmedAt (null).

### complianceItem
| field | type | notes |
|---|---|---|
| id, orgId, buildingId | | |
| name | text | |
| frequencyMonths | int | 1, 6, 12, 36, 60 … |
| anchor | enum `none` \| `apcm` \| `insurance_renewal`, default `none` | anchored items take their date from the anchor |
| doneBy | text | "Churchwardens", "Gas Safe engineer" |
| note | text | one-line guidance shown on hover |
| nextDueOverride | date, null | manual edit of next due |
| selfCheck | bool | evidence can be a named person instead of a document |
| fittingKind | text, null | links to `building.fittings` for checklist tests |
| active | bool | |

### complianceOccurrence
id, complianceItemId, doneOn (date), doneByUserId (null), doneByText, documentId (null), checklist (json, null — per-fitting results), notes, status (`complete` \| `partial`).

**Rules (computed server-side, one function shared by screens and emails):**
- `lastDone` = latest complete occurrence's `doneOn`.
- `nextDue` = `nextDueOverride` ?? (anchor date if anchored) ?? `lastDone + frequencyMonths` ?? creation date.
- `status` = `overdue` (today > nextDue; n days), `due_soon` (within 90 days), `on_track`.
- `missingEvidence` = latest occurrence complete, not a self-check, and no `documentId`.

### qiReport
id, orgId, buildingId, documentId, inspectedOn, inspectorName, pageCount, nextDueOn, status (`reading` \| `review` \| `current` \| `previous` \| `failed`), rawExtraction (json), modelVersion, promptVersion, readAt.

### task (QI recommendation)
| field | type | notes |
|---|---|---|
| id, orgId, buildingId, qiReportId | | |
| ref | text | inspector's "3.2" |
| text | text | reviewed wording |
| originalText | text | as extracted |
| location | text | |
| trade | text, null | for group-by |
| band | enum `A` \| `B` \| `C` \| `D` \| `M` | inspector's own bands; `M` routine items also create a complianceItem |
| estimateLowPence, estimateHighPence | int, null | |
| pageNumber | int, null | links back to the PDF page |
| permission | enum `none` \| `like_for_like` \| `list_a` \| `list_b` \| `faculty` \| `tbc` | |
| confidence | json | per-field 0–1 from extraction |
| status | enum `not_started` \| `quoted` \| `in_progress` \| `waiting` \| `done` | |
| waitingOnTaskId | fk task, null | "Waiting on 8.4" |
| jobId | fk job, null | completing job |

### contractor
id, orgId, name, trade, contactName, phone, email, website, notes, accreditation (text, null). Contractors belong to the organisation; a diocese's contractor list is separate from a parish's.

### job
id, orgId, buildingId, title, doneOn, contractorId (null), costPence (null), status (`planned` \| `done`), taskId (null), complianceOccurrenceId (null), instructedByOrgId (null), notes. Linked documents via `jobDocument(jobId, documentId)`.

### logbookEntry
id, orgId, buildingId, jobId (null), entryDate, work, who, costPence, permissionRef (null — faculty or List B reference), status (`draft` \| `approved`), approvedBy, approvedAt. A completed job with at least one document creates a draft entry automatically.

### fabricReport
id, orgId, buildingId, year, inspectionDate, inspectedBy, accompaniedBy, conditionText, matters (json — confirmed matters for the PCC), terrierConfirmed (bool), status (`draft` \| `exported`), exportedDocumentIds (json).

### estatesNote
id, orgId (the diocese), buildingId, body, authorId, sharedWithParish (bool).

### programme
id, orgId (the diocese), type (e.g. `lightning_protection`), title, windowStart, windowEnd, buildingIds (json), estimateLowPence, estimateHighPence, status (`suggested` \| `tendering` \| `instructed` \| `done`).

### reminderLog
id, buildingId, sentOn, recipients (json), itemIds (json). Enforces one email per building per day.

### aiCall
id, orgId, buildingId (null), purpose (`qi_extraction` \| `document_reading` \| `assistant`), model, promptVersion, inputTokens, outputTokens, costPence, ok (bool), createdAt.

### auditEvent
id, orgId, userId, entity, entityId, action, summary (json), createdAt.

---

## 6. Default compliance checklist (16)

Seeded on building creation. The first 14 always; the last two only when the profile says so.

| # | Item | Frequency | Anchor | Normally done by |
|---|---|---|---|---|
| 1 | Lightning protection system test | 12 months | | Specialist contractor |
| 2 | Asbestos register review | 12 months | | Churchwardens |
| 3 | Fire risk assessment review | 12 months | | Churchwardens / fire assessor |
| 4 | Fire extinguisher service | 12 months | | Fire protection contractor |
| 5 | Emergency lighting monthly flick test | 1 month | | Churchwarden or volunteer (self-check, per fitting) |
| 6 | Emergency lighting annual duration test | 12 months | | Electrician |
| 7 | Gutters and rainwater goods clearance | 6 months | | Contractor or volunteers |
| 8 | Gas boiler service and safety check | 12 months | | Gas Safe engineer |
| 9 | Portable appliance testing | 12 months | | Competent person / electrician |
| 10 | Electrical installation condition report | 60 months | | Electrician |
| 11 | Insurance renewal | 12 months | insurance_renewal | Treasurer |
| 12 | Churchwardens' annual fabric inspection | 12 months | apcm | Churchwardens |
| 13 | Tree survey, churchyard | 36 months | | Arboriculturist |
| 14 | Quinquennial inspection | 60 months | | Inspecting architect / surveyor |
| 15 | Lift inspection (LOLER) | 6 months | | Lift engineer — only if `hasLift` |
| 16 | Legionella risk assessment | 24 months | | Competent person — only if `hasWaterSystems` |

Frequencies are starting guidance and editable per item **[ASSUMPTION for 15 and 16]**.

---

## 7. AI touchpoints (exactly three)

All server-side, all logged in `aiCall`, none on the request hot path (Queues).

1. **QI report reading.** PDF in (text layer, or page images for scans). JSON out: items with ref, text, location, band, estimate low/high, page, and per-field confidence. Run once per upload; raw output stored on `qiReport.rawExtraction`; a human reviews before tasks become live. Regression suite of real reports from several inspectors, run on every model or prompt change.
2. **Document reading.** Invoices, certificates, insurance schedules: type, date, contractor, amount, next due. Shown as pre-filled fields with a source snippet; nothing saved until a person confirms.
3. **In-app assistant** — later, behind a feature flag. Questions over the building's own records only, answers cite records, capped per church per month.

Cost cap: configurable monthly ceiling per organisation; when reached, extraction queues and the user is told.

---

## 8. Reminders

Daily cron at 07:00 Europe/London. For each building, email recipients (`membership.receivesReminders`) about items 60, 30 and 7 days before `nextDue`, on the day it becomes overdue, then weekly while overdue. One email per building per day grouping all items. Recording an occurrence advances `nextDue` and stops reminders. Email wording matches on-screen wording.

---

## 9. Milestones

Each milestone is shippable to the pilot churches before the next starts. Front-end steps refer to UI-HANDOFF §16.

| # | Milestone | Includes | UI-HANDOFF steps |
|---|---|---|---|
| M1 | Foundations | Repo, Worker, D1, R2, Drizzle schema and migrations, tenancy repository layer + tests, magic-link auth, roles, audit, tokens and shared components with `/components` page | 1, 2 |
| M2 | Compliance calendar | Building profile, seeding, occurrences, document upload, status rules (tests first), month strip, daily reminders | 3 |
| M3 | Jobs, contractors, documents, dashboard | Job log, contractor book, documents list, draft logbook entries, church dashboard | 4, 5 |
| M4 | Quinquennial | Upload, queued extraction, review screen, task table, permission flags, routine items into the calendar, extraction test suite | 6 |
| M5 | Annual fabric report | Builder, preview, Word and PDF export saved to Documents | 7 |
| M6 | Phone and offline | Responsive phone layout, This week, checklists, camera logging, offline queue | 8 |
| M7 | Estates console and document reading | Organisation tree, aggregates, survey cycle, programmes, estates notes and sharing; document reading; AI usage meter | 9, 10 |

---

## 10. Open points

- Confirm or change every **[ASSUMPTION]** above (API framework, React, auth method, email provider, PDF rendering, inspector role, items 15–16).
- Which inspecting architects' reports form the extraction test suite.
- Pilot PCCs to sign the data and ownership agreement before real documents are uploaded.
- Final product name.
