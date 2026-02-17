/**
 * Database Adapter Interface
 *
 * Provides a unified interface for database operations across different backends
 * (SQLite, PostgreSQL, etc.)
 */

export interface DatabaseAdapter {
  // Core operations
  exec(sql: string): void;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  prepare(sql: string): PreparedStatement;

  // Transaction support
  transaction<T>(fn: () => T | Promise<T>): Promise<T>;

  // Specialized operations
  vectorSearch(
    embedding: number[],
    limit: number,
    model: string,
    filters?: SearchFilters,
  ): Promise<VectorSearchResult[]>;

  fullTextSearch(
    query: string,
    limit: number,
    model: string,
    filters?: SearchFilters,
  ): Promise<TextSearchResult[]>;

  // Schema management
  ensureSchema(agentId: string): Promise<void>;
  migrate(fromVersion: number, toVersion: number): Promise<void>;

  // Metadata
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(version: number): Promise<void>;

  // Cleanup
  close(): Promise<void>;
}

export interface PreparedStatement {
  run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  get<T>(...params: unknown[]): Promise<T | undefined>;
  all<T>(...params: unknown[]): Promise<T[]>;
}

export interface SearchFilters {
  source?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface VectorSearchResult {
  id: string;
  path: string;
  source: string;
  start_line: number;
  end_line: number;
  text: string;
  hash: string;
  model: string;
  distance: number;
}

export interface TextSearchResult {
  id: string;
  path: string;
  source: string;
  start_line: number;
  end_line: number;
  text: string;
  hash: string;
  model: string;
  rank: number;
}

export interface EmbeddingCacheEntry {
  provider: string;
  model: string;
  provider_key: string;
  hash: string;
  embedding: number[];
  dims: number;
  updated_at: number;
}

export interface FileEntry {
  path: string;
  source: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface ChunkEntry {
  id: string;
  path: string;
  source: string;
  start_line: number;
  end_line: number;
  hash: string;
  model: string;
  text: string;
  embedding?: number[];
  updated_at: number;
}
