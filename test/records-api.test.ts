import { beforeAll, describe, expect, it } from "vitest";
import { addDaysTo, todayIn } from "../src/shared/compliance";
import { parsePounds, formatRangeText } from "../src/shared/money";
import { email, makeBuilding, makeOrg, makeUser, signedIn, type Client } from "./helpers";

const PDF = new TextEncoder().encode("%PDF-1.4\n% invoice\n");
const today = todayIn("Europe/London");
const year = Number(today.slice(0, 4));

let org: string, church: string, hall: string, otherOrg: string, otherChurch: string;
let warden: Client, treasurer: Client, otherWarden: Client;

beforeAll(async () => {
  org = await makeOrg("Records parish");
  church = await makeBuilding(org, "St Mary");
  hall = await makeBuilding(org, "Church hall");
  otherOrg = await makeOrg("Other parish");
  otherChurch = await makeBuilding(otherOrg, "St Other");
  const e = { w: email("w"), t: email("t"), o: email("o") };
  await makeUser(e.w, [{ orgId: org, role: "churchwarden" }]);
  await makeUser(e.t, [{ orgId: org, role: "treasurer" }]);
  await makeUser(e.o, [{ orgId: otherOrg, role: "churchwarden" }]);
  [warden, treasurer, otherWarden] = (await Promise.all([e.w, e.t, e.o].map(signedIn))) as [Client, Client, Client];
});

const upload = async (c: Client, buildingId: string, type: string, title: string) =>
  (await c.upload(`/api/buildings/${buildingId}/documents`, PDF, { "content-type": "application/pdf", "x-document-type": type, "x-document-title": encodeURIComponent(title) })).json.document.id as string;

describe("money", () => {
  it("reads what people type", () => {
    expect(parsePounds("1,150")).toBe(115000);
    expect(parsePounds("£380.50")).toBe(38050);
    expect(parsePounds("")).toBeNull();
    expect(parsePounds("about 300")).toBeNaN();
    expect(formatRangeText(250000, 400000)).toBe("£2,500 to £4,000");
  });
});

describe("dashboard for a new building", () => {
  it("shows the setup steps and zero stats", async () => {
    const d = (await warden.get(`/api/buildings/${church}/dashboard`)).json;
    expect(d.attention.map((a: any) => a.title)).toEqual([
      "Add your quinquennial report",
      "Upload your insurance schedule",
      "Add your contractors",
    ]);
    expect(d.stats.overdue.count).toBe(0);
    expect(d.stats.spend).toMatchObject({ totalPence: 0, jobCount: 0 });
    expect(d.qi).toBeNull();
    expect(d.recentJobs).toEqual([]);
  });
});

describe("contractors", () => {
  let roofer: string;
  it("adds a contractor to the organisation's address book, shared by its buildings", async () => {
    const r = await warden.post(`/api/buildings/${church}/contractors`, { name: "Solent Heritage Roofing", trade: "Roofing", email: "office@example.org", website: "example.org" });
    expect(r.status).toBe(201);
    roofer = r.json.id;
    const fromHall = (await warden.get(`/api/buildings/${hall}/contractors`)).json.contractors;
    expect(fromHall.map((c: any) => c.name)).toContain("Solent Heritage Roofing");
    expect(fromHall[0].website).toBe("https://example.org");
  });
  it("keeps other parishes out of the address book", async () => {
    expect((await otherWarden.get(`/api/buildings/${otherChurch}/contractors`)).json.contractors).toEqual([]);
    expect((await otherWarden.get(`/api/buildings/${otherChurch}/contractors/${roofer}`)).status).toBe(404);
    // Another parish can't put our contractor on their job.
    const j = await otherWarden.post(`/api/buildings/${otherChurch}/jobs`, { title: "x", doneOn: today, contractorId: roofer });
    expect(j.status).toBe(400);
  });
  it("rejects a bad email", async () => {
    expect((await warden.post(`/api/buildings/${church}/contractors`, { name: "X", email: "not an email" })).status).toBe(400);
  });
});

describe("jobs and the logbook", () => {
  let roofer: string;
  beforeAll(async () => {
    roofer = (await warden.post(`/api/buildings/${church}/contractors`, { name: "Roof Co" })).json.id;
  });

  it("logs a job without paperwork: awaiting invoice, no logbook entry", async () => {
    const r = await treasurer.post(`/api/buildings/${church}/jobs`, { title: "Clear gutters", doneOn: today, costPence: 38000, contractorId: roofer });
    expect(r.status).toBe(201);
    const { jobs, spend, drafts } = (await warden.get(`/api/buildings/${church}/jobs?year=${year}`)).json;
    const j = jobs.find((x: any) => x.id === r.json.id);
    expect(j).toMatchObject({ contractorName: "Roof Co", awaitingInvoice: true, logbook: null, paperwork: [] });
    expect(spend).toMatchObject({ totalPence: 38000, jobCount: 1, awaitingInvoice: 1 });
    expect(drafts).toEqual([]);
  });

  it("drafts a logbook entry when the invoice is added, and only once", async () => {
    const { jobs } = (await warden.get(`/api/buildings/${church}/jobs`)).json;
    const id = jobs[0].id;
    const inv = await upload(warden, church, "invoice", "Gutter invoice");
    await warden.patch(`/api/buildings/${church}/jobs/${id}`, { documentIds: [inv] });
    await warden.patch(`/api/buildings/${church}/jobs/${id}`, { notes: "Both sides" });
    const after = (await warden.get(`/api/buildings/${church}/jobs`)).json;
    expect(after.jobs[0]).toMatchObject({ awaitingInvoice: false, logbook: "draft" });
    expect(after.drafts).toHaveLength(1);
    expect(after.drafts[0]).toMatchObject({ work: "Clear gutters", who: "Roof Co", costPence: 38000 });
  });

  it("lets a churchwarden approve, not a treasurer; approved entries are fixed", async () => {
    const draft = (await warden.get(`/api/buildings/${church}/logbook?status=draft`)).json.entries[0];
    expect((await treasurer.patch(`/api/buildings/${church}/logbook/${draft.id}`, { permissionRef: "List A" })).status).toBe(200);
    expect((await treasurer.post(`/api/buildings/${church}/logbook/${draft.id}/approve`)).status).toBe(403);
    expect((await warden.post(`/api/buildings/${church}/logbook/${draft.id}/approve`)).status).toBe(200);
    const approved = (await warden.get(`/api/buildings/${church}/logbook?status=approved`)).json.entries;
    expect(approved[0]).toMatchObject({ status: "approved", permissionRef: "List A" });
    expect((await warden.patch(`/api/buildings/${church}/logbook/${draft.id}`, { work: "changed" })).status).toBe(400);
    // A job in the approved logbook can't be deleted.
    expect((await warden.post(`/api/buildings/${church}/jobs/${draft.jobId}/delete`)).status).toBe(400);
  });

  it("records a compliance check when the job is one", async () => {
    const cal = (await warden.get(`/api/buildings/${church}/compliance`)).json;
    const boiler = cal.items.find((i: any) => i.name.startsWith("Gas boiler"));
    const cert = await upload(warden, church, "certificate", "Gas safety record");
    const r = await warden.post(`/api/buildings/${church}/jobs`, {
      title: "Boiler annual service",
      doneOn: today,
      costPence: 19000,
      complianceItemId: boiler.id,
      documentIds: [cert],
    });
    expect(r.status).toBe(201);
    const after = (await warden.get(`/api/buildings/${church}/compliance`)).json.items.find((i: any) => i.id === boiler.id);
    expect(after).toMatchObject({ lastDone: today, status: "on_track", missingEvidence: false });
    const docs = (await warden.get(`/api/buildings/${church}/documents`)).json.documents;
    expect(docs.find((d: any) => d.id === cert).usedFor.sort()).toEqual(["Boiler annual service", "Gas boiler service and safety check"]);
  });

  it("plans a job without a date, then completes it", async () => {
    const r = await warden.post(`/api/buildings/${church}/jobs`, { title: "Repoint parapet", status: "planned" });
    expect(r.status).toBe(201);
    expect((await warden.patch(`/api/buildings/${church}/jobs/${r.json.id}`, { status: "done" })).status).toBe(400);
    expect((await warden.patch(`/api/buildings/${church}/jobs/${r.json.id}`, { status: "done", doneOn: today })).status).toBe(200);
    expect((await warden.post(`/api/buildings/${church}/jobs/${r.json.id}/delete`)).status).toBe(200);
  });

  it("refuses another building's documents on a job", async () => {
    const theirs = await upload(otherWarden, otherChurch, "invoice", "Theirs");
    const r = await warden.post(`/api/buildings/${church}/jobs`, { title: "x", doneOn: today, documentIds: [theirs] });
    expect(r.status).toBe(400);
  });

  it("hides jobs and documents from other parishes", async () => {
    expect((await otherWarden.get(`/api/buildings/${church}/jobs`)).status).toBe(404);
    expect((await otherWarden.get(`/api/buildings/${church}/documents`)).status).toBe(404);
    expect((await otherWarden.get(`/api/buildings/${church}/dashboard`)).status).toBe(404);
  });
});

describe("documents", () => {
  it("edits a document's details", async () => {
    const id = await upload(warden, church, "other", "Scan 001");
    const r = await warden.patch(`/api/buildings/${church}/documents/${id}`, { title: "Insurance schedule 2026", type: "insurance_schedule", expiresOn: addDaysTo(today, 40) });
    expect(r.status).toBe(200);
    const d = (await warden.get(`/api/buildings/${church}/documents`)).json.documents.find((x: any) => x.id === id);
    expect(d).toMatchObject({ title: "Insurance schedule 2026", type: "insurance_schedule" });
    // The dashboard setup step for insurance goes away.
    const dash = (await warden.get(`/api/buildings/${church}/dashboard`)).json;
    expect(dash.attention.map((a: any) => a.title)).not.toContain("Upload your insurance schedule");
  });
});

describe("dashboard with records", () => {
  it("puts overdue checks first and counts spend", async () => {
    const cal = (await warden.get(`/api/buildings/${church}/compliance`)).json;
    const lp = cal.items.find((i: any) => i.name.startsWith("Lightning"));
    await warden.post(`/api/buildings/${church}/compliance/${lp.id}/occurrences`, { doneOn: addDaysTo(today, -400) });
    const d = (await warden.get(`/api/buildings/${church}/dashboard`)).json;
    expect(d.stats.overdue.count).toBe(1);
    expect(d.attention[0]).toMatchObject({ kind: "compliance", title: "Lightning protection system test", pill: { tone: "danger" } });
    expect(d.attention[0].action.href).toContain(`/compliance?item=${lp.id}`);
    expect(d.stats.spend.totalPence).toBe(38000 + 19000);
    expect(d.recentJobs.length).toBeGreaterThan(0);
  });
});
