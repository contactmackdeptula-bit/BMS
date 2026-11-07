import { beforeAll, describe, expect, it } from "vitest";
import { addDaysTo, todayIn } from "../src/shared/compliance";
import { email, makeBuilding, makeOrg, makeUser, signedIn, type Client } from "./helpers";

const today = todayIn("Europe/London");
const PDF = new TextEncoder().encode("%PDF-1.4\n% qi\n");

let diocese: string, areaA: string, areaB: string;
const churches: string[] = [];
const parishes: string[] = [];
let estates: Client, warden: Client, otherEstates: Client, wardenOnly: Client;

beforeAll(async () => {
  diocese = await makeOrg("Diocese of Testing", "diocese");
  areaA = await makeOrg("North area", "pastoral_area", diocese);
  areaB = await makeOrg("South area", "pastoral_area", diocese);
  for (let i = 0; i < 6; i++) {
    const p = await makeOrg(`Parish ${i}`, "parish", i < 4 ? areaA : areaB);
    parishes.push(p);
    churches.push(await makeBuilding(p, `St Test ${i}`));
  }
  const e = { es: email("es"), w: email("w"), oe: email("oe"), w2: email("w2") };
  await makeUser(e.es, [{ orgId: diocese, role: "estates" }]);
  await makeUser(e.w, parishes.map((orgId) => ({ orgId, role: "churchwarden" as const })));
  const other = await makeOrg("Other diocese", "diocese");
  await makeUser(e.oe, [{ orgId: other, role: "estates_admin" }]);
  await makeUser(e.w2, [{ orgId: parishes[0]!, role: "churchwarden" }]);
  [estates, warden, otherEstates, wardenOnly] = (await Promise.all([e.es, e.w, e.oe, e.w2].map(signedIn))) as [Client, Client, Client, Client];

  // Every church had its lightning test 300 days ago: all due within the 120-day window.
  for (const c of churches) {
    const items = (await warden.get(`/api/buildings/${c}/compliance`)).json.items;
    const lp = items.find((x: any) => x.templateKey === "lightning_protection");
    await warden.post(`/api/buildings/${c}/compliance/${lp.id}/occurrences`, { doneOn: addDaysTo(today, -300) });
  }
  // Two churches have an overdue asbestos review.
  for (const c of churches.slice(4)) {
    const items = (await warden.get(`/api/buildings/${c}/compliance`)).json.items;
    const ab = items.find((x: any) => x.templateKey === "asbestos_review");
    await warden.post(`/api/buildings/${c}/compliance/${ab.id}/occurrences`, { doneOn: addDaysTo(today, -400) });
  }
  // Church 3 has a current quinquennial report with an urgent item.
  const doc = (await warden.upload(`/api/buildings/${churches[3]}/documents`, PDF, { "content-type": "application/pdf", "x-document-type": "qi_report" })).json.document.id;
  const r = (await warden.post(`/api/buildings/${churches[3]}/quinquennial`, { documentId: doc, inspectedOn: "2021-06-01", nextDueOn: "2026-06-01" })).json.id;
  await warden.post(`/api/buildings/${churches[3]}/quinquennial/${r}/tasks`, { ref: "1.1", band: "A", text: "Repair parapet", trade: "Masonry", estimateLowPence: 200000, estimateHighPence: 400000 });
  await warden.post(`/api/buildings/${churches[3]}/quinquennial/${r}/tasks`, { ref: "2.1", band: "B", text: "Gutters", trade: "Roofing", estimateLowPence: 50000, estimateHighPence: 50000 });
  await warden.post(`/api/buildings/${churches[3]}/quinquennial/${r}/publish`);
});

describe("estate overview", () => {
  it("adds up every church under the diocese", async () => {
    const o = (await estates.get(`/api/orgs/${diocese}/estate`)).json;
    expect(o.buildingCount).toBe(6);
    expect(o.areas.map((a: any) => a.name).sort()).toEqual(["North area", "South area"]);
    // Two asbestos reviews, plus church 3's quinquennial inspection (due June 2026).
    expect(o.stats.overdue).toMatchObject({ count: 3, churches: 3, common: { name: "Asbestos register review", count: 2 } });
    expect(o.stats.openActions).toMatchObject({ count: 2, a: 1, b: 1 });
    expect(o.stats.backlog.pence).toBe(300000 + 50000); // midpoints
    expect(o.stats.backlog.topTrade).toMatchObject({ trade: "Masonry", share: 86 });
  });

  it("puts churches with urgent items first, then overdue checks", async () => {
    const { rows } = (await estates.get(`/api/orgs/${diocese}/estate`)).json;
    expect(rows[0]).toMatchObject({ name: "St Test 3", openA: 1, openB: 1, surveyOverdue: true, area: { name: "North area" } });
    expect(rows[1].overdue).toEqual(["Asbestos register review"]);
    expect(rows[0].contact).toBeTruthy();
  });

  it("counts an overdue survey in this year's bar", async () => {
    const { cycle } = (await estates.get(`/api/orgs/${diocese}/estate`)).json;
    expect(cycle).toHaveLength(5);
    expect(cycle[0].overdue).toBe(1);
  });

  it("suggests a programme when five or more churches need the same check in the window", async () => {
    const { programmes } = (await estates.get(`/api/orgs/${diocese}/estate`)).json;
    const lp = programmes.find((p: any) => p.key === "lightning_protection");
    expect(lp).toMatchObject({ churches: 6, estimateLowPence: 6 * 35000, estimateHighPence: 6 * 50000 });
    expect(lp.areas.sort()).toEqual(["North area", "South area"]);
    // Only two asbestos reviews are due: below the threshold.
    expect(programmes.find((p: any) => p.key === "asbestos_review")).toBeUndefined();
  });

  it("filters by pastoral area", async () => {
    const o = (await estates.get(`/api/orgs/${diocese}/estate?area=${areaB}`)).json;
    expect(o.buildingCount).toBe(2);
    expect(o.stats.overdue.count).toBe(2);
    expect(o.programmes).toEqual([]); // two churches can't make a programme
  });

  it("lists open survey actions and spend across churches", async () => {
    const b = (await estates.get(`/api/orgs/${diocese}/estate/backlog`)).json.tasks;
    expect(b.map((x: any) => x.ref)).toEqual(["1.1", "2.1"]);
    await warden.post(`/api/buildings/${churches[0]}/jobs`, { title: "Boiler", doneOn: today, costPence: 19000 });
    const s = (await estates.get(`/api/orgs/${diocese}/estate/spend`)).json.rows;
    expect(s.find((r: any) => r.name === "St Test 0").totalPence).toBe(19000);
  });

  it("exports a board report spreadsheet", async () => {
    const r = await estates.get(`/api/orgs/${diocese}/estate/board-report.csv`);
    expect(r.status).toBe(200);
    const csv = new TextDecoder().decode(r.bytes!);
    expect(csv.split("\r\n")[0]).toContain('"Church","Parish","Pastoral area"');
    expect(csv).toContain('"St Test 3"');
  });
});

describe("programmes", () => {
  it("saves a programme from a suggestion, only with the diocese's own churches", async () => {
    const outsider = await makeBuilding(await makeOrg("Unrelated"), "Not ours");
    const r = await estates.post(`/api/orgs/${diocese}/estate/programmes`, { title: "Lightning protection tests", type: "lightning_protection", buildingIds: [...churches, outsider] });
    expect(r.status).toBe(201);
    const list = (await estates.get(`/api/orgs/${diocese}/estate/programmes`)).json.programmes;
    expect(list[0]).toMatchObject({ title: "Lightning protection tests", status: "tendering" });
    expect(list[0].buildingIds).toHaveLength(6); // the outsider was dropped
    expect((await estates.patch(`/api/orgs/${diocese}/estate/programmes/${r.json.id}`, { status: "instructed" })).status).toBe(200);
  });
});

describe("access", () => {
  it("is for the diocese only", async () => {
    expect((await otherEstates.get(`/api/orgs/${diocese}/estate`)).status).toBe(404);
    expect((await wardenOnly.get(`/api/orgs/${diocese}/estate`)).status).toBe(404);
    // A parish's own org isn't an estate.
    expect((await wardenOnly.get(`/api/orgs/${parishes[0]}/estate`)).status).toBe(403);
  });
});

describe("estates notes", () => {
  it("are private to the diocese until shared", async () => {
    const c = churches[0]!;
    const n = await estates.post(`/api/buildings/${c}/estates-notes`, { body: "Consider for the Places of Worship Renewal Fund." });
    expect(n.status).toBe(201);
    expect((await estates.get(`/api/buildings/${c}/estates-notes`)).json.notes).toHaveLength(1);
    expect((await wardenOnly.get(`/api/buildings/${c}/estates-notes`)).json).toMatchObject({ notes: [], canWrite: false });
    expect((await wardenOnly.post(`/api/buildings/${c}/estates-notes`, { body: "x" })).status).toBe(403);

    await estates.patch(`/api/buildings/${c}/estates-notes/${n.json.id}`, { sharedWithParish: true });
    const seen = (await wardenOnly.get(`/api/buildings/${c}/estates-notes`)).json.notes;
    expect(seen.map((x: any) => x.body)).toEqual(["Consider for the Places of Worship Renewal Fund."]);
    expect((await otherEstates.get(`/api/buildings/${c}/estates-notes`)).status).toBe(404);
  });
});
