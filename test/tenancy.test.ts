// SPEC.md §3: each PCC's data is walled off; dioceses read but don't edit.
import { beforeAll, describe, expect, it } from "vitest";
import { email, makeBuilding, makeOrg, makeUser, signedIn, type Client } from "./helpers";

let stPeter: string, stJohn: string, diocese: string, otherDiocese: string;
let stPeterChurch: string, stJohnChurch: string;
let wardenP: Client, wardenJ: Client, treasurerP: Client, estates: Client, outsider: Client, inspector: Client;

beforeAll(async () => {
  diocese = await makeOrg("Diocese of Portsmouth", "diocese");
  const area = await makeOrg("Fareham and Gosport", "pastoral_area", diocese);
  otherDiocese = await makeOrg("Diocese of Elsewhere", "diocese");
  stPeter = await makeOrg("St Peter and St Paul, Fareham", "parish", area);
  stJohn = await makeOrg("St John the Evangelist, Fareham", "parish");
  stPeterChurch = await makeBuilding(stPeter, "St Peter and St Paul");
  stJohnChurch = await makeBuilding(stJohn, "St John the Evangelist");

  const e = { wp: email("wp"), wj: email("wj"), tp: email("tp"), es: email("es"), out: email("out"), insp: email("insp") };
  await makeUser(e.wp, [{ orgId: stPeter, role: "churchwarden" }]);
  await makeUser(e.wj, [{ orgId: stJohn, role: "churchwarden" }]);
  await makeUser(e.tp, [{ orgId: stPeter, role: "treasurer" }]);
  await makeUser(e.es, [{ orgId: diocese, role: "estates" }]);
  await makeUser(e.out, [{ orgId: otherDiocese, role: "estates_admin" }]);
  await makeUser(e.insp, [{ orgId: stPeter, role: "inspector", buildingId: stPeterChurch }]);
  [wardenP, wardenJ, treasurerP, estates, outsider, inspector] = (await Promise.all(
    [e.wp, e.wj, e.tp, e.es, e.out, e.insp].map(signedIn),
  )) as [Client, Client, Client, Client, Client, Client];
});

describe("parish walls", () => {
  it("lists only your own church's buildings", async () => {
    const p = await wardenP.get("/api/buildings");
    expect(p.json.buildings.map((b: any) => b.id)).toEqual([stPeterChurch]);
    const j = await wardenJ.get("/api/buildings");
    expect(j.json.buildings.map((b: any) => b.id)).toEqual([stJohnChurch]);
  });

  it("answers 404, not 403, for another church's building", async () => {
    const r = await wardenP.get(`/api/buildings/${stJohnChurch}`);
    expect(r.status).toBe(404);
    const w = await wardenP.patch(`/api/buildings/${stJohnChurch}`, { name: "Hijacked" });
    expect(w.status).toBe(404);
    const after = await wardenJ.get(`/api/buildings/${stJohnChurch}`);
    expect(after.json.building.name).toBe("St John the Evangelist");
  });

  it("doesn't let one parish manage another's users", async () => {
    expect((await wardenP.get(`/api/orgs/${stJohn}/members`)).status).toBe(404);
  });
});

describe("roles inside a parish", () => {
  it("lets a churchwarden edit the profile, not a treasurer", async () => {
    const ok = await wardenP.patch(`/api/buildings/${stPeterChurch}`, { listing: "grade_ii_star", diocese: "Portsmouth" });
    expect(ok.status).toBe(200);
    expect(ok.json.building.listing).toBe("grade_ii_star");
    const no = await treasurerP.patch(`/api/buildings/${stPeterChurch}`, { listing: "grade_i" });
    expect(no.status).toBe(403);
  });

  it("gives an inspector read-only access to their one building", async () => {
    const list = await inspector.get("/api/buildings");
    expect(list.json.buildings.map((b: any) => b.id)).toEqual([stPeterChurch]);
    expect((await inspector.get(`/api/buildings/${stPeterChurch}`)).status).toBe(200);
    expect((await inspector.patch(`/api/buildings/${stPeterChurch}`, { name: "x" })).status).toBe(403);
  });
});

describe("diocese over parish", () => {
  it("lets the diocese read buildings in parishes under it, through the estates shell", async () => {
    const list = await estates.get("/api/buildings");
    const ids = list.json.buildings.map((b: any) => b.id);
    expect(ids).toContain(stPeterChurch);
    expect(ids).not.toContain(stJohnChurch); // St John's isn't under this diocese
    const one = await estates.get(`/api/buildings/${stPeterChurch}`);
    expect(one.status).toBe(200);
    expect(one.json.access.viaEstates).toBe(true);
    expect(one.json.access.canEdit).toBe(false);
  });

  it("doesn't let the diocese edit parish records", async () => {
    expect((await estates.patch(`/api/buildings/${stPeterChurch}`, { name: "Renamed" })).status).toBe(403);
  });

  it("gives another diocese nothing", async () => {
    expect((await outsider.get("/api/buildings")).json.buildings).toEqual([]);
    expect((await outsider.get(`/api/buildings/${stPeterChurch}`)).status).toBe(404);
  });
});
