// Screen 1: church dashboard (UI-HANDOFF §7).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatPounds, formatRangeText } from "../../shared/money";
import { api, ApiError, DOC_LABEL, type Dashboard, type Job } from "../api";
import { formatDate } from "../format";
import { AttentionList, AttentionRow, DataTable } from "../ui/data";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, ProgressBar, Skeleton, StatTile } from "../ui/basics";
import { subtitleFor, useChurch } from "./church";
import { JobSheet, UploadSheet } from "./sheets";
import { PhoneHome } from "./phone";
import { EstatesNotesCard } from "./estates";

const BAND_LABEL: Record<string, string> = {
  A: "A · Urgent",
  B: "B · Within 12 months",
  C: "C · Before next inspection",
  D: "D · Desirable",
  M: "M · Routine maintenance",
};
const BAND_TONE = { A: "danger", B: "warn", C: "info", D: "neutral", M: "ok" } as const;

/** True on phone-width screens, where the dashboard becomes "This week" (UI-HANDOFF §5). */
function useIsPhone() {
  const q = "(max-width: 799px)";
  const [phone, setPhone] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

export function DashboardPage() {
  const { building } = useChurch();
  const phone = useIsPhone();
  return phone ? <PhoneHome building={building} /> : <DesktopDashboard />;
}

function DesktopDashboard() {
  const { building } = useChurch();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [sheet, setSheet] = useState<"job" | "upload" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const base = `/b/${building.id}`;

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get<Dashboard>(`/buildings/${building.id}/dashboard`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [building.id]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  const saved = async (m: string) => {
    setFlash(m);
    await load();
  };

  const subtitle = [
    subtitleFor(building),
    data?.qi?.inspectedOn && `Quinquennial inspected ${formatDate(data.qi.inspectedOn)}`,
    data?.qi?.nextDueOn && `Next due ${formatDate(data.qi.nextDueOn).replace(/^\d+ /, "")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="stack">
      <PageHeader
        title={building.name}
        subtitle={subtitle}
        actions={
          <>
            {data?.canWrite && <Button onClick={() => setSheet("upload")}>Upload a document</Button>}
            {data?.canWrite && <Button onClick={() => setSheet("job")}>Log a job</Button>}
            <Button variant="primary" href={`${base}/reports`}>
              Annual fabric report
            </Button>
          </>
        }
      />
      {flash && <Notice>{flash}</Notice>}
      {error ? (
        <ErrorPanel message={error.message} onRetry={load} />
      ) : !data ? (
        <>
          <div className="grid grid-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
          <Skeleton height={300} />
        </>
      ) : (
        <>
          <Body data={data} base={base} onLogJob={() => setSheet("job")} />
          <EstatesNotesCard buildingId={building.id} />
        </>
      )}
      {sheet === "job" && data && <JobSheet buildingId={building.id} today={data.today} onClose={() => setSheet(null)} onSaved={saved} />}
      {sheet === "upload" && <UploadSheet buildingId={building.id} onClose={() => setSheet(null)} onSaved={saved} />}
    </div>
  );
}

function overdueCaption(names: string[]) {
  if (names.length === 0) return "Nothing overdue";
  const shown = names.slice(0, 2).map((n, i) => (i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1)));
  return shown.join(", ") + (names.length > 2 ? ` and ${names.length - 2} more` : "");
}

function Body({ data, base, onLogJob }: { data: Dashboard; base: string; onLogJob: () => void }) {
  const { stats, qi } = data;
  const next = stats.dueSoon.next;
  return (
    <>
      <div className="grid grid-4">
        <StatTile label="Overdue" value={String(stats.overdue.count)} tone="danger" caption={overdueCaption(stats.overdue.names)} href={`${base}/compliance?filter=overdue`} />
        <StatTile
          label="Due in the next 90 days"
          value={String(stats.dueSoon.count)}
          tone="warn"
          caption={next ? `Next: ${next.name.charAt(0).toLowerCase() + next.name.slice(1)}, ${formatDate(next.nextDue).replace(/ \d{4}$/, "")}` : "Nothing due soon"}
          href={`${base}/compliance?filter=due_soon`}
        />
        <StatTile
          label="Open quinquennial actions"
          value={qi ? String(qi.open) : "0"}
          caption={qi ? `${qi.openA} priority A · ${qi.done} of ${qi.total} completed` : "No report added yet"}
          href={`${base}/quinquennial`}
        />
        <StatTile
          label="Spend this year"
          value={formatPounds(stats.spend.totalPence) || "£0"}
          caption={`${stats.spend.jobCount} ${stats.spend.jobCount === 1 ? "job" : "jobs"} logged · ${stats.spend.awaitingInvoice} awaiting invoice`}
          href={`${base}/jobs`}
        />
      </div>

      <div className="grid grid-3">
        <Card className="span-2" title="Needs attention" headingId="dash-attention" link={{ label: "See the full calendar", href: `${base}/compliance` }}>
          {data.attention.length === 0 ? (
            <p style={{ margin: 0 }}>
              Nothing needs attention right now.
              {stats.notRecorded > 0 && (
                <>
                  {" "}
                  {stats.notRecorded} {stats.notRecorded === 1 ? "check has" : "checks have"} no record yet on the <a href={`${base}/compliance?filter=not_recorded`}>calendar</a>.
                </>
              )}
            </p>
          ) : (
            <AttentionList>
              {data.attention.map((a) => (
                <AttentionRow key={a.title} pill={a.pill} title={a.title} detail={a.detail} action={a.action} />
              ))}
            </AttentionList>
          )}
          {data.attentionTotal > data.attention.length && (
            <span className="muted" style={{ fontSize: 13 }}>
              Showing 5 of {data.attentionTotal}.
            </span>
          )}
        </Card>

        <Card
          title="Quinquennial progress"
          headingId="dash-qi"
          link={qi ? { label: "All actions", href: `${base}/quinquennial` } : undefined}
          caption={qi?.inspectedOn ? `Report of ${formatDate(qi.inspectedOn)} · ${qi.total} recommendations` : undefined}
        >
          {qi ? (
            <>
              {qi.bands
                .filter((b) => b.total > 0)
                .map((b) => (
                  <ProgressBar
                    key={b.band}
                    label={BAND_LABEL[b.band]!}
                    rightLabel={b.band === "M" ? "On the calendar" : `${b.done} of ${b.total} done`}
                    value={b.band === "M" ? 100 : (b.done / b.total) * 100}
                    tone={BAND_TONE[b.band as keyof typeof BAND_TONE]}
                  />
                ))}
              <div className="panel tone-neutral" style={{ display: "block" }}>
                Outstanding work at the inspector's estimates: <strong>{formatRangeText(qi.estimateLowPence, qi.estimateHighPence) || "not given"}</strong>.
                {qi.needPermission > 0 && ` ${qi.needPermission} ${qi.needPermission === 1 ? "item needs" : "items need"} List B or faculty permission.`}
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>Add the inspecting architect's report and its recommendations become a task list here.</p>
              <div>
                <Button href={`${base}/quinquennial`}>Upload report</Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title="Recent jobs" headingId="dash-jobs" link={{ label: "Job log", href: `${base}/jobs` }}>
        {data.recentJobs.length === 0 ? (
          <div className="table-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            No jobs logged yet
            {data.canWrite && (
              <Button size="sm" onClick={onLogJob}>
                Log a job
              </Button>
            )}
          </div>
        ) : (
          <JobsTable jobs={data.recentJobs} caption="Recent jobs" />
        )}
      </Card>
    </>
  );
}

export function paperworkCell(j: Job): ReactNode {
  const types = [...new Set(j.paperwork.map((p) => (DOC_LABEL[p.type] ?? p.type).toLowerCase()))];
  const list = types.length ? types.join(", ").replace(/^./, (c) => c.toUpperCase()) : "";
  if (j.status === "done" && j.awaitingInvoice) {
    return (
      <>
        {list && `${list}, `}
        <span className="warn-text">{list ? "invoice missing" : "Invoice missing"}</span>
      </>
    );
  }
  return list || <span className="muted">None</span>;
}

export function logbookPill(j: Job) {
  if (j.logbook === "approved") return <Pill tone="ok" label="Entered" />;
  if (j.logbook === "draft") return <Pill tone="warn" label="Draft" />;
  if (j.status === "planned") return <Pill tone="neutral" label="Planned" />;
  return <span className="muted">Needs paperwork</span>;
}

export function JobsTable({
  jobs,
  caption,
  action,
}: {
  jobs: Job[];
  caption: string;
  action?: (j: Job) => ReactNode;
}) {
  return (
    <DataTable<Job & Record<string, unknown>>
      caption={caption}
      rows={jobs as (Job & Record<string, unknown>)[]}
      rowKey={(j) => j.id}
      columns={[
        { key: "doneOn", label: "Date", nowrap: true, render: (j) => formatDate(j.doneOn) || <span className="muted">Not set</span> },
        { key: "title", label: "Job" },
        { key: "contractorName", label: "Contractor", render: (j) => j.contractorName ?? <span className="muted">—</span> },
        { key: "costPence", label: "Cost", align: "right", nowrap: true, render: (j) => formatPounds(j.costPence) },
        { key: "paperwork", label: "Paperwork", render: paperworkCell },
        { key: "logbook", label: "Logbook", render: logbookPill },
        ...(action ? [{ key: "action", label: "Action", render: action }] : []),
      ]}
    />
  );
}
