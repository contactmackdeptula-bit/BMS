// The /components page (UI-HANDOFF §16 step 1): every shared component in every
// listed variant and state, to compare with the design canvas before screens are built.
// Figures are illustrative, taken from the mockups.
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, ProgressBar, Skeleton, StatTile } from "../ui/basics";
import { AttentionList, AttentionRow, DataTable, FilterChips, MonthStrip } from "../ui/data";
import { Checkbox, DateInput, FileDrop, Input, Select, Textarea } from "../ui/forms";
import { Sidebar } from "../ui/Sidebar";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-muted)" }}>{title}</h2>
      {children}
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>;

const MONTHS = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const COUNTS = [2, 3, 1, 0, 2, 2, 1, 1, 0, 1, 2, 3];

type Job = { id: string; date: string; job: string; contractor: string; cost: string; paperwork: ReactNode; logbook: ReactNode };
const JOBS: Job[] = [
  { id: "1", date: "28 Oct 2026", job: "Boiler annual service", contractor: "Portsdown Heating Ltd", cost: "£190", paperwork: "Gas safety certificate, invoice", logbook: <Pill tone="ok" label="Entered" /> },
  { id: "2", date: "9 Oct 2026", job: "Emergency lighting annual test", contractor: "Meon Valley Electrical", cost: "£240", paperwork: "Test certificate", logbook: <Pill tone="ok" label="Entered" /> },
  {
    id: "3",
    date: "22 Sep 2026",
    job: "Replace cracked slates, north aisle (QI item 2.4)",
    contractor: "Solent Heritage Roofing",
    cost: "£1,150",
    paperwork: <span style={{ color: "var(--warn-text)", fontWeight: 600 }}>Invoice missing</span>,
    logbook: <Pill tone="warn" label="Draft" />,
  },
];

type Task = { id: string; band: string; ref: string; text: string; estimate: string; permission: ReactNode };
const TASKS: Task[] = [
  { id: "a", band: "A · Urgent, within weeks", ref: "3.2", text: "Repoint open joints to south aisle parapet; loose coping stone to be re-bedded", estimate: "£2,500 to £4,000", permission: <Pill tone="info" label="List B" /> },
  { id: "b", band: "A · Urgent, within weeks", ref: "5.1", text: "Replace corroded rainwater hopper and downpipe, north-east corner of chancel", estimate: "£800 to £1,200", permission: <Pill tone="neutral" label="Like for like" /> },
  { id: "c", band: "B · Within twelve months", ref: "2.6", text: "Overhaul nave roof: refix slipped slates, renew lead flashings at tower abutment", estimate: "£3,000 to £5,000", permission: <Pill tone="info" label="List B" /> },
];

export function ComponentsPage() {
  const [chip, setChip] = useState("all");
  const [month, setMonth] = useState<string | null>(null);
  const [checked, setChecked] = useState(true);
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    document.title = "Components";
  }, []);

  return (
    <div className="shell">
<>
        <Sidebar
          shell="church"
          productName="Fabric"
          tagline="Church buildings, in order"
          user={{ name: "R. Hughes", role: "churchwarden" }}
          onSignOut={() => {}}
          buildings={[
            { id: "sp", name: "St Peter and St Paul, Fareham" },
            { id: "sj", name: "St John the Evangelist, Fareham" },
          ]}
          activeBuildingId="sp"
          activeSection="dashboard"
          apcmDate="2027-04-26"
        />

        <main className="main" id="main">
          <PageHeader
            title="Components"
            subtitle="Every shared component and state from UI-HANDOFF §6 and §13 · Figures are illustrative"
            actions={
              <>
                <Button>Upload a document</Button>
                <Button>Log a job</Button>
                <Button variant="primary">Annual fabric report</Button>
              </>
            }
          />

          <Section title="Button">
            <Row>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="primary" size="sm">
                Small primary
              </Button>
              <Button size="sm">Small secondary</Button>
              <Button variant="primary" loading>
                Saving
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button href="/components">Link as button</Button>
            </Row>
          </Section>

          <Section title="Pill">
            <Row>
              <Pill tone="danger" label="Overdue 23 days" />
              <Pill tone="warn" label="Due in 36 days" />
              <Pill tone="ok" label="On track" />
              <Pill tone="info" label="List B" />
              <Pill tone="info" label="Faculty" />
              <Pill tone="neutral" label="Not started" />
              <Pill tone="danger" label="Priority A" />
              <Pill tone="warn" label="Draft" />
            </Row>
          </Section>

          <Section title="StatTile">
            <div className="grid grid-4">
              <StatTile label="Overdue" value="2" tone="danger" caption="Lightning protection test, asbestos review" href="/components" />
              <StatTile label="Due in the next 90 days" value="5" tone="warn" caption="Next: fire risk assessment review, 12 Dec" />
              <StatTile label="Open quinquennial actions" value="14" caption="3 priority A · 30 of 44 completed" />
              <StatTile label="Spend this year" value="£6,420" caption="11 jobs logged · 2 awaiting invoice" />
            </div>
            <div className="grid grid-4">
              <StatTile label="Overdue (zero state)" value="0" tone="danger" caption="Nothing overdue" />
            </div>
          </Section>

          <Section title="Card, AttentionRow and ProgressBar">
            <div className="grid grid-3">
              <Card className="span-2" title="Needs attention" headingId="c-attn" link={{ label: "See the full calendar", href: "/components" }}>
                <AttentionList>
                  <AttentionRow
                    pill={{ tone: "danger", label: "Overdue 23 days" }}
                    title="Lightning protection system test"
                    detail="Last tested 14 Oct 2025 · Insurer expects at least every 4 years, annual recommended"
                    action={{ label: "Book contractor", onClick: () => {} }}
                  />
                  <AttentionRow
                    pill={{ tone: "warn", label: "Due 12 Dec" }}
                    title="Fire risk assessment annual review"
                    detail="Assessment dated 12 Dec 2025 · Review form ready to complete"
                    action={{ label: "Start review", onClick: () => {} }}
                  />
                  <AttentionRow
                    pill={{ tone: "danger", label: "Priority A" }}
                    title="Repoint south aisle parapet (QI item 3.2)"
                    detail="Inspector estimate £2,500 to £4,000 · Needs List B permission before work starts"
                    action={{ label: "Open task", onClick: () => {} }}
                  />
                </AttentionList>
              </Card>
              <Card title="Quinquennial progress" headingId="c-qi" link={{ label: "All actions", href: "/components" }} caption="Report of 14 May 2024 · 44 recommendations">
                <ProgressBar label="A · Urgent" rightLabel="0 of 3 done" value={0} tone="danger" />
                <ProgressBar label="B · Within 12 months" rightLabel="4 of 7 done" value={57} tone="warn" />
                <ProgressBar label="C · Before next inspection" rightLabel="13 of 18 done" value={72} tone="info" />
                <ProgressBar label="D · Desirable" rightLabel="5 of 9 done" value={56} tone="neutral" />
                <ProgressBar label="M · Routine maintenance" rightLabel="On the calendar" value={100} tone="ok" />
                <ProgressBar label="2027 surveys (estates, large)" rightLabel="31 due" value={45} tone="ok" large />
              </Card>
            </div>
          </Section>

          <Section title="FilterChips and MonthStrip">
            <Card title="Next twelve months" headingId="c-months">
              <MonthStrip
                selected={month}
                onSelect={setMonth}
                months={MONTHS.map((m, i) => ({
                  key: m,
                  label: m,
                  fullLabel: m,
                  count: COUNTS[i]!,
                  tone: i === 0 ? "danger" : COUNTS[i] === 0 ? "neutral" : i < 3 ? "warn" : "ok",
                }))}
              />
              <FilterChips
                label="Filter items"
                selected={chip}
                onChange={setChip}
                options={[
                  { value: "all", label: "All", count: 14 },
                  { value: "overdue", label: "Overdue", count: 2 },
                  { value: "soon", label: "Due in 90 days", count: 5 },
                  { value: "ok", label: "On track", count: 7 },
                  { value: "missing", label: "Missing evidence", count: 3 },
                ]}
              />
            </Card>
          </Section>

          <Section title="DataTable">
            <Card title="Recent jobs" headingId="c-jobs" link={{ label: "Job log", href: "/components" }}>
              <DataTable<Job>
                caption="Recent jobs"
                rows={JOBS}
                rowKey={(r) => r.id}
                columns={[
                  { key: "date", label: "Date", nowrap: true },
                  { key: "job", label: "Job" },
                  { key: "contractor", label: "Contractor" },
                  { key: "cost", label: "Cost", align: "right", nowrap: true },
                  { key: "paperwork", label: "Paperwork" },
                  { key: "logbook", label: "Logbook" },
                ]}
              />
            </Card>
            <Card title="Grouped by band" headingId="c-grouped">
              <DataTable<Task>
                caption="Quinquennial actions grouped by band"
                rows={TASKS}
                rowKey={(r) => r.id}
                groupBy={(r) => r.band}
                groupClassName={(g) => (g.startsWith("A") ? "group-danger" : "group-warn")}
                groupLabel={(g) => <span style={{ color: g.startsWith("A") ? "var(--danger-text)" : "var(--warn-text)" }}>{g}</span>}
                columns={[
                  { key: "ref", label: "Ref", nowrap: true },
                  { key: "text", label: "Recommendation" },
                  { key: "estimate", label: "Inspector's estimate", nowrap: true },
                  { key: "permission", label: "Permission" },
                ]}
                footer="Showing 3 of 14 open items."
              />
            </Card>
            <Card title="Empty table" headingId="c-empty">
              <DataTable caption="Empty" rows={[]} rowKey={() => ""} columns={[{ key: "a", label: "Date" }, { key: "b", label: "Job" }]} emptyMessage="No jobs logged yet" />
            </Card>
          </Section>

          <Section title="Form controls">
            <Card>
              <div className="form-grid">
                <Input label="Inspected by" defaultValue="R. Hughes and M. Patel, churchwardens" />
                <DateInput label="Date of churchwardens' inspection" defaultValue="2027-03-20" />
                <Select
                  label="Report year"
                  options={[
                    { value: "2026", label: "2026 (APCM 26 April 2027)" },
                    { value: "2025", label: "2025" },
                  ]}
                />
                <Input label="With a hint" hint="At least 10 characters." />
                <Input label="With an error" error="Enter a valid email address." defaultValue="not-an-email" />
                <Input label="Read only" readOnly defaultValue="Grade II* listed" />
                <Textarea className="full" label="Your assessment of the building this year" defaultValue="The building remains in fair condition overall." />
                <div className="full">
                  <Checkbox label="Nave, west door" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <Checkbox label="Chancel" />
                </div>
                <div className="full">
                  <FileDrop label="Upload a certificate or invoice" onFiles={(f) => setFiles(f.map((x) => x.name))} />
                  {files.length > 0 && <p className="muted">Chosen: {files.join(", ")}</p>}
                </div>
              </div>
            </Card>
          </Section>

          <Section title="Panels and loading">
            <ErrorPanel message="We couldn't load the calendar." onRetry={() => {}} />
            <Notice>Boiler service logged on 28 Oct. The next service is in the calendar for October 2027.</Notice>
            <Notice tone="warn">3 items need checking.</Notice>
            <div className="grid grid-4" aria-hidden="true">
              <Skeleton height={110} />
              <Skeleton height={110} />
              <Skeleton height={110} />
              <Skeleton height={110} />
            </div>
          </Section>
        </main>
</>
    </div>
  );
}
