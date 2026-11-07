// Screen 4: annual fabric report builder and preview (UI-HANDOFF §10).
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildFabricReport, CONDITION_TEMPLATE, formatLongDate, type FabricFacts, type FabricInput } from "../../shared/fabric-report";
import { formatPounds } from "../../shared/money";
import { api, ApiError } from "../api";
import { Button, Card, ErrorPanel, Notice, PageHeader, Pill, Skeleton } from "../ui/basics";
import { Checkbox, DateInput, Input, Select, Textarea } from "../ui/forms";
import { useChurch } from "./church";

type ReportData = {
  year: number;
  defaultYear: number;
  facts: FabricFacts;
  input: FabricInput;
  status: "new" | "draft" | "exported";
  exportedDocumentIds: string[];
  years: { year: number; status: string }[];
  canEdit: boolean;
};

export function ReportsPage() {
  const { building } = useChurch();
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [form, setForm] = useState<FabricInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "docx" | "pdf" | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await api.get<ReportData>(`/buildings/${building.id}/fabric-report${year ? `?year=${year}` : ""}`);
      setData(d);
      setForm(d.input);
      setDirty(false);
      if (!year) setYear(d.year);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [building.id, year]);
  useEffect(() => void load(), [load]);

  // Warn before leaving with unsaved words.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const preview = useMemo(() => (data && form ? buildFabricReport(data.facts, form) : null), [data, form]);
  const set = <K extends keyof FabricInput>(k: K, v: FabricInput[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
    setFlash(null);
  };

  const save = async (quiet = false) => {
    if (!form || !data) return;
    await api.req("PUT", `/buildings/${building.id}/fabric-report/${data.year}`, form);
    setDirty(false);
    if (!quiet) setFlash("Draft saved.");
  };

  const run = async (kind: "save" | "docx" | "pdf") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") await save();
      else {
        await save(true);
        const res = await fetch(`/api/buildings/${building.id}/fabric-report/${data!.year}/export?format=${kind}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The export failed. Please try again.", res.status);
        const blob = await res.blob();
        const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `fabric-report.${kind}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setFlash(`${kind === "docx" ? "Word" : "PDF"} file downloaded, and a copy saved to Documents.`);
        await load();
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const readOnly = !data?.canEdit;
  const yearOptions = useMemo(() => {
    if (!data) return [];
    const ys = new Set<number>([data.defaultYear, data.defaultYear - 1, ...data.years.map((y) => y.year)]);
    return [...ys].sort((a, b) => b - a).map((y) => ({ value: String(y), label: y === data.year && data.facts.apcmDate ? `${y} (APCM ${formatLongDate(data.facts.apcmDate)})` : String(y) }));
  }, [data]);

  return (
    <div className="stack">
      <PageHeader
        title="Annual fabric report for the APCM"
        subtitle="Drafted from the job log, the compliance calendar and the quinquennial actions. You edit the words; the facts come from the records."
        actions={
          !readOnly && data && (
            <>
              <Button loading={busy === "save"} onClick={() => run("save")}>
                Save draft
              </Button>
              <Button loading={busy === "docx"} onClick={() => run("docx")}>
                Export Word
              </Button>
              <Button variant="primary" loading={busy === "pdf"} onClick={() => run("pdf")}>
                Export PDF
              </Button>
            </>
          )
        }
      />
      {flash && <Notice>{flash}</Notice>}
      {error && <ErrorPanel message={error} onRetry={data ? undefined : load} />}
      {!data || !form || !preview ? (
        !error && (
          <div className="grid grid-2">
            <Skeleton height={500} />
            <Skeleton height={500} />
          </div>
        )
      ) : (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <section className="stack" style={{ gap: 14 }} aria-label="Report details">
            {readOnly && <Notice tone="info">Churchwardens and the PCC admin write this report. You can read the preview.</Notice>}
            <Card title="1 · Inspection details" headingId="fr-inspection">
              <div className="form-grid">
                <Select
                  label="Report year"
                  value={String(data.year)}
                  options={yearOptions}
                  onChange={(e) => {
                    if (dirty && !window.confirm("You have unsaved changes. Switch year anyway?")) return;
                    setYear(Number(e.target.value));
                  }}
                />
                <DateInput label="Date of churchwardens' inspection" value={form.inspectionDate ?? ""} readOnly={readOnly} onChange={(e) => set("inspectionDate", e.target.value || null)} />
                <Input label="Inspected by" value={form.inspectedBy ?? ""} readOnly={readOnly} placeholder="R. Hughes and M. Patel, churchwardens" onChange={(e) => set("inspectedBy", e.target.value)} />
                <Input label="Accompanied by" value={form.accompaniedBy ?? ""} readOnly={readOnly} placeholder="Fabric committee chair" onChange={(e) => set("accompaniedBy", e.target.value)} />
              </div>
            </Card>

            <Card title="2 · Condition summary" headingId="fr-condition">
              <div style={{ marginTop: -36, alignSelf: "flex-end" }}>
                {preview.sections[1]!.state === "warn" ? <Pill tone="warn" label="Draft, please edit" /> : <Pill tone="ok" label="Written" />}
              </div>
              <Textarea
                label="Your assessment of the building this year"
                rows={6}
                value={form.conditionText ?? ""}
                readOnly={readOnly}
                onChange={(e) => set("conditionText", e.target.value)}
                hint="Replace the words in square brackets. A blank line starts a new paragraph."
              />
              {!readOnly && form.conditionText !== CONDITION_TEMPLATE && (form.conditionText ?? "").trim() === "" && (
                <Button size="sm" variant="ghost" onClick={() => set("conditionText", CONDITION_TEMPLATE)}>
                  Start from the template
                </Button>
              )}
            </Card>

            <Card title="Sections filled from the records" headingId="fr-sections">
              <div className="report-checklist">
                {preview.sections.slice(2).map((s) => (
                  <div key={s.n} className="report-check">
                    <span className={`badge tone-${s.state}`} aria-hidden="true">
                      {s.n}
                    </span>
                    <span className="grow">{s.heading}</span>
                    <span className={s.state === "warn" ? "warn-text" : "muted"}>{s.fact}</span>
                  </div>
                ))}
              </div>
            </Card>

            <MattersCard facts={data.facts} form={form} readOnly={readOnly} onChange={(m) => set("matters", m)} />

            <Card title="7 · Terrier, inventory and logbook" headingId="fr-terrier">
              <p style={{ margin: 0 }}>
                {data.facts.logbook.length} approved logbook {data.facts.logbook.length === 1 ? "entry" : "entries"} in {data.year}. They're listed in the report's appendix.
                Draft entries waiting for approval are on the <a href={`/b/${building.id}/jobs`}>Jobs page</a>.
              </p>
              <Checkbox label="The terrier and inventory have been checked and are accurate" checked={form.terrierConfirmed} disabled={readOnly} onChange={(e) => set("terrierConfirmed", e.target.checked)} />
            </Card>

            {data.exportedDocumentIds.length > 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Exported {data.exportedDocumentIds.length} {data.exportedDocumentIds.length === 1 ? "time" : "times"}. Copies are in <a href={`/b/${building.id}/documents`}>Documents</a>.
              </p>
            )}
          </section>

          <section className="paper" aria-label="Preview of the report">
            <div className="paper-label">Preview</div>
            <div className="paper-head">
              <div className="paper-title">{preview.title}</div>
              <div className="paper-sub">{preview.subtitle}</div>
              <div className="paper-sub">{preview.presented}</div>
            </div>
            {preview.sections.map((s) => (
              <div key={s.n} className="paper-section">
                <div className="paper-heading">
                  {s.n}. {s.heading}
                </div>
                {s.paragraphs.map((p, i) => (
                  <p key={i} className={p.includes("[") ? "paper-todo" : undefined}>
                    {p}
                  </p>
                ))}
              </div>
            ))}
            <div className="paper-appendix">
              <div className="paper-heading">Appendix: logbook entries for the year</div>
              {preview.appendix.length === 0 ? (
                <p>No logbook entries were made during the year.</p>
              ) : (
                <ul>
                  {preview.appendix.map((e, i) => (
                    <li key={i}>
                      {formatLongDate(e.entryDate)}: {e.work}
                      {e.who ? `, ${e.who}` : ""}
                      {e.costPence != null ? `, ${formatPounds(e.costPence)}` : ""}
                      {e.permissionRef ? ` (${e.permissionRef})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="paper-foot">{preview.footer}</div>
          </section>
        </div>
      )}
    </div>
  );
}

function MattersCard({ facts, form, readOnly, onChange }: { facts: FabricFacts; form: FabricInput; readOnly: boolean; onChange: (m: FabricInput["matters"]) => void }) {
  const [own, setOwn] = useState("");
  const pending = facts.suggestedMatters.filter((s) => !form.matters.some((m) => m.text === s));
  const confirmed = form.matters.filter((m) => m.confirmed);
  return (
    <Card title="6 · Matters for the PCC" headingId="fr-matters" caption="Suggested from urgent quinquennial items and overdue checks. Nothing goes into the report until you confirm it.">
      {pending.length > 0 && (
        <div className="sheet-section">
          {pending.map((s) => (
            <div key={s} className="matter suggestion">
              <p>{s}</p>
              {!readOnly && (
                <span style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" variant="primary" onClick={() => onChange([...form.matters, { text: s, confirmed: true }])}>
                    Include
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onChange([...form.matters, { text: s, confirmed: false }])}>
                    Leave out
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {confirmed.map((m) => (
        <div key={m.text} className="matter">
          <p>{m.text}</p>
          {!readOnly && (
            <Button size="sm" variant="ghost" onClick={() => onChange(form.matters.filter((x) => x !== m))} aria-label={`Remove: ${m.text}`}>
              Remove
            </Button>
          )}
        </div>
      ))}
      {pending.length === 0 && confirmed.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing for the PCC's attention yet.</p>}
      {!readOnly && (
        <div className="sheet-section">
          <Textarea label="Add a matter of your own" rows={2} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="The PCC is asked to…" />
          <div>
            <Button
              size="sm"
              disabled={!own.trim()}
              onClick={() => {
                onChange([...form.matters, { text: own.trim(), confirmed: true }]);
                setOwn("");
              }}
            >
              Add matter
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
