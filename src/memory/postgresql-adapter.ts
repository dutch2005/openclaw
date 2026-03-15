/**
 * PostgreSQL Database Adapter
 *
 * Provides PostgreSQL support for OpenClaw memory system using pgvector extension.
 * Designed for multi-agent deployments with shared knowledge base.
 */

import { Pool, type PoolConfig } from "pg";
import type {
  DatabaseAdapter,
  PreparedStatement,
  SearchFilters,
  VectorSearchResult,
  TextSearchResult,
} from "./db-adapter.js";

export interface PostgresqlAdapterOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  schema?: string;
  pool?: {
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
  vector?: {
    extension?: "pgvector";
    dimensions?: number;
  };
}

export class PostgresqlAdapter implements DatabaseAdapter {
  private pool: Pool;
  private readonly schema: string;
  private readonly vectorDimensions: number;

  constructor(options: PostgresqlAdapterOptions) {
    const poolConfig: PoolConfig = options.connectionString
      ? { connectionString: options.connectionString }
      : {
          host: options.host,
          port: options.port,
          database: options.database,
          user: options.user,
          password: options.password,
        };

    poolConfig.max = options.pool?.max ?? 10;
    poolConfig.idleTimeoutMillis = options.pool?.idleTimeoutMillis ?? 30000;
    poolConfig.connectionTimeoutMillis = options.pool?.connectionTimeoutMillis ?? 5000;

    this.pool = new Pool(poolConfig);
    this.schema = options.schema ?? "public";
    this.vectorDimensions = options.vector?.dimensions ?? 1536;
  }

  exec(sql: string): void {
    // PostgreSQL doesn't support synchronous operations
    // Queue it asynchronously
    this.pool.query(sql).catch((err: Error) => {
      console.error(`PostgreSQL exec failed: ${err.message}`);
    });
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  prepare(sql: string): PreparedStatement {
    // PostgreSQL uses parameterized queries, not traditional prepared statements
    // Simulate with closures
    return {
      run: async (...params: unknown[]) => {
        const result = await this.pool.query(sql, params);
        return {
          changes: result.rowCount ?? 0,
          lastInsertRowid: undefined,
        };
      },
      get: async <T>(...params: unknown[]) => {
        const result = await this.pool.query(sql, params);
        return result.rows[0] as T | undefined;
      },
      all: async <T>(...params: unknown[]) => {
        const result = await this.pool.query(sql, params);
        return result.rows as T[];
      },
    };
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async vectorSearch(
    embedding: number[],
    limit: number,
    model: string,
    filters?: SearchFilters,
  ): Promise<VectorSearchResult[]> {
    let sql = `
      SELECT id, path, source, start_line, end_line, text, hash, model,
             embedding <=> $1::vector AS distance
      FROM ${this.schema}.chunks
      WHERE model = $2
    `;

    const params: unknown[] = [JSON.stringify(embedding), model];
    let paramIndex = 3;

    if (filters?.source) {
      sql += ` AND source = $${paramIndex++}`;
      params.push(filters.source);
    }

    if (filters?.path) {
      sql += ` AND path = $${paramIndex++}`;
      params.push(filters.path);
    }

    sql += ` ORDER BY distance ASC LIMIT $${paramIndex}`;
    params.push(limit);

    return this.query<VectorSearchResult>(sql, params);
  }

  async fullTextSearch(
    query: string,
    limit: number,
    model: string,
    filters?: SearchFilters,
  ): Promise<TextSearchResult[]> {
    let sql = `
      SELECT id, path, source, start_line, end_line, text, hash, model,
             ts_rank(text_tsv, to_tsquery('english', $1)) AS rank
      FROM ${this.schema}.chunks
      WHERE text_tsv @@ to_tsquery('english', $1)
        AND model = $2
    `;

    const params: unknown[] = [query, model];
    let paramIndex = 3;

    if (filters?.source) {
      sql += ` AND source = $${paramIndex++}`;
      params.push(filters.source);
    }

    if (filters?.path) {
      sql += ` AND path = $${paramIndex++}`;
      params.push(filters.path);
    }

    sql += ` ORDER BY rank DESC LIMIT $${paramIndex}`;
    params.push(limit);

    return this.query<TextSearchResult>(sql, params);
  }

  async ensureSchema(_agentId: string): Promise<void> {
    // Create schema
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);

    // Create pgvector extension
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Create meta table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Create files table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'memory',
        hash TEXT NOT NULL,
        mtime BIGINT NOT NULL,
        size BIGINT NOT NULL
      )
    `);

    // Create chunks table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL REFERENCES ${this.schema}.files(path) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding vector(${this.vectorDimensions}),
        updated_at BIGINT NOT NULL
      )
    `);

    // Add tsvector column for full-text search if it doesn't exist
    await this.pool.query(`
      DO $$ BEGIN
        ALTER TABLE ${this.schema}.chunks
        ADD COLUMN IF NOT EXISTS text_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Create embedding_cache table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.embedding_cache (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        hash TEXT NOT NULL,
        embedding vector(${this.vectorDimensions}),
        dims INTEGER,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (provider, model, provider_key, hash)
      )
    `);

    // Create indexes
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_path
      ON ${this.schema}.chunks(path)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_source
      ON ${this.schema}.chunks(source)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding
      ON ${this.schema}.chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_text_tsv
      ON ${this.schema}.chunks
      USING gin(text_tsv)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at
      ON ${this.schema}.embedding_cache(updated_at)
    `);
  }

  async migrate(_fromVersion: number, _toVersion: number): Promise<void> {
    // PostgreSQL migration logic would go here
  }

  async getSchemaVersion(): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT value FROM ${this.schema}.meta WHERE key = 'schema_version'`,
      );
      return result.rows[0] ? parseInt(result.rows[0].value) : 0;
    } catch {
      return 0;
    }
  }

  async setSchemaVersion(version: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.meta (key, value) VALUES ('schema_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(version)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
