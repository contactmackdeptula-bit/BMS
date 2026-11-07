// Screen 5: diocesan estates console (UI-HANDOFF §11).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useOutletContext, useParams, useSearchParams } from "react-router";
import { formatPounds, formatRangeText } from "../../shared/money";
import { api, ApiError, type Role } from "../api";
import { formatDate, formatMoney, LISTING_LABELS } from "../format";
import { useSession } from "../session";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, ProgressBar, Skeleton, StatTile } from "../ui/basics";
import { AttentionList, AttentionRow, DataTable } from "../ui/data";
import { Select } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";
import { ESTATES_NAV, Sidebar, type EstatesSection } from "../ui/Sidebar";
import { PeopleCard } from "./church";

type Row = {
  id: string;
  name: string;
  parish: string;
  area: { id: string; name: string } | null;
  listing: string | null;
  hasCalendar: boolean;
  overdue: string[];
  openA: number;
  openB: number;
  backlogPence: number;
  surveyDue: string | null;
  surveyOverdue: boolean;
  contact: { name: string; email: string; role: string } | null;
};
type Programme = {
  key: string;
  title: string;
  churches: number;
  overdue: number;
  areas: string[];
  windowEnd: string;
  estimateLowPence: number | null;
  estimateHighPence: number | null;
  buildings: { id: string; name: string; nextDue: string; overdue: boolean; area: string | null }[];
};
type Overview = {
  today: string;
  areas: { id: string; name: string }[];
  stats: {
    overdue: { count: number; churches: number; common: { name: string; count: number } | null };
    lapsing: { count: number; byType: { type: string; n: number }[] };
    openActions: { count: number; a: number; b: number };
    backlog: { pence: number; clearedThisYearPence: number; topTrade: { trade: string; share: number } | null };
  };
  cycle: { year: number; due: number; overdue: number }[];
  programmes: Programme[];
  rows: Row[];
  buildingCount: number;
};
type Ctx = { orgId: string; data: Overview | null; error: string | null; reload: () => Promise<void>; area: string | null; setArea: (a: string | null) => void; role: Role };
const useEstate = () => useOutletContext<Ctx>();

export function EstatesLayout() {
  const { orgId = "" } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { me, signOut } = useSession();
  const org = me.organisations.find((o) => o.id === orgId);
  const rest = location.pathname.slice(`/org/${orgId}`.length);
  const section = (ESTATES_NAV.find((n) => n.path && rest.startsWith(n.path))?.key ?? "overview") as EstatesSection;
  const area = params.get("area");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get<Overview>(`/orgs/${orgId}/estate${area ? `?area=${area}` : ""}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [orgId, area]);
  useEffect(() => {
    if (org) void reload();
  }, [org, reload]);

  useEffect(() => {
    document.title = [ESTATES_NAV.find((n) => n.key === section)?.label, org?.name, me.product.name].filter(Boolean).join(" · ");
  }, [section, org, me.product.name]);

  const setArea = (a: string | null) => {
    const next = new URLSearchParams(params);
    if (a) next.set("area", a);
    else next.delete("area");
    setParams(next, { replace: true });
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {org && (
        <Sidebar
          shell="estates"
          productName={me.product.name}
          tagline={me.product.tagline}
          user={{ name: me.user.name, role: org.role }}
          onSignOut={signOut}
          org={{ id: org.id, name: org.name, buildingCount: data?.buildingCount ?? me.buildings.filter((b) => b.viaEstates).length, areaCount: data?.areas.length }}
          activeSection={section}
          team="Estates"
        />
      )}
      <main className="main" id="main" tabIndex={-1}>
        {org ? (
          <Outlet context={{ orgId, data, error, reload, area, setArea, role: org.role } satisfies Ctx} />
        ) : (
          <ErrorPanel message="That organisation doesn't exist, or you don't have access to it." />
        )}
      </main>
    </div>
  );
}

function AreaSelect() {
  const { data, area, setArea } = useEstate();
  if (!data || data.areas.length === 0) return null;
  return (
    <div style={{ minWidth: 200 }}>
      <Select label="Pastoral area" value={area ?? ""} onChange={(e) => setArea(e.target.value || null)} options={[{ value: "", label: "All areas" }, ...data.areas.map((a) => ({ value: a.id, label: a.name }))]} />
    </div>
  );
}

function boardReportUrl(orgId: string, area: string | null) {
  return `/api/orgs/${orgId}/estate/board-report.csv${area ? `?area=${area}` : ""}`;
}

function Loading({ children }: { children: (d: Overview) => ReactNode }) {
  const { data, error, reload } = useEstate();
  if (error) return <ErrorPanel message={error} onRetry={reload} />;
  if (!data) return <Skeleton height={400} />;
  return <>{children(data)}</>;
}

const surveyPill = (r: Row) =>
  !r.surveyDue ? <span className="muted">Not known</span> : r.surveyOverdue ? <Pill tone="danger" label={`Overdue ${r.surveyDue.slice(0, 4)}`} /> : <Pill tone={Number(r.surveyDue.slice(0, 4)) <= new Date().getFullYear() + 1 ? "warn" : "neutral"} label={formatDate(r.surveyDue).replace(/^\d+ /, "")} />;

function ChurchesTable({ rows, limit }: { rows: Row[]; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <DataTable<Row & Record<string, unknown>>
      caption="Churches"
      rows={shown as (Row & Record<string, unknown>)[]}
      rowKey={(r) => r.id}
      emptyMessage="No churches in this estate yet."
      footer={limit && rows.length > limit ? `Showing ${limit} of ${rows.length}. Each row opens the same church view a parish user sees, with the estates team's notes added.` : "Each row opens the same church view a parish user sees, with the estates team's notes added."}
      columns={[
        { key: "name", label: "Church", render: (r) => <Link to={`/b/${r.id}`}>{r.name}</Link> },
        { key: "area", label: "Pastoral area", render: (r) => r.area?.name ?? <span className="muted">—</span> },
        { key: "listing", label: "Listing", render: (r) => (r.listing ? LISTING_LABELS[r.listing]?.replace(" listed", "") : <span className="muted">—</span>) },
        {
          key: "overdue",
          label: "Overdue checks",
          align: "right",
          render: (r) => (!r.hasCalendar ? <span className="muted">Not set up</span> : r.overdue.length ? <span style={{ color: "var(--danger-text)", fontWeight: 700 }} title={r.overdue.join(", ")}>{r.overdue.length}</span> : "0"),
        },
        { key: "openA", label: "Open A", align: "right", render: (r) => (r.openA ? <strong>{r.openA}</strong> : "0") },
        { key: "openB", label: "B", align: "right" },
        { key: "backlogPence", label: "Backlog", align: "right", nowrap: true, render: (r) => (r.backlogPence ? <span title="Midpoint of the inspector's estimate ranges">{formatMoney(r.backlogPence, { compact: true })}</span> : <span className="muted">—</span>) },
        { key: "surveyDue", label: "Survey due", render: surveyPill },
        { key: "contact", label: "Parish contact", render: (r) => (r.contact ? <a href={`mailto:${r.contact.email}`}>{r.contact.name}</a> : <span className="muted">None yet</span>) },
      ]}
    />
  );
}

// ---------- Overview ----------
export function EstatesOverview() {
  const { orgId, area } = useEstate();
  const { me } = useSession();
  const org = me.organisations.find((o) => o.id === orgId);
  const [tender, setTender] = useState<Programme | null>(null);
  return (
    <div className="stack">
      <PageHeader
        title="Estate overview"
        subtitle={`${org?.name ?? ""} · Every church, fed by the same records each parish keeps for itself.`}
        actions={
          <>
            <AreaSelect />
            <Button variant="primary" href={boardReportUrl(orgId, area)}>
              Board report
            </Button>
          </>
        }
      />
      <Loading>
        {(d) => (
          <>
            <div className="grid grid-4">
              <StatTile
                label="Overdue checks"
                value={String(d.stats.overdue.count)}
                tone="danger"
                caption={d.stats.overdue.count ? `Across ${d.stats.overdue.churches} ${d.stats.overdue.churches === 1 ? "church" : "churches"}${d.stats.overdue.common ? ` · ${d.stats.overdue.common.count} are ${d.stats.overdue.common.name.toLowerCase()}` : ""}` : "Nothing overdue"}
              />
              <StatTile
                label="Certificates lapsing this quarter"
                value={String(d.stats.lapsing.count)}
                tone="warn"
                caption={d.stats.lapsing.count ? d.stats.lapsing.byType.map((t) => `${t.n} ${t.type.replace("_", " ")}`).join(", ") : "None with an expiry date this quarter"}
              />
              <StatTile label="Open survey actions" value={String(d.stats.openActions.count)} caption={`${d.stats.openActions.a} priority A · ${d.stats.openActions.b} priority B`} href={`/org/${orgId}/backlog`} />
              <StatTile
                label="Backlog at surveyors' estimates"
                value={formatMoney(d.stats.backlog.pence, { compact: true }) || "£0"}
                caption={[d.stats.backlog.clearedThisYearPence ? `${formatMoney(d.stats.backlog.clearedThisYearPence, { compact: true })} cleared since 1 January` : null, d.stats.backlog.topTrade && d.stats.backlog.topTrade.trade !== "Other" ? `${d.stats.backlog.topTrade.share}% is ${d.stats.backlog.topTrade.trade.toLowerCase()}` : null].filter(Boolean).join(" · ") || "Midpoint of each estimate range"}
              />
            </div>
            <div className="grid grid-3">
              <SurveyCycle d={d} />
              <Card className="span-2" title="Suggested programmes" headingId="es-programmes" link={{ label: "All programmes", href: `/org/${orgId}/programmes` }} caption="Work due at several churches in the same window, grouped so it can be instructed once.">
                <ProgrammeRows programmes={d.programmes} onBuild={setTender} />
              </Card>
            </div>
            <Card title="Churches needing attention first" headingId="es-churches" caption="Sorted by priority A actions, then overdue checks" link={{ label: "All churches", href: `/org/${orgId}/buildings` }}>
              <ChurchesTable rows={d.rows} limit={10} />
            </Card>
          </>
        )}
      </Loading>
      {tender && <TenderSheet orgId={orgId} programme={tender} onClose={() => setTender(null)} />}
    </div>
  );
}

function SurveyCycle({ d }: { d: Overview }) {
  const max = Math.max(1, ...d.cycle.map((c) => c.due + c.overdue));
  const overdue = d.cycle[0]?.overdue ?? 0;
  return (
    <Card title="Survey cycle" headingId="es-cycle" caption="Quinquennial inspections due by year">
      {d.cycle.map((c) => (
        <ProgressBar key={c.year} large label={String(c.year)} value={((c.due + c.overdue) / max) * 100} tone={c.overdue ? "danger" : "ok"} rightLabel={c.overdue ? `${c.overdue} overdue${c.due ? `, ${c.due} due` : ""}` : `${c.due} due`} />
      ))}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {overdue
          ? `${overdue} ${overdue === 1 ? "church is" : "churches are"} past the five-year date. Instructing them together as one block would bring the cycle back in line.`
          : "No church is past its five-year inspection date."}
      </p>
    </Card>
  );
}

function ProgrammeRows({ programmes, onBuild }: { programmes: Programme[]; onBuild: (p: Programme) => void }) {
  if (programmes.length === 0) {
    return <p className="muted" style={{ margin: 0 }}>Nothing to group yet. A programme is suggested when five or more churches need the same check within 120 days.</p>;
  }
  return (
    <AttentionList>
      {programmes.map((p) => (
        <AttentionRow
          key={p.key}
          pill={{ tone: p.overdue ? "danger" : "warn", label: `${p.churches} churches` }}
          title={p.title}
          detail={[`Due by ${formatDate(p.windowEnd)}`, p.overdue ? `${p.overdue} already overdue` : null, p.areas.length ? p.areas.join(", ") : null, p.estimateLowPence != null ? `Est. ${formatRangeText(p.estimateLowPence, p.estimateHighPence)}` : null].filter(Boolean).join(" · ")}
          action={{ label: "Build tender", onClick: () => onBuild(p) }}
        />
      ))}
    </AttentionList>
  );
}

function TenderSheet({ orgId, programme, onClose }: { orgId: string; programme: Programme; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const csv = () => {
    const cell = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
    const lines = [["Church", "Pastoral area", "Due", "Status"].map(cell).join(","), ...programme.buildings.map((b) => [b.name, b.area ?? "", b.nextDue, b.overdue ? "Overdue" : "Due"].map(cell).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${programme.title} schedule.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/orgs/${orgId}/estate/programmes`, { title: programme.title, type: programme.key, buildingIds: programme.buildings.map((b) => b.id), windowEnd: programme.windowEnd, estimateLowPence: programme.estimateLowPence, estimateHighPence: programme.estimateHighPence });
      setSaved(true);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SideSheet
      open
      title={programme.title}
      subtitle={`${programme.churches} churches · due by ${formatDate(programme.windowEnd)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={csv}>
            Download schedule
          </Button>
          <Button loading={busy} disabled={saved} onClick={save}>
            {saved ? "Saved to programmes" : "Save as a programme"}
          </Button>
        </>
      }
    >
      {error && <ErrorPanel message={error} />}
      {saved && <Notice>Saved. Track it on the Programmes page.</Notice>}
      <p style={{ margin: 0 }}>
        A schedule of the churches and dates, to send to contractors for one price. Nothing is sent from here.
        {programme.estimateLowPence != null && ` Typical cost for the block: ${formatRangeText(programme.estimateLowPence, programme.estimateHighPence)}.`}
      </p>
      <ul className="history">
        {programme.buildings.map((b) => (
          <li key={b.id}>
            <strong>{b.name}</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              {[b.area, b.overdue ? `Overdue since ${formatDate(b.nextDue)}` : `Due ${formatDate(b.nextDue)}`].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </SideSheet>
  );
}

// ---------- Sections ----------
export function EstatesBuildings() {
  return (
    <div className="stack">
      <PageHeader title="Buildings" subtitle="Every church in the estate." actions={<AreaSelect />} />
      <Loading>{(d) => <Card><ChurchesTable rows={d.rows} /></Card>}</Loading>
    </div>
  );
}

export function EstatesSurveys() {
  return (
    <div className="stack">
      <PageHeader title="Survey cycle" subtitle="When each church's quinquennial inspection is due." actions={<AreaSelect />} />
      <Loading>
        {(d) => (
          <div className="grid grid-3">
            <SurveyCycle d={d} />
            <Card className="span-2" title="By due date" headingId="es-surveys">
              <DataTable<Row & Record<string, unknown>>
                caption="Surveys by due date"
                rows={[...d.rows].sort((a, b) => (a.surveyDue ?? "9999").localeCompare(b.surveyDue ?? "9999")) as (Row & Record<string, unknown>)[]}
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", label: "Church", render: (r) => <Link to={`/b/${r.id}`}>{r.name}</Link> },
                  { key: "area", label: "Pastoral area", render: (r) => r.area?.name ?? "—" },
                  { key: "surveyDue", label: "Due", render: surveyPill },
                ]}
              />
            </Card>
          </div>
        )}
      </Loading>
    </div>
  );
}

type BacklogTask = { id: string; buildingId: string; church: string; area: string | null; ref: string; band: string; text: string; trade: string | null; permission: string; status: string; estimateLowPence: number | null; estimateHighPence: number | null };

export function EstatesBacklog() {
  const { orgId, area } = useEstate();
  const [tasks, setTasks] = useState<BacklogTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ tasks: BacklogTask[] }>(`/orgs/${orgId}/estate/backlog${area ? `?area=${area}` : ""}`).then((r) => setTasks(r.tasks)).catch((e: ApiError) => setError(e.message));
  }, [orgId, area]);
  const total = (tasks ?? []).reduce((s, t) => s + Math.round(((t.estimateLowPence ?? t.estimateHighPence ?? 0) + (t.estimateHighPence ?? t.estimateLowPence ?? 0)) / 2), 0);
  return (
    <div className="stack">
      <PageHeader title="Backlog" subtitle="Open quinquennial actions across every church, at the inspectors' estimates." actions={<AreaSelect />} />
      {error && <ErrorPanel message={error} />}
      {!tasks && !error && <Skeleton height={300} />}
      {tasks && (
        <Card caption={`${tasks.length} open actions · ${formatMoney(total, { compact: true })} at estimate midpoints`}>
          <DataTable<BacklogTask & Record<string, unknown>>
            caption="Open actions"
            rows={tasks as (BacklogTask & Record<string, unknown>)[]}
            rowKey={(t) => t.id}
            groupBy={(t) => t.band}
            groupLabel={(g) => `Priority ${g}`}
            emptyMessage="No open actions."
            columns={[
              { key: "church", label: "Church", render: (t) => <Link to={`/b/${t.buildingId}/quinquennial`}>{t.church}</Link> },
              { key: "ref", label: "Ref", nowrap: true },
              { key: "text", label: "Recommendation" },
              { key: "trade", label: "Trade", render: (t) => t.trade ?? "—" },
              { key: "estimate", label: "Estimate", align: "right", nowrap: true, render: (t) => formatRangeText(t.estimateLowPence, t.estimateHighPence) || "—" },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

type SavedProgramme = { id: string; title: string; type: string; status: string; windowEnd: string | null; buildingIds: string[]; estimateLowPence: number | null; estimateHighPence: number | null };

export function EstatesProgrammes() {
  const { orgId, role } = useEstate();
  const [saved, setSaved] = useState<SavedProgramme[] | null>(null);
  const [tender, setTender] = useState<Programme | null>(null);
  const load = useCallback(() => api.get<{ programmes: SavedProgramme[] }>(`/orgs/${orgId}/estate/programmes`).then((r) => setSaved(r.programmes)), [orgId]);
  useEffect(() => void load(), [load]);
  const setStatus = async (id: string, status: string) => {
    await api.patch(`/orgs/${orgId}/estate/programmes/${id}`, { status });
    await load();
  };
  return (
    <div className="stack">
      <PageHeader title="Programmes" subtitle="The same work at several churches, instructed once." actions={<AreaSelect />} />
      <Loading>
        {(d) => (
          <Card title="Suggested now" headingId="es-suggested">
            <ProgrammeRows programmes={d.programmes} onBuild={setTender} />
          </Card>
        )}
      </Loading>
      <Card title="Saved programmes" headingId="es-saved">
        {!saved ? (
          <Skeleton height={80} />
        ) : saved.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>None saved yet. Build a tender from a suggestion and save it here to track it.</p>
        ) : (
          <DataTable<SavedProgramme & Record<string, unknown>>
            caption="Saved programmes"
            rows={saved as (SavedProgramme & Record<string, unknown>)[]}
            rowKey={(p) => p.id}
            columns={[
              { key: "title", label: "Programme" },
              { key: "buildingIds", label: "Churches", align: "right", render: (p) => String(p.buildingIds.length) },
              { key: "estimate", label: "Estimate", align: "right", nowrap: true, render: (p) => formatRangeText(p.estimateLowPence, p.estimateHighPence) || "—" },
              {
                key: "status",
                label: "Status",
                render: (p) =>
                  role === "estates" || role === "estates_admin" ? (
                    <select className="control" value={p.status} aria-label={`Status of ${p.title}`} onChange={(e) => setStatus(p.id, e.target.value)} style={{ minWidth: 150 }}>
                      <option value="tendering">Tendering</option>
                      <option value="instructed">Instructed</option>
                      <option value="done">Done</option>
                    </select>
                  ) : (
                    p.status
                  ),
              },
            ]}
          />
        )}
      </Card>
      {tender && <TenderSheet orgId={orgId} programme={tender} onClose={() => { setTender(null); void load(); }} />}
    </div>
  );
}

export function EstatesSpend() {
  const { orgId, area } = useEstate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<{ id: string; name: string; area: string | null; totalPence: number; jobs: number }[] | null>(null);
  useEffect(() => {
    setRows(null);
    api.get<{ rows: NonNullable<typeof rows> }>(`/orgs/${orgId}/estate/spend?year=${year}${area ? `&area=${area}` : ""}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [orgId, area, year]);
  const total = (rows ?? []).reduce((s, r) => s + r.totalPence, 0);
  return (
    <div className="stack">
      <PageHeader
        title="Spend"
        subtitle="Work logged by each parish, by year."
        actions={
          <>
            <div style={{ minWidth: 120 }}>
              <Select label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => ({ value: y, label: y }))} />
            </div>
            <AreaSelect />
          </>
        }
      />
      {!rows ? (
        <Skeleton height={300} />
      ) : (
        <Card caption={`${formatPounds(total) || "£0"} across ${rows.reduce((s, r) => s + r.jobs, 0)} jobs in ${year}`}>
          <DataTable<NonNullable<typeof rows>[number] & Record<string, unknown>>
            caption="Spend by church"
            rows={[...rows].sort((a, b) => b.totalPence - a.totalPence) as (NonNullable<typeof rows>[number] & Record<string, unknown>)[]}
            rowKey={(r) => r.id}
            columns={[
              { key: "name", label: "Church", render: (r) => <Link to={`/b/${r.id}/jobs`}>{r.name}</Link> },
              { key: "area", label: "Pastoral area", render: (r) => r.area ?? "—" },
              { key: "jobs", label: "Jobs", align: "right" },
              { key: "totalPence", label: "Spend", align: "right", render: (r) => formatPounds(r.totalPence) || "£0" },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

export function EstatesContractors() {
  const { orgId } = useEstate();
  const [rows, setRows] = useState<{ name: string; trade: string | null; phone: string | null; email: string | null; jobs: number; totalPence: number; churches: number }[] | null>(null);
  useEffect(() => {
    api.get<{ contractors: NonNullable<typeof rows> }>(`/orgs/${orgId}/estate/contractors`).then((r) => setRows(r.contractors)).catch(() => setRows([]));
  }, [orgId]);
  return (
    <div className="stack">
      <PageHeader title="Contractors" subtitle="Who the parishes use, from their job logs." />
      {!rows ? (
        <Skeleton height={300} />
      ) : (
        <Card>
          <DataTable<NonNullable<typeof rows>[number] & Record<string, unknown>>
            caption="Contractors used"
            rows={rows as (NonNullable<typeof rows>[number] & Record<string, unknown>)[]}
            rowKey={(r) => `${r.name}-${r.email}`}
            emptyMessage="No jobs with contractors logged yet."
            columns={[
              { key: "name", label: "Contractor" },
              { key: "trade", label: "Trade", render: (r) => r.trade ?? "—" },
              { key: "churches", label: "Churches", align: "right" },
              { key: "jobs", label: "Jobs", align: "right" },
              { key: "totalPence", label: "Spend", align: "right", render: (r) => formatPounds(r.totalPence) || "£0" },
              { key: "email", label: "Contact", render: (r) => (r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : r.phone ?? "—") },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

export function EstatesReports() {
  const { orgId, area } = useEstate();
  return (
    <div className="stack">
      <PageHeader title="Reports" actions={<AreaSelect />} />
      <Card title="Board report" headingId="es-board" caption="One row per church: overdue checks, open actions, backlog, survey date and parish contact. Opens in Excel or Google Sheets.">
        <div>
          <Button variant="primary" href={boardReportUrl(orgId, area)}>
            Download board report
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function EstatesUsers() {
  const { orgId, role } = useEstate();
  return (
    <div className="stack">
      <PageHeader title="Users" subtitle="The estates team." />
      {role === "estates_admin" ? (
        <PeopleCard orgId={orgId} roles={["estates", "estates_admin"]} caption="The estates team can read every church's records and write their own notes and programmes. Only estates admins can invite." />
      ) : (
        <Card>
          <p style={{ margin: 0 }}>An estates admin manages the team.</p>
        </Card>
      )}
    </div>
  );
}

// ---------- Estates notes, shown on a church's dashboard ----------
type Note = { id: string; body: string; sharedWithParish: boolean; createdAt: string; author: string | null };

export function EstatesNotesCard({ buildingId }: { buildingId: string }) {
  const [data, setData] = useState<{ notes: Note[]; canWrite: boolean } | null>(null);
  const [text, setText] = useState("");
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.get<{ notes: Note[]; canWrite: boolean }>(`/buildings/${buildingId}/estates-notes`).then(setData).catch(() => setData(null)), [buildingId]);
  useEffect(() => void load(), [load]);
  if (!data || (!data.canWrite && data.notes.length === 0)) return null;
  const add = async () => {
    setError(null);
    try {
      await api.post(`/buildings/${buildingId}/estates-notes`, { body: text, sharedWithParish: share });
      setText("");
      setShare(false);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  const toggle = async (n: Note) => {
    await api.patch(`/buildings/${buildingId}/estates-notes/${n.id}`, { sharedWithParish: !n.sharedWithParish });
    await load();
  };
  return (
    <Card
      title={data.canWrite ? "Estates notes" : "Notes from the diocese"}
      headingId="estates-notes"
      caption={data.canWrite ? "Private to the estates team unless you share a note with the parish." : "Shared with you by the diocesan estates team."}
    >
      {error && <ErrorPanel message={error} />}
      {data.notes.length > 0 && (
        <ul className="history">
          {data.notes.map((n) => (
            <li key={n.id}>
              <span>{n.body}</span>
              <span className="muted" style={{ fontSize: 13, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {[n.author, formatDate(n.createdAt.slice(0, 10))].filter(Boolean).join(" · ")}
                {data.canWrite && (
                  <>
                    <Pill tone={n.sharedWithParish ? "info" : "neutral"} label={n.sharedWithParish ? "Shared with parish" : "Private"} />
                    <button type="button" className="link-button" onClick={() => toggle(n)}>
                      {n.sharedWithParish ? "Make private" : "Share with parish"}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.canWrite && (
        <div className="sheet-section">
          <label className="field" htmlFor="estates-note-text">
            Add a note
          </label>
          <textarea id="estates-note-text" className="control" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Consider for the Places of Worship Renewal Fund" />
          <label className="check">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            Share this note with the parish
          </label>
          <div>
            <Button size="sm" disabled={!text.trim()} onClick={add}>
              Add note
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
