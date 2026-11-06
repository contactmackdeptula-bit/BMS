import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import type { AppEnv } from "./app-env";
import { readSession } from "./auth/session";
import { authRoutes } from "./routes/auth";
import { buildingRoutes } from "./routes/buildings";
import { orgRoutes } from "./routes/orgs";
import { complianceRoutes } from "./routes/compliance";
import { recordRoutes } from "./routes/records";
import { scheduledReminders } from "./reminders";
import type { Env } from "./env";

export const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  // Cross-site request protection: state-changing requests must be JSON (which a
  // plain HTML form on another site cannot send) and, when the browser says where
  // they came from, come from this site.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    // File uploads carry a custom header instead, which forces a CORS preflight
    // that this API never answers, so other sites can't send them either.
    const isUpload = c.req.header("x-fabric-upload") === "1";
    if (!isUpload && !c.req.header("content-type")?.startsWith("application/json")) {
      return c.json({ error: "Expected a JSON body." }, 415);
    }
    const origin = c.req.header("origin");
    if (origin) {
      const allowed = [new URL(c.req.url).origin, new URL(c.env.APP_URL).origin];
      if (!allowed.includes(origin)) return c.json({ error: "Request from another site refused." }, 403);
    }
  }
  const db = drizzle(c.env.DB);
  c.set("db", db);
  c.set("user", await readSession(c, db));
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
});

app.route("/auth", authRoutes);
app.route("/buildings", buildingRoutes);
app.route("/buildings", complianceRoutes);
app.route("/buildings", recordRoutes);
app.route("/orgs", orgRoutes);

app.get("/health", (c) => c.json({ ok: true }));
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledReminders(env));
  },
} satisfies ExportedHandler<Env>;
