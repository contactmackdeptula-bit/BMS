import { describe, expect, it } from "vitest";
import { sentEmails } from "../src/worker/lib/email";
import { hashPassword, verifyPassword } from "../src/worker/lib/crypto";
import { Client, PASSWORD, email, makeOrg, makeUser, signedIn } from "./helpers";

const linkToken = (text: string) => /token=([\w-]+)/.exec(text)?.[1] ?? "";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("a long enough password");
    expect(h.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("a long enough password", h)).toBe(true);
    expect(await verifyPassword("a long enough passwore", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("login", () => {
  it("signs in, shows /me, and signs out", async () => {
    const org = await makeOrg("St Peter and St Paul");
    const e = email("warden");
    await makeUser(e, [{ orgId: org, role: "churchwarden" }]);
    const c = new Client();
    expect((await c.get("/api/auth/me")).status).toBe(401);

    const login = await c.post("/api/auth/login", { email: e.toUpperCase(), password: PASSWORD });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(e);
    expect(me.json.organisations[0].role).toBe("churchwarden");
    expect(me.json.product.name).toBe("Fabric");

    await c.post("/api/auth/logout");
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const e = email("someone");
    await makeUser(e, []);
    const wrong = await new Client().post("/api/auth/login", { email: e, password: "not the password" });
    const unknown = await new Client().post("/api/auth/login", { email: email("nobody"), password: "whatever123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error).toBe(unknown.json.error);
  });

  it("locks an email for 15 minutes after 10 failed attempts", async () => {
    const e = email("locked");
    await makeUser(e, []);
    for (let i = 0; i < 10; i++) await new Client().post("/api/auth/login", { email: e, password: "wrong password" });
    const r = await new Client().post("/api/auth/login", { email: e, password: PASSWORD });
    expect(r.status).toBe(429);
  });

  it("refuses non-JSON and cross-site writes", async () => {
    const { env } = await import("cloudflare:test");
    const { app } = await import("../src/worker/index");
    const form = await app.request("http://localhost/api/auth/login", { method: "POST", body: "email=a" }, env);
    expect(form.status).toBe(415);
    const cross = await app.request(
      "http://localhost/api/auth/login",
      { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" },
      env,
    );
    expect(cross.status).toBe(403);
  });
});

describe("invitations", () => {
  it("lets a PCC admin invite a churchwarden, who sets a password and gets access", async () => {
    const org = await makeOrg("St John the Evangelist");
    const adminEmail = email("admin");
    await makeUser(adminEmail, [{ orgId: org, role: "pcc_admin" }]);
    const admin = await signedIn(adminEmail);

    const invitee = email("new.warden");
    const inv = await admin.post(`/api/orgs/${org}/invitations`, { email: invitee, role: "churchwarden" });
    expect(inv.status).toBe(201);
    const mail = sentEmails.findLast((m) => m.to === invitee)!;
    expect(mail.text).toContain("/invite?token=");
    const token = linkToken(mail.text);

    const c = new Client();
    const info = await c.get(`/api/auth/invite?token=${token}`);
    expect(info.json).toMatchObject({ email: invitee, organisation: "St John the Evangelist", hasAccount: false });

    const weak = await c.post("/api/auth/invite/accept", { token, name: "Ruth", password: "password123" });
    expect(weak.status).toBe(400);

    const ok = await c.post("/api/auth/invite/accept", { token, name: "Ruth", password: "a sensible pass phrase" });
    expect(ok.status).toBe(200);
    const me = await c.get("/api/auth/me");
    expect(me.json.organisations).toEqual([expect.objectContaining({ id: org, role: "churchwarden" })]);

    // The link only works once.
    const again = await new Client().post("/api/auth/invite/accept", { token, name: "X", password: "another long phrase" });
    expect(again.status).toBe(400);
  });

  it("doesn't let a churchwarden invite people, or an admin give estates roles", async () => {
    const org = await makeOrg("Parish A");
    const w = email("w");
    const a = email("a");
    await makeUser(w, [{ orgId: org, role: "churchwarden" }]);
    await makeUser(a, [{ orgId: org, role: "pcc_admin" }]);
    const warden = await signedIn(w);
    expect((await warden.post(`/api/orgs/${org}/invitations`, { email: email("x"), role: "member" })).status).toBe(403);
    const admin = await signedIn(a);
    expect((await admin.post(`/api/orgs/${org}/invitations`, { email: email("x"), role: "estates" })).status).toBe(400);
  });
});

describe("password reset", () => {
  it("emails a one-hour link that sets a new password and ends other sessions", async () => {
    const e = email("forgetful");
    await makeUser(e, []);
    const oldSession = await signedIn(e);

    const req = await new Client().post("/api/auth/password/reset-request", { email: e });
    expect(req.status).toBe(200);
    const token = linkToken(sentEmails.findLast((m) => m.to === e)!.text);

    const c = new Client();
    const done = await c.post("/api/auth/password/reset", { token, password: "a brand new phrase" });
    expect(done.status).toBe(200);
    expect((await c.get("/api/auth/me")).status).toBe(200);
    expect((await oldSession.get("/api/auth/me")).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: e, password: PASSWORD })).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: e, password: "a brand new phrase" })).status).toBe(200);
  });

  it("answers the same for unknown emails and sends nothing", async () => {
    const before = sentEmails.length;
    const r = await new Client().post("/api/auth/password/reset-request", { email: email("ghost") });
    expect(r.status).toBe(200);
    expect(sentEmails.length).toBe(before);
  });
});
