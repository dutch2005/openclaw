/**
 * Database Adapter Factory
 *
 * Creates the appropriate database adapter (SQLite or PostgreSQL) based on configuration.
 */

import type { DatabaseAdapter } from "./db-adapter.js";
import { PostgresqlAdapter } from "./postgresql-adapter.js";
import { SqliteAdapter } from "./sqlite-adapter.js";

export interface DatabaseConfig {
  driver?: "sqlite" | "postgresql";

  // SQLite options
  path?: string;
  vector?: {
    enabled: boolean;
    extensionPath?: string;
  };

  // PostgreSQL options
  postgresql?: {
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
  };
}

export function createDatabaseAdapter(config: DatabaseConfig, agentId: string): DatabaseAdapter {
  const driver = config.driver || process.env.OPENCLAW_DB_DRIVER || "sqlite";

  if (driver === "postgresql") {
    const pgConfig = config.postgresql;
    if (!pgConfig) {
      throw new Error("PostgreSQL configuration required when driver=postgresql");
    }

    // Build connection string if individual parameters provided
    let connectionString = pgConfig.connectionString;
    if (!connectionString && pgConfig.host && pgConfig.database) {
      const auth =
        pgConfig.user && pgConfig.password ? `${pgConfig.user}:${pgConfig.password}@` : "";
      const port = pgConfig.port || 5432;
      connectionString = `postgresql://${auth}${pgConfig.host}:${port}/${pgConfig.database}`;
    }

    if (!connectionString) {
      throw new Error("PostgreSQL connection string or host/database required");
    }

    // Replace {agentId} placeholder in schema name
    const schema = (pgConfig.schema || "agent_{agentId}").replace("{agentId}", agentId);

    return new PostgresqlAdapter({
      connectionString,
      schema,
      pool: pgConfig.pool,
      vector: pgConfig.vector,
    });
  }

  // Default: SQLite
  const dbPath = (config.path || "~/.openclaw/memory/{agentId}.sqlite").replace(
    "{agentId}",
    agentId,
  );

  return new SqliteAdapter({
    path: dbPath,
    vector: config.vector,
    embeddingCacheTable: "embedding_cache",
    ftsTable: "chunks_fts",
    ftsEnabled: true,
  });
}
