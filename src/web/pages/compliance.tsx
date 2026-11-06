// Screen 2: compliance calendar (UI-HANDOFF §8).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, type Calendar, type ComplianceItem, type ItemDetail } from "../api";
import { formatDate } from "../format";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, Skeleton, type Tone } from "../ui/basics";
import { DataTable, FilterChips, MonthStrip } from "../ui/data";
import { Checkbox, DateInput, FileDrop, Input, Select, Textarea } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";
import { useChurch } from "./church";

const STATUS_TONE: Record<ComplianceItem["status"], Tone> = {
  overdue: "danger",
  due_soon: "warn",
  on_track: "ok",
  not_recorded: "neutral",
};

const FREQUENCIES = [
  { value: "1", label: "Monthly" },
  { value: "3", label: "Every 3 months" },
  { value: "6", label: "Twice yearly" },
  { value: "12", label: "Yearly" },
  { value: "24", label: "Every 2 years" },
  { value: "36", label: "Every 3 years" },
  { value: "48", label: "Every 4 years" },
  { value: "60", label: "Every 5 years" },
];
const DOC_TYPES = [
  { value: "certificate", label: "Certificate" },
  { value: "invoice", label: "Invoice" },
  { value: "report", label: "Report" },
  { value: "insurance_schedule", label: "Insurance schedule" },
  { value: "survey", label: "Survey" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label]));

type Filter = "all" | "overdue" | "due_soon" | "on_track" | "not_recorded" | "missing_evidence";

export function CompliancePage() {
  const { building } = useChurch();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const filter = (params.get("filter") as Filter) || "all";

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get<Calendar>(`/buildings/${building.id}/compliance`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [building.id]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.items.filter((i) => {
      if (filter === "missing_evidence" ? !i.missingEvidence : filter !== "all" && i.status !== filter) return false;
      if (month) {
        const isCurrent = month === data.months[0]?.key;
        return i.nextDue?.slice(0, 7) === month || (isCurrent && i.status === "overdue");
      }
      return true;
    });
  }, [data, filter, month]);

  const setFilter = (f: string) => {
    const next = new URLSearchParams(params);
    if (f === "all") next.delete("filter");
    else next.set("filter", f);
    setParams(next, { replace: true });
  };

  const done = async (message: string) => {
    setFlash(message);
    await load();
  };

  if (error) return <ErrorPanel message={error.message} onRetry={load} />;

  const monthLabel = month ? data?.months.find((m) => m.key === month)?.fullLabel : null;

  return (
    <div className="stack">
      <PageHeader
        title="Compliance calendar"
        subtitle="Every recurring check for this building, with the evidence behind it. Frequencies start from the insurer's and diocese's guidance and can be changed."
        actions={
          <>
            <Button onClick={() => window.print()}>Print or save as PDF</Button>
            {data?.canWrite && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add a recurring item
              </Button>
            )}
          </>
        }
      />
      {flash && <Notice>{flash}</Notice>}

      {!data ? (
        <>
          <Skeleton height={130} />
          <Skeleton height={420} />
        </>
      ) : (
        <>
          {data.counts.not_recorded > 0 && data.canWrite && (
            <Notice tone="info">
              {data.counts.not_recorded === data.counts.all
                ? "Start by recording when each check was last done. Open any row to add the date and its certificate."
                : `${data.counts.not_recorded} ${data.counts.not_recorded === 1 ? "check has" : "checks have"} no record yet. Add when each was last done so its next date can be worked out.`}
            </Notice>
          )}

          <Card title="Next twelve months" headingId="months-heading" caption="Items falling due each month. Overdue items count in this month.">
            <MonthStrip months={data.months} selected={month} onSelect={setMonth} />
          </Card>

          <Card>
            <div className="filter-row">
              <FilterChips
                label="Show"
                selected={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All", count: data.counts.all },
                  { value: "overdue", label: "Overdue", count: data.counts.overdue },
                  { value: "due_soon", label: "Due in 90 days", count: data.counts.due_soon },
                  { value: "on_track", label: "On track", count: data.counts.on_track },
                  { value: "missing_evidence", label: "Missing evidence", count: data.counts.missing_evidence },
                  ...(data.counts.not_recorded ? [{ value: "not_recorded", label: "No record yet", count: data.counts.not_recorded }] : []),
                ]}
              />
              {monthLabel && (
                <button type="button" className="chip" aria-pressed="true" onClick={() => setMonth(null)} aria-label={`Remove the ${monthLabel} filter`}>
                  Due in {monthLabel} ×
                </button>
              )}
            </div>
            <ItemsTable rows={rows} onOpen={setOpenItem} canWrite={data.canWrite} buildingId={building.id} />
            {data.items.length === 0 && (
              <Notice tone="neutral">Every check has been removed. Use “Add a recurring item” to start again.</Notice>
            )}
          </Card>
        </>
      )}

      {openItem && (
        <ItemSheet
          buildingId={building.id}
          itemId={openItem}
          canWrite={Boolean(data?.canWrite)}
          today={data?.today ?? ""}
          onClose={() => setOpenItem(null)}
          onChanged={done}
        />
      )}
      {adding && <AddItemSheet buildingId={building.id} today={data?.today ?? ""} onClose={() => setAdding(false)} onChanged={done} />}
    </div>
  );
}

function evidenceCell(i: ComplianceItem, buildingId: string) {
  if (i.evidence?.kind === "document") {
    const d = i.evidence.document;
    const year = (d.documentDate ?? i.lastDone ?? "").slice(0, 4);
    return (
      <a href={`/api/buildings/${buildingId}/documents/${d.id}/file`} target="_blank" rel="noopener">
        {d.title || DOC_LABEL[d.type]}
        {year && !d.title.includes(year) ? ` ${year}` : ""}
      </a>
    );
  }
  if (i.evidence?.kind === "person") return i.evidence.name ? `Logged by ${i.evidence.name}` : "Logged";
  if (i.missingEvidence) return <span className="warn-text">Certificate not uploaded</span>;
  return <span className="muted">None yet</span>;
}

function actionFor(i: ComplianceItem): string | null {
  if (i.status === "not_recorded") return i.partial ? "Finish test" : "Add last done";
  if (i.status === "overdue" || i.status === "due_soon") return i.selfCheck ? "Record test" : "Record";
  if (i.missingEvidence) return "Upload";
  return null;
}

function ItemsTable({ rows, onOpen, canWrite, buildingId }: { rows: ComplianceItem[]; onOpen: (id: string) => void; canWrite: boolean; buildingId: string }) {
  return (
    <DataTable<ComplianceItem & Record<string, unknown>>
      caption="Compliance items"
      rows={rows as (ComplianceItem & Record<string, unknown>)[]}
      rowKey={(r) => r.id}
      emptyMessage="Nothing matches this filter."
      columns={[
        {
          key: "name",
          label: "Item",
          render: (r) => (
            <button type="button" className="link-button item-name" style={{ color: "var(--ink)", textDecoration: "none" }} onClick={() => onOpen(r.id)} title={r.note ?? undefined}>
              {r.name}
              {r.doneBy && <span className="item-sub">{r.doneBy}</span>}
            </button>
          ),
        },
        { key: "frequencyLabel", label: "Frequency" },
        { key: "lastDone", label: "Last done", nowrap: true, render: (r) => formatDate(r.lastDone) || <span className="muted">Not recorded</span> },
        { key: "nextDue", label: "Next due", nowrap: true, render: (r) => formatDate(r.nextDue) },
        { key: "evidence", label: "Evidence on file", render: (r) => evidenceCell(r, buildingId) },
        { key: "status", label: "Status", render: (r) => <Pill tone={STATUS_TONE[r.status]} label={r.statusLabel} /> },
        {
          key: "action",
          label: "Action",
          render: (r) => {
            const label = canWrite ? actionFor(r) : null;
            return label ? (
              <Button size="sm" onClick={() => onOpen(r.id)} aria-label={`${label}: ${r.name}`}>
                {label}
              </Button>
            ) : null;
          },
        },
      ]}
    />
  );
}

// ---------- Item sheet: details, record, history, settings ----------
function ItemSheet({
  buildingId,
  itemId,
  canWrite,
  today,
  onClose,
  onChanged,
}: {
  buildingId: string;
  itemId: string;
  canWrite: boolean;
  today: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setDetail(await api.get<ItemDetail>(`/buildings/${buildingId}/compliance/${itemId}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [buildingId, itemId]);
  useEffect(() => void load(), [load]);

  const item = detail?.item;
  return (
    <SideSheet
      open
      title={item?.name ?? "Loading"}
      subtitle={item && <Pill tone={STATUS_TONE[item.status]} label={item.statusLabel} />}
      onClose={onClose}
      ready={Boolean(detail)}
    >
      {error && <ErrorPanel message={error} onRetry={load} />}
      {!detail || !item ? (
        !error && <Skeleton height={240} />
      ) : (
        <>
          <dl className="facts">
            <dt>How often</dt>
            <dd>{item.frequencyLabel}</dd>
            <dt>Last done</dt>
            <dd>{formatDate(item.lastDone) || "Not recorded"}</dd>
            <dt>Next due</dt>
            <dd>
              {formatDate(item.nextDue) || "Once it has been recorded"}
              {item.nextDueOverride && " (set by hand)"}
            </dd>
            {item.doneBy && (
              <>
                <dt>Usually done by</dt>
                <dd>{item.doneBy}</dd>
              </>
            )}
          </dl>
          {item.note && <p style={{ margin: 0 }}>{item.note}</p>}

          {canWrite && (
            <RecordForm
              buildingId={buildingId}
              detail={detail}
              today={today}
              onSaved={async (msg) => {
                await onChanged(msg);
                onClose();
              }}
            />
          )}

          <History buildingId={buildingId} detail={detail} canWrite={canWrite} onChanged={async (m) => { await load(); await onChanged(m); }} />

          {canWrite && <ItemSettings buildingId={buildingId} item={item} onChanged={async (m) => { await onChanged(m); onClose(); }} />}
        </>
      )}
    </SideSheet>
  );
}

function RecordForm({ buildingId, detail, today, onSaved }: { buildingId: string; detail: ItemDetail; today: string; onSaved: (message: string) => Promise<void> }) {
  const { item, fittings } = detail;
  const isChecklist = Boolean(item.fittingKind);
  const [doneOn, setDoneOn] = useState(today);
  const [who, setWho] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("certificate");
  const [ticks, setTicks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((item.partial?.checklist ?? []).map((r) => [r.fittingId, r.ok])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticked = fittings.filter((f) => ticks[f.id]).length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let documentId: string | undefined;
      if (file) documentId = (await api.upload(buildingId, file, { type: docType, documentDate: doneOn })).id;
      const res = await api.post<{ partial: boolean }>(`/buildings/${buildingId}/compliance/${item.id}/occurrences`, {
        doneOn,
        doneByText: who,
        notes,
        documentId,
        checklist: isChecklist && fittings.length ? fittings.map((f) => ({ fittingId: f.id, ok: Boolean(ticks[f.id]) })) : undefined,
      });
      await onSaved(res.partial ? `Saved ${ticked} of ${fittings.length} lights. Finish the rest to complete the test.` : `${item.name} recorded for ${formatDate(doneOn)}.`);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sheet-section" onSubmit={submit}>
      <h3>{item.status === "not_recorded" && !item.partial ? "When was it last done?" : "Record it as done"}</h3>
      {error && <ErrorPanel message={error} />}
      <DateInput label="Date done" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} required />
      <Input label="Who did it" value={who} onChange={(e) => setWho(e.target.value)} placeholder={item.doneBy ?? ""} />
      {isChecklist && (
        <div className="sheet-section">
          {fittings.length === 0 ? (
            <Notice tone="info">
              Add the emergency lights on the <a href={`/b/${buildingId}/building`}>Building page</a> to tick each one off here.
            </Notice>
          ) : (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field" style={{ marginBottom: 4 }}>
                Tick each light that came on ({ticked} of {fittings.length})
              </legend>
              {fittings.map((f) => (
                <Checkbox key={f.id} label={f.location} checked={Boolean(ticks[f.id])} onChange={(e) => setTicks({ ...ticks, [f.id]: e.target.checked })} />
              ))}
            </fieldset>
          )}
        </div>
      )}
      {!item.selfCheck && (
        <>
          <FileDrop label={file ? `Chosen: ${file.name}` : "Add the certificate or invoice"} onFiles={(fs) => setFile(fs[0] ?? null)} />
          {file && <Select label="Document type" value={docType} options={DOC_TYPES} onChange={(e) => setDocType(e.target.value)} />}
        </>
      )}
      <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div>
        <Button variant="primary" type="submit" loading={busy}>
          {isChecklist && fittings.length && ticked < fittings.length ? `Save ${ticked} of ${fittings.length} so far` : "Save record"}
        </Button>
      </div>
    </form>
  );
}

function History({ buildingId, detail, canWrite, onChanged }: { buildingId: string; detail: ItemDetail; canWrite: boolean; onChanged: (m: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (detail.history.length === 0) return null;
  const attach = async (occurrenceId: string, file: File) => {
    setBusy(occurrenceId);
    setError(null);
    try {
      const doc = await api.upload(buildingId, file, { type: "certificate" });
      await api.post(`/buildings/${buildingId}/occurrences/${occurrenceId}/evidence`, { documentId: doc.id });
      await onChanged("Certificate added.");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="sheet-section">
      <h3>History</h3>
      {error && <ErrorPanel message={error} />}
      <ul className="history">
        {detail.history.map((h) => (
          <li key={h.id}>
            <strong>
              {formatDate(h.doneOn)}
              {h.status === "partial" && " · part done"}
            </strong>
            <span className="muted" style={{ fontSize: 13 }}>
              {[h.doneByText, h.recordedBy && `recorded by ${h.recordedBy}`].filter(Boolean).join(" · ")}
            </span>
            {h.notes && <span style={{ fontSize: 13 }}>{h.notes}</span>}
            {h.documentId ? (
              <a href={`/api/buildings/${buildingId}/documents/${h.documentId}/file`} target="_blank" rel="noopener" style={{ fontSize: 13 }}>
                {h.documentTitle}
              </a>
            ) : (
              canWrite &&
              !detail.item.selfCheck &&
              h.status === "complete" && (
                <label className="link-button" style={{ fontSize: 13 }}>
                  {busy === h.id ? "Uploading…" : "Add the certificate"}
                  <input type="file" className="visually-hidden" onChange={(e) => e.target.files?.[0] && attach(h.id, e.target.files[0])} />
                </label>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemSettings({ buildingId, item, onChanged }: { buildingId: string; item: ComplianceItem; onChanged: (m: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState(String(item.frequencyMonths));
  const [override, setOverride] = useState(item.nextDueOverride ?? "");
  const [doneBy, setDoneBy] = useState(item.doneBy ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freqOptions = FREQUENCIES.some((f) => f.value === frequency) ? FREQUENCIES : [...FREQUENCIES, { value: frequency, label: item.frequencyLabel }];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/buildings/${buildingId}/compliance/${item.id}`, { frequencyMonths: Number(frequency), nextDueOverride: override || null, doneBy });
      await onChanged(`${item.name} updated.`);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove “${item.name}” from the calendar? Its history is kept.`)) return;
    try {
      await api.post(`/buildings/${buildingId}/compliance/${item.id}/remove`);
      await onChanged(`${item.name} removed from the calendar.`);
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Change how often, or the next date
        </Button>
      </div>
    );
  }
  return (
    <form className="sheet-section" onSubmit={save}>
      <h3>Change this check</h3>
      {error && <ErrorPanel message={error} />}
      <Select label="How often" value={frequency} options={freqOptions} onChange={(e) => setFrequency(e.target.value)} />
      <DateInput label="Next due (leave empty to work it out)" value={override} onChange={(e) => setOverride(e.target.value)} hint="Use this when a contractor is booked for a set date." />
      <Input label="Usually done by" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="primary" type="submit" loading={busy}>
          Save changes
        </Button>
        <Button variant="ghost" onClick={remove}>
          Remove from calendar
        </Button>
      </div>
    </form>
  );
}

// ---------- Add a recurring item ----------
function AddItemSheet({ buildingId, today, onClose, onChanged }: { buildingId: string; today: string; onClose: () => void; onChanged: (m: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("12");
  const [doneBy, setDoneBy] = useState("");
  const [lastDone, setLastDone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.post<{ id: string }>(`/buildings/${buildingId}/compliance`, { name, frequencyMonths: Number(frequency), doneBy });
      if (lastDone) {
        const documentId = file ? (await api.upload(buildingId, file, { type: "certificate", documentDate: lastDone })).id : undefined;
        await api.post(`/buildings/${buildingId}/compliance/${id}/occurrences`, { doneOn: lastDone, documentId });
      }
      await onChanged(`${name} added to the calendar.`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <SideSheet
      open
      title="Add a recurring item"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" loading={busy} onClick={() => (document.getElementById("add-item-form") as HTMLFormElement | null)?.requestSubmit()}>
            Add to calendar
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id="add-item-form" className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <Input label="What needs doing" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bell frame inspection" required />
        <Select label="How often" value={frequency} options={FREQUENCIES} onChange={(e) => setFrequency(e.target.value)} />
        <Input label="Usually done by" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="Bell adviser" />
        <DateInput label="Last done (if known)" value={lastDone} max={today} onChange={(e) => setLastDone(e.target.value)} />
        {lastDone && <FileDrop label={file ? `Chosen: ${file.name}` : "Add the certificate (optional)"} onFiles={(fs) => setFile(fs[0] ?? null)} />}
      </form>
    </SideSheet>
  );
}
