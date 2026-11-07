import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { api, ApiError, type Me } from "./api";
import { clearQueue, isOffline, lastKnown, pending, startOfflineSync } from "./offline";
import { ErrorPanel, Skeleton } from "./ui/basics";

type SessionState = { me: Me; reload: () => Promise<void>; signOut: () => Promise<void> };
const SessionContext = createContext<SessionState | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside RequireSession");
  return s;
}

/** Loads /api/auth/me; sends signed-out visitors to the sign-in page. */
export function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      const fresh = await api.get<Me>("/auth/me");
      setMe(fresh);
      lastKnown.set("me", fresh);
      setError(null);
    } catch (e) {
      // No signal: carry on with who this phone last knew was signed in.
      const cached = isOffline(e) ? lastKnown.get<Me>("me") : null;
      if (cached) setMe(cached);
      else setError(e as ApiError);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Send anything saved on this phone as soon as there's a connection.
  useEffect(() => {
    if (!me) return;
    return startOfflineSync();
  }, [me]);

  const signOut = useCallback(async () => {
    const waiting = (await pending()).length;
    if (waiting && !window.confirm(`${waiting} ${waiting === 1 ? "thing hasn't" : "things haven't"} uploaded from this phone yet. Signing out will discard ${waiting === 1 ? "it" : "them"}. Sign out anyway?`)) return;
    await api.post("/auth/logout");
    await clearQueue();
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("fabric:cache:")).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* nothing cached */
    }
    window.location.assign("/login");
  }, []);

  if (error?.status === 401) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (error) {
    return (
      <div className="auth-page">
        <ErrorPanel message={error.message} onRetry={reload} />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="auth-page" aria-busy="true">
        <div style={{ width: 320, display: "grid", gap: 12 }}>
          <Skeleton height={28} />
          <Skeleton />
          <Skeleton />
        </div>
      </div>
    );
  }
  return <SessionContext.Provider value={{ me, reload, signOut }}>{children}</SessionContext.Provider>;
}

/** Remembers the last building per browser (a convenience only; never required). */
export const lastBuilding = {
  get(userId: string): string | null {
    try {
      return localStorage.getItem(`fabric:lastBuilding:${userId}`);
    } catch {
      return null;
    }
  },
  set(userId: string, buildingId: string) {
    try {
      localStorage.setItem(`fabric:lastBuilding:${userId}`, buildingId);
    } catch {
      /* private window: ignore */
    }
  },
};
