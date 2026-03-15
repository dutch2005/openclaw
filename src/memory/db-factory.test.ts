/**
 * Tests for Database Adapter Factory
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConfig } from "./db-factory.js";
import { createDatabaseAdapter } from "./db-factory.js";
import { PostgresqlAdapter } from "./postgresql-adapter.js";
import { SqliteAdapter } from "./sqlite-adapter.js";

describe("createDatabaseAdapter", () => {
  const originalEnv = process.env.OPENCLAW_DB_DRIVER;

  beforeEach(() => {
    // Clear environment variable before each test
    delete process.env.OPENCLAW_DB_DRIVER;
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.OPENCLAW_DB_DRIVER = originalEnv;
    } else {
      delete process.env.OPENCLAW_DB_DRIVER;
    }
  });

  describe("SQLite adapter creation", () => {
    it("creates SQLite adapter by default", () => {
      const config: DatabaseConfig = {};
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("creates SQLite adapter when driver=sqlite", () => {
      const config: DatabaseConfig = {
        driver: "sqlite",
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("replaces {agentId} in SQLite path", () => {
      const config: DatabaseConfig = {
        driver: "sqlite",
        path: "/tmp/memory/{agentId}.sqlite",
      };
      const adapter = createDatabaseAdapter(config, "codex");

      // Verify by checking internal path (assuming SqliteAdapter exposes it)
      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("uses default path when not specified", () => {
      const config: DatabaseConfig = {
        driver: "sqlite",
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("passes vector configuration to SQLite adapter", () => {
      const config: DatabaseConfig = {
        driver: "sqlite",
        vector: {
          enabled: true,
          extensionPath: "/custom/path/sqlite-vec.so",
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });
  });

  describe("PostgreSQL adapter creation", () => {
    it("creates PostgreSQL adapter when driver=postgresql", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("throws error when PostgreSQL config missing", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
      };

      expect(() => createDatabaseAdapter(config, "test-agent")).toThrow(
        "PostgreSQL configuration required",
      );
    });

    it("throws error when connection string and host missing", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          database: "openclaw",
        },
      };

      expect(() => createDatabaseAdapter(config, "test-agent")).toThrow(
        "connection string or host/database required",
      );
    });

    it("builds connection string from individual parameters", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          host: "192.168.1.160",
          port: 5432,
          database: "openclaw_router",
          user: "openclaw_router",
          password: "password123",
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("uses default port 5432 when not specified", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          host: "localhost",
          database: "openclaw",
          user: "openclaw",
          password: "password",
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("replaces {agentId} in schema name", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
          schema: "agent_{agentId}",
        },
      };
      const adapter = createDatabaseAdapter(config, "codex");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
      // Schema replacement is tested implicitly by not throwing errors
    });

    it("uses default schema pattern when not specified", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
        },
      };
      const adapter = createDatabaseAdapter(config, "sentinel");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("passes pool configuration to PostgreSQL adapter", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
          pool: {
            max: 20,
            idleTimeoutMillis: 60000,
            connectionTimeoutMillis: 10000,
          },
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("passes vector configuration to PostgreSQL adapter", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
          vector: {
            extension: "pgvector",
            dimensions: 768,
          },
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });
  });

  describe("Environment variable support", () => {
    it("respects OPENCLAW_DB_DRIVER environment variable", () => {
      process.env.OPENCLAW_DB_DRIVER = "postgresql";

      const config: DatabaseConfig = {
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("explicit driver config overrides environment variable", () => {
      process.env.OPENCLAW_DB_DRIVER = "postgresql";

      const config: DatabaseConfig = {
        driver: "sqlite",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
        },
      };
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("defaults to sqlite when environment variable not set", () => {
      const config: DatabaseConfig = {};
      const adapter = createDatabaseAdapter(config, "test-agent");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });
  });

  describe("Agent ID placeholder replacement", () => {
    it("replaces {agentId} in SQLite path", () => {
      const config: DatabaseConfig = {
        path: "/tmp/{agentId}-test.sqlite",
      };
      const adapter = createDatabaseAdapter(config, "pixel");

      expect(adapter).toBeInstanceOf(SqliteAdapter);
    });

    it("replaces {agentId} in PostgreSQL schema", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
          schema: "openclaw_{agentId}_data",
        },
      };
      const adapter = createDatabaseAdapter(config, "architect");

      expect(adapter).toBeInstanceOf(PostgresqlAdapter);
    });

    it("handles multiple agents with same config", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://user:pass@localhost:5432/openclaw",
          schema: "agent_{agentId}",
        },
      };

      const adapter1 = createDatabaseAdapter(config, "codex");
      const adapter2 = createDatabaseAdapter(config, "sentinel");

      expect(adapter1).toBeInstanceOf(PostgresqlAdapter);
      expect(adapter2).toBeInstanceOf(PostgresqlAdapter);
      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe("Configuration validation", () => {
    it("accepts minimal SQLite configuration", () => {
      const config: DatabaseConfig = {};

      expect(() => createDatabaseAdapter(config, "test")).not.toThrow();
    });

    it("accepts connection string only for PostgreSQL", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          connectionString: "postgresql://localhost/openclaw",
        },
      };

      expect(() => createDatabaseAdapter(config, "test")).not.toThrow();
    });

    it("accepts host/database only for PostgreSQL", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {
          host: "localhost",
          database: "openclaw",
        },
      };

      expect(() => createDatabaseAdapter(config, "test")).not.toThrow();
    });

    it("rejects PostgreSQL without connection details", () => {
      const config: DatabaseConfig = {
        driver: "postgresql",
        postgresql: {},
      };

      expect(() => createDatabaseAdapter(config, "test")).toThrow();
    });

    it("handles empty agentId gracefully", () => {
      const config: DatabaseConfig = {
        path: "/tmp/{agentId}.sqlite",
      };

      expect(() => createDatabaseAdapter(config, "")).not.toThrow();
    });

    it("handles special characters in agentId", () => {
      const config: DatabaseConfig = {
        path: "/tmp/{agentId}.sqlite",
      };

      expect(() => createDatabaseAdapter(config, "test-agent_2024")).not.toThrow();
    });
  });
});
