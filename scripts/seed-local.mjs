// Seeds the LOCAL D1 database with the pilot structure so the app can be tried.
// Usage: npm run db:migrate:local && npm run seed:local
// Sign in with any seeded email and the password below (local only).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

const PASSWORD = process.env.SEED_PASSWORD ?? "fabric local password";

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  const b64 = (b) => Buffer.from(b).toString("base64");
  return `pbkdf2-sha256$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const hash = await hashPassword(PASSWORD);

const orgs = [
  ["org_diocese", "Diocese of Portsmouth", "diocese", null],
  ["org_area", "Fareham and Gosport", "pastoral_area", "org_diocese"],
  ["org_stpeter", "St Peter and St Paul, Fareham", "parish", "org_area"],
  ["org_stjohn", "St John the Evangelist, Fareham", "parish", "org_area"],
];
const buildings = [
  ["bld_stpeter", "org_stpeter", "St Peter and St Paul, Fareham", "grade_ii_star", "Portsmouth"],
  ["bld_stjohn", "org_stjohn", "St John the Evangelist, Fareham", null, "Portsmouth"],
];
const users = [
  ["usr_admin", "admin@example.org", "Pilot Admin", [["org_stpeter", "pcc_admin"], ["org_stjohn", "pcc_admin"]]],
  ["usr_warden", "warden@example.org", "Pilot Warden", [["org_stpeter", "churchwarden"]]],
  ["usr_estates", "estates@example.org", "Diocesan Surveyor", [["org_diocese", "estates"]]],
];

const sql = [];
for (const [id, name, type, parent] of orgs) {
  sql.push(`INSERT OR IGNORE INTO organisation (id, name, type, parent_id, apcm_date) VALUES (${q(id)}, ${q(name)}, ${q(type)}, ${q(parent)}, ${type === "parish" ? q("2027-04-26") : "NULL"});`);
}
for (const [id, org, name, listing, diocese] of buildings) {
  sql.push(`INSERT OR IGNORE INTO building (id, org_id, name, kind, listing, diocese) VALUES (${q(id)}, ${q(org)}, ${q(name)}, 'church', ${q(listing)}, ${q(diocese)});`);
}
for (const [id, email, name, ms] of users) {
  sql.push(`INSERT OR IGNORE INTO user (id, email, name, password_hash, password_changed_at) VALUES (${q(id)}, ${q(email)}, ${q(name)}, ${q(hash)}, ${q(new Date().toISOString())});`);
  ms.forEach(([org, role], i) => {
    sql.push(`INSERT OR IGNORE INTO membership (id, user_id, org_id, role, receives_reminders) VALUES (${q(`${id}_m${i}`)}, ${q(id)}, ${q(org)}, ${q(role)}, 1);`);
  });
}

const dir = mkdtempSync(join(tmpdir(), "fabric-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "fabric", "--local", "--file", file], { stdio: "inherit" });
console.log(`\nSeeded. Sign in at the app with admin@example.org, warden@example.org or estates@example.org.\nPassword: "${PASSWORD}"`);
