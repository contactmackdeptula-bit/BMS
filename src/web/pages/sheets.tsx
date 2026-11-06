// Side sheets shared by the dashboard, Jobs and Documents pages.
import { useEffect, useState, type FormEvent } from "react";
import { parsePounds } from "../../shared/money";
import { api, ApiError, DOC_TYPES, type Calendar, type Contractor, type Job } from "../api";
import { Button, ErrorPanel } from "../ui/basics";
import { DateInput, FileDrop, Input, Select, Textarea } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";

const penceToInput = (p: number | null | undefined) => (p == null ? "" : (p / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 }));

type PendingFile = { file: File; type: string };

function guessType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("invoice") || n.includes("inv")) return "invoice";
  if (n.includes("quote")) return "quote";
  if (n.includes("cert") || n.includes("record")) return "certificate";
  if (/\.(jpe?g|png|heic)$/.test(n)) return "photo";
  return "invoice";
}

/** Log a new job, or edit one. Paperwork uploads with it. */
export function JobSheet({
  buildingId,
  today,
  job,
  taskId,
  presetTitle,
  onClose,
  onSaved,
}: {
  buildingId: string;
  today: string;
  job?: Job | null;
  /** Logging the job for a quinquennial recommendation completes it. */
  taskId?: string;
  presetTitle?: string;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const editing = Boolean(job);
  const [title, setTitle] = useState(job?.title ?? presetTitle ?? "");
  const [status, setStatus] = useState<"done" | "planned">(job?.status ?? "done");
  const [doneOn, setDoneOn] = useState(job?.doneOn ?? (job ? "" : today));
  const [contractorId, setContractorId] = useState(job?.contractorId ?? "");
  const [newContractor, setNewContractor] = useState("");
  const [cost, setCost] = useState(penceToInput(job?.costPence));
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [complianceItemId, setComplianceItemId] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [checks, setChecks] = useState<Calendar["items"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ contractors: Contractor[] }>(`/buildings/${buildingId}/contractors`).then((r) => setContractors(r.contractors)).catch(() => {});
    if (!editing) api.get<Calendar>(`/buildings/${buildingId}/compliance`).then((r) => setChecks(r.items)).catch(() => {});
  }, [buildingId, editing]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const costPence = parsePounds(cost);
    if (Number.isNaN(costPence)) {
      setError("Enter the cost in pounds, like 1,150 or 380.50.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let cId = contractorId === "__new" ? "" : contractorId;
      if (contractorId === "__new" && newContractor.trim()) {
        cId = (await api.post<{ id: string }>(`/buildings/${buildingId}/contractors`, { name: newContractor.trim() })).id;
      }
      const documentIds: string[] = [];
      for (const f of files) documentIds.push((await api.upload(buildingId, f.file, { type: f.type, documentDate: doneOn || null })).id);
      const body = {
        title,
        status,
        doneOn: status === "done" ? doneOn : doneOn || null,
        contractorId: cId || null,
        costPence,
        notes,
        documentIds,
        ...(complianceItemId ? { complianceItemId } : {}),
        ...(taskId ? { taskId } : {}),
      };
      if (job) await api.patch(`/buildings/${buildingId}/jobs/${job.id}`, body);
      else await api.post(`/buildings/${buildingId}/jobs`, body);
      await onSaved(editing ? `${title} updated.` : `${title} logged.`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  const formId = "job-form";
  return (
    <SideSheet
      open
      title={editing ? "Edit job" : "Log a job"}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" loading={busy} onClick={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}>
            {editing ? "Save job" : "Log job"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={formId} className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <Input label="What was done" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replace cracked slates, north aisle" required />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as "done" | "planned")}
          options={[
            { value: "done", label: "Done" },
            { value: "planned", label: "Planned, not done yet" },
          ]}
        />
        <DateInput label={status === "done" ? "Date done" : "Planned for (optional)"} value={doneOn} max={status === "done" ? today : undefined} onChange={(e) => setDoneOn(e.target.value)} />
        <Select
          label="Contractor"
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
          options={[{ value: "", label: "None, or done by volunteers" }, ...contractors.map((c) => ({ value: c.id, label: c.name })), { value: "__new", label: "Someone new…" }]}
        />
        {contractorId === "__new" && <Input label="New contractor's name" value={newContractor} onChange={(e) => setNewContractor(e.target.value)} hint="Added to your address book; fill in their details on the Contractors page." />}
        <Input label="Cost (£)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="1,150" hint="Leave empty if it's not known yet." />
        {!editing && !taskId && status === "done" && checks.length > 0 && (
          <Select
            label="Was this one of your regular checks?"
            value={complianceItemId}
            onChange={(e) => setComplianceItemId(e.target.value)}
            options={[{ value: "", label: "No" }, ...checks.map((c) => ({ value: c.id, label: c.name }))]}
            hint="If so, it's recorded on the compliance calendar too."
          />
        )}
        <div className="sheet-section">
          <FileDrop
            label={editing ? "Add paperwork" : "Invoice, certificate or photos"}
            onFiles={(fs) => setFiles([...files, ...fs.map((file) => ({ file, type: guessType(file.name) }))])}
          />
          {files.map((f, i) => (
            <div key={i} className="form-grid" style={{ alignItems: "end" }}>
              <Input label="File" value={f.file.name} readOnly />
              <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <Select label="Type" value={f.type} options={DOC_TYPES} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.file.name}`}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {job && job.paperwork.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Already attached: {job.paperwork.map((p) => p.title).join(", ")}</p>}
        </div>
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          A finished job with paperwork gets a draft logbook entry, for a churchwarden to approve.
        </p>
      </form>
    </SideSheet>
  );
}

/** Upload a document on its own, with its type, date and expiry. */
export function UploadSheet({
  buildingId,
  initialType = "certificate",
  onClose,
  onSaved,
}: {
  buildingId: string;
  initialType?: string;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState(initialType);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const doc = await api.upload(buildingId, file, { type, title, documentDate: date || null, expiresOn: expires || null });
      await onSaved(`${doc.title} uploaded.`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <SideSheet
      open
      title="Upload a document"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" loading={busy} onClick={() => (document.getElementById("upload-form") as HTMLFormElement | null)?.requestSubmit()}>
            Upload
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id="upload-form" className="sheet-section" onSubmit={submit}>
        {error && <ErrorPanel message={error} />}
        <Select label="What is it" value={type} options={DOC_TYPES} onChange={(e) => setType(e.target.value)} />
        <FileDrop
          label={file ? `Chosen: ${file.name}` : "Choose the file"}
          onFiles={(fs) => {
            const f = fs[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
          }}
        />
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Insurance schedule 2026" />
        <DateInput label="Date on the document" value={date} onChange={(e) => setDate(e.target.value)} />
        <DateInput label="Expires or renews (optional)" value={expires} onChange={(e) => setExpires(e.target.value)} hint="For policies and certificates that lapse." />
      </form>
    </SideSheet>
  );
}
