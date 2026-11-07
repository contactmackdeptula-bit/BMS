// Offline queue (UI-HANDOFF §12 "Gestures and offline"): inside a thick-walled
// church there is often no signal. Checklist ticks, jobs and photos are kept in
// IndexedDB on the phone and sent when the connection returns.
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

export type QueuedOp =
  | { kind: "occurrence"; buildingId: string; itemId: string; body: Record<string, unknown>; label: string }
  | { kind: "job"; buildingId: string; body: Record<string, unknown>; files: { blob: Blob; name: string; type: string; docType: string }[]; label: string }
  | { kind: "upload"; buildingId: string; file: { blob: Blob; name: string; type: string; docType: string }; title?: string; label: string };

type Stored = QueuedOp & { id: number; queuedAt: string };

const DB = "fabric-offline";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function pending(): Promise<Stored[]> {
  try {
    return (await tx("readonly", (s) => s.getAll())) as Stored[];
  } catch {
    return [];
  }
}

async function enqueue(op: QueuedOp) {
  await tx("readwrite", (s) => s.add({ ...op, queuedAt: new Date().toISOString() }));
  notify();
}

/** A failure that means "no connection", as opposed to the server saying no. */
export const isOffline = (e: unknown) => !navigator.onLine || (e instanceof ApiError && e.status === 0);

async function send(op: QueuedOp) {
  if (op.kind === "occurrence") {
    await api.post(`/buildings/${op.buildingId}/compliance/${op.itemId}/occurrences`, op.body);
  } else if (op.kind === "job") {
    const documentIds: string[] = [];
    for (const f of op.files) {
      const file = new File([f.blob], f.name, { type: f.type });
      documentIds.push((await api.upload(op.buildingId, file, { type: f.docType, documentDate: (op.body.doneOn as string) ?? null })).id);
    }
    await api.post(`/buildings/${op.buildingId}/jobs`, { ...op.body, documentIds });
  } else {
    await api.upload(op.buildingId, new File([op.file.blob], op.file.name, { type: op.file.type }), { type: op.file.docType, title: op.title });
  }
}

/**
 * Tries to send now; if there's no connection, keeps it on the phone.
 * Returns "sent" or "queued". Real errors from the server are thrown.
 */
export async function sendOrQueue(op: QueuedOp): Promise<"sent" | "queued"> {
  if (!navigator.onLine) {
    await enqueue(op);
    return "queued";
  }
  try {
    await send(op);
    return "sent";
  } catch (e) {
    if (isOffline(e)) {
      await enqueue(op);
      return "queued";
    }
    throw e;
  }
}

let flushing = false;
/** Sends everything waiting, oldest first. Stops at the first connection failure. */
export async function flush(): Promise<{ sent: number; failed: { label: string; message: string }[] }> {
  if (flushing || !navigator.onLine) return { sent: 0, failed: [] };
  flushing = true;
  let sent = 0;
  const failed: { label: string; message: string }[] = [];
  try {
    for (const op of await pending()) {
      try {
        await send(op);
        await tx("readwrite", (s) => s.delete(op.id));
        sent++;
      } catch (e) {
        if (isOffline(e)) break;
        // The server refused it (for example the check was removed): drop it and say so.
        failed.push({ label: op.label, message: (e as Error).message });
        await tx("readwrite", (s) => s.delete(op.id));
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return { sent, failed };
}

/** Number of things waiting on this phone, kept up to date. */
export function usePendingCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => void pending().then((p) => setN(p.length));
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return n;
}

/** Sends the queue when the app starts and whenever the connection comes back. */
export function startOfflineSync(onResult?: (r: Awaited<ReturnType<typeof flush>>) => void) {
  const run = () => void flush().then((r) => (r.sent || r.failed.length) && onResult?.(r));
  window.addEventListener("online", run);
  run();
  return () => window.removeEventListener("online", run);
}

/** Keeps the last good copy of a page's data, so the phone can show it with no signal. */
export const lastKnown = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(`fabric:cache:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`fabric:cache:${key}`, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the phone just won't have an offline copy */
    }
  },
};

/** Empties the queue, for sign-out on a shared phone. */
export async function clearQueue() {
  try {
    await tx("readwrite", (s) => s.clear());
  } catch {
    /* nothing stored */
  }
  notify();
}
