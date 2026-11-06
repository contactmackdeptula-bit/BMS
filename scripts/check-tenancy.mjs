// Fails if a route file reaches the database without going through the tenancy
// layer (SPEC.md §3.1). Route files may import constants and types from the
// schema, but not tables or drizzle-orm query helpers. Auth routes are exempt:
// they work on users and sessions, not church data.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "src/worker/routes";
const EXEMPT = new Set(["auth.ts"]);
const ALLOWED_SCHEMA_IMPORTS = new Set(["ROLES", "Role", "DOCUMENT_TYPES", "ORG_TYPES"]);
const problems = [];

for (const file of readdirSync(dir)) {
  if (EXEMPT.has(file) || !file.endsWith(".ts")) continue;
  const src = readFileSync(join(dir, file), "utf8");
  if (/from\s+["']drizzle-orm/.test(src)) problems.push(`${file}: imports drizzle-orm`);
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']\.\.\/db\/schema["']/g)) {
    if (m[1]) continue;
    const names = m[2].split(",").map((n) => n.replace(/^\s*type\s+/, "").trim()).filter(Boolean);
    for (const n of names) if (!ALLOWED_SCHEMA_IMPORTS.has(n)) problems.push(`${file}: imports table "${n}" from the schema`);
  }
}

if (problems.length) {
  console.error("Tenancy check failed. Route files must go through src/worker/tenancy.ts and src/worker/repo/*:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("Tenancy check passed.");
