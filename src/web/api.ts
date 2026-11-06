export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("We couldn't reach the server. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? "Something went wrong. Please try again.", res.status);
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
};

// ---------- Shapes returned by the API ----------
export type Role = "pcc_admin" | "churchwarden" | "treasurer" | "member" | "inspector" | "estates_admin" | "estates";

export type Me = {
  user: { id: string; email: string; name: string };
  organisations: { id: string; name: string; type: string; apcmDate: string | null; role: Role }[];
  buildings: { id: string; orgId: string; name: string; kind: string; roles: Role[]; viaEstates: boolean }[];
  product: { name: string; tagline: string };
};

export type Building = {
  id: string;
  orgId: string;
  name: string;
  kind: "church" | "hall" | "house" | "other";
  listing: string | null;
  diocese: string | null;
  address: string | null;
  postcode: string | null;
  hasLift: boolean;
  hasWaterSystems: boolean;
  inspectorName: string | null;
  insurer: string | null;
  architect: string | null;
  keyContacts: { name: string; role: string; phone?: string; email?: string }[];
};

export type BuildingAccess = { roles: Role[]; canEdit: boolean; viaEstates: boolean };
