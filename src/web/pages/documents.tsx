// Documents: every file on the building, grouped by type, with dates and expiry.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, DOC_LABEL, DOC_TYPES, type DocumentRow } from "../api";
import { formatDate } from "../format";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, Skeleton } from "../ui/basics";
import { DataTable, FilterChips } from "../ui/data";
import { DateInput, Input, Select } from "../ui/forms";
import { SideSheet } from "../ui/SideSheet";
import { useChurch } from "./church";
import { UploadSheet } from "./sheets";

const GROUP_ORDER = DOC_TYPES.map((d) => d.value);

function expiryPill(expiresOn: string | null, today: string) {
  if (!expiresOn) return null;
  const days = Math.round((Date.parse(expiresOn) - Date.parse(today)) / 86_400_000);
  if (days < 0) return <Pill tone="danger" label={`Expired ${formatDate(expiresOn)}`} />;
  if (days <= 90) return <Pill tone="warn" label={`Expires ${formatDate(expiresOn)}`} />;
  return <span className="muted">Until {formatDate(expiresOn)}</span>;
}

const size = (b: number) => (b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

export function DocumentsPage() {
  const { building } = useChurch();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ documents: DocumentRow[]; canWrite: boolean } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [type, setType] = useState("all");
  const uploadType = params.get("upload");
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get(`/buildings/${building.id}/documents`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [building.id]);
  useEffect(() => void load(), [load]);

  const setUpload = (t: string | null) => {
    const next = new URLSearchParams(params);
    if (t) next.set("upload", t);
    else next.delete("upload");
    setParams(next, { replace: true });
  };
  const saved = async (m: string) => {
    setFlash(m);
    await load();
  };

  const docs = data?.documents ?? [];
  const present = GROUP_ORDER.filter((t) => docs.some((d) => d.type === t));
  const shown = docs
    .filter((d) => type === "all" || d.type === type)
    .sort((a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type) || (b.documentDate ?? b.createdAt).localeCompare(a.documentDate ?? a.createdAt));

  return (
    <div className="stack">
      <PageHeader
        title="Documents"
        subtitle="Certificates, invoices, reports and policies for this building. Only people with access to this church can open them."
        actions={
          data?.canWrite && (
            <Button variant="primary" onClick={() => setUpload("certificate")}>
              Upload a document
            </Button>
          )
        }
      />
      {flash && <Notice>{flash}</Notice>}
      {error && <ErrorPanel message={error.message} onRetry={load} />}
      {!data && !error && <Skeleton height={300} />}
      {data && (
        <Card>
          {docs.length > 0 && (
            <FilterChips
              label="Show"
              selected={type}
              onChange={setType}
              options={[{ value: "all", label: "All", count: docs.length }, ...present.map((t) => ({ value: t, label: DOC_LABEL[t] ?? t, count: docs.filter((d) => d.type === t).length }))]}
            />
          )}
          <DataTable<DocumentRow & Record<string, unknown>>
            caption="Documents"
            rows={shown as (DocumentRow & Record<string, unknown>)[]}
            rowKey={(d) => d.id}
            groupBy={type === "all" ? (d) => d.type : undefined}
            groupLabel={(g) => DOC_LABEL[g] ?? g}
            emptyMessage="No documents yet. Certificates you add on the compliance calendar and invoices on jobs appear here too."
            columns={[
              {
                key: "title",
                label: "Document",
                render: (d) => (
                  <a href={`/api/buildings/${building.id}/documents/${d.id}/file`} target="_blank" rel="noopener">
                    {d.title}
                  </a>
                ),
              },
              { key: "documentDate", label: "Dated", nowrap: true, render: (d) => formatDate(d.documentDate) || <span className="muted">—</span> },
              { key: "expiresOn", label: "Expiry", nowrap: true, render: (d) => expiryPill(d.expiresOn, today) ?? <span className="muted">—</span> },
              { key: "usedFor", label: "Used for", render: (d) => (d.usedFor.length ? d.usedFor.join(", ") : <span className="muted">—</span>) },
              { key: "uploadedBy", label: "Added", render: (d) => <span className="muted">{[d.uploadedBy, formatDate(d.createdAt.slice(0, 10)), size(d.sizeBytes)].filter(Boolean).join(" · ")}</span> },
              ...(data.canWrite
                ? [{ key: "action", label: "Action", render: (d: DocumentRow) => <Button size="sm" onClick={() => setEditing(d)} aria-label={`Edit details: ${d.title}`}>Edit</Button> }]
                : []),
            ]}
          />
        </Card>
      )}
      {uploadType && <UploadSheet buildingId={building.id} initialType={uploadType} onClose={() => setUpload(null)} onSaved={saved} />}
      {editing && <EditDocumentSheet buildingId={building.id} doc={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
}

function EditDocumentSheet({ buildingId, doc, onClose, onSaved }: { buildingId: string; doc: DocumentRow; onClose: () => void; onSaved: (m: string) => Promise<void> }) {
  const [title, setTitle] = useState(doc.title);
  const [type, setType] = useState(doc.type);
  const [date, setDate] = useState(doc.documentDate ?? "");
  const [expires, setExpires] = useState(doc.expiresOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/buildings/${buildingId}/documents/${doc.id}`, { title, type, documentDate: date || null, expiresOn: expires || null });
      await onSaved(`${title} saved.`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <SideSheet
      open
      title="Document details"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} onClick={() => (document.getElementById("doc-form") as HTMLFormElement | null)?.requestSubmit()}>
          Save
        </Button>
      }
    >
      <form id="doc-form" className="sheet-section" onSubmit={save}>
        {error && <ErrorPanel message={error} />}
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <Select label="Type" value={type} options={DOC_TYPES} onChange={(e) => setType(e.target.value)} />
        <DateInput label="Date on the document" value={date} onChange={(e) => setDate(e.target.value)} />
        <DateInput label="Expires or renews" value={expires} onChange={(e) => setExpires(e.target.value)} />
        <a href={`/api/buildings/${buildingId}/documents/${doc.id}/file`} target="_blank" rel="noopener">
          Open the file
        </a>
      </form>
    </SideSheet>
  );
}
