import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addDaysTo, todayIn } from "../src/shared/compliance";
import { building, reminderLog } from "../src/worker/db/schema";
import { sentEmails } from "../src/worker/lib/email";
import { runReminders } from "../src/worker/reminders";
import { db, email, makeBuilding, makeOrg, makeUser, signedIn, type Client } from "./helpers";

const PDF = new TextEncoder().encode("%PDF-1.4\n% test certificate\n");
const today = todayIn("Europe/London");

let org: string, church: string, otherChurch: string;
let warden: Client, treasurer: Client, inspector: Client, otherWarden: Client;
let wardenEmail: string;

beforeAll(async () => {
  org = await makeOrg("St Peter and St Paul, Fareham");
  church = await makeBuilding(org, "St Peter and St Paul");
  const otherOrg = await makeOrg("St John the Evangelist, Fareham");
  otherChurch = await makeBuilding(otherOrg, "St John the Evangelist");
  wardenEmail = email("warden");
  const e = { t: email("treasurer"), i: email("inspector"), o: email("other") };
  await makeUser(wardenEmail, [{ orgId: org, role: "churchwarden" }]);
  await makeUser(e.t, [{ orgId: org, role: "treasurer" }]);
  await makeUser(e.i, [{ orgId: org, role: "inspector", buildingId: church }]);
  await makeUser(e.o, [{ orgId: otherOrg, role: "churchwarden" }]);
  [warden, treasurer, inspector, otherWarden] = (await Promise.all([wardenEmail, e.t, e.i, e.o].map(signedIn))) as [Client, Client, Client, Client];
});

const calendar = async (c: Client = warden) => (await c.get(`/api/buildings/${church}/compliance`)).json;
const itemNamed = async (name: string) => (await calendar()).items.find((i: any) => i.name === name);

describe("seeding", () => {
  it("seeds the 14 default checks on first use, all with no record yet", async () => {
    const cal = await calendar();
    expect(cal.items).toHaveLength(14);
    expect(cal.counts).toMatchObject({ all: 14, not_recorded: 14, overdue: 0 });
    // The churchwardens' inspection has no APCM date yet either.
    expect(cal.items.every((i: any) => i.statusLabel === "No record yet")).toBe(true);
    expect(cal.months).toHaveLength(12);
    expect(cal.canWrite).toBe(true);
    // Seeding is idempotent.
    expect((await calendar()).items).toHaveLength(14);
  });

  it("adds the lift inspection when the profile says there's a lift", async () => {
    await warden.patch(`/api/buildings/${church}`, { hasLift: true });
    expect((await calendar()).items.map((i: any) => i.name)).toContain("Lift inspection (LOLER)");
  });
});

describe("recording a check", () => {
  it("records a past date, advances next due and shows the status", async () => {
    const item = await itemNamed("Lightning protection system test");
    const doneOn = addDaysTo(today, -388); // a year and 23 days ago
    const r = await warden.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, { doneOn, doneByText: "Contractor" });
    expect(r.status).toBe(201);
    const after = await itemNamed("Lightning protection system test");
    expect(after.lastDone).toBe(doneOn);
    expect(after.status).toBe("overdue");
    expect(after.statusLabel).toMatch(/^Overdue \d+ days$/);
    expect(after.missingEvidence).toBe(true);
  });

  it("refuses a future date", async () => {
    const item = await itemNamed("Gas boiler service and safety check");
    const r = await warden.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, { doneOn: addDaysTo(today, 3) });
    expect(r.status).toBe(400);
  });

  it("uploads a certificate, links it, and clears the missing-evidence flag", async () => {
    const up = await warden.upload(`/api/buildings/${church}/documents`, PDF, {
      "content-type": "application/pdf",
      "x-document-type": "certificate",
      "x-document-title": encodeURIComponent("Gas safety certificate 2026"),
      "x-document-date": today,
    });
    expect(up.status).toBe(201);
    const docId = up.json.document.id;
    const item = await itemNamed("Gas boiler service and safety check");
    await warden.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, { doneOn: today, documentId: docId });
    const after = await itemNamed("Gas boiler service and safety check");
    expect(after).toMatchObject({ status: "on_track", missingEvidence: false });
    expect(after.evidence.document.title).toBe("Gas safety certificate 2026");

    const file = await warden.get(`/api/buildings/${church}/documents/${docId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode(file.bytes!)).toContain("%PDF");
  });

  it("attaches a certificate to an earlier record", async () => {
    const item = await itemNamed("Lightning protection system test");
    const detail = (await warden.get(`/api/buildings/${church}/compliance/${item.id}`)).json;
    const up = await warden.upload(`/api/buildings/${church}/documents`, PDF, { "content-type": "application/pdf", "x-document-type": "certificate", "x-document-title": "LP test" });
    const r = await warden.post(`/api/buildings/${church}/occurrences/${detail.history[0].id}/evidence`, { documentId: up.json.document.id });
    expect(r.status).toBe(200);
    expect((await itemNamed("Lightning protection system test")).missingEvidence).toBe(false);
  });

  it("rejects a file whose contents don't match its type", async () => {
    const r = await warden.upload(`/api/buildings/${church}/documents`, new TextEncoder().encode("<html>"), {
      "content-type": "application/pdf",
      "x-document-type": "certificate",
    });
    expect(r.status).toBe(400);
  });

  it("marks a monthly light test with lights not ticked as partial, without advancing it", async () => {
    await warden.patch(`/api/buildings/${church}`, {
      fittings: [
        { kind: "emergency_light", location: "Nave, west door" },
        { kind: "emergency_light", location: "Chancel" },
      ],
    });
    const item = await itemNamed("Emergency lighting monthly flick test");
    const { fittings } = (await warden.get(`/api/buildings/${church}/compliance/${item.id}`)).json;
    expect(fittings).toHaveLength(2);
    const r = await warden.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, {
      doneOn: today,
      checklist: [{ fittingId: fittings[0].id, ok: true }],
    });
    expect(r.json.partial).toBe(true);
    const mid = await itemNamed("Emergency lighting monthly flick test");
    expect(mid.status).toBe("not_recorded");
    expect(mid.partial.checklist).toHaveLength(1);
    await warden.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, {
      doneOn: today,
      doneByText: "R. Hughes",
      checklist: fittings.map((f: any) => ({ fittingId: f.id, ok: true })),
    });
    const done = await itemNamed("Emergency lighting monthly flick test");
    expect(done).toMatchObject({ lastDone: today, missingEvidence: false, evidence: { kind: "person", name: "R. Hughes" } });
  });
});

describe("anchors and editing", () => {
  it("dates the churchwardens' inspection from the APCM date", async () => {
    // Only a PCC admin sets the APCM date; set it directly for this test.
    const adminEmail = email("admin");
    await makeUser(adminEmail, [{ orgId: org, role: "pcc_admin" }]);
    const admin = await signedIn(adminEmail);
    const apcm = addDaysTo(today, 50);
    expect((await admin.patch(`/api/orgs/${org}`, { apcmDate: apcm })).status).toBe(200);
    const item = await itemNamed("Churchwardens' annual fabric inspection");
    expect(item).toMatchObject({ nextDue: apcm, status: "due_soon", frequencyLabel: "Yearly, before APCM" });
    expect((await warden.patch(`/api/orgs/${org}`, { apcmDate: apcm })).status).toBe(403);
  });

  it("changes frequency, adds and removes items", async () => {
    const item = await itemNamed("Tree survey, churchyard");
    await warden.patch(`/api/buildings/${church}/compliance/${item.id}`, { frequencyMonths: 60 });
    expect((await itemNamed("Tree survey, churchyard")).frequencyLabel).toBe("Every 5 years");

    const add = await warden.post(`/api/buildings/${church}/compliance`, { name: "Bell frame inspection", frequencyMonths: 12, doneBy: "Bell adviser" });
    expect(add.status).toBe(201);
    expect(await itemNamed("Bell frame inspection")).toBeTruthy();
    await warden.post(`/api/buildings/${church}/compliance/${add.json.id}/remove`);
    expect(await itemNamed("Bell frame inspection")).toBeUndefined();
  });
});

describe("permissions and separation", () => {
  it("lets a treasurer record checks, but an inspector only read", async () => {
    const item = await itemNamed("Portable appliance testing");
    expect((await treasurer.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, { doneOn: today })).status).toBe(201);
    expect((await calendar(inspector)).canWrite).toBe(false);
    expect((await inspector.post(`/api/buildings/${church}/compliance/${item.id}/occurrences`, { doneOn: today })).status).toBe(403);
  });

  it("hides one church's calendar, items and documents from another", async () => {
    const item = await itemNamed("Gas boiler service and safety check");
    expect((await otherWarden.get(`/api/buildings/${church}/compliance`)).status).toBe(404);
    expect((await otherWarden.get(`/api/buildings/${church}/compliance/${item.id}`)).status).toBe(404);
    // Using their own building id with our item id still finds nothing.
    expect((await otherWarden.get(`/api/buildings/${otherChurch}/compliance/${item.id}`)).status).toBe(404);
    expect((await otherWarden.post(`/api/buildings/${otherChurch}/compliance/${item.id}/occurrences`, { doneOn: today })).status).toBe(404);
    const doc = item.evidence.document.id;
    expect((await otherWarden.get(`/api/buildings/${church}/documents/${doc}/file`)).status).toBe(404);
    expect((await otherWarden.get(`/api/buildings/${otherChurch}/documents/${doc}/file`)).status).toBe(404);
  });

  it("refuses uploads without the upload header (cross-site protection)", async () => {
    const { app } = await import("../src/worker/index");
    const r = await app.request(
      `http://localhost/api/buildings/${church}/documents`,
      { method: "POST", headers: { "content-type": "application/pdf", cookie: warden.cookie }, body: PDF },
      env,
    );
    expect(r.status).toBe(415);
  });
});

describe("reminder emails", () => {
  it("emails recipients once a day, grouping items, with the screen's wording", async () => {
    const remOrg = await makeOrg("Reminder parish");
    const remChurch = await makeBuilding(remOrg, "Holy Trinity");
    const recipient = email("recipient");
    const quiet = email("quiet");
    await makeUser(recipient, [{ orgId: remOrg, role: "churchwarden" }]);
    await makeUser(quiet, [{ orgId: remOrg, role: "churchwarden" }]);
    const w = await signedIn(recipient);
    const adminEmail = email("remadmin");
    const adminId = await makeUser(adminEmail, [{ orgId: remOrg, role: "pcc_admin" }]);
    const admin = await signedIn(adminEmail);
    const members = (await admin.get(`/api/orgs/${remOrg}/members`)).json.members;
    const recipientId = members.find((m: any) => m.email === recipient).userId;
    await admin.patch(`/api/orgs/${remOrg}/members/${recipientId}`, { receivesReminders: true });
    expect(adminId).toBeTruthy();

    const items = (await w.get(`/api/buildings/${remChurch}/compliance`)).json.items;
    const yearly = items.find((i: any) => i.name === "Fire risk assessment review");
    const pat = items.find((i: any) => i.name === "Portable appliance testing");
    // Due in exactly 30 days, and overdue by exactly 1 day: both remind today.
    await w.post(`/api/buildings/${remChurch}/compliance/${yearly.id}/occurrences`, { doneOn: addDaysTo(today, 30 - 365) });
    await w.post(`/api/buildings/${remChurch}/compliance/${pat.id}/occurrences`, { doneOn: addDaysTo(today, -366) });
    const expectedPat = (await w.get(`/api/buildings/${remChurch}/compliance`)).json.items.find((i: any) => i.id === pat.id);

    const before = sentEmails.length;
    await runReminders(env);
    const mine = sentEmails.slice(before).filter((m) => m.subject.startsWith("Holy Trinity"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(recipient);
    expect(mine[0]!.text).toContain(`Portable appliance testing: ${expectedPat.statusLabel}`);
    expect(mine[0]!.text).toContain("Fire risk assessment review: Due in");
    expect(mine[0]!.text).toContain(`/b/${remChurch}/compliance`);

    // A second run the same day sends nothing more.
    const again = sentEmails.length;
    await runReminders(env);
    expect(sentEmails.slice(again).filter((m) => m.subject.startsWith("Holy Trinity"))).toHaveLength(0);
    const logs = await db().select().from(reminderLog).where(eq(reminderLog.buildingId, remChurch)).all();
    expect(logs).toHaveLength(1);
    expect(await db().select().from(building).where(eq(building.id, remChurch)).get()).toBeTruthy();
  });
});
