import { beforeAll, describe, expect, it } from "vitest";
import { buildFabricReport, CONDITION_TEMPLATE, type FabricFacts } from "../src/shared/fabric-report";
import { defaultReportYear } from "../src/worker/repo/fabric-report";
import { email, makeBuilding, makeOrg, makeUser, signedIn, type Client } from "./helpers";

const facts: FabricFacts = {
  year: 2026,
  parish: "St Peter and St Paul, Fareham",
  buildingName: "St Peter and St Paul, Fareham",
  apcmDate: "2027-04-26",
  productName: "Fabric",
  works: {
    count: 11,
    totalPence: 642000,
    largest: [
      { title: "Replace cracked slates to the north aisle", doneOn: "2026-09-22", contractor: "Solent Heritage Roofing", costPence: 115000 },
      { title: "Boiler service", doneOn: "2026-10-28", contractor: "Portsdown Heating", costPence: 19000 },
    ],
  },
  qi: { inspectedOn: "2024-05-14", total: 44, done: 30, openA: [{ ref: "3.2", text: "Repoint the south aisle parapet.", status: "quoted", permission: "list_b" }] },
  checks: { inDate: 12, recorded: 14, notRecorded: 0, overdue: [{ name: "Lightning protection system test", bookedFor: "2026-11-12" }, { name: "Asbestos register review", bookedFor: null }] },
  suggestedMatters: ["The PCC is asked to note X."],
  logbook: [{ entryDate: "2026-09-22", work: "Slates", who: "Roofer", costPence: 115000, permissionRef: null }],
};

describe("report wording", () => {
  it("drafts every section from the records", () => {
    const r = buildFabricReport(facts, {
      inspectionDate: "2027-03-20",
      inspectedBy: "R. Hughes and M. Patel, churchwardens",
      accompaniedBy: "The fabric committee chair",
      conditionText: "The building remains in fair condition overall.",
      matters: [{ text: "The PCC is asked to note X.", confirmed: true }],
      terrierConfirmed: true,
    });
    const s = Object.fromEntries(r.sections.map((x) => [x.n, x]));
    expect(s[1]!.paragraphs[0]).toBe(
      "The fabric of the church was inspected on 20 March 2027 by R. Hughes and M. Patel, churchwardens, accompanied by the fabric committee chair, in accordance with Canon F 13 and the Care of Churches and Ecclesiastical Jurisdiction Measure 1991.",
    );
    expect(s[3]!.paragraphs[0]).toBe(
      "Eleven items of work were completed at a total cost of £6,420. The largest were: Replace cracked slates to the north aisle (September, Solent Heritage Roofing, £1,150); Boiler service (October, Portsdown Heating, £190); and 9 smaller items.",
    );
    expect(s[4]!.paragraphs[0]).toContain("Of the 44 recommendations in the report of 14 May 2024, 30 have been completed. One urgent item remains open: repoint the south aisle parapet (item 3.2, quote received; List B application needed).");
    expect(s[5]!.paragraphs[0]).toBe(
      "Twelve of 14 recurring checks are in date. The following were overdue at the date of this report: the lightning protection system test (booked for 12 November 2026); the asbestos register review.",
    );
    expect(s[6]!.paragraphs).toEqual(["The PCC is asked to note X."]);
    expect(s[6]!.state).toBe("ok");
    expect(s[7]!.paragraphs[0]).toBe("The terrier and inventory have been checked and are accurate. One entry was made in the logbook during the year; it is listed in the appendix.");
    expect(r.presented).toBe("Presented to the Annual Parochial Church Meeting, 26 April 2027");
  });

  it("flags what the warden still has to do, and never exports unconfirmed suggestions", () => {
    const r = buildFabricReport(facts, { inspectionDate: null, inspectedBy: null, accompaniedBy: null, conditionText: CONDITION_TEMPLATE, matters: [], terrierConfirmed: false });
    const s = Object.fromEntries(r.sections.map((x) => [x.n, x]));
    expect(s[1]!.state).toBe("warn");
    expect(s[2]).toMatchObject({ state: "warn", fact: "Draft, please edit" });
    expect(s[6]).toMatchObject({ state: "warn", fact: "1 suggested, confirm" });
    expect(s[6]!.paragraphs[0]).toBe("There are no matters for the particular attention of the PCC this year.");
    expect(s[7]!.paragraphs[0]).not.toContain("terrier");
  });

  it("picks last year until July", () => {
    expect(defaultReportYear("2027-03-10")).toBe(2026);
    expect(defaultReportYear("2026-11-07")).toBe(2026);
  });
});

describe("drafting and exporting", () => {
  let church: string;
  let warden: Client, treasurer: Client, other: Client;
  beforeAll(async () => {
    const org = await makeOrg("Report parish");
    church = await makeBuilding(org, "Holy Trinity");
    const otherOrg = await makeOrg("Other report parish");
    await makeBuilding(otherOrg, "Elsewhere");
    const e = { w: email("w"), t: email("t"), o: email("o") };
    await makeUser(e.w, [{ orgId: org, role: "churchwarden" }]);
    await makeUser(e.t, [{ orgId: org, role: "treasurer" }]);
    await makeUser(e.o, [{ orgId: otherOrg, role: "churchwarden" }]);
    [warden, treasurer, other] = (await Promise.all([e.w, e.t, e.o].map(signedIn))) as [Client, Client, Client];
    await warden.post(`/api/buildings/${church}/jobs`, { title: "Clear gutters", doneOn: "2026-05-06", costPence: 38000 });
  });

  it("starts from the template and saves the warden's draft", async () => {
    const first = (await warden.get(`/api/buildings/${church}/fabric-report?year=2026`)).json;
    expect(first).toMatchObject({ year: 2026, status: "new", canEdit: true });
    expect(first.input.conditionText).toBe(CONDITION_TEMPLATE);
    expect(first.facts.works).toMatchObject({ count: 1, totalPence: 38000 });

    expect((await treasurer.req("PUT", `/api/buildings/${church}/fabric-report/2026`, { conditionText: "x" })).status).toBe(403);
    const put = await warden.req("PUT", `/api/buildings/${church}/fabric-report/2026`, {
      inspectionDate: "2027-03-20",
      inspectedBy: "The churchwardens",
      conditionText: "Sound overall.",
      matters: [{ text: "Please note the roof.", confirmed: true }],
      terrierConfirmed: true,
    });
    expect(put.status).toBe(200);
    const after = (await warden.get(`/api/buildings/${church}/fabric-report?year=2026`)).json;
    expect(after.input).toMatchObject({ conditionText: "Sound overall.", terrierConfirmed: true, matters: [{ text: "Please note the roof.", confirmed: true }] });
    expect(after.status).toBe("draft");
  });

  it("exports a real Word file and a real PDF, each saved to Documents", async () => {
    const docx = await warden.req("POST", `/api/buildings/${church}/fabric-report/2026/export?format=docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-disposition")).toContain("Holy Trinity fabric report 2026.docx");
    expect([...docx.bytes!.slice(0, 2)]).toEqual([0x50, 0x4b]); // a zip, as .docx files are
    const pdf = await warden.req("POST", `/api/buildings/${church}/fabric-report/2026/export?format=pdf`);
    expect(pdf.status).toBe(200);
    const head = new TextDecoder().decode(pdf.bytes!.slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(pdf.bytes!.length).toBeGreaterThan(1500);

    const docs = (await warden.get(`/api/buildings/${church}/documents`)).json.documents.filter((d: any) => d.type === "fabric_report");
    expect(docs.map((d: any) => d.title).sort()).toEqual(["Annual fabric report 2026", "Annual fabric report 2026 (Word)"]);
    expect((await warden.get(`/api/buildings/${church}/fabric-report?year=2026`)).json.status).toBe("exported");
  });

  it("keeps the report to its own church and its editors", async () => {
    expect((await treasurer.req("POST", `/api/buildings/${church}/fabric-report/2026/export?format=pdf`)).status).toBe(403);
    expect((await other.get(`/api/buildings/${church}/fabric-report`)).status).toBe(404);
  });
});
