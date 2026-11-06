import { beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../src/shared/compliance";
import { refCompare } from "../src/worker/repo/quinquennial";
import { email, makeBuilding, makeOrg, makeUser, signedIn, type Client } from "./helpers";

const PDF = new TextEncoder().encode("%PDF-1.4\n% quinquennial report\n");
const today = todayIn("Europe/London");

let org: string, church: string, otherChurch: string;
let warden: Client, treasurer: Client, otherWarden: Client, inspector: Client;

beforeAll(async () => {
  org = await makeOrg("QI parish");
  church = await makeBuilding(org, "St Peter");
  const other = await makeOrg("QI other");
  otherChurch = await makeBuilding(other, "St Other");
  const e = { w: email("w"), t: email("t"), o: email("o"), i: email("i") };
  await makeUser(e.w, [{ orgId: org, role: "churchwarden" }]);
  await makeUser(e.t, [{ orgId: org, role: "treasurer" }]);
  await makeUser(e.o, [{ orgId: other, role: "churchwarden" }]);
  await makeUser(e.i, [{ orgId: org, role: "inspector", buildingId: church }]);
  [warden, treasurer, otherWarden, inspector] = (await Promise.all([e.w, e.t, e.o, e.i].map(signedIn))) as [Client, Client, Client, Client];
});

const uploadReport = async () =>
  (await warden.upload(`/api/buildings/${church}/documents`, PDF, { "content-type": "application/pdf", "x-document-type": "qi_report", "x-document-title": "Quinquennial%20Inspection%20Report%202024" })).json.document.id as string;
const qi = async (c: Client = warden, q = "") => (await c.get(`/api/buildings/${church}/quinquennial${q}`)).json;

describe("reference order", () => {
  it("sorts 2.6 before 2.10", () => {
    expect(["2.10", "2.6", "10.1", "3.2"].sort(refCompare)).toEqual(["2.6", "2.10", "3.2", "10.1"]);
  });
});

describe("entering and publishing a report", () => {
  let reportId: string;
  const ids: Record<string, string> = {};

  it("starts with no report", async () => {
    expect((await qi()).report).toBeNull();
  });

  it("creates a report in review; only churchwardens can", async () => {
    const docId = await uploadReport();
    expect((await treasurer.post(`/api/buildings/${church}/quinquennial`, { documentId: docId, inspectedOn: "2024-05-14" })).status).toBe(403);
    const r = await warden.post(`/api/buildings/${church}/quinquennial`, { documentId: docId, inspectedOn: "2024-05-14", inspectorName: "Inspecting architect", pageCount: 38, nextDueOn: "2029-05-14" });
    expect(r.status).toBe(201);
    reportId = r.json.id;
    expect((await qi()).report).toMatchObject({ id: reportId, status: "review", pageCount: 38 });
    // A second report can't be started while one is being entered.
    expect((await warden.post(`/api/buildings/${church}/quinquennial`, { documentId: docId })).status).toBe(400);
  });

  it("refuses to publish an empty report", async () => {
    expect((await warden.post(`/api/buildings/${church}/quinquennial/${reportId}/publish`)).status).toBe(400);
  });

  it("adds recommendations with bands, estimates and permission", async () => {
    const add = (body: Record<string, unknown>) => warden.post(`/api/buildings/${church}/quinquennial/${reportId}/tasks`, body);
    const items = [
      { key: "parapet", ref: "3.2", band: "A", text: "Repoint open joints to south aisle parapet", location: "South aisle, roof level", estimateLowPence: 250000, estimateHighPence: 400000, permission: "list_b", pageNumber: 12 },
      { key: "hopper", ref: "5.1", band: "A", text: "Replace corroded rainwater hopper", location: "Chancel, north-east", estimateLowPence: 80000, estimateHighPence: 120000, permission: "like_for_like" },
      { key: "damp", ref: "8.4", band: "A", text: "Investigate damp staining at base of tower", location: "Tower" },
      { key: "redecorate", ref: "4.1", band: "C", text: "Redecorate north aisle once damp has dried out", permission: "faculty" },
      { key: "gutters", ref: "1.1", band: "M", text: "Clear gutters and gullies" },
    ];
    for (const { key, ...body } of items) {
      const r = await add(body);
      expect(r.status).toBe(201);
      ids[key] = r.json.id;
    }
    expect((await add({ ref: "9.9", text: "x" })).status).toBe(400); // no band
    expect((await add({ ref: "9.9", band: "B", text: "x", estimateLowPence: 500, estimateHighPence: 100 })).status).toBe(400);
    // 4.1 waits on 8.4
    expect((await warden.patch(`/api/buildings/${church}/tasks/${ids.redecorate}`, { waitingOnTaskId: ids.damp })).status).toBe(200);
    const { tasks } = await qi();
    expect(tasks.map((t: any) => t.ref)).toEqual(["3.2", "5.1", "8.4", "4.1", "1.1"]);
    expect(tasks.find((t: any) => t.ref === "4.1")).toMatchObject({ status: "waiting", waitingOnTaskId: ids.damp });
  });

  it("publishes: becomes current, routine items join the calendar, the inspection is recorded", async () => {
    const r = await warden.post(`/api/buildings/${church}/quinquennial/${reportId}/publish`);
    expect(r.status).toBe(200);
    expect((await qi()).report.status).toBe("current");
    const cal = (await warden.get(`/api/buildings/${church}/compliance`)).json.items;
    expect(cal.find((i: any) => i.name === "Clear gutters and gullies")).toMatchObject({ frequencyLabel: "Yearly" });
    expect(cal.find((i: any) => i.templateKey === "quinquennial")).toMatchObject({ lastDone: "2024-05-14", nextDue: "2029-05-14", missingEvidence: false });
    // Published items can't be deleted.
    expect((await warden.post(`/api/buildings/${church}/tasks/${ids.hopper}/delete`)).status).toBe(400);
  });

  it("shows on the dashboard: open count excludes routine items, estimate range, permission count", async () => {
    const d = (await warden.get(`/api/buildings/${church}/dashboard`)).json;
    expect(d.qi).toMatchObject({ total: 5, open: 4, openA: 3, estimateLowPence: 330000, estimateHighPence: 520000, needPermission: 2 });
    expect(d.qi.bands.find((b: any) => b.band === "M")).toMatchObject({ total: 1, done: 1 });
    const a = d.attention.find((x: any) => x.kind === "task" && x.title.includes("3.2"));
    expect(a.detail).toContain("£2,500 to £4,000");
    expect(a.detail).toContain("List B");
  });

  it("lets a treasurer move progress on but not reword the inspector's text", async () => {
    expect((await treasurer.patch(`/api/buildings/${church}/tasks/${ids.parapet}`, { status: "quoted" })).status).toBe(200);
    expect((await treasurer.patch(`/api/buildings/${church}/tasks/${ids.parapet}`, { text: "changed" })).status).toBe(403);
    expect((await inspector.patch(`/api/buildings/${church}/tasks/${ids.parapet}`, { status: "done" })).status).toBe(403);
    expect((await qi(inspector)).tasks).toHaveLength(5); // the inspector can read
  });

  it("completes a task by logging its job, which frees anything waiting on it", async () => {
    const r = await warden.post(`/api/buildings/${church}/jobs`, { title: "Damp investigation", doneOn: today, costPence: 45000, taskId: ids.damp });
    expect(r.status).toBe(201);
    const { tasks } = await qi();
    expect(tasks.find((t: any) => t.id === ids.damp)).toMatchObject({ status: "done", job: { title: "Damp investigation" } });
    expect(tasks.find((t: any) => t.id === ids.redecorate)).toMatchObject({ status: "not_started", waitingOnTaskId: null });
  });

  it("files an older report as previous without replacing the current one", async () => {
    const docId = await uploadReport();
    const r = (await warden.post(`/api/buildings/${church}/quinquennial`, { documentId: docId, inspectedOn: "2019-05-01" })).json.id;
    await warden.post(`/api/buildings/${church}/quinquennial/${r}/tasks`, { ref: "1", band: "B", text: "Old item" });
    expect((await warden.post(`/api/buildings/${church}/quinquennial/${r}/publish`)).json.current).toBe(false);
    const o = await qi();
    expect(o.report.id).toBe(reportId);
    expect(o.reports.map((x: any) => x.status)).toEqual(["current", "previous"]);
    expect((await qi(warden, `?report=${r}`)).tasks[0].text).toBe("Old item");
  });
});

describe("separation", () => {
  it("keeps reports and tasks inside their church", async () => {
    const { report, tasks } = await qi();
    expect((await otherWarden.get(`/api/buildings/${church}/quinquennial`)).status).toBe(404);
    expect((await otherWarden.get(`/api/buildings/${otherChurch}/quinquennial?report=${report.id}`)).json.report).toBeNull();
    expect((await otherWarden.patch(`/api/buildings/${otherChurch}/tasks/${tasks[0].id}`, { status: "done" })).status).toBe(404);
    expect((await otherWarden.post(`/api/buildings/${otherChurch}/quinquennial/${report.id}/tasks`, { ref: "1", band: "A", text: "x" })).status).toBe(404);
    expect((await otherWarden.post(`/api/buildings/${otherChurch}/jobs`, { title: "x", doneOn: today, taskId: tasks[0].id })).status).toBe(404);
  });
});
