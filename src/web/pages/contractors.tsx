// Contractors: the parish's address book, one card per contractor, with the jobs they've done.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatPounds } from "../../shared/money";
import { api, ApiError, type Contractor } from "../api";
import { formatDate } from "../format";
import { Button, Card, ErrorPanel, Notice, PageHeader, Skeleton } from "../ui/basics";
import { Input, Textarea } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";
import { useChurch } from "./church";

type Detail = { contractor: Contractor; jobs: { id: string; title: string; doneOn: string | null; costPence: number | null; status: string }[] };

export function ContractorsPage() {
  const { building } = useChurch();
  const [data, setData] = useState<{ contractors: Contractor[]; canWrite: boolean } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [sheet, setSheet] = useState<Contractor | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get(`/buildings/${building.id}/contractors`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [building.id]);
  useEffect(() => void load(), [load]);

  const q = query.trim().toLowerCase();
  const shown = (data?.contractors ?? []).filter((c) => !q || [c.name, c.trade, c.contactName].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div className="stack">
      <PageHeader
        title="Contractors"
        subtitle="The people you call for the boiler, the roof and the gutters. Shared by every building in the parish."
        actions={
          data?.canWrite && (
            <Button variant="primary" onClick={() => setSheet("new")}>
              Add a contractor
            </Button>
          )
        }
      />
      {flash && <Notice>{flash}</Notice>}
      {error && <ErrorPanel message={error.message} onRetry={load} />}
      {!data && !error && <Skeleton height={240} />}
      {data && data.contractors.length > 6 && (
        <div style={{ maxWidth: 360 }}>
          <Input label="Find a contractor" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or trade" />
        </div>
      )}
      {data &&
        (data.contractors.length === 0 ? (
          <Card>
            <p style={{ margin: 0 }}>No contractors yet. Add the people you already use, and they'll appear when you log a job.</p>
          </Card>
        ) : (
          <div className="contractor-grid">
            {shown.map((c) => (
              <Card key={c.id} className="contractor-card">
                <div>
                  <h2 className="card-title">{c.name}</h2>
                  {c.trade && <div className="trade">{c.trade}</div>}
                </div>
                <div className="lines">
                  {c.contactName && <span>{c.contactName}</span>}
                  {c.phone && <a href={`tel:${c.phone.replace(/\s+/g, "")}`}>{c.phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noopener noreferrer">
                      {c.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                  {c.accreditation && <span className="muted">{c.accreditation}</span>}
                </div>
                <div className="stats">
                  {c.jobCount === 0 ? "No jobs logged yet" : `${c.jobCount} ${c.jobCount === 1 ? "job" : "jobs"} · ${formatPounds(c.totalPence)} · last ${formatDate(c.lastJobOn)}`}
                </div>
                <div>
                  <Button size="sm" onClick={() => setSheet(c)} aria-label={`Open ${c.name}`}>
                    {data.canWrite ? "Details and jobs" : "Jobs"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}
      {sheet && (
        <ContractorSheet
          buildingId={building.id}
          contractor={sheet === "new" ? null : sheet}
          canWrite={Boolean(data?.canWrite)}
          onClose={() => setSheet(null)}
          onSaved={async (m) => {
            setFlash(m);
            await load();
          }}
        />
      )}
    </div>
  );
}

const FIELDS = [
  { key: "name", label: "Name" },
  { key: "trade", label: "Trade", placeholder: "Roofing, heating, electrical…" },
  { key: "contactName", label: "Contact person" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "accreditation", label: "Accreditation", placeholder: "Gas Safe, NICEIC, SPAB…" },
] as const;

function ContractorSheet({
  buildingId,
  contractor,
  canWrite,
  onClose,
  onSaved,
}: {
  buildingId: string;
  contractor: Contractor | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (m: string) => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries([...FIELDS.map((f) => f.key), "notes"].map((k) => [k, ((contractor as Record<string, unknown> | null)?.[k] as string) ?? ""])),
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contractor) api.get<Detail>(`/buildings/${buildingId}/contractors/${contractor.id}`).then(setDetail).catch(() => {});
  }, [buildingId, contractor]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (contractor) await api.patch(`/buildings/${buildingId}/contractors/${contractor.id}`, form);
      else await api.post(`/buildings/${buildingId}/contractors`, form);
      await onSaved(`${form.name} saved.`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!contractor || !window.confirm(`Remove ${contractor.name} from the address book?`)) return;
    try {
      await api.post(`/buildings/${buildingId}/contractors/${contractor.id}/delete`);
      await onSaved(`${contractor.name} removed.`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <SideSheet
      open
      title={contractor ? contractor.name : "Add a contractor"}
      onClose={onClose}
      ready={!contractor || Boolean(detail)}
      footer={
        canWrite && (
          <>
            <Button variant="primary" loading={busy} onClick={() => (document.getElementById("contractor-form") as HTMLFormElement | null)?.requestSubmit()}>
              Save
            </Button>
            {contractor && contractor.jobCount === 0 && (
              <Button variant="ghost" onClick={remove}>
                Remove
              </Button>
            )}
          </>
        )
      }
    >
      {error && <ErrorPanel message={error} />}
      {canWrite ? (
        <form id="contractor-form" className="sheet-section" onSubmit={save}>
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              type={"type" in f ? f.type : "text"}
              placeholder={"placeholder" in f ? f.placeholder : undefined}
              value={form[f.key] ?? ""}
              required={f.key === "name"}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          ))}
          <Textarea label="Notes" rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </form>
      ) : null}
      {contractor && (
        <div className="sheet-section">
          <h3>Jobs</h3>
          {!detail ? (
            <Skeleton height={80} />
          ) : detail.jobs.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None logged yet.
            </p>
          ) : (
            <ul className="history">
              {detail.jobs.map((j) => (
                <li key={j.id}>
                  <strong>{j.title}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {[j.status === "planned" ? "Planned" : formatDate(j.doneOn), formatPounds(j.costPence)].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SideSheet>
  );
}
