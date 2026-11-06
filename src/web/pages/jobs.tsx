// Jobs and spend: the full job log, filters, and logbook approvals.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { formatPounds } from "../../shared/money";
import { api, ApiError, type Job, type LogbookEntry, type Spend } from "../api";
import { formatDate } from "../format";
import { Button, Card, ErrorPanel, Notice, PageHeader, Skeleton, StatTile } from "../ui/basics";
import { DataTable, FilterChips } from "../ui/data";
import { Input, Select } from "../ui/forms";
import { useChurch } from "./church";
import { JobsTable } from "./dashboard";
import { JobSheet } from "./sheets";

type JobsData = { jobs: Job[]; spend: Spend; drafts: LogbookEntry[]; canWrite: boolean; canApprove: boolean };

export function JobsPage() {
  const { building } = useChurch();
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("year")) || thisYear;
  const filter = params.get("show") ?? "all";
  const [data, setData] = useState<JobsData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [sheet, setSheet] = useState<Job | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get<JobsData>(`/buildings/${building.id}/jobs?year=${year}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [building.id, year]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // Planned jobs have no date yet, so they're fetched alongside whatever year is shown.
  const [planned, setPlanned] = useState<Job[]>([]);
  useEffect(() => {
    api.get<JobsData>(`/buildings/${building.id}/jobs?status=planned`).then((r) => setPlanned(r.jobs.filter((j) => !j.doneOn))).catch(() => {});
  }, [building.id, data]);

  const all = useMemo(() => {
    const seen = new Set(data?.jobs.map((j) => j.id));
    return [...planned.filter((p) => !seen.has(p.id)), ...(data?.jobs ?? [])];
  }, [data, planned]);
  const shown = all.filter((j) =>
    filter === "done" ? j.status === "done" : filter === "planned" ? j.status === "planned" : filter === "invoice" ? j.awaitingInvoice : true,
  );

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v == null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };
  const saved = async (m: string) => {
    setFlash(m);
    await load();
  };

  return (
    <div className="stack">
      <PageHeader
        title="Jobs and spend"
        subtitle="Every piece of work on the building, what it cost, and the paperwork behind it."
        actions={
          data?.canWrite && (
            <Button variant="primary" onClick={() => setSheet("new")}>
              Log a job
            </Button>
          )
        }
      />
      {flash && <Notice>{flash}</Notice>}
      {error && <ErrorPanel message={error.message} onRetry={load} />}
      {!data && !error && <Skeleton height={400} />}
      {data && (
        <>
          <div className="grid grid-4">
            <StatTile label={`Spend in ${year}`} value={formatPounds(data.spend.totalPence) || "£0"} caption={`${data.spend.jobCount} ${data.spend.jobCount === 1 ? "job" : "jobs"} done`} />
            <StatTile label="Awaiting invoice" value={String(data.spend.awaitingInvoice)} tone="warn" caption="Done jobs with no invoice attached" />
            <StatTile label="Logbook drafts" value={String(data.drafts.length)} tone="warn" caption={data.canApprove ? "Waiting for your approval" : "Waiting for a churchwarden"} />
            <StatTile label="Planned" value={String(all.filter((j) => j.status === "planned").length)} caption="Booked or waiting to start" />
          </div>

          {data.drafts.length > 0 && (
            <LogbookDrafts buildingId={building.id} drafts={data.drafts} canApprove={data.canApprove} canWrite={data.canWrite} onChanged={saved} />
          )}

          <Card title="Job log" headingId="jobs-log">
            <div className="filter-row">
              <FilterChips
                label="Show"
                selected={filter}
                onChange={(v) => set("show", v === "all" ? null : v)}
                options={[
                  { value: "all", label: "All", count: all.length },
                  { value: "done", label: "Done", count: all.filter((j) => j.status === "done").length },
                  { value: "planned", label: "Planned", count: all.filter((j) => j.status === "planned").length },
                  { value: "invoice", label: "Awaiting invoice", count: all.filter((j) => j.awaitingInvoice).length },
                ]}
              />
              <div style={{ minWidth: 140 }}>
                <Select
                  label="Year"
                  value={String(year)}
                  onChange={(e) => set("year", e.target.value === String(thisYear) ? null : e.target.value)}
                  options={Array.from({ length: 8 }, (_, i) => String(thisYear - i)).map((y) => ({ value: y, label: y }))}
                />
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="table-empty">No jobs here yet.</div>
            ) : (
              <JobsTable
                jobs={shown}
                caption="Job log"
                action={(j) =>
                  data.canWrite ? (
                    <Button size="sm" onClick={() => setSheet(j)} aria-label={`${j.awaitingInvoice ? "Add invoice" : "Edit"}: ${j.title}`}>
                      {j.awaitingInvoice ? "Add invoice" : j.status === "planned" ? "Mark done" : "Edit"}
                    </Button>
                  ) : null
                }
              />
            )}
          </Card>
        </>
      )}
      {sheet && (
        <JobSheet
          buildingId={building.id}
          today={new Date().toISOString().slice(0, 10)}
          job={sheet === "new" ? null : sheet.status === "planned" ? { ...sheet, status: "done", doneOn: sheet.doneOn ?? new Date().toISOString().slice(0, 10) } : sheet}
          onClose={() => setSheet(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function LogbookDrafts({
  buildingId,
  drafts,
  canApprove,
  canWrite,
  onChanged,
}: {
  buildingId: string;
  drafts: LogbookEntry[];
  canApprove: boolean;
  canWrite: boolean;
  onChanged: (m: string) => Promise<void>;
}) {
  const [refs, setRefs] = useState<Record<string, string>>(() => Object.fromEntries(drafts.map((d) => [d.id, d.permissionRef ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approve = async (d: LogbookEntry) => {
    setBusy(d.id);
    setError(null);
    try {
      if ((refs[d.id] ?? "") !== (d.permissionRef ?? "")) await api.patch(`/buildings/${buildingId}/logbook/${d.id}`, { permissionRef: refs[d.id] });
      await api.post(`/buildings/${buildingId}/logbook/${d.id}/approve`);
      await onChanged(`“${d.work}” entered in the logbook.`);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      title="Logbook entries to approve"
      headingId="jobs-logbook"
      caption="Each finished job with paperwork becomes a draft entry in the church logbook. Add a faculty or List B reference if the work needed one, then approve."
    >
      {error && <ErrorPanel message={error} />}
      <DataTable<LogbookEntry & Record<string, unknown>>
        caption="Draft logbook entries"
        rows={drafts as (LogbookEntry & Record<string, unknown>)[]}
        rowKey={(d) => d.id}
        columns={[
          { key: "entryDate", label: "Date", nowrap: true, render: (d) => formatDate(d.entryDate) },
          { key: "work", label: "Work" },
          { key: "who", label: "Who", render: (d) => d.who ?? <span className="muted">—</span> },
          { key: "costPence", label: "Cost", align: "right", nowrap: true, render: (d) => formatPounds(d.costPence) },
          {
            key: "permissionRef",
            label: "Faculty or List B ref",
            render: (d) =>
              canWrite ? (
                <Input label={`Permission reference for ${d.work}`} className="label-hidden" value={refs[d.id] ?? ""} placeholder="None needed" onChange={(e) => setRefs({ ...refs, [d.id]: e.target.value })} />
              ) : (
                d.permissionRef ?? "—"
              ),
          },
          {
            key: "action",
            label: "Action",
            render: (d) =>
              canApprove ? (
                <Button size="sm" variant="primary" loading={busy === d.id} onClick={() => approve(d)} aria-label={`Approve: ${d.work}`}>
                  Approve
                </Button>
              ) : (
                <span className="muted">Churchwarden to approve</span>
              ),
          },
        ]}
      />
    </Card>
  );
}
