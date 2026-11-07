# SPEC — Church buildings platform ("Fabric", working name)

Status: **rebuilt 6 Nov 2026** from the design handoff (`docs/UI-HANDOFF.md`) and the decisions recorded in it. The original SPEC.md of 26 Oct 2026 was not saved anywhere retrievable. Choices not in any surviving record were confirmed by Mack on 6 Nov 2026.

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
| API | Hono on Workers |
| Front end | React + TypeScript + Vite, React Router, served as Workers static assets from the same Worker |
| Styling | Plain CSS with the custom properties in UI-HANDOFF §4; no CSS framework |
| Scheduled jobs | Workers Cron Triggers (daily reminder run) |
| Background work | Cloudflare Queues for QI extraction and document reading |
| Email | Transactional email through a provider adapter (Brevo first, as it is already in use) |
| Exports | `.docx` generated server-side (`docx` package); PDF drawn server-side with `pdf-lib` (standard Times font, A4). Decided 7 Nov 2026 instead of Cloudflare Browser Rendering: no paid service, works locally and offline |
| AI | Claude API, called only from the Worker on the product's own account. Model and prompt versions are config. |
| Tests | Vitest (unit + Workers pool for D1), Playwright for end-to-end |
| Fonts | Inter and Source Serif 4, self-hosted woff2 |

Environments: `dev` (local, `wrangler dev` with local D1/R2), `staging`, `production`. Secrets via `wrangler secret`: `ANTHROPIC_API_KEY`, `EMAIL_API_KEY`, `APP_URL`.

---

## 3. Tenancy and security

1. **Organisation is the tenant.** Every row that holds church data carries `orgId` (and `buildingId` where relevant). Every query goes through a repository layer that takes the session's resolved scope and adds the `orgId`/`buildingId` filter; raw table access from route handlers is not allowed. A lint rule or test enforces this.
2. **Access is by membership.** A user sees a building only through a `membership` on that building's organisation (or an ancestor organisation with an estates role, see 4). No membership → 404, not 403, so ids don't leak.
3. **Diocese over parish.** A diocese organisation can be the parent of a parish organisation. Estates roles on the diocese can **read** the parish's records and **write their own** estates notes and programmes. They cannot edit parish records. Estates notes are never shown to parish users unless explicitly shared (`estatesNote.sharedWithParish`).
4. **Parish users never see the estates shell** or other parishes.
5. **Files.** R2 keys are `org/{orgId}/building/{buildingId}/{documentId}.{ext}`. Files are only ever served by the Worker streaming them after a scope check (`/api/buildings/:id/documents/:docId/file`), with `no-store` and a sandboxing content security policy. No public bucket and no shareable links in v1.
6. **Auth.** Email and password (decided 6 Nov 2026). Passwords hashed with PBKDF2-SHA256 (Web Crypto, 100,000 iterations, 16-byte random salt), minimum 10 characters, checked against a short list of common passwords. Session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) holding a random token stored hashed in D1; 30-day sliding sessions. After 10 failed attempts on an email in 15 minutes, logins for that email are refused for 15 minutes. Password reset by emailed single-use link (1 hour). Accounts are created by invitation only in v1; the invite link lets the person set their own password. All sessions are ended when a password changes.
7. **Audit.** Every create/update/delete writes an `auditEvent` (who, what, before/after summary, when). Frequency changes on compliance items are logged explicitly (UI-HANDOFF §8).
8. **AI data handling.** The PCC is the controller, the product the processor, the AI provider a sub-processor on API terms with no training on customer data. Named in the privacy notice and the pilot agreement. Contractor contact details are personal data under the same notice.
9. **Uploads.** Max 50 MB per file; allowed types PDF, JPEG, PNG, HEIC, DOCX, XLSX. The file's first bytes are checked against its declared type server-side. Uploads send the raw file with an `X-Fabric-Upload: 1` header, which another site can't send without a CORS preflight the API never grants.
10. **No real documents uploaded** until the pilot PCC has signed the data and ownership agreement.

---

## 4. Roles

| Role | Scope | Can |
|---|---|---|
| `pcc_admin` | parish org | Everything in the church shell, plus users, roles, reminder recipients and settings |
| `churchwarden` | parish org | Read/write all building records; approve logbook entries; build and export the fabric report |
| `treasurer` | parish org | Read all; write jobs and costs; upload documents |
| `member` | parish org | Read all; upload documents; log jobs and checklist results (fabric volunteer, incumbent, administrator, PCC secretary) |
| `inspector` | one building | Read-only on Quinquennial and Documents (inspecting architect) (invited, read-only) |
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

### user, membership, session, authToken, loginAttempt
- `user`: id, email (unique, lower-cased), name, phone (null), passwordHash (null until invite accepted), passwordChangedAt.
- `membership`: id, userId, orgId, role (see 4), buildingId (null except for `inspector`), receivesReminders (bool).
- `session`: id (hash of cookie token), userId, expiresAt, lastSeenAt.
- `authToken`: id (hash), userId (null for invites), email, kind (`invite` \| `password_reset`), orgId and role (invites), expiresAt, usedAt.
- `loginAttempt`: email, attemptedAt, ok — for the lockout rule.

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
| insuranceRenewsOn | date, null | anchors the insurance renewal item |
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
| templateKey | text, null | which default checklist entry it came from (§6) |
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

**Rules** — one implementation in `src/shared/compliance.ts`, used by the API, the screens and the reminder emails:
- `lastDone` = latest *complete* occurrence's `doneOn`. A *partial* occurrence (a monthly light test with lights not all ticked) never advances the date.
- `nextDue` = `nextDueOverride` ?? anchored date ?? `lastDone + frequencyMonths`. Recording a complete occurrence clears the override.
- Anchored items (APCM, insurance renewal) work in windows: each anchor date covers the `frequency` before it, so a churchwardens' inspection in March counts for the April APCM. `nextDue` is the earliest anchor date whose window opens on or after `lastDone`; with no `lastDone` it is the anchor date itself. With no anchor date set, it falls back to `lastDone + frequency`.
- `status` = `overdue` (today after nextDue), `due_soon` (0–90 days), `on_track`, or `not_recorded` when there is no record and no anchor (shown as "No record yet", never as overdue, and never reminded about). "Today" is in the organisation's time zone.
- `missingEvidence` = latest complete occurrence is not a self-check and has no `documentId`.
- Items are never deleted: removing one sets `active = false` so its history stays.

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
Awaiting invoice = done, cost above zero, no invoice document (unpaid visits and volunteer work don't wait for one).

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

Frequencies are starting guidance and editable per item.

---

## 7. AI touchpoints (exactly three)

All server-side, all logged in `aiCall`, none on the request hot path (Queues).

1. **QI report reading.** PDF in (text layer, or page images for scans). JSON out: items with ref, text, location, band, estimate low/high, page, and per-field confidence. Run once per upload; raw output stored on `qiReport.rawExtraction`; a human reviews before tasks become live. Regression suite of real reports from several inspectors, run on every model or prompt change.
2. **Document reading.** Invoices, certificates, insurance schedules: type, date, contractor, amount, next due. Shown as pre-filled fields with a source snippet; nothing saved until a person confirms.
3. **In-app assistant** — later, behind a feature flag. Questions over the building's own records only, answers cite records, capped per church per month.

Cost cap: configurable monthly ceiling per organisation; when reached, extraction queues and the user is told.

---

## 8. Reminders

Cron triggers at 06:00 and 07:00 UTC; the job acts only when it is 07:00 in Europe/London, so it runs once a day in both GMT and BST. For each building, email recipients (parish-role members with `membership.receivesReminders`, set by the PCC admin in Settings) about items 60, 30 and 7 days before `nextDue`, on the first day overdue, then weekly while overdue. One email per building per day grouping all items, guaranteed by a unique (building, day) row in `reminderLog`. Recording an occurrence advances `nextDue` and stops reminders. Email wording matches on-screen wording (`statusLabel`).

---

## 9. Milestones

Each milestone is shippable to the pilot churches before the next starts. Front-end steps refer to UI-HANDOFF §16.

| # | Milestone | Includes | UI-HANDOFF steps |
|---|---|---|---|
| M1 | Foundations | Repo, Worker, D1, R2, Drizzle schema and migrations, tenancy repository layer + tests, password auth with invites and reset, roles, audit, tokens and shared components with `/components` page | 1, 2 |
| M2 | Compliance calendar | Building profile, seeding, occurrences, document upload, status rules (tests first), month strip, daily reminders. The calendar's export is the browser's print / save as PDF with a print stylesheet; server-rendered PDFs arrive with M5 | 3 |
| M3 | Jobs, contractors, documents, dashboard | Job log (planned and done, paperwork, awaiting-invoice flag, yearly spend; a job can also record a compliance check), organisation-wide contractor book, documents list with expiry and where each is used, draft logbook entries approved by churchwardens, church dashboard with setup steps for a new building | 4, 5 |
| M4 | Quinquennial | **Built 6 Nov 2026 with manual entry:** upload, review step (report in `review`, items typed in), publish (newer inspection becomes `current`, older filed as `previous`), task table grouped by band/location/trade, permission flags, waiting-on links, done only via a logged job, routine (M) items onto the calendar, the inspection recorded on the calendar with the report as evidence. **Still to do:** queued AI extraction into the same review step (Claude Haiku 5.5 first, Sonnet 5.5 for low-confidence reports), page images beside flagged items, the extraction test suite of real reports, and "Get quotes" emails to contractors | 6 |
| M5 | Annual fabric report | **Built 7 Nov 2026:** builder with live preview from one shared text function, draft saved per year, suggested matters confirmed or left out (never exported unconfirmed), terrier confirmation, Word and PDF exports (footer, signature block, logbook appendix) each saved to Documents | 7 |
| M6 | Phone and offline | **Built 7 Nov 2026:** under 800 px the dashboard becomes This week (needs doing, monthly light test as a tick list saving partial results, four quick-log buttons, confirmation panel). Photos resized to 2,000 px before upload. Offline: last-known copies of the session, building and This week data in localStorage; ticks, jobs, photos and documents queue in IndexedDB and send when the connection returns; a service worker keeps the app shell. Sign-out clears the phone's copies and queue (warning first if anything is unsent). Known limit: if a request reaches the server but the reply is lost, the retry can save it twice | 8 |
| M7 | Estates console and document reading | **Estates console built 7 Nov 2026:** overview with pastoral area filter, four totals, five-year survey cycle, suggested programmes (same check due within 120 days at 5+ churches, priced from typical cost bands in `repo/estates.ts`, to be replaced with the diocese's own rates), Build tender sheet with schedule download and saved programmes, churches table, buildings / surveys / backlog / spend / contractors / reports / users pages, board report CSV, estates notes private to the diocese until shared. **Still to do:** document reading and the AI usage meter (with the AI work in M4), "Not sharing records" for parishes that haven't granted access, diocese-instructed jobs | 9, 10 |

---

## 10. Open points

- Decided 6 Nov 2026 (M2): items with no record show "No record yet" rather than overdue; anchored items use the window rule in §5.
- Decided 6 Nov 2026: Hono, React, Brevo, Browser Rendering, inspector role, items 15–16; login changed to passwords.
- Which inspecting architects' reports form the extraction test suite.
- Pilot PCCs to sign the data and ownership agreement before real documents are uploaded.
- Final product name.
