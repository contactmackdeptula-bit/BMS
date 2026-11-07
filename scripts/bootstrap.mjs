// One-off setup of a parish, its building, and an invitation for its first PCC admin.
// The admin opens the printed link and chooses their own password, so no password
// is ever typed into a terminal or shared.
//
// Usage:
//   node scripts/bootstrap.mjs --remote --parish "St Peter and St Paul, Fareham" \
//     --church "St Peter and St Paul, Fareham" --email admin@example.org [--listing grade_ii_star] [--diocese Portsmouth]
// Repeat --email for another parish to give the same person access to both.
// Without --remote it writes to the local development database.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const parish = opt("parish");
const church = opt("church") ?? parish;
const email = opt("email")?.toLowerCase();
const listing = opt("listing") ?? null;
const diocese = opt("diocese") ?? null;
const appUrl = opt("app-url") ?? (flag("remote") ? "https://fabric.mds-chms.workers.dev" : "http://localhost:5173");
if (!parish || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Needs --parish and a valid --email. See the comment at the top of this file.");
  process.exit(1);
}
const LISTINGS = ["grade_i", "grade_ii_star", "grade_ii", "unlisted", "locally_listed"];
if (listing && !LISTINGS.includes(listing)) {
  console.error(`--listing must be one of ${LISTINGS.join(", ")}`);
  process.exit(1);
}

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const orgId = id("org");
const buildingId = id("bld");
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const expires = new Date(Date.now() + 7 * 86400000).toISOString();

const sql = [
  `INSERT INTO organisation (id, name, type) VALUES (${q(orgId)}, ${q(parish)}, 'parish');`,
  `INSERT INTO building (id, org_id, name, kind, listing, diocese) VALUES (${q(buildingId)}, ${q(orgId)}, ${q(church)}, 'church', ${q(listing)}, ${q(diocese)});`,
  `INSERT INTO auth_token (id, kind, email, org_id, role, expires_at) VALUES (${q(tokenHash)}, 'invite', ${q(email)}, ${q(orgId)}, 'pcc_admin', ${q(expires)});`,
];

const dir = mkdtempSync(join(tmpdir(), "fabric-bootstrap-"));
const file = join(dir, "bootstrap.sql");
writeFileSync(file, sql.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "fabric", flag("remote") ? "--remote" : "--local", "--file", file, "--yes"], { stdio: ["ignore", "ignore", "inherit"] });

console.log(`\nCreated ${parish} with ${church}.`);
console.log(`Invitation for ${email} as PCC admin, valid until ${expires.slice(0, 10)}:`);
console.log(`${appUrl}/invite?token=${token}\n`);
