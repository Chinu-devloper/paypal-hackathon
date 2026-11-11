import { getDb } from "./db";
import type {
  ApiTelemetryEntry,
  AuditLogEntry,
  LedgerItem,
  Project,
  ProjectBundle,
} from "../shared/types";

interface ItemRow {
  id: string;
  is_processing: number;
  data: string;
}

function rowToItem(row: ItemRow): LedgerItem {
  const item = JSON.parse(row.data) as LedgerItem;
  item.isProcessingPayment = row.is_processing === 1;
  return item;
}

export function listProjects(): Project[] {
  const rows = getDb().prepare("SELECT data FROM projects ORDER BY created_at ASC").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Project);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare("SELECT data FROM projects WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Project) : null;
}

export function listItems(projectId: string): LedgerItem[] {
  const rows = getDb()
    .prepare("SELECT id, is_processing, data FROM items WHERE project_id = ? ORDER BY sort_order ASC")
    .all(projectId) as ItemRow[];
  return rows.map(rowToItem);
}

export function getItem(id: string): LedgerItem | null {
  const row = getDb().prepare("SELECT id, is_processing, data FROM items WHERE id = ?").get(id) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function getBundle(projectId: string): ProjectBundle | null {
  const project = getProject(projectId);
  if (!project) return null;
  return { project, items: listItems(projectId) };
}

export function insertProject(project: Project, items: LedgerItem[]): void {
  const db = getDb();
  const insProject = db.prepare("INSERT INTO projects (id, data, created_at) VALUES (?, ?, ?)");
  const insItem = db.prepare(
    "INSERT INTO items (id, project_id, sort_order, status, is_processing, data) VALUES (?, ?, ?, ?, 0, ?)",
  );
  db.transaction(() => {
    insProject.run(project.id, JSON.stringify(project), project.createdAt);
    for (const item of items) {
      insItem.run(item.id, item.projectId, item.sortOrder, item.status, JSON.stringify(item));
    }
  })();
}

/** Persists an item; the processing lock lives in its own column and is never overwritten here. */
export function saveItem(item: LedgerItem): void {
  const { isProcessingPayment: _ignored, ...rest } = item;
  void _ignored;
  getDb()
    .prepare("UPDATE items SET status = ?, sort_order = ?, data = ? WHERE id = ?")
    .run(item.status, item.sortOrder, JSON.stringify({ ...rest, isProcessingPayment: false }), item.id);
}

export function updateItem(id: string, mutate: (item: LedgerItem) => void): LedgerItem {
  const db = getDb();
  return db.transaction(() => {
    const current = getItem(id);
    if (!current) throw new Error(`Item ${id} not found`);
    mutate(current);
    saveItem(current);
    return getItem(id) as LedgerItem;
  })();
}

/** Atomic compare-and-set lock; returns false when another request already holds it. */
export function acquirePaymentLock(itemId: string): boolean {
  const res = getDb().prepare("UPDATE items SET is_processing = 1 WHERE id = ? AND is_processing = 0").run(itemId);
  return res.changes === 1;
}

export function releasePaymentLock(itemId: string): void {
  getDb().prepare("UPDATE items SET is_processing = 0 WHERE id = ?").run(itemId);
}

export function deleteProject(projectId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM items WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM audit_log WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM api_calls WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

export function resetAll(): void {
  const db = getDb();
  db.transaction(() => {
    for (const table of ["items", "projects", "audit_log", "api_calls", "idempotency"]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  })();
}

export function addAuditLog(
  projectId: string,
  itemId: string | null,
  level: AuditLogEntry["level"],
  kind: string,
  message: string,
): void {
  getDb()
    .prepare("INSERT INTO audit_log (project_id, item_id, ts, level, kind, message) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, itemId, new Date().toISOString(), level, kind, message);
}

export function listAuditLog(projectId: string, limit = 200): AuditLogEntry[] {
  const rows = getDb()
    .prepare(
      "SELECT id, project_id, item_id, ts, level, kind, message FROM audit_log WHERE project_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(projectId, limit) as Array<{
    id: number;
    project_id: string;
    item_id: string | null;
    ts: string;
    level: AuditLogEntry["level"];
    kind: string;
    message: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    itemId: r.item_id,
    ts: r.ts,
    level: r.level,
    kind: r.kind,
    message: r.message,
  }));
}

export function addApiCall(entry: Omit<ApiTelemetryEntry, "id">): void {
  getDb()
    .prepare("INSERT INTO api_calls (project_id, item_id, ts, data) VALUES (?, ?, ?, ?)")
    .run(entry.projectId, entry.itemId, entry.ts, JSON.stringify(entry));
}

export function listApiCalls(projectId: string | null, limit = 100): ApiTelemetryEntry[] {
  const db = getDb();
  const rows = (
    projectId
      ? db.prepare("SELECT id, data FROM api_calls WHERE project_id = ? ORDER BY id DESC LIMIT ?").all(projectId, limit)
      : db.prepare("SELECT id, data FROM api_calls ORDER BY id DESC LIMIT ?").all(limit)
  ) as Array<{ id: number; data: string }>;
  return rows.map((r) => ({ ...(JSON.parse(r.data) as ApiTelemetryEntry), id: r.id }));
}

export function getIdempotent<T>(key: string): T | null {
  const row = getDb().prepare("SELECT result FROM idempotency WHERE key = ?").get(key) as
    | { result: string }
    | undefined;
  return row ? (JSON.parse(row.result) as T) : null;
}

export function putIdempotent(key: string, result: unknown): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO idempotency (key, result, created_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(result), new Date().toISOString());
}
