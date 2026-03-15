/**
 * SQLite Database Adapter
 *
 * Wraps existing SQLite implementation from OpenClaw's memory system
 * to conform to the DatabaseAdapter interface.
 */

import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveUserPath } from "../utils.js";
import type {
  DatabaseAdapter,
  PreparedStatement,
  SearchFilters,
  VectorSearchResult,
  TextSearchResult,
} from "./db-adapter.js";
import { ensureDir } from "./internal.js";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import { requireNodeSqlite } from "./sqlite.js";

export interface SqliteAdapterOptions {
  path: string;
  vector?: {
    enabled: boolean;
    extensionPath?: string;
  };
  embeddingCacheTable?: string;
  ftsTable?: string;
  ftsEnabled?: boolean;
}

export class SqliteAdapter implements DatabaseAdapter {
  private db: DatabaseSync;
  private readonly vectorEnabled: boolean;
  private readonly embeddingCacheTable: string;
  private readonly ftsTable: string;
  protected ftsAvailable: boolean = false;

  constructor(options: SqliteAdapterOptions) {
    const dbPath = resolveUserPath(options.path);
    const dir = path.dirname(dbPath);
    ensureDir(dir);

    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(dbPath, {
      allowExtension: options.vector?.enabled ?? false,
    });

    this.vectorEnabled = options.vector?.enabled ?? false;
    this.embeddingCacheTable = options.embeddingCacheTable ?? "embedding_cache";
    this.ftsTable = options.ftsTable ?? "chunks_fts";

    // Load vector extension if enabled
    if (this.vectorEnabled && options.vector?.extensionPath) {
      try {
        this.db.exec(`SELECT load_extension('${options.vector.extensionPath}')`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Failed to load vector extension: ${message}`);
      }
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = params ? stmt.all(...(params as any[])) : stmt.all();
    return results as T[];
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: async (...params: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = stmt.run(...(params as any[]));
        return {
          changes: typeof result.changes === "bigint" ? Number(result.changes) : result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: async <T>(...params: unknown[]) => stmt.get(...(params as any[])) as T | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      all: async <T>(...params: unknown[]) => stmt.all(...(params as any[])) as T[],
    };
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async vectorSearch(
    embedding: number[],
    limit: number,
    model: string,
    filters?: SearchFilters,
  ): Promise<VectorSearchResult[]> {
    if (!this.vectorEnabled) {
      return [];
    }

    // Convert embedding to BLOB for sqlite-vec
    const embeddingBlob = new Float32Array(embedding).buffer;

    let sql = `
      SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.text, c.hash, c.model,
             v.distance
      FROM chunks_vec v
      JOIN chunks c ON v.id = c.id
      WHERE v.embedding MATCH ?
        AND c.model = ?
    `;

    const params: unknown[] = [embeddingBlob, model];

    if (filters?.source) {
      sql += " AND c.source = ?";
      params.push(filters.source);
    }

    if (filters?.path) {
      sql += " AND c.path = ?";
      params.push(filters.path);
    }

    sql += " ORDER BY v.distance ASC LIMIT ?";
    params.push(limit);

    return this.query<VectorSearchResult>(sql, params);
  }

  async fullTextSearch(
    query: string,
    limit: number,
    model: string,
    filters?: SearchFilters,
  ): Promise<TextSearchResult[]> {
    if (!this.ftsAvailable) {
      return [];
    }

    let sql = `
      SELECT id, path, source, start_line, end_line, text, '' as hash, '' as model,
             bm25(${this.ftsTable}) AS rank
      FROM ${this.ftsTable}
      WHERE ${this.ftsTable} MATCH ?
        AND model = ?
    `;

    const params: unknown[] = [query, model];

    if (filters?.source) {
      sql += " AND source = ?";
      params.push(filters.source);
    }

    if (filters?.path) {
      sql += " AND path = ?";
      params.push(filters.path);
    }

    sql += " ORDER BY rank ASC LIMIT ?";
    params.push(limit);

    return this.query<TextSearchResult>(sql, params);
  }

  async ensureSchema(_agentId: string): Promise<void> {
    const result = ensureMemoryIndexSchema({
      db: this.db,
      embeddingCacheTable: this.embeddingCacheTable,
      ftsTable: this.ftsTable,
      ftsEnabled: true,
    });
    this.ftsAvailable = result.ftsAvailable;
  }

  async migrate(_fromVersion: number, _toVersion: number): Promise<void> {
    // SQLite migration logic would go here
    // For now, we rely on ensureSchema to handle basic migrations
  }

  async getSchemaVersion(): Promise<number> {
    try {
      const result = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined;
      return result ? parseInt(result.value) : 0;
    } catch {
      return 0;
    }
  }

  async setSchemaVersion(version: number): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)")
      .run(String(version));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
