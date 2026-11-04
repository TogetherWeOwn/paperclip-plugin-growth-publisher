import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";

export interface Store<S> {
  load(companyId: string): Promise<{ version: number; state: S } | null>;
  compareAndSwap(companyId: string, expectedVersion: number | null, nextState: S): Promise<boolean>;
}

export const MAX_STATE_BYTES = 2 * 1024 * 1024;
const FIXTURE_COMPANY = /^fixture-company-[a-z0-9-]{1,40}$(?![\s\S])/;
// Matches the installed host's derivePluginDatabaseNamespace, not arbitrary SQL identifiers.
const HOST_NAMESPACE = /^plugin_[a-z0-9_]{1,36}_[a-f0-9]{10}$(?![\s\S])/;
const TABLE = "publisher_state";

function validateVersion(version: number | null): void {
  if (version !== null && (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Expected version must be null or a positive, incrementable safe integer");
  }
}

function serialize(state: unknown): string {
  const json = JSON.stringify(state);
  if (typeof json !== "string") throw new TypeError("State must be JSON serializable");
  if (Buffer.byteLength(json, "utf8") > MAX_STATE_BYTES) throw new RangeError("Serialized state exceeds 2 MiB");
  // Validate the roundtrip before issuing any write. Neither adapter retains caller references.
  JSON.parse(json);
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decode<S>(row: unknown, companyId: string): { version: number; state: S } {
  if (!isRecord(row) || row.company_id !== companyId || typeof row.state_json !== "string") {
    throw new TypeError("Malformed publisher state row");
  }
  // PostgreSQL BIGINT may be returned as a canonical decimal string.
  const version = typeof row.version === "string" && /^[1-9][0-9]*$(?![\s\S])/.test(row.version)
    ? Number(row.version) : row.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("Malformed publisher state version");
  }
  if (Buffer.byteLength(row.state_json, "utf8") > MAX_STATE_BYTES) throw new RangeError("Serialized state exceeds 2 MiB");
  return { version, state: JSON.parse(row.state_json) as S };
}

/** Local fixture only: real, file-backed SQLite; never a replacement for host persistence. */
export class FileStore<S> implements Store<S> {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(filename: string) {
    if (!filename || filename === ":memory:") throw new TypeError("A file-backed SQLite path is required");
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        company_id TEXT PRIMARY KEY NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        state_json TEXT NOT NULL
      ) STRICT`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private assertCompany(companyId: string): void {
    if (this.closed) throw new Error("Store is closed");
    if (typeof companyId !== "string" || !FIXTURE_COMPANY.test(companyId)) {
      throw new TypeError("FileStore requires a fixture-company identifier");
    }
  }

  async load(companyId: string): Promise<{ version: number; state: S } | null> {
    this.assertCompany(companyId);
    const row = this.db.prepare(`SELECT company_id, version, state_json FROM ${TABLE} WHERE company_id = ?`).get(companyId);
    return row === undefined ? null : decode<S>(row, companyId);
  }

  async compareAndSwap(companyId: string, expectedVersion: number | null, nextState: S): Promise<boolean> {
    this.assertCompany(companyId);
    validateVersion(expectedVersion);
    const json = serialize(nextState);
    // No read-before-write: uniqueness / the one UPDATE are the linearization points.
    const result = expectedVersion === null
      ? this.db.prepare(`INSERT INTO ${TABLE} (company_id, version, state_json) VALUES (?, 1, ?) ON CONFLICT (company_id) DO NOTHING`).run(companyId, json)
      : this.db.prepare(`UPDATE ${TABLE} SET state_json = ?, version = version + 1 WHERE company_id = ? AND version = ?`).run(json, companyId, expectedVersion);
    if (result.changes !== 0 && result.changes !== 1) throw new Error("Unexpected SQLite affected-row count");
    return result.changes === 1;
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}

/** Structural subset of the installed SDK's PluginDatabaseClient. */
export interface HostDatabase {
  namespace: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

/**
 * Supplied ONLY by trusted composition after verifying the local SQL contract.
 * SDK test mocks do not establish atomicity or affected-row semantics. No default proof
 * is exported, and no runtime flag, tool argument, or company state should supply this.
 */
export interface TrustedSqlContract {
  namespace: string;
  atomicCompareAndSwap: true;
  affectedRowCount: true;
  evidence: string;
}

export class HostStore<S> implements Store<S> {
  private readonly db: HostDatabase;
  private readonly namespace: string;
  private readonly table: string;

  constructor(ctx: { db: HostDatabase }, proof?: TrustedSqlContract) {
    const namespace = ctx.db.namespace;
    if (typeof namespace !== "string" || !HOST_NAMESPACE.test(namespace)) throw new TypeError("Untrusted host database namespace");
    if (!proof || proof.namespace !== namespace || proof.atomicCompareAndSwap !== true || proof.affectedRowCount !== true ||
        typeof proof.evidence !== "string" || proof.evidence.trim().length === 0) {
      throw new Error("HostStore unavailable without an explicit trusted SQL contract proof");
    }
    this.db = ctx.db;
    this.namespace = namespace;
    this.table = `"${namespace}"."${TABLE}"`;
  }

  private assertCompany(companyId: string): void {
    if (this.db.namespace !== this.namespace) throw new Error("Host database namespace changed");
    if (typeof companyId !== "string" || !companyId.trim()) throw new TypeError("Company identifier is required");
  }

  async load(companyId: string): Promise<{ version: number; state: S } | null> {
    this.assertCompany(companyId);
    const rows: unknown = await this.db.query(`SELECT company_id, version, state_json FROM ${this.table} WHERE company_id = $1`, [companyId]);
    if (!Array.isArray(rows) || rows.length > 1) throw new TypeError("Malformed host query results");
    return rows.length === 0 ? null : decode<S>(rows[0], companyId);
  }

  async compareAndSwap(companyId: string, expectedVersion: number | null, nextState: S): Promise<boolean> {
    this.assertCompany(companyId);
    validateVersion(expectedVersion);
    const json = serialize(nextState);
    const result: unknown = expectedVersion === null
      ? await this.db.execute(`INSERT INTO ${this.table} (company_id, version, state_json) VALUES ($1, 1, $2) ON CONFLICT (company_id) DO NOTHING`, [companyId, json])
      : await this.db.execute(`UPDATE ${this.table} SET state_json = $1, version = version + 1 WHERE company_id = $2 AND version = $3`, [json, companyId, expectedVersion]);
    if (!isRecord(result) || (result.rowCount !== 0 && result.rowCount !== 1)) {
      throw new TypeError("Malformed host affected-row count");
    }
    return result.rowCount === 1;
  }
}
