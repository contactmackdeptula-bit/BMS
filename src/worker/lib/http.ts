import { HTTPException } from "hono/http-exception";

export const notFound = () => new HTTPException(404, { message: "Not found" });
export const forbidden = () => new HTTPException(403, { message: "You don't have permission to do that." });
export const badRequest = (message: string) => new HTTPException(400, { message });
export const unauthorised = () => new HTTPException(401, { message: "Please sign in." });

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    throw badRequest("Expected a JSON body.");
  }
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const normaliseEmail = (v: unknown) => str(v).toLowerCase();
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
