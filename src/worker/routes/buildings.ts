import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { readJson, unauthorised } from "../lib/http";
import { buildingFields, getProfile, updateProfile } from "../repo/building";
import { buildingScope, listBuildings } from "../tenancy";

export const buildingRoutes = new Hono<AppEnv>();

buildingRoutes.use("*", async (c, next) => {
  if (!c.get("user")) throw unauthorised();
  await next();
});

buildingRoutes.get("/", async (c) => {
  return c.json({ buildings: await listBuildings(c.get("db"), c.get("user")!.id) });
});

buildingRoutes.get("/:buildingId", async (c) => {
  const scope = await buildingScope(c.get("db"), c.get("user")!.id, c.req.param("buildingId"));
  return c.json({
    building: getProfile(scope),
    access: { roles: scope.roles, canEdit: scope.can("building.edit"), viaEstates: scope.viaEstates },
  });
});

buildingRoutes.patch("/:buildingId", async (c) => {
  const scope = await buildingScope(c.get("db"), c.get("user")!.id, c.req.param("buildingId"));
  const updated = await updateProfile(scope, buildingFields(await readJson(c.req.raw)));
  return c.json({ building: updated });
});
