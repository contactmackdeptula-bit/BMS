// Screen 3: quinquennial report to task list (UI-HANDOFF §9).
// Milestone 4: recommendations are typed in during the review step. AI reading
// will pre-fill the same review step later; nothing is final until published.
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { formatRangeText, parsePounds } from "../../shared/money";
import { api, ApiError } from "../api";
import { formatDate } from "../format";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, Skeleton, type Tone } from "../ui/basics";
import { DataTable, FilterChips } from "../ui/data";
import { DateInput, FileDrop, Input, Select, Textarea } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";
import { useChurch } from "./church";
import { JobSheet } from "./sheets";

type Report = {
  id: string;
  documentId: string;
  documentTitle: string | null;
  inspectedOn: string | null;
  inspectorName: string | null;
  pageCount: number | null;
  nextDueOn: string | null;
  status: "reading" | "review" | "current" | "previous" | "failed";
};
type Task = {
  id: string;
  ref: string;
  text: string;
  originalText: string;
  location: string | null;
  trade: string | null;
  band: "A" | "B" | "C" | "D" | "M";
  estimateLowPence: number | null;
  estimateHighPence: number | null;
  pageNumber: number | null;
  permission: "none" | "like_for_like" | "list_a" | "list_b" | "faculty" | "tbc";
  status: "not_started" | "quoted" | "in_progress" | "waiting" | "done";
  waitingOnTaskId: string | null;
  job: { id: string; title: string | null; doneOn: string | null } | null;
};
type Data = { reports: Report[]; report: Report | null; tasks: Task[]; canEdit: boolean; canWrite: boolean };

export const BANDS: { band: Task["band"]; label: string; short: string; tone: Tone }[] = [
  { band: "A", label: "A · Urgent, within weeks", short: "A · Urgent", tone: "danger" },
  { band: "B", label: "B · Within twelve months", short: "B · 12 months", tone: "warn" },
  { band: "C", label: "C · Before the next inspection", short: "C · Before next", tone: "info" },
  { band: "D", label: "D · Desirable", short: "D · Desirable", tone: "neutral" },
  { band: "M", label: "M · Routine maintenance", short: "M · Routine", tone: "ok" },
];
const PERMISSIONS = [
  { value: "tbc", label: "To be confirmed" },
  { value: "none", label: "None needed" },
  { value: "like_for_like", label: "Like for like" },
  { value: "list_a", label: "List A" },
  { value: "list_b", label: "List B" },
  { value: "faculty", label: "Faculty" },
];
const PERMISSION_LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.value, p.label]));
const STATUS: Record<Task["status"], { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  quoted: { label: "Quote received", tone: "warn" },
  waiting: { label: "Waiting", tone: "neutral" },
  done: { label: "Done", tone: "ok" },
};

const penceInput = (p: number | null) => (p == null ? "" : String(Math.round(p / 100)));
const fileUrl = (buildingId: string, documentId: string, page?: number | null) =>
  `/api/buildings/${buildingId}/documents/${documentId}/file${page ? `#page=${page}` : ""}`;

export function QuinquennialPage() {
  const { building } = useChurch();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [newReport, setNewReport] = useState(false);
  const reportParam = params.get("report");
  const openTask = params.get("task");

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get<Data>(`/buildings/${building.id}/quinquennial${reportParam ? `?report=${reportParam}` : ""}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [building.id, reportParam]);
  useEffect(() => void load(), [load]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const saved = async (m: string) => {
    setFlash(m);
    await load();
  };

  const report = data?.report ?? null;
  const reviewing = report?.status === "review";
  const task = data?.tasks.find((t) => t.id === openTask) ?? null;

  return (
    <div className="stack">
      <PageHeader
        title="Quinquennial inspection"
        subtitle="The inspector's recommendations, kept as a live task list until the next inspection."
        actions={
          <>
            {report && !reviewing && <Button onClick={() => window.print()}>Export task list</Button>}
            {data?.canEdit && !data.reports.some((r) => r.status === "review") && (
              <Button variant="primary" onClick={() => setNewReport(true)}>
                {data.reports.length ? "Add a new report" : "Add your report"}
              </Button>
            )}
          </>
        }
      />
      {flash && <Notice>{flash}</Notice>}
      {error && <ErrorPanel message={error.message} onRetry={load} />}
      {!data && !error && <Skeleton height={420} />}
      {data && !report && (
        <Card>
          <p style={{ margin: 0 }}>
            Every five years the inspecting architect or surveyor reports on the building and lists what needs doing, by priority. Add that report here
            and each recommendation becomes a task you can track until the next inspection.
          </p>
          {!data.canEdit && <p className="muted" style={{ margin: 0 }}>A churchwarden or the PCC admin adds the report.</p>}
        </Card>
      )}
      {data && report && reviewing && <ReviewReport buildingId={building.id} data={data} report={report} onChanged={saved} />}
      {data && report && !reviewing && (
        <PublishedReport buildingId={building.id} data={data} report={report} onOpenTask={(id) => setParam("task", id)} onShowReport={(id) => setParam("report", id)} />
      )}
      {newReport && <NewReportSheet buildingId={building.id} onClose={() => setNewReport(false)} onSaved={saved} />}
      {task && data && report && (
        <TaskSheet buildingId={building.id} report={report} task={task} tasks={data.tasks} canEdit={data.canEdit} canWrite={data.canWrite} onClose={() => setParam("task", null)} onChanged={saved} />
      )}
    </div>
  );
}

// ---------- New report ----------
function NewReportSheet({ buildingId, onClose, onSaved }: { buildingId: string; onClose: () => void; onSaved: (m: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [inspectedOn, setInspectedOn] = useState("");
  const [inspector, setInspector] = useState("");
  const [pages, setPages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextDue = inspectedOn ? `${Number(inspectedOn.slice(0, 4)) + 5}${inspectedOn.slice(4)}` : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Choose the report's PDF.");
    setBusy(true);
    setError(null);
    try {
      const doc = await api.upload(buildingId, file, { type: "qi_report", title: `Quinquennial Inspection Report${inspectedOn ? ` ${inspectedOn.slice(0, 4)}` : ""}`, documentDate: inspectedOn || null });
      await api.post(`/buildings/${buildingId}/quinquennial`, { documentId: doc.id, inspectedOn: inspectedOn || null, inspectorName: inspector, pageCount: pages || null, nextDueOn: nextDue || null });
      await onSaved("Report added. Now enter its recommendations.");
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <SideSheet
      open
      title="Add a quinquennial report"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} onClick={() => (document.getElementById("qi-new") as HTMLFormElement | null)?.requestSubmit()}>
          Add report
        </Button>
      }
    >
      <form id="qi-new" className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <FileDrop label={file ? `Chosen: ${file.name}` : "The report as a PDF"} accept="application/pdf" onFiles={(fs) => setFile(fs[0] ?? null)} />
        <DateInput label="Date of the inspection" value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} />
        <Input label="Inspected by" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Name of the architect or surveyor" />
        <Input label="Number of pages" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} />
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Next, you'll copy in the recommendations. Nothing is shown as the task list until you publish it.
        </p>
      </form>
    </SideSheet>
  );
}

// ---------- Review: entering recommendations ----------
function ReviewReport({ buildingId, data, report, onChanged }: { buildingId: string; data: Data; report: Report; onChanged: (m: string) => Promise<void> }) {
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ current: boolean }>(`/buildings/${buildingId}/quinquennial/${report.id}/publish`);
      await onChanged(r.current ? "Published. The task list is live and the inspection is recorded on the compliance calendar." : "Published as an earlier report. The current task list is unchanged.");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!window.confirm("Discard this report and the items entered so far? The PDF stays in Documents.")) return;
    try {
      await api.post(`/buildings/${buildingId}/quinquennial/${report.id}/discard`);
      await onChanged("Report discarded.");
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  const remove = async (t: Task) => {
    try {
      await api.post(`/buildings/${buildingId}/tasks/${t.id}/delete`);
      await onChanged(`Item ${t.ref} removed.`);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  return (
    <>
      <div className="panel tone-warn" role="status">
        <span>
          <strong>Entering the report.</strong> Copy each recommendation in with the inspector's reference and priority band. Check them against the PDF, then publish.
        </span>
        {data.canEdit && (
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" onClick={discard}>
              Discard
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={publish} disabled={data.tasks.length === 0}>
              Publish task list
            </Button>
          </span>
        )}
      </div>
      {error && <ErrorPanel message={error} />}
      <div className="grid grid-3">
        <ReportCard buildingId={buildingId} report={report} count={data.tasks.length} editable={data.canEdit} onChanged={onChanged} />
        <Card className="span-2" title={`Recommendations entered (${data.tasks.length})`} headingId="qi-entered">
          <BandCounts tasks={data.tasks} />
          {data.canEdit && (
            <div>
              <Button variant="primary" onClick={() => setEditing("new")}>
                Add a recommendation
              </Button>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <TaskTable
          buildingId={buildingId}
          report={report}
          tasks={data.tasks}
          groupBy="band"
          action={(t) =>
            data.canEdit ? (
              <span style={{ display: "flex", gap: 6 }}>
                <Button size="sm" onClick={() => setEditing(t)} aria-label={`Edit item ${t.ref}`}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t)} aria-label={`Remove item ${t.ref}`}>
                  Remove
                </Button>
              </span>
            ) : null
          }
          empty="No recommendations entered yet."
        />
      </Card>
      {editing && (
        <TaskForm buildingId={buildingId} reportId={report.id} task={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      )}
    </>
  );
}

function TaskForm({ buildingId, reportId, task, onClose, onSaved }: { buildingId: string; reportId: string; task: Task | null; onClose: () => void; onSaved: (m: string) => Promise<void> }) {
  const [f, setF] = useState({
    ref: task?.ref ?? "",
    band: task?.band ?? "B",
    text: task?.text ?? "",
    location: task?.location ?? "",
    trade: task?.trade ?? "",
    low: penceInput(task?.estimateLowPence ?? null),
    high: penceInput(task?.estimateHighPence ?? null),
    page: task?.pageNumber ? String(task.pageNumber) : "",
    permission: task?.permission ?? "tbc",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = async (again: boolean) => {
    const low = parsePounds(f.low);
    const high = parsePounds(f.high);
    if (Number.isNaN(low) || Number.isNaN(high)) return setError("Enter estimates in pounds, like 2,500.");
    setBusy(true);
    setError(null);
    try {
      const body = {
        ref: f.ref,
        band: f.band,
        text: f.text,
        location: f.location,
        trade: f.trade,
        estimateLowPence: low,
        estimateHighPence: high ?? low,
        pageNumber: f.page ? Number(f.page) : null,
        permission: f.permission,
      };
      if (task) await api.patch(`/buildings/${buildingId}/tasks/${task.id}`, body);
      else await api.post(`/buildings/${buildingId}/quinquennial/${reportId}/tasks`, body);
      // Clear the form before the page refreshes, so typing into the next item isn't wiped.
      if (again) {
        setF({ ...f, ref: "", text: "", location: "", trade: "", low: "", high: "", page: f.page, permission: "tbc" });
        setBusy(false);
        document.querySelector<HTMLInputElement>("#qi-task input")?.focus();
      }
      await onSaved(`Item ${f.ref} saved.`);
      if (!again) onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <SideSheet
      open
      title={task ? `Item ${task.ref}` : "Add a recommendation"}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" loading={busy} onClick={() => (document.getElementById("qi-task") as HTMLFormElement | null)?.requestSubmit()}>
            Save
          </Button>
          {!task && (
            <Button
              onClick={() => {
                const form = document.getElementById("qi-task") as HTMLFormElement | null;
                if (form?.reportValidity()) void save(true);
              }}
            >
              Save and add another
            </Button>
          )}
        </>
      }
    >
      <form
        id="qi-task"
        className="sheet-section"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {error && <ErrorPanel message={error} />}
        <div className="form-grid">
          <Input label="Ref" value={f.ref} onChange={(e) => set("ref", e.target.value)} placeholder="3.2" required />
          <Input label="Page" inputMode="numeric" value={f.page} onChange={(e) => set("page", e.target.value)} placeholder="12" />
        </div>
        <Select label="Priority band (the inspector's own)" value={f.band} options={BANDS.map((b) => ({ value: b.band, label: b.label }))} onChange={(e) => set("band", e.target.value)} />
        <Textarea label="Recommendation, in the inspector's words" rows={4} value={f.text} onChange={(e) => set("text", e.target.value)} required />
        <div className="form-grid">
          <Input label="Location" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="South aisle, roof level" />
          <Input label="Trade" value={f.trade} onChange={(e) => set("trade", e.target.value)} placeholder="Masonry" />
          <Input label="Estimate from (£)" inputMode="decimal" value={f.low} onChange={(e) => set("low", e.target.value)} placeholder="2,500" />
          <Input label="Estimate to (£)" inputMode="decimal" value={f.high} onChange={(e) => set("high", e.target.value)} placeholder="4,000" />
        </div>
        <Select label="Permission needed" value={f.permission} options={PERMISSIONS} onChange={(e) => set("permission", e.target.value)} hint="Leave as 'To be confirmed' if unsure; the DAC can advise." />
        {f.band === "M" && <Notice tone="info">Routine items go onto the compliance calendar as yearly checks when you publish.</Notice>}
      </form>
    </SideSheet>
  );
}

// ---------- Published report ----------
function PublishedReport({ buildingId, data, report, onOpenTask, onShowReport }: { buildingId: string; data: Data; report: Report; onOpenTask: (id: string) => void; onShowReport: (id: string | null) => void }) {
  const [filter, setFilter] = useState("open");
  const [groupBy, setGroupBy] = useState<"band" | "location" | "trade">("band");
  const tasks = data.tasks;
  const isOpen = (t: Task) => t.status !== "done" && t.band !== "M";
  const needsPermission = (t: Task) => isOpen(t) && (t.permission === "list_b" || t.permission === "faculty");
  const shown = tasks.filter((t) => (filter === "open" ? isOpen(t) : filter === "done" ? !isOpen(t) : filter === "permission" ? needsPermission(t) : filter === "quoted" ? t.status === "quoted" : true));
  const done = tasks.filter((t) => !isOpen(t)).length;
  const others = data.reports.filter((r) => r.id !== report.id);

  return (
    <>
      {report.status === "previous" && (
        <div className="panel tone-info">
          <span>You're looking at an earlier report.</span>
          <Button size="sm" onClick={() => onShowReport(null)}>
            Back to the current report
          </Button>
        </div>
      )}
      <div className="grid grid-3">
        <ReportCard buildingId={buildingId} report={report} count={tasks.length} editable={false} others={others} onShowReport={onShowReport} />
        <Card className="span-2" title="Where things stand" headingId="qi-standing" caption={`${done} of ${tasks.length} completed · ${tasks.length - done} open · ${tasks.filter(needsPermission).length} need permission`}>
          <BandCounts tasks={tasks} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Priority bands are the inspector's own. Routine items (gutters, drains, vegetation) were moved to the compliance calendar so they recur rather than sit as one-off tasks.
          </p>
        </Card>
      </div>
      <Card>
        <div className="filter-row">
          <FilterChips
            label="Show"
            selected={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open", count: tasks.filter(isOpen).length },
              { value: "done", label: "Completed", count: done },
              { value: "permission", label: "Needs permission", count: tasks.filter(needsPermission).length },
              { value: "quoted", label: "Quoted", count: tasks.filter((t) => t.status === "quoted").length },
              { value: "all", label: "All", count: tasks.length },
            ]}
          />
          <div style={{ minWidth: 170 }}>
            <Select
              label="Group by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              options={[
                { value: "band", label: "Priority" },
                { value: "location", label: "Location" },
                { value: "trade", label: "Trade" },
              ]}
            />
          </div>
        </div>
        <TaskTable
          buildingId={buildingId}
          report={report}
          tasks={shown}
          allTasks={tasks}
          groupBy={groupBy}
          action={(t) => (
            <Button size="sm" onClick={() => onOpenTask(t.id)} aria-label={`Open item ${t.ref}`}>
              Open
            </Button>
          )}
          empty="Nothing here."
          footer={`Showing ${shown.length} of ${tasks.length} items. Completed items keep their job, invoice and logbook entry.`}
        />
      </Card>
    </>
  );
}

function ReportCard({
  buildingId,
  report,
  count,
  editable,
  onChanged,
  others = [],
  onShowReport,
}: {
  buildingId: string;
  report: Report;
  count: number;
  editable: boolean;
  onChanged?: (m: string) => Promise<void>;
  others?: Report[];
  onShowReport?: (id: string) => void;
}) {
  const [f, setF] = useState({ inspectedOn: report.inspectedOn ?? "", inspectorName: report.inspectorName ?? "", pageCount: report.pageCount ? String(report.pageCount) : "", nextDueOn: report.nextDueOn ?? "" });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.patch(`/buildings/${buildingId}/quinquennial/${report.id}`, { ...f, pageCount: f.pageCount || null });
      await onChanged?.("Report details saved.");
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  return (
    <Card title={report.status === "current" ? "Current report" : report.status === "review" ? "Report being entered" : "Earlier report"} headingId="qi-report">
      <a href={fileUrl(buildingId, report.documentId)} target="_blank" rel="noopener" style={{ fontWeight: 600 }}>
        {report.documentTitle ?? "Quinquennial report"} (PDF)
      </a>
      {editable ? (
        <div className="sheet-section">
          {error && <ErrorPanel message={error} />}
          <DateInput label="Inspected on" value={f.inspectedOn} onChange={(e) => setF({ ...f, inspectedOn: e.target.value })} />
          <Input label="Inspected by" value={f.inspectorName} onChange={(e) => setF({ ...f, inspectorName: e.target.value })} />
          <div className="form-grid">
            <Input label="Pages" value={f.pageCount} onChange={(e) => setF({ ...f, pageCount: e.target.value })} />
            <DateInput label="Next due" value={f.nextDueOn} onChange={(e) => setF({ ...f, nextDueOn: e.target.value })} />
          </div>
          <div>
            <Button size="sm" onClick={save}>
              Save details
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span className="muted">
            {[report.inspectedOn && `Inspected ${formatDate(report.inspectedOn)}`, report.inspectorName && `by ${report.inspectorName}`].filter(Boolean).join(" ")}
          </span>
          <span className="muted">
            {[report.pageCount && `${report.pageCount} pages`, `${count} recommendations`, report.nextDueOn && `next inspection due ${formatDate(report.nextDueOn).replace(/^\d+ /, "")}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <div className="panel tone-ok" style={{ display: "block" }}>
            Every recommendation links back to its page in the report, so you can check the inspector's wording in one click.
          </div>
          {others.length > 0 && onShowReport && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              {others
                .filter((o) => o.status !== "review")
                .map((o) => (
                  <button key={o.id} type="button" className="link-button" onClick={() => onShowReport(o.id)}>
                    {o.status === "current" ? "Current report" : "Earlier report"} ({formatDate(o.inspectedOn) || "undated"})
                  </button>
                ))}
            </div>
          )}
          <a href={`/b/${buildingId}/jobs`} style={{ fontSize: 13 }}>
            Logbook and completed work
          </a>
        </>
      )}
    </Card>
  );
}

function BandCounts({ tasks }: { tasks: Task[] }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
      {BANDS.map((b) => {
        const inBand = tasks.filter((t) => t.band === b.band);
        const open = inBand.filter((t) => t.status !== "done").length;
        return (
          <div key={b.band} className="band-tile">
            <Pill tone={b.tone} label={b.short} />
            <strong>{b.band === "M" ? `${inBand.length} ${inBand.length === 1 ? "item" : "items"}` : `${open} open`}</strong>
            <span className="muted">{b.band === "M" ? "on the calendar" : `of ${inBand.length}`}</span>
          </div>
        );
      })}
    </div>
  );
}

function TaskTable({
  buildingId,
  report,
  tasks,
  allTasks = tasks,
  groupBy,
  action,
  empty,
  footer,
}: {
  buildingId: string;
  report: Report;
  tasks: Task[];
  allTasks?: Task[];
  groupBy: "band" | "location" | "trade";
  action: (t: Task) => ReactNode;
  empty: string;
  footer?: string;
}) {
  const byId = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);
  const ordered = groupBy === "band" ? tasks : [...tasks].sort((a, b) => (a[groupBy] ?? "~").localeCompare(b[groupBy] ?? "~"));
  const bandOf = (g: string) => BANDS.find((b) => b.band === g);
  return (
    <DataTable<Task & Record<string, unknown>>
      caption="Quinquennial recommendations"
      rows={ordered as (Task & Record<string, unknown>)[]}
      rowKey={(t) => t.id}
      groupBy={(t) => (groupBy === "band" ? t.band : t[groupBy] ?? "Not given")}
      groupLabel={(g) => (groupBy === "band" ? <span style={{ color: `var(--${bandOf(g)?.tone === "neutral" ? "ink-muted" : `${bandOf(g)?.tone}-text`})` }}>{bandOf(g)?.label ?? g}</span> : g)}
      emptyMessage={empty}
      footer={footer}
      columns={[
        {
          key: "ref",
          label: "Ref",
          nowrap: true,
          render: (t) => (
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong>{t.ref}</strong>
              {t.pageNumber && (
                <a href={fileUrl(buildingId, report.documentId, t.pageNumber)} target="_blank" rel="noopener" style={{ fontSize: 13 }}>
                  p.{t.pageNumber}
                </a>
              )}
            </span>
          ),
        },
        { key: "text", label: "Recommendation", render: (t) => <span style={{ fontWeight: 600 }}>{t.text}</span> },
        { key: "location", label: "Location", render: (t) => t.location ?? <span className="muted">—</span> },
        {
          key: "estimate",
          label: "Inspector's estimate",
          align: "right",
          nowrap: true,
          render: (t) => formatRangeText(t.estimateLowPence, t.estimateHighPence) || <span className="muted">Not given</span>,
        },
        {
          key: "permission",
          label: "Permission",
          render: (t) => (t.permission === "list_b" || t.permission === "faculty" ? <Pill tone="info" label={PERMISSION_LABEL[t.permission]!} /> : <span className="muted">{PERMISSION_LABEL[t.permission]}</span>),
        },
        {
          key: "status",
          label: "Status",
          render: (t) =>
            t.band === "M" && t.status !== "done" ? (
              <Pill tone="ok" label="On the calendar" />
            ) : t.status === "waiting" && t.waitingOnTaskId ? (
              <Pill tone="neutral" label={`Waiting on ${byId.get(t.waitingOnTaskId)?.ref ?? "another item"}`} />
            ) : (
              <Pill tone={STATUS[t.status].tone} label={STATUS[t.status].label} />
            ),
        },
        { key: "action", label: "Action", render: action },
      ]}
    />
  );
}

// ---------- One recommendation ----------
function TaskSheet({
  buildingId,
  report,
  task,
  tasks,
  canEdit,
  canWrite,
  onClose,
  onChanged,
}: {
  buildingId: string;
  report: Report;
  task: Task;
  tasks: Task[];
  canEdit: boolean;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (m: string) => Promise<void>;
}) {
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (body: Record<string, unknown>, message: string) => {
    setError(null);
    try {
      await api.patch(`/buildings/${buildingId}/tasks/${task.id}`, body);
      await onChanged(message);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  if (logging) {
    return (
      <JobSheet
        buildingId={buildingId}
        today={new Date().toISOString().slice(0, 10)}
        taskId={task.id}
        presetTitle={`${task.text.length > 120 ? `${task.text.slice(0, 117)}…` : task.text} (QI item ${task.ref})`}
        onClose={() => setLogging(false)}
        onSaved={async (m) => {
          await onChanged(`${m} Item ${task.ref} is done.`);
          onClose();
        }}
      />
    );
  }
  if (editing) return <TaskForm buildingId={buildingId} reportId={report.id} task={task} onClose={() => setEditing(false)} onSaved={onChanged} />;
  const isRoutine = task.band === "M";
  const band = BANDS.find((b) => b.band === task.band)!;
  return (
    <SideSheet open title={`Item ${task.ref}`} subtitle={<Pill tone={band.tone} label={band.label} />} onClose={onClose}>
      {error && <ErrorPanel message={error} />}
      <p style={{ margin: 0, fontWeight: 600 }}>{task.text}</p>
      {task.text !== task.originalText && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          The inspector's original wording: {task.originalText}
        </p>
      )}
      <dl className="facts">
        <dt>Location</dt>
        <dd>{task.location ?? "Not given"}</dd>
        <dt>Estimate</dt>
        <dd>{formatRangeText(task.estimateLowPence, task.estimateHighPence) || "Not given"}</dd>
        <dt>Permission</dt>
        <dd>{PERMISSION_LABEL[task.permission]}</dd>
        {task.pageNumber && (
          <>
            <dt>In the report</dt>
            <dd>
              <a href={fileUrl(buildingId, report.documentId, task.pageNumber)} target="_blank" rel="noopener">
                Page {task.pageNumber}
              </a>
            </dd>
          </>
        )}
      </dl>
      {task.status === "done" ? (
        <Notice>
          Done{task.job ? `: ${task.job.title}${task.job.doneOn ? `, ${formatDate(task.job.doneOn)}` : ""}` : ""}.
        </Notice>
      ) : isRoutine ? (
        <Notice tone="info">This routine item is on the compliance calendar, so it recurs.</Notice>
      ) : (
        canWrite &&
        report.status === "current" && (
          <div className="sheet-section">
            <h3>Progress</h3>
            <Select
              label="Status"
              value={task.status === "waiting" ? "not_started" : task.status}
              onChange={(e) => update({ status: e.target.value, waitingOnTaskId: null }, `Item ${task.ref} updated.`)}
              options={[
                { value: "not_started", label: "Not started" },
                { value: "quoted", label: "Quote received" },
                { value: "in_progress", label: "In progress" },
              ]}
            />
            <Select
              label="Waiting on another item"
              value={task.waitingOnTaskId ?? ""}
              onChange={(e) => update({ waitingOnTaskId: e.target.value || null, ...(e.target.value ? {} : { status: "not_started" }) }, `Item ${task.ref} updated.`)}
              options={[{ value: "", label: "No" }, ...tasks.filter((t) => t.id !== task.id && t.status !== "done" && t.band !== "M").map((t) => ({ value: t.id, label: `${t.ref}: ${t.text.slice(0, 60)}` }))]}
            />
            <Select label="Permission" value={task.permission} options={PERMISSIONS} onChange={(e) => update({ permission: e.target.value }, `Item ${task.ref} updated.`)} />
            <div>
              <Button variant="primary" onClick={() => setLogging(true)}>
                Log the job that did this
              </Button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              An item is marked done when its job is logged, so the invoice and logbook entry stay with it.
            </p>
          </div>
        )
      )}
      {canEdit && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Correct the wording, band or estimate
          </Button>
        </div>
      )}
    </SideSheet>
  );
}
