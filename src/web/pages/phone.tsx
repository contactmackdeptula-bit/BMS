// Screen 6: warden on the phone (UI-HANDOFF §12). Under 800 px the dashboard
// becomes "This week": what needs doing, the monthly light test, and quick ways
// to log something. Everything here works without signal and syncs later.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CircleCheck, Clock, FileText } from "lucide-react";
import { parsePounds } from "../../shared/money";
import { api, ApiError, type Building, type Calendar, type Contractor, type Dashboard } from "../api";
import { formatDate } from "../format";
import { resizePhoto } from "../image";
import { isOffline, lastKnown, sendOrQueue, usePendingCount } from "../offline";
import { useSession } from "../session";
import { Button, Card, ErrorPanel, Pill, Skeleton } from "../ui/basics";
import { Checkbox, Input, Select, Textarea } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";

type Data = { dashboard: Dashboard; calendar: Calendar; contractors: Contractor[]; savedAt: string };
type Sheet = { kind: "problem"; photo: File } | { kind: "document"; file: File } | { kind: "job" } | { kind: "visit" } | null;

const today = () => new Date().toISOString().slice(0, 10);
const DOT: Record<string, string> = { danger: "var(--danger-text)", warn: "var(--warn-text)", neutral: "var(--ink-muted)", info: "var(--info-text)", ok: "var(--ok-text)" };

export function PhoneHome({ building }: { building: Building }) {
  const { me } = useSession();
  const cacheKey = `phone:${building.id}`;
  const [data, setData] = useState<Data | null>(() => lastKnown.get<Data>(cacheKey));
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirmation, setConfirmation] = useState<string | null>(() => lastKnown.get<string>(`confirm:${building.id}`));
  const queued = usePendingCount();
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [dashboard, calendar, c] = await Promise.all([
        api.get<Dashboard>(`/buildings/${building.id}/dashboard`),
        api.get<Calendar>(`/buildings/${building.id}/compliance`),
        api.get<{ contractors: Contractor[] }>(`/buildings/${building.id}/contractors`),
      ]);
      const fresh = { dashboard, calendar, contractors: c.contractors, savedAt: new Date().toISOString() };
      setData(fresh);
      lastKnown.set(cacheKey, fresh);
      setStale(false);
      setError(null);
    } catch (e) {
      if (isOffline(e)) setStale(true);
      else setError((e as ApiError).message);
    }
  }, [building.id, cacheKey]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const back = () => void load();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [load]);

  const confirm = (message: string) => {
    setConfirmation(message);
    lastKnown.set(`confirm:${building.id}`, message);
  };
  const done = async (result: "sent" | "queued", message: string) => {
    confirm(result === "queued" ? `${message} Saved on this phone, will upload when you have signal.` : message);
    if (result === "sent") await load();
  };

  const canWrite = data?.dashboard.canWrite ?? false;
  const lightItem = data?.calendar.items.find((i) => i.fittingKind === "emergency_light");

  return (
    <div className="stack phone-home" style={{ gap: 14 }}>
      <h1 className="page-title" style={{ fontSize: 22 }}>
        This week
      </h1>
      {queued > 0 && (
        <div className="panel tone-neutral" role="status">
          <span>
            {queued} {queued === 1 ? "thing" : "things"} saved on this phone, will upload when you have signal.
          </span>
        </div>
      )}
      {stale && data && (
        <div className="panel tone-warn" role="status">
          <span>No signal. Showing what this phone last saw at {new Date(data.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</span>
        </div>
      )}
      {error && <ErrorPanel message={error} onRetry={load} />}
      {!data && !error && (stale ? <ErrorPanel message="No signal, and nothing saved on this phone yet. Open this page once with signal." onRetry={load} /> : <Skeleton height={300} />)}

      {data && (
        <>
          <Card>
            <div className="card-head">
              <h2 className="card-title" style={{ fontSize: 15 }}>
                Needs doing
              </h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {data.dashboard.attentionTotal} {data.dashboard.attentionTotal === 1 ? "item" : "items"}
              </span>
            </div>
            {data.dashboard.attention.length === 0 ? (
              <p style={{ margin: 0 }}>Nothing needs doing this week.</p>
            ) : (
              <div className="needs-list">
                {data.dashboard.attention.slice(0, 3).map((a) => (
                  <a key={a.title} className="needs-row" href={a.action.href}>
                    <span className="dot" style={{ background: DOT[a.pill.tone] }} aria-hidden="true" />
                    <span className="needs-text">
                      <strong>{a.title}</strong>
                      <span>
                        {a.pill.label}
                        {a.detail ? ` · ${a.detail}` : ""}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </Card>

          {lightItem && <LightTest buildingId={building.id} building={building} item={lightItem} canWrite={canWrite} who={me.user.name} onDone={done} />}

          {canWrite && (
            <Card>
              <h2 className="card-title" style={{ fontSize: 15 }}>
                Log something now
              </h2>
              <div className="log-grid">
                <button type="button" className="log-button" onClick={() => photoInput.current?.click()}>
                  <Camera size={20} aria-hidden="true" />
                  Photo of a problem
                </button>
                <button type="button" className="log-button" onClick={() => docInput.current?.click()}>
                  <FileText size={20} aria-hidden="true" />
                  Invoice or certificate
                </button>
                <button type="button" className="log-button" onClick={() => setSheet({ kind: "job" })}>
                  <CircleCheck size={20} aria-hidden="true" />
                  Job done, add cost
                </button>
                <button type="button" className="log-button" onClick={() => setSheet({ kind: "visit" })}>
                  <Clock size={20} aria-hidden="true" />
                  Contractor visited
                </button>
              </div>
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setSheet({ kind: "problem", photo: f });
                }}
              />
              <input
                ref={docInput}
                type="file"
                accept="image/*,application/pdf"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setSheet({ kind: "document", file: f });
                }}
              />
            </Card>
          )}

          {confirmation && (
            <div className="panel tone-ok" role="status">
              <span>{confirmation}</span>
            </div>
          )}
        </>
      )}

      {sheet?.kind === "problem" && <ProblemSheet buildingId={building.id} photo={sheet.photo} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "document" && <DocumentSheet buildingId={building.id} file={sheet.file} onClose={() => setSheet(null)} onDone={done} />}
      {(sheet?.kind === "job" || sheet?.kind === "visit") && data && (
        <QuickJobSheet buildingId={building.id} visit={sheet.kind === "visit"} contractors={data.contractors} onClose={() => setSheet(null)} onDone={done} />
      )}
    </div>
  );
}

// ---------- Monthly emergency lighting test ----------
function LightTest({
  buildingId,
  building,
  item,
  canWrite,
  who,
  onDone,
}: {
  buildingId: string;
  building: Building;
  item: Calendar["items"][number];
  canWrite: boolean;
  who: string;
  onDone: (r: "sent" | "queued", m: string) => Promise<void>;
}) {
  const lights = building.fittings.filter((f) => f.kind === "emergency_light");
  const thisMonth = today().slice(0, 7);
  const initial = item.partial && item.partial.doneOn.slice(0, 7) === thisMonth ? item.partial.checklist ?? [] : [];
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => Object.fromEntries(initial.map((r) => [r.fittingId, r.ok])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doneThisMonth = item.lastDone?.slice(0, 7) === thisMonth;
  const count = lights.filter((l) => ticks[l.id]).length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const all = count === lights.length;
      const r = await sendOrQueue({
        kind: "occurrence",
        buildingId,
        itemId: item.id,
        label: "Emergency lighting test",
        body: { doneOn: today(), doneByText: who, checklist: lights.map((l) => ({ fittingId: l.id, ok: Boolean(ticks[l.id]) })) },
      });
      await onDone(r, all ? `Emergency lighting test recorded, all ${lights.length} lights working.` : `${count} of ${lights.length} lights saved. Finish the rest to complete the test.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="card-head">
        <h2 className="card-title" style={{ fontSize: 15 }}>
          Monthly emergency lighting test
        </h2>
        {doneThisMonth ? <Pill tone="ok" label="Done this month" /> : <Pill tone={item.status === "overdue" ? "danger" : "warn"} label={item.nextDue ? `Due ${formatDate(item.nextDue).replace(/ \d{4}$/, "")}` : "Not yet recorded"} />}
      </div>
      {lights.length === 0 ? (
        <p style={{ margin: 0 }}>
          List your emergency lights on the <a href={`/b/${buildingId}/building`}>Building page</a> and they'll appear here as a tick list.
        </p>
      ) : doneThisMonth ? (
        <p className="muted" style={{ margin: 0 }}>
          All {lights.length} lights were checked on {formatDate(item.lastDone)}. Next test due {formatDate(item.nextDue)}.
        </p>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Press the test key on each light and tick it if it comes on.
          </p>
          {error && <ErrorPanel message={error} />}
          <div>
            {lights.map((l) => (
              <Checkbox key={l.id} label={l.location} checked={Boolean(ticks[l.id])} disabled={!canWrite} onChange={(e) => setTicks({ ...ticks, [l.id]: e.target.checked })} />
            ))}
          </div>
          {canWrite && (
            <Button variant="primary" loading={busy} disabled={count === 0} onClick={save}>
              {count === lights.length ? `Record test, all ${lights.length} working` : `Record test, ${count} of ${lights.length} so far`}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

// ---------- Quick logging sheets ----------
function ProblemSheet({ buildingId, photo, onClose, onDone }: { buildingId: string; photo: File; onClose: () => void; onDone: (r: "sent" | "queued", m: string) => Promise<void> }) {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview] = useState(() => URL.createObjectURL(photo));
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const small = await resizePhoto(photo);
      const title = what.trim() || "Problem spotted";
      const r = await sendOrQueue({
        kind: "job",
        buildingId,
        label: title,
        body: { title, status: "planned", notes: [where.trim() && `Where: ${where.trim()}`, `Reported from a phone on ${formatDate(today())}.`].filter(Boolean).join("\n") },
        files: [{ blob: small, name: small.name, type: small.type, docType: "photo" }],
      });
      await onDone(r, `"${title}" added to the job log as planned work, with the photo.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <SideSheet open title="Photo of a problem" onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={() => (document.getElementById("problem-form") as HTMLFormElement | null)?.requestSubmit()}>Save</Button>}>
      <form id="problem-form" className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <img src={preview} alt="The photo you took" style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 8 }} />
        <Input label="What's the problem?" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Slipped slate above the porch" />
        <Input label="Where (optional)" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="South porch roof" />
      </form>
    </SideSheet>
  );
}

const DOC_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "certificate", label: "Certificate" },
  { value: "quote", label: "Quote" },
  { value: "insurance_schedule", label: "Insurance schedule" },
  { value: "other", label: "Something else" },
];

function DocumentSheet({ buildingId, file, onClose, onDone }: { buildingId: string; file: File; onClose: () => void; onDone: (r: "sent" | "queued", m: string) => Promise<void> }) {
  const [docType, setDocType] = useState("invoice");
  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const f = await resizePhoto(file);
      const r = await sendOrQueue({ kind: "upload", buildingId, label: title, title, file: { blob: f, name: f.name, type: f.type, docType } });
      await onDone(r, `${title} saved to Documents. Link it to its job or check from there.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <SideSheet open title="Invoice or certificate" onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={() => (document.getElementById("doc-quick-form") as HTMLFormElement | null)?.requestSubmit()}>Save</Button>}>
      <form id="doc-quick-form" className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <Select label="What is it" value={docType} options={DOC_OPTIONS} onChange={(e) => setDocType(e.target.value)} />
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {file.name}
        </p>
      </form>
    </SideSheet>
  );
}

function QuickJobSheet({
  buildingId,
  visit,
  contractors,
  onClose,
  onDone,
}: {
  buildingId: string;
  visit: boolean;
  contractors: Contractor[];
  onClose: () => void;
  onDone: (r: "sent" | "queued", m: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [contractorId, setContractorId] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contractorName = contractors.find((c) => c.id === contractorId)?.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const costPence = visit ? null : parsePounds(cost);
    if (Number.isNaN(costPence)) return setError("Enter the cost in pounds, like 380.");
    if (visit && !contractorId) return setError("Choose who visited.");
    if (!visit && !title.trim()) return setError("Say what was done.");
    setBusy(true);
    setError(null);
    try {
      const jobTitle = visit ? `Visit by ${contractorName}${title.trim() ? `: ${title.trim()}` : ""}` : title.trim();
      const r = await sendOrQueue({
        kind: "job",
        buildingId,
        label: jobTitle,
        body: { title: jobTitle, status: "done", doneOn: today(), contractorId: contractorId || null, costPence, notes },
        files: [],
      });
      await onDone(r, visit ? `${contractorName}'s visit logged for today.` : `${jobTitle} logged${costPence ? ` at £${(costPence / 100).toLocaleString("en-GB")}` : ""}. Add the invoice when it arrives.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <SideSheet open title={visit ? "Contractor visited" : "Job done"} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={() => (document.getElementById("quick-job-form") as HTMLFormElement | null)?.requestSubmit()}>Save</Button>}>
      <form id="quick-job-form" className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <Select
          label={visit ? "Who visited" : "Contractor (optional)"}
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
          options={[{ value: "", label: visit ? "Choose…" : "None, or volunteers" }, ...contractors.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <Input label={visit ? "What for (optional)" : "What was done"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={visit ? "Looked at the boiler" : "Cleared the gutters"} />
        {!visit && <Input label="Cost (£, optional)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="380" />}
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {contractors.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Add contractors on the Contractors page to pick them here.</p>}
      </form>
    </SideSheet>
  );
}
