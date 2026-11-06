# Church buildings platform — design handoff for build

Nov 6, 2026 · @Mack Deptula

## Purpose

This is the front-end handover for the church buildings platform: what each screen shows, how it behaves, and what data it needs, written so Claude Code can build it against the SPEC.md produced on 26 October 2026 without guessing. SPEC.md stays the source of truth for the stack (Cloudflare Workers, D1, R2, Drizzle), the data model and the security and tenancy rules; this document adds the user interface on top and names where the two must agree.

Use it in three ways. Drop an exported Markdown copy into the repository as `docs/UI-HANDOFF.md` beside SPEC.md and point Claude Code at both. Build the shared components in section 6 first, because every screen is assembled from them. Treat every figure, church name and contractor in the mockups as illustrative; only St Peter and St Paul and St John the Evangelist, Fareham, are real.

The mockups themselves live on the design canvas at https://claude.ai/artifact/8jBJmS99wetVgcv3fHQWWj. Each artboard is self-contained HTML with inline styles, so the exact spacing and colours can be read straight from the source if a measurement here is ambiguous.

## What already exists and what has been decided

The build starts from an approved spec, a set of mockups and five decisions that constrain the front end.

| Item | Where | What it fixes |
| --- | --- | --- |
| SPEC.md (26 Oct 2026) | Repository | Stack, data model (organisations, buildings, documents, compliance items, QI reports, tasks, jobs, contractors), seven build milestones, 16-item default compliance checklist, tenancy and security rules |
| Design canvas, six artboards | https://claude.ai/artifact/8jBJmS99wetVgcv3fHQWWj | Layout, copy, colours, states for the screens in sections 7 to 12 |
| Decision: AI runs server-side on the product's own account | Chat, 6 Nov 2026 | No user-supplied keys or AI sign-in in v1; AI is used only at the points in section 15 and never on the hot path |
| Decision: product is not called a "building management system" | Chat, 6 Nov 2026 | The Church of England's national Building Management Portal (live 6 Oct 2026) owns that name; "Fabric" is the placeholder wordmark and must be a config value, not hard-coded |
| Decision: scope of v1 | Chat, 26 Oct and 6 Nov 2026 | Church-side records, compliance calendar, QI task list, job log, contractor address book, annual fabric report, multi-building console. No contractor accounts, quoting, payments, collective purchasing or Maintenance Days |
| Decision: pilot customers | 26 Oct 2026 | Two churches now, a third planned; each PCC's data walled off from the others from day one |
| Decision: diocesan console is in scope | Chat, 6 Nov 2026 | Added after research found a diocesan estates team in Hampshire doing this work by hand; it reuses the church screens with an organisation layer above them |

## Information architecture

There are two shells over one data model: a church shell with nine sections, and an estates shell that aggregates many churches and opens any of them in the church shell. Every route is scoped to an organisation and a building, and the building switcher in the sidebar changes the building without leaving the current section.

| Screen | Route | Shell | Who uses it | Mockup |
| --- | --- | --- | --- | --- |
| Church dashboard | `/b/:buildingId` | Church | Churchwarden, treasurer, incumbent, parish administrator | Artboard 1 |
| Building profile | `/b/:buildingId/building` | Church | Churchwarden, administrator | Not drawn; a form over the building record (listing grade, inspector, insurer, architect, key contacts) |
| Compliance calendar | `/b/:buildingId/compliance` | Church | Churchwarden, fabric volunteer | Artboard 2 |
| Quinquennial | `/b/:buildingId/quinquennial` | Church | Churchwarden, fabric committee, inspecting architect (read-only) | Artboard 3 |
| Jobs and spend | `/b/:buildingId/jobs` | Church | Churchwarden, treasurer | Not drawn; the Recent jobs table from artboard 1 as a full page with filters and a job form |
| Documents | `/b/:buildingId/documents` | Church | All church roles | Not drawn; a list grouped by document type with expiry dates and upload |
| Contractors | `/b/:buildingId/contractors` | Church | Churchwarden | Not drawn; address book, one card per contractor, jobs they have done |
| Reports | `/b/:buildingId/reports` | Church | Churchwarden, PCC secretary | Artboard 4 (annual fabric report); other exports listed below it |
| Settings | `/b/:buildingId/settings` and `/org/:orgId/settings` | Church | PCC admin | Users, roles, reminder recipients, product name display |
| Estate overview | `/org/:orgId` | Estates | Diocesan building surveyor, estates coordinator | Artboard 5 |
| Estate sections | `/org/:orgId/buildings`, `/surveys`, `/backlog`, `/programmes`, `/spend`, `/contractors`, `/reports`, `/users` | Estates | Estates team | Not drawn; each is a filtered table over the same records |
| Phone home | Responsive view of `/b/:buildingId` under 768 px | Church | Churchwarden on site | Artboard 6 |

The estates shell appears only when the signed-in user's organisation has more than one building or the role `estates`. A parish user in a diocese that also uses the product never sees the estates shell; the diocese sees the parish's building with its own notes layered on top, as the row footnote on artboard 5 says.

## Design tokens

Define these as CSS custom properties on `:root` and reference the token, never the hex, in components. Every text and background pair below passes 4.5:1; the status and priority colours differ in lightness as well as hue so they still read in greyscale.

| Token | Value | Usage |
| --- | --- | --- |
| `--ground` | #F4F3EF | Page background, inset panels inside cards |
| `--surface` | #FFFFFF | Cards, tables, inputs |
| `--border` | #DDD9D0 | Card and input borders, phone tab bar top |
| `--rule` | #EEECE6 | Row dividers, progress track |
| `--ink` | #1C1D1F | Body text, headings |
| `--ink-muted` | #5A5F66 | Secondary text, table headers, captions (6.5:1 on surface) |
| `--brand-900` | #163F33 | Sidebar and phone header background |
| `--brand-700` | #1E5B48 | Primary buttons, active nav item, links, progress bars; the only tweakable accent |
| `--brand-800` | #174A3A | Primary button and link hover |
| `--brand-200` | #BFD3CA | Secondary text on brand-900 |
| `--danger-text` / `--danger-bg` | #A8321F / #FBE9E5 | Overdue pills, priority A, overdue survey |
| `--warn-text` / `--warn-bg` | #8A5A00 / #FBF0D9 | Due soon pills, priority B, drafts, missing evidence |
| `--info-text` / `--info-bg` | #1E4E8A / #E4ECF7 | Priority C, permission flags (List B, Faculty), in progress |
| `--ok-text` / `--ok-bg` | #1E6B3A / #E3F2E7 | On track, entered, completed, routine maintenance |
| `--neutral-bg` | #EEECE6 | Priority D, not started |
| `--font-ui` | Inter, system-ui, sans-serif | Everything except the report preview |
| `--font-report` | "Source Serif 4", Georgia, serif | Annual fabric report preview and exports only |
| `--text-xs` | 11px / 500 | Phone tab labels only |
| `--text-sm` | 12px / 600, uppercase, 0.04em | Table headers, pills, captions |
| `--text-base` | 13px / 400 | Secondary lines, filters |
| `--text-md` | 14px / 400 or 600 | Body, table cells, buttons, nav |
| `--text-lg` | 16px / 600 | Card headings |
| `--text-xl` | 20px to 22px / 700 | Phone page title, wordmark |
| `--text-2xl` | 26px / 700, -0.01em | Page title |
| `--text-stat` | 34px / 700, line-height 1 | Stat tile number |
| `--space-1` to `--space-6` | 4, 8, 12, 16, 20, 24px | Gaps and padding; cards pad 20, main pads 32 top and 36 sides, sections gap 24 |
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill` | 6 / 8 / 12 / 999px | Thumbnails / buttons, inputs, nav items / cards / pills and chips |
| Shadow | none | Cards are separated by border and ground, not shadow |

Fonts: self-host Inter 400 to 700 and Source Serif 4 400 and 600 as woff2 rather than loading from Google Fonts, so the app works for churches with content blockers and offline on site.

## Layout and responsive behaviour

The shell is a wrapping flex row: a 240 px sidebar and a main column that grows, with the main column dropping below the sidebar under 800 px. Content inside the main column uses CSS grid with equal tracks, and every table scrolls horizontally inside its card rather than widening the page.

| Breakpoint | Shell | Grids | Tables and actions |
| --- | --- | --- | --- |
| Desktop, 1200 px and up | Sidebar fixed at 240 px, main column fluid with no max width; page title row and action buttons on one line | Stat tiles 4 columns; dashboard body 3 columns (2 + 1); fabric report 2 columns; estates body 3 columns (1 + 2) | Full tables; action buttons inline in rows |
| Tablet, 800 to 1199 px | Same shell; action buttons wrap under the title | Stat tiles 2 columns; dashboard and estates bodies 1 column with the side panel below; fabric report 1 column with the preview below the builder | Tables scroll inside `overflow-x: auto`; the Phone artboard is not used here |
| Phone, under 800 px | Sidebar collapses to a top bar with the wordmark, building name and a menu button; the nine sections become a bottom tab bar of four (Home, Calendar, Log, Documents) with the rest under More | Everything 1 column; stat tiles become a 2 x 2 grid with 28 px numbers | Row action buttons move under the row text; the dashboard is replaced by the This week layout of artboard 6 |

Measurements that matter: nav items are 44 px tall with 12 px horizontal padding and 8 px radius; the active item has `--brand-700` background and 600 weight; the building switcher is a native select styled 14 px with 10 by 12 px padding. Page title block has 6 px between title and subtitle; sections are 24 px apart; cards pad 20 px with 12 to 14 px internal gaps; table cells pad 12 px with a `--rule` bottom border and the last row borderless. The phone root is 390 by 844 with the header padding 20 px, content padding 16 px, and the tab bar at 56 px minimum with 22 px icons and 11 px labels.

Why the sidebar is not sticky and never 100vh: churchwardens on a tablet at the back of church scroll long tables, and a sticky 100vh sidebar traps the scroll and breaks the phone stack.

## Shared components

Twelve components build every screen; build them first, with their states, and the screens become composition. Props are listed with their types; anything not listed is static.

| Component | Props | Variants and states | Notes |
| --- | --- | --- | --- |
| `Sidebar` | `shell: church or estates`, `buildings[]`, `activeBuildingId`, `activeSection`, `user` | Church shell shows wordmark, tagline, building select and nine links; estates shell shows the organisation card instead of the select and nine estates links; collapses to top bar under 800 px | Footer line shows role and next APCM date (church) or role and team (estates) |
| `PageHeader` | `title`, `subtitle`, `actions[]` | Actions wrap under the title under 1200 px | Subtitle is one line of facts separated by middle dots |
| `Button` | `variant: primary, secondary, ghost`, `size: md, sm`, `loading`, `disabled`, `href` | Primary: brand-700 fill, white text, hover brand-800; Secondary: surface fill, border, hover ground; Small: 9 by 14 px padding, 13 px text | Loading replaces label with a 16 px spinner and keeps width; an `href` renders an anchor styled as the button |
| `StatTile` | `label`, `value`, `tone: default, danger, warn`, `caption` | Tone colours the 34 px number only | Value is text, so £6,420 and 1,284 arrive formatted |
| `Pill` | `tone: danger, warn, info, ok, neutral`, `label` | 12 px 600, 4 by 10 px padding, pill radius, `white-space: nowrap` | Used for status, priority band, permission and logbook state |
| `Card` | `title`, `link {label, href}`, `caption` | Header row with title left and link right | 12 px radius, border, 20 px padding |
| `DataTable` | `columns[] {key, label, align, nowrap}`, `rows[]`, `groupBy`, `emptyMessage`, `footer` | Group header rows are 13 px 700 in the band colour (QI table); numeric columns right-aligned; last row borderless | Always wrapped in an `overflow-x: auto` box; header cells 12 px uppercase muted |
| `FilterChips` | `options[] {label, count}`, `selected`, `onChange` | Selected chip brand-700 fill; others surface with border; `aria-pressed` | Counts are part of the label |
| `AttentionRow` | `pill`, `title`, `detail`, `action {label, href or onClick}` | Pill left, two-line text centre, action right; on phone the action drops below | Used on the dashboard, the estates programmes list and the phone Needs doing card |
| `ProgressBar` | `value 0 to 100`, `tone`, `label`, `rightLabel` | 8 px track in `--rule`, fill in the tone colour; 10 px in the estates survey cycle | No animation on load |
| `MonthStrip` | `months[] {label, count, tone}` | 12 equal cells, 10 by 6 px padding, count 20 px 700 coloured by tone | Clicking a month filters the table below |
| `Form` controls | `Input`, `Select`, `Textarea`, `DateInput`, `Checkbox`, `FileDrop` | Labels 13 px muted above the control; controls 14 px with 10 by 12 px padding, 8 px radius, border; focus ring 2 px brand-700 outside the border | Checkbox rows on phone are 44 px tall with a 20 px box |

Icons are 18 px inline stroke SVGs at 2 px stroke in the sidebar and 20 to 22 px on phone buttons and tabs, drawn from one icon set (Lucide is a fit) and marked `aria-hidden` when a label sits beside them.

## Screen 1: church dashboard

The dashboard answers one question in the first screenful: what does this building need from me before the next PCC meeting. It is the landing page for every church role and the page the phone layout is derived from.

**Layout, top to bottom.** `PageHeader` with the building name, a subtitle built from listing grade, diocese, last QI date and next QI due, and three actions: Upload a document (secondary), Log a job (secondary), Annual fabric report (primary, links to Reports). Then four `StatTile`s. Then a 3-column grid: `Card` Needs attention spanning two columns, `Card` Quinquennial progress in the third. Then `Card` Recent jobs with a `DataTable`.

| Element | Content | Data and rules |
| --- | --- | --- |
| Stat: Overdue | Count, danger tone, caption lists up to two item names | Compliance items where `nextDue < today` and no evidence after `lastDone`; caption truncates with "and 1 more" |
| Stat: Due in the next 90 days | Count, warn tone, caption "Next: item, date" | Items with `nextDue` within 90 days, excluding overdue |
| Stat: Open quinquennial actions | Count, caption "n priority A · done of total completed" | Tasks from the current QI report with status not Done |
| Stat: Spend this year | Sum formatted as £ with thousands separator, caption "n jobs logged · n awaiting invoice" | Jobs with `date` in the current calendar year; awaiting invoice = job without an invoice document |
| Needs attention | Up to five `AttentionRow`s: overdue compliance first, then due within 60 days, then open priority A tasks | Each row's action depends on type: Book contractor, Record review, Start review, Accept quote (when a quote document exists), Open task |
| Quinquennial progress | Five `ProgressBar`s A, B, C, D, M with "done of total"; footer panel with the summed inspector estimate range and the count needing permission | Band M shows "On the calendar" and 100% because routine items are converted to compliance items on import |
| Recent jobs | Last four jobs: date, job, contractor, cost right-aligned, paperwork, logbook `Pill` | Paperwork lists linked document types; a missing invoice shows warn text; logbook Entered when the job has a logbook entry, Draft otherwise |

**Interactions.** Stat tiles link to the filtered view they describe (Overdue opens the calendar with the Overdue chip selected). Row actions open a side sheet, not a new page, so the warden keeps their place. The building switcher reloads the dashboard for the chosen building and remembers the choice per user.

**Why the summed estimate is shown as a range.** Inspecting architects give bands, not quotes; a single figure would be read by a PCC as a price.

## Screen 2: compliance calendar

The calendar is the engine of the product: every recurring check with its frequency, last date, next date and the evidence that proves it, and the source of every reminder email. It needs no AI.

**Layout.** `PageHeader` (title, one-line explanation, Export to PDF secondary, Add a recurring item primary). `Card` Next twelve months holding a `MonthStrip`. `Card` with `FilterChips` (All, Overdue, Due in 90 days, On track, Missing evidence, each with a count) and a `DataTable` of items.

| Column | Content | Rule |
| --- | --- | --- |
| Item | Name, 600 weight | From the compliance item record |
| Frequency | Plain words: Monthly, Twice yearly, Yearly, Every 3 years, Every 5 years, Yearly before APCM | Stored as months plus an optional anchor (APCM, insurance renewal) |
| Last done | Date, `nowrap` | Latest completed occurrence |
| Next due | Date, `nowrap` | `lastDone + frequency`, or the anchor date; editable per item |
| Evidence on file | Document type and year, or a named person for self-checks | Warn text "Certificate not uploaded" when the occurrence is complete but no document is linked |
| Status | `Pill`: Overdue n days (danger), Due in n days (warn, within 90), On track (ok) | Computed server-side so emails and screen agree |
| Action | Context button: Book contractor, Record review, Start review, Accept quote, Upload; empty when on track | Opens a side sheet |

**Default checklist on creating a building.** Seed these 14 items (SPEC.md lists 16; the two extras are lift inspection and legionella assessment, added only when the building profile says it has a lift or a hall with water systems): lightning protection test (yearly), asbestos register review (yearly), fire risk assessment review (yearly), fire extinguisher service (yearly), emergency lighting monthly flick test (monthly) and annual duration test (yearly), gutters and rainwater goods (twice yearly), gas boiler service (yearly), portable appliance testing (yearly), electrical installation condition report (every 5 years), insurance renewal (yearly, anchored), churchwardens' annual fabric inspection (yearly before APCM), tree survey (every 3 years), quinquennial inspection (every 5 years). Each has a one-line note of who normally does it, which the row shows on hover and the side sheet shows in full.

**Reminders.** Email the reminder recipients 60, 30 and 7 days before `nextDue` and on the day it becomes overdue, then weekly while overdue; one email per building per day, grouping all items. Recording an occurrence with a document clears the reminders and advances `nextDue`.

**Interactions.** Clicking a month in the strip selects that month as a filter and shows a chip for it. Adding a recurring item opens a side sheet with name, frequency, anchor, last done, who does it, and a document upload. Frequencies can be edited per item; the change is logged with who made it.

## Screen 3: quinquennial report to task list

This screen turns a 40-page PDF into a task list that survives five years, and it is the product's main differentiator. The extraction is the one place AI touches a warden's data, so the review step is built in rather than bolted on.

**Layout.** `PageHeader` (Export task list secondary, Upload a new report primary). A 3-column grid: `Card` Current report (one column) with a PDF thumbnail, title, inspector, date, page count, recommendation count, next due, a green status panel and links to the previous report and to the terrier and logbook; `Card` Where things stand (two columns) with five band tiles and a note that bands are the inspector's own. Below, a `Card` with `FilterChips` (Open, Completed, Needs permission, Quoted), a Group by select (Priority, Location, Trade) and a `DataTable` grouped by band.

| Column | Content | Rule |
| --- | --- | --- |
| Ref | Inspector's item number plus a `p.n` link | Link opens the PDF at that page in a side panel; the page number comes from extraction |
| Recommendation | Inspector's wording, 600 weight | Never paraphrased by the system; wardens may edit and the original stays visible |
| Location | Short place name | Extracted; editable |
| Inspector's estimate | Range text right-aligned, or "Investigation first" | Extracted when the report gives figures; blank otherwise, never invented |
| Permission | `Pill` info for List B or Faculty; muted text for List A, Like for like, To be confirmed | Set by the warden or the DAC; the system only suggests from the task's trade and the building's listing, and marks a suggestion as such |
| Status | `Pill`: Not started (neutral), In progress (info), Quote received (warn), Waiting on x (neutral), Done (ok) | Done requires a job log entry; Waiting on links to another task |
| Action | Open, Get quotes | Get quotes opens a side sheet to request quotes from the address book by email, which is the whole of v1's contractor feature |

**Upload and extraction flow.** 1. Warden uploads the PDF; the file is stored and a QI report record created with status Reading. 2. Extraction runs server-side and returns items with ref, text, location, band, estimate, page. 3. The card shows Reading with a progress line, then "n items need checking" in warn tone when any item has band or page confidence below the threshold. 4. The warden opens Review, sees each flagged item beside its page image, and confirms or corrects. 5. Items with band M are offered for conversion to recurring compliance items with a suggested frequency. 6. Report status becomes Current and the previous report becomes Previous, keeping its completed tasks.

**Priority bands.** Store the inspector's own band letter and description verbatim; map to the five colours by position only (first band danger, second warn, third info, fourth neutral, routine ok) because dioceses and architects use different schemes.

**Why wardens never see an unreviewed task list as final.** One missed priority A roof item would end trust in the product; the review step costs ten minutes once every five years.

## Screen 4: annual fabric report

The report is the statutory output every churchwarden owes the APCM, drafted from records the warden already keeps in the product. The warden writes two short paragraphs; everything else is assembled from data and can be edited before export.

**Layout.** `PageHeader` (Save draft, Export Word, Export PDF primary). A 2-column grid. Left column, three `Card`s: 1 Inspection details (report year select, inspection date, inspected by, accompanied by); 2 Condition summary (a `Textarea` with a Draft, please edit pill and the warden's assessment); Sections filled from the records, a checklist of sections 3 to 7 each with a numbered badge (ok tone when complete, warn when it needs confirmation) and a right-aligned fact. Right column, one `Card` styled as paper: 36 by 40 px padding, `--font-report`, a Preview label, the report title, parish and year, then sections 1 to 7 as they will export.

| Section | Source | Draft rule |
| --- | --- | --- |
| 1 Inspection | Form fields on the left | Sentence template citing Canon F13 and the Care of Churches Measure, with the date and names inserted |
| 2 Condition | Warden's own words | Pre-filled with a plain template only; no AI drafting in v1 (see section 15 for the optional later step) |
| 3 Works carried out | Jobs in the report year | One paragraph: count and total cost, then the four largest jobs with month, contractor and cost, then "and n smaller items" |
| 4 Quinquennial | Current QI report and tasks | Report date, done of total, open priority A items by name with their status |
| 5 Statutory and insurance checks | Compliance items | "n of m in date"; names overdue items and whether booked |
| 6 Matters for the PCC | Suggested from open priority A tasks, overdue items and permission needs | Shown as suggestions the warden confirms or deletes; nothing goes to export unconfirmed |
| 7 Terrier, inventory and logbook | Logbook entries in the year | Count of entries and a confirmation sentence the warden ticks |

**Exports.** Word (.docx) and PDF, A4, body 12 pt serif, headings 14 pt 600, with a footer "Generated from records held in \[product name\] · Signed by the churchwardens", a page 2 appendix listing the year's logbook entries, and a signature block. Export regenerates from current data at the moment of export and saves a copy to Documents with the year.

**Logbook entries.** Every completed job with a document creates a draft logbook entry (date, work, who, cost, faculty or List B reference if any); the warden approves them in the Jobs section, and the count on this screen is approved entries only.

## Screen 5: diocesan estates console

The console gives one building surveyor the state of 136 buildings on one screen, using the same records each parish keeps, so a diocese is one customer rather than 136. It is the church shell with an organisation layer above it, not a separate product.

**Organisation model.** An organisation has a type (parish, diocese, circuit, trust) and may contain child organisations and buildings. A diocese organisation contains pastoral areas (child organisations) which contain parishes which contain buildings. A parish can belong to a diocese organisation without the diocese being able to edit its records; the diocese reads and adds its own notes, which live on the diocese side and are never shown to the parish unless shared. SPEC.md's organisation table needs `parentId`, `type` and a `visibility` rule for notes to support this.

**Layout.** `Sidebar` in estates shell with an organisation card (name, building count, area count) and nine estates links. `PageHeader` with a Pastoral area select and a Board report primary button. Four `StatTile`s. A 3-column grid: `Card` Survey cycle (one column) with a `ProgressBar` per year showing surveys due, and a footer note; `Card` Suggested programmes (two columns) with `AttentionRow`s. Below, `Card` Churches needing attention first with a `DataTable`.

| Element | Content | Data and rules |
| --- | --- | --- |
| Stat: Overdue checks | Count, danger; caption with church count and the most common item | Sum of overdue compliance items across buildings in the filter |
| Stat: Certificates lapsing this quarter | Count, warn; caption by document type | Documents with expiry in the current quarter |
| Stat: Open survey actions | Count; caption with A and B counts | Open QI tasks across buildings |
| Stat: Backlog at surveyors' estimates | Sum of the midpoint of estimate ranges, formatted £n.nm; caption with change since 1 January and the share by trade | Midpoint is used for sums and labelled as such on hover |
| Survey cycle | One bar per year for five years; a year with overdue surveys is danger-toned; right label "n due" or "n overdue" | QI reports where `nextDue` falls in that year; bar length relative to the largest year |
| Suggested programmes | Compliance items of the same type due within one window across several buildings, grouped: title, church count and area, estimate range, Build tender button | Grouping rule: same item type, due within 120 days, 5 or more buildings; estimate = sum of typical cost bands set per item type. Build tender opens a side sheet listing the buildings and dates and exports a schedule; it does not contact contractors in v1 |
| Churches table | Church, pastoral area, listing, overdue checks (danger when above 0), open A / B, backlog, survey due `Pill`, parish contact | Sorted by priority A count then overdue; each row opens the church dashboard in the estates shell with a back link |

**Roles.** `estates_admin` edits organisation settings and users; `estates` reads everything and writes notes and programmes; parish roles are unchanged. A diocese user instructing a survey or a job for a parish building records it as the diocese's job, flagged on the parish's job log as instructed by the diocese.

**Why programmes stay inside the console in v1.** Grouping work is the one marketplace-adjacent feature the research supports now, because the buyer and the demand are both in the room; sending tenders to contractors is phase 2.

## Screen 6: warden on the phone

On a phone the product is for doing, not reading: tick the monthly test, photograph a problem, log a job while the contractor is still in the car park. It is the responsive layout of the church dashboard under 800 px, not a separate app, so it ships with the first release.

**Layout.** Brand-900 header with product name and church on one 12 px line and This week at 20 px 700. Scrolling content at 16 px padding with four cards. Fixed bottom tab bar with Home, Calendar, Log, Documents.

| Card | Content | Behaviour |
| --- | --- | --- |
| Needs doing | Up to three `AttentionRow`s with a 10 px coloured dot instead of a pill, two lines of text, and a small action button where one applies | Same selection as the dashboard's Needs attention; tapping the row opens the item's sheet |
| Monthly emergency lighting test | Title, due pill, one line of instruction, a `Checkbox` per emergency light fitting at 44 px row height, a primary button whose label counts progress ("Record test, 2 of 5 so far") | Fittings come from the building profile; the button saves a partial result and the occurrence completes when all are ticked; the same pattern serves any monthly self-check |
| Log something now | 2 x 2 grid of 64 px buttons: Photo of a problem, Invoice or certificate, Job done, add cost, Contractor visited | Photo opens the camera and creates a draft job with the image; Invoice opens the camera or file picker and runs document reading; Job done opens the job form; Contractor visited logs a visit against a contractor |
| Confirmation | Ok-toned panel describing the last thing the system did for this building | Replaces a toast; stays until the next action |

**Gestures and offline.** No swipe gestures in v1; everything is a tap. Draft jobs, photos and checklist ticks queue locally when there is no signal inside a thick-walled church and sync when the connection returns, with a muted "Saved on this phone, will upload" line on the item.

**Camera uploads.** Photos are resized to 2,000 px on the long edge before upload and stored in R2 against the job; the original is not kept.

## States and edge cases

A new church has no data for weeks, a listed church has a backlog that never empties, and the inspector's PDF may be a 2014 scan. Each screen must look finished in all three cases.

| Element | State | Behaviour |
| --- | --- | --- |
| Primary and secondary `Button` | Hover | Background brand-800 (primary) or ground (secondary), 120 ms ease-out; no movement |
| `Button` | Focus | 2 px brand-700 ring outside the border |
| `Button` | Loading | Label replaced by a spinner, width held, `aria-busy` |
| `Button` | Disabled | 50% opacity, no pointer |
| Nav link | Hover | Background rgba(255,255,255,0.08) on brand-900 |
| Table row | Hover | Background ground; whole row is not clickable, the Open button is |
| Side sheet | Open | Slides in from the right at 440 px over 180 ms, with a scrim; Escape closes; focus moves to the first field |
| Compliance item | Evidence missing after completion | Warn text in Evidence column; row still On track; counted in the Missing evidence chip |
| Stat tile | Zero | Shows 0 in ink colour with caption "Nothing overdue"; never hides |
| Dashboard | New building, no QI and no jobs | Needs attention shows the three setup steps as rows (Add your quinquennial report, Upload your insurance schedule, Add your contractors); Quinquennial progress card shows an Upload report button; Recent jobs shows "No jobs logged yet" with a Log a job button |
| Calendar | Empty | Cannot be empty after seeding; if all items are deleted show "Add a recurring item" panel |
| QI extraction | Reading | Card shows a progress line; the task table shows a skeleton of six rows |
| QI extraction | Partial confidence | "n items need checking" warn panel with a Review button; flagged rows carry a warn dot before the ref |
| QI extraction | Failed (scan unreadable, file not a QI) | Card shows a danger panel "We couldn't read this report" with Try again and Enter items by hand; the PDF is still stored and linked |
| QI extraction | Too many items (over 150) | Import in full; table pages at 50 with the group headers repeated |
| Document reading | Low confidence on a date | Field shows the read value with a warn outline and the source snippet; warden confirms before `nextDue` advances |
| Fabric report | Section 6 has unconfirmed suggestions | Export buttons stay enabled but the export omits unconfirmed lines and the badge stays warn |
| Estates console | A parish has not granted the diocese access | Row shows the church name, pastoral area and "Not sharing records" in muted text; no counts |
| Any page | Loading | Skeleton blocks in `--rule` matching the layout, 400 ms minimum to avoid flicker |
| Any page | Error | Inline danger panel with a plain sentence and a Try again button; no modal |
| Long text | Church names over 40 characters, recommendations over 300 | Names wrap to two lines in the sidebar and tables; recommendations show in full, never truncated, because the wording is the inspector's |
| Money | Values over £1m, ranges, blanks | £n.nm in estates stats, £n,nnn elsewhere, ranges as "£a to £b", blank cell when unknown |
| Dates | All | Day Month Year (14 Oct 2026), never numeric; relative days in pills only |

## Accessibility

Most churchwardens are over sixty and many use a tablet in poor light, so the bar is WCAG 2.1 AA with 14 px minimum body text and 44 px touch targets, and the whole product usable by keyboard.

- Focus order on every church page: skip link, building switcher, nav links in order, page actions left to right, then content top to bottom with each card's link after its heading and each row's action after its text.
- Every control is a real element: `<button>`, `<a href>`, `<input>` with a visible `<label>`, `<select>`; no click handlers on `div` or `span`. Icon-only buttons carry `aria-label`; decorative SVGs carry `aria-hidden="true"`.
- The active nav item has `aria-current="page"`; filter chips are buttons with `aria-pressed`; the month strip cells are buttons with `aria-label` of the month and count.
- Status is never colour alone: every pill carries its words, bars carry a "done of total" label, the phone's coloured dots sit beside the words Overdue or Due.
- Tables use `<th scope="col">`, caption text for the card heading, and a `<td>` for the action; group header rows are `<th scope="rowgroup">`.
- Side sheets trap focus while open, return focus to the opener on close, and announce their title via `aria-labelledby`.
- Reminder emails and in-app confirmations use the same wording so screen reader users hear what sighted users see.
- Reduced motion: when `prefers-reduced-motion` is set, side sheets and hover transitions switch to instant.
- Contrast checked pairs: ink on ground 14.8:1, muted on surface 6.5:1, muted on ground 5.9:1, white on brand-700 7.8:1, brand-200 on brand-900 7.0:1, danger text on danger background 5.6:1, warn 5.2:1, info 6.9:1, ok 5.5:1.

## Data each screen needs and where AI is used

Every screen reads from the SPEC.md entities; four fields and one table are new, and AI runs at exactly three points, all server-side on the product's account.

| Screen | Entities read | Derived server-side | Additions to SPEC.md |
| --- | --- | --- | --- |
| Dashboard | building, complianceItem, document, qiReport, task, job, logbookEntry | overdue count, due-90 count, open task counts by band, spend YTD, estimate sum, needs-attention list | `task.estimateLow`, `task.estimateHigh`, `task.pageNumber` |
| Compliance calendar | complianceItem, complianceOccurrence, document | status, next due, month counts, missing-evidence flag | `complianceItem.anchor` (APCM, insurance), `complianceItem.doneBy` text, `complianceOccurrence` table if SPEC.md stores only last done |
| Quinquennial | qiReport, task, document, contractor | band counts, permission suggestions, waiting-on links | `task.permission` (enum: none, listA, listB, faculty, tbc), `task.confidence`, `task.originalText`, `qiReport.status` (reading, review, current, previous) |
| Fabric report | all of the above plus report drafts | section 3 to 7 text, export files | `fabricReport` table: year, inspection fields, condition text, confirmed matters, exported document ids |
| Estates console | organisation tree, every building's records | cross-building aggregates, survey cycle, programme groups, backlog midpoint | `organisation.parentId`, `organisation.type`, `estatesNote` table, `programme` table (type, window, building ids, status) |
| Phone | same as dashboard plus checklist fittings | partial occurrence state | `building.fittings[]` for emergency lights and similar self-checks |

**AI touchpoints.** Three, and nothing else in v1.

1. QI report reading: input is the PDF (text layer, or page images for scans); output is a JSON list of items with ref, text, location, band, estimate low and high, page and a confidence per field. Run once per upload; store the raw output beside the reviewed items so corrections can be compared later. Keep a test suite of real reports from different inspectors and re-run it on every model or prompt change.
2. Document reading: for invoices, certificates and insurance schedules, read the document type, date, contractor, amount and next due date; show them as pre-filled fields with a source snippet; nothing is saved until the warden confirms.
3. In-app assistant (later, behind a flag): questions over the building's own records only ("what is overdue before the APCM"); answers cite the record they came from; capped per church per month.

**Cost and control.** Log every call with building, purpose, tokens and cost so cost per church per month is known before pricing the fourth church. Extraction and document reading are rare events costing pence; the assistant is the only feature that scales with use, so it carries the cap. Model and prompt versions are configuration, recorded on each stored output.

**Data protection.** The PCC is the controller, the product the processor and the AI provider a sub-processor using API terms with no training on customer data; name the provider in the privacy notice and the pilot agreement. Contractor contact details are personal data and sit under the same notice.

## Build order for Claude Code

Build in the order below, each step shippable to your own churches before the next starts; it follows SPEC.md's milestones and adds the front end at the point each milestone needs it.

1. Tokens and shared components (section 4 and 6) as a small library with a storybook-style page showing every variant and state, checked against the canvas before any screen is assembled.
2. Shell and building profile: `Sidebar` in both shells, `PageHeader`, routing, the building switcher, the building form, user roles and the responsive collapse.
3. Compliance calendar with seeding, occurrences, document upload, reminders and the month strip; this is the first screen a pilot church uses for real.
4. Jobs, contractors and documents pages, with the draft logbook entry on each completed job.
5. Church dashboard, assembled from steps 3 and 4.
6. Quinquennial: upload, extraction, review, task table, permission flags, routine items into the calendar; build the test suite of real reports first.
7. Annual fabric report builder, preview and Word and PDF export.
8. Phone layout: tab bar, This week, checklists, camera logging, offline queue.
9. Estates console: organisation tree, aggregates, survey cycle, programmes, notes and sharing rules.
10. Document reading and the usage meter; the assistant stays behind a flag.

**Starting prompt for Claude Code.** Paste after SPEC.md and this document are in the repository:

```markdown
Read SPEC.md and docs/UI-HANDOFF.md in full before writing code. SPEC.md governs stack, data model, tenancy and security; UI-HANDOFF.md governs every screen, component, token, state and the AI touchpoints. Where they disagree, stop and ask. Start with step 1 of the build order in UI-HANDOFF.md section 16: create the design tokens as CSS custom properties and the twelve shared components with all listed variants and states, plus a /components page that renders each one. Do not assemble any screen until the components page matches the mockups described in sections 4 to 6. Use the product name from configuration, never a literal. Write tests for the compliance status and next-due rules in section 8 before the calendar UI.
```

**Open points to settle in the first week.** Which inspecting architect's reports form the extraction test suite; whether the pilot churches' PCCs will sign the data and ownership agreement before any real document is uploaded; and which frontend framework SPEC.md names, since the tokens and components above are framework-neutral and should be implemented once in whatever it chose.
