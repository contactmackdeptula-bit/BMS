import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { app } from "../src/worker/index";
import { building, membership, organisation, user, type Role } from "../src/worker/db/schema";
import { hashPassword } from "../src/worker/lib/crypto";
import { ulid } from "../src/worker/lib/ids";

export const db = () => drizzle(env.DB);
export const PASSWORD = "correct horse battery";

/** A tiny browser: keeps the session cookie between requests. */
export class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    const raw = body instanceof Uint8Array || body instanceof ArrayBuffer;
    if (method !== "GET" && !raw) headers["content-type"] = "application/json";
    Object.assign(headers, extraHeaders);
    const res = await app.request(
      `http://localhost${path}`,
      { method, headers, body: method === "GET" ? undefined : raw ? (body as BodyInit) : JSON.stringify(body ?? {}) },
      env,
    );
    const set = res.headers.get("set-cookie");
    if (set) {
      const [pair] = set.split(";");
      this.cookie = pair!.endsWith("=") ? "" : pair!;
    }
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const json = isJson ? ((await res.json().catch(() => null)) as any) : null;
    const bytes = isJson ? null : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, json, headers: res.headers, bytes };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b);
  patch = (p: string, b?: unknown) => this.req("PATCH", p, b);
  upload = (p: string, bytes: Uint8Array, headers: Record<string, string>) =>
    this.req("POST", p, bytes, { "x-fabric-upload": "1", ...headers });
}

export async function makeOrg(name: string, type: "parish" | "diocese" | "pastoral_area" = "parish", parentId: string | null = null) {
  const id = ulid();
  await db().insert(organisation).values({ id, name, type, parentId });
  return id;
}

export async function makeBuilding(orgId: string, name: string) {
  const id = ulid();
  await db().insert(building).values({ id, orgId, name });
  return id;
}

export async function makeUser(email: string, memberships: { orgId: string; role: Role; buildingId?: string }[]) {
  const id = ulid();
  await db().insert(user).values({ id, email, name: email.split("@")[0]!, passwordHash: await hashPassword(PASSWORD) });
  for (const m of memberships) {
    await db().insert(membership).values({ id: ulid(), userId: id, orgId: m.orgId, role: m.role, buildingId: m.buildingId ?? null });
  }
  return id;
}

export async function signedIn(email: string) {
  const c = new Client();
  const r = await c.post("/api/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.json)}`);
  return c;
}

let n = 0;
/** Unique email per test so tests don't collide in the shared database. */
export const email = (label: string) => `${label}.${Date.now()}.${n++}@example.org`;
