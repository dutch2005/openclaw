# Database Configuration

OpenClaw supports two database backends for memory search: **SQLite** (default) and **PostgreSQL** (optional).

## Overview

The memory search system stores agent memories, embeddings, and full-text search indexes. You can choose between SQLite for simple deployments or PostgreSQL for multi-agent shared knowledge environments.

## SQLite (Default)

### When to Use SQLite

✅ **Best for:**

- **Single-agent deployments** - One agent, one database file
- **Local development** - No external dependencies, easy setup
- **Embedded use cases** - Self-contained, portable
- **Low latency** - Zero network overhead, direct file access
- **Simple backups** - Copy .sqlite file to backup

✅ **Advantages:**

- No external database server needed
- Zero configuration required
- Perfect for personal use
- Very fast for single-agent scenarios
- Portable (just copy the file)

❌ **Limitations:**

- **No shared knowledge** - Each agent has completely isolated memory
- **Difficult to scale** - Adding 5 agents = managing 5 separate .sqlite files
- **No concurrent writes** - Only one agent can write to its database at a time
- **Limited analytics** - Cannot query across all agents easily
- **Backup complexity** - Must backup each agent's .sqlite file separately
- **No replication** - Cannot setup high-availability or failover
- **File locks** - Can't have multiple processes access same agent database

### Configuration

SQLite is the default - no configuration needed. OpenClaw will automatically create a database file at:

```
~/.openclaw/memory/{agentId}.sqlite
```

**Explicit configuration (optional):**

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "store": {
          "driver": "sqlite",
          "path": "~/.openclaw/memory/{agentId}.sqlite",
          "vector": {
            "enabled": true,
            "extensionPath": null
          }
        }
      }
    }
  }
}
```

### Extensions

SQLite uses the following extensions:

- **sqlite-vec** (v0.1.7) - Vector search with cosine similarity
- **FTS5** - Full-text search with BM25 ranking

## PostgreSQL (Optional)

### When to Use PostgreSQL

✅ **Best for:**

- **Multi-agent deployments** - 3+ agents sharing knowledge base
- **Production environments** - Enterprise deployments with HA requirements
- **Cloud deployments** - Works seamlessly with managed PostgreSQL (AWS RDS, Supabase, Neon)
- **Team collaboration** - Multiple users running agents that share memory
- **Advanced analytics** - Need to query and analyze data across all agents
- **Centralized management** - Single backup, single monitoring system

✅ **Advantages:**

- **Shared knowledge pool** - All agents can access and learn from shared memory patterns
  - Example: If Codex learns about a Python library, Sentinel can also benefit from that knowledge
- **True concurrency** - Multiple agents can read/write simultaneously with proper isolation
- **Unified backups** - One `pg_dump` backs up all agents' data
- **Advanced analytics** - SQL queries across all agents:
  ```sql
  SELECT agent, COUNT(*) FROM all_schemas.chunks GROUP BY agent;
  ```
- **Replication & HA** - Setup replicas for high availability
- **Point-in-time recovery** - Restore to any point in the past
- **Better observability** - Use PostgreSQL monitoring tools (pg_stat_statements, pgAdmin)
- **Cloud-native** - Works with managed services, no file system access needed
- **Future-proof** - Can add full-text search improvements, better indexes, partitioning

✅ **Key Use Cases:**

1. **Multi-Agent Learning:**
   - 5 agents (codex, sentinel, pixel, architect, main) share knowledge
   - When codex learns a pattern, all agents benefit
   - Centralized routing patterns improve accuracy across the board

2. **Production Deployments:**
   - Deploy OpenClaw in Docker/Kubernetes
   - Use AWS RDS or Supabase PostgreSQL
   - Automatic backups and monitoring
   - Scale horizontally by adding agent replicas

3. **Team Environments:**
   - Multiple developers running their own agents
   - All agents share organizational knowledge
   - Consistent behavior across team members

4. **Analytics & Reporting:**
   - Dashboard queries all agent data at once
   - Generate reports: "Which agent answered most questions this month?"
   - Track collective learning progress
   - Identify knowledge gaps across all agents

❌ **Considerations:**

- Requires PostgreSQL server (can use Docker or managed service)
- Network latency (add ~3-5ms per query vs local SQLite)
- More complex setup (connection string, credentials)
- Cost (managed PostgreSQL services have fees)

### Prerequisites

1. **PostgreSQL 14+** installed and running
2. **pgvector extension** installed

#### Installing PostgreSQL

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

**macOS:**

```bash
brew install postgresql@15
brew services start postgresql@15
```

**Docker:**

```bash
docker run -d \
  --name openclaw-postgres \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=openclaw_router \
  -p 5432:5432 \
  ankane/pgvector
```

#### Installing pgvector

**Ubuntu/Debian:**

```bash
sudo apt install postgresql-15-pgvector
```

**From source:**

```bash
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

**Enable extension:**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Database Setup

#### 1. Create Database and User

```sql
-- Connect as superuser
sudo -u postgres psql

-- Create database
CREATE DATABASE openclaw_router;

-- Create user
CREATE USER openclaw_router WITH PASSWORD 'your_secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE openclaw_router TO openclaw_router;
GRANT CREATE ON DATABASE openclaw_router TO openclaw_router;

-- Connect to database
\c openclaw_router

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
```

#### 2. Configure OpenClaw

Update `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "store": {
          "driver": "postgresql",
          "postgresql": {
            "connectionString": "postgresql://openclaw_router:your_password@localhost:5432/openclaw_router",
            "schema": "agent_{agentId}",
            "pool": {
              "max": 10,
              "idleTimeoutMillis": 30000,
              "connectionTimeoutMillis": 5000
            },
            "vector": {
              "extension": "pgvector",
              "dimensions": 1536
            }
          }
        }
      }
    }
  }
}
```

**Configuration Options:**

| Option                                    | Type   | Default             | Description                                       |
| ----------------------------------------- | ------ | ------------------- | ------------------------------------------------- |
| `driver`                                  | string | `"sqlite"`          | Database driver: `"sqlite"` or `"postgresql"`     |
| `postgresql.connectionString`             | string | -                   | Full PostgreSQL connection string                 |
| `postgresql.host`                         | string | -                   | PostgreSQL host (alternative to connectionString) |
| `postgresql.port`                         | number | `5432`              | PostgreSQL port                                   |
| `postgresql.database`                     | string | -                   | Database name                                     |
| `postgresql.user`                         | string | -                   | Username                                          |
| `postgresql.password`                     | string | -                   | Password                                          |
| `postgresql.schema`                       | string | `"agent_{agentId}"` | Schema name (supports `{agentId}` placeholder)    |
| `postgresql.pool.max`                     | number | `10`                | Maximum pool connections                          |
| `postgresql.pool.idleTimeoutMillis`       | number | `30000`             | Idle connection timeout                           |
| `postgresql.pool.connectionTimeoutMillis` | number | `5000`              | Connection acquisition timeout                    |
| `postgresql.vector.dimensions`            | number | `1536`              | Embedding vector dimensions                       |

**Environment Variables:**

You can use environment variables instead of hardcoding credentials:

```bash
export OPENCLAW_DB_DRIVER=postgresql
export OPENCLAW_POSTGRESQL_URL=postgresql://openclaw_router:password@host:5432/openclaw_router
```

#### 3. Schema Isolation

Each agent gets its own PostgreSQL schema:

- Agent `codex` → Schema `agent_codex`
- Agent `sentinel` → Schema `agent_sentinel`
- Agent `pixel` → Schema `agent_pixel`

This provides data isolation while allowing shared infrastructure.

### Schema Structure

PostgreSQL adapter creates the following tables in each agent's schema:

```sql
-- Configuration metadata
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- File tracking
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime BIGINT NOT NULL,
  size BIGINT NOT NULL
);

-- Memory chunks with embeddings
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(1536),  -- pgvector column
  updated_at BIGINT NOT NULL,
  text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED  -- Full-text search
);

-- Embedding cache
CREATE TABLE embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding vector(1536),
  dims INTEGER,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);

-- Indexes
CREATE INDEX idx_chunks_path ON chunks(path);
CREATE INDEX idx_chunks_source ON chunks(source);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_text_tsv ON chunks USING gin(text_tsv);
CREATE INDEX idx_embedding_cache_updated_at ON embedding_cache(updated_at);
```

## Migration

### Migrating from SQLite to PostgreSQL

Use the migration script to copy existing SQLite data to PostgreSQL:

```bash
# Set PostgreSQL credentials
export POSTGRES_HOST=192.168.1.160
export POSTGRES_PORT=5432
export POSTGRES_DB=openclaw_router
export POSTGRES_USER=openclaw_router
export POSTGRES_PASSWORD=your_password

# Run migration
cd /path/to/openclaw
bash scripts/migrate-openclaw-to-postgres.sh
```

**What the script does:**

1. Discovers all agent SQLite databases in `~/.openclaw/memory/`
2. Validates PostgreSQL connection and pgvector extension
3. Shows migration plan with database sizes
4. Asks for confirmation
5. Creates PostgreSQL schemas for each agent
6. Migrates all tables: meta, files, chunks, embedding_cache
7. Converts embeddings from SQLite BLOB to pgvector format
8. Creates indexes (including IVFFlat for vector search)
9. Verifies migration

**After migration:**

1. Update `openclaw.json` to use PostgreSQL (script shows example)
2. Restart OpenClaw agents
3. Verify schemas: `psql -h host -U user -d openclaw_router -c "\dn"`
4. Backup old SQLite files (optional)

**Rollback:**

If migration fails or you want to revert:

1. Change `driver` back to `"sqlite"` in config
2. Restart agents (will use original SQLite files)
3. Drop PostgreSQL schemas if desired:
   ```sql
   DROP SCHEMA IF EXISTS agent_codex CASCADE;
   ```

## Performance Tuning

### SQLite Optimization

**PRAGMA settings:**

```sql
PRAGMA journal_mode = WAL;  -- Write-Ahead Logging for concurrent reads
PRAGMA synchronous = NORMAL;  -- Balance durability and speed
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA mmap_size = 30000000000;  -- Memory-mapped I/O for large files
PRAGMA temp_store = MEMORY;  -- Use memory for temporary tables
```

OpenClaw sets these automatically.

### PostgreSQL Optimization

**Connection pool tuning:**

```json
{
  "postgresql": {
    "pool": {
      "max": 20, // Increase for high-concurrency
      "idleTimeoutMillis": 30000,
      "connectionTimeoutMillis": 5000
    }
  }
}
```

**PostgreSQL server configuration (`postgresql.conf`):**

```ini
# Memory
shared_buffers = 256MB  # 25% of RAM
effective_cache_size = 1GB  # 50-75% of RAM
work_mem = 16MB  # Per-operation memory
maintenance_work_mem = 128MB  # For VACUUM, INDEX

# Connections
max_connections = 100

# WAL
wal_buffers = 16MB
min_wal_size = 1GB
max_wal_size = 4GB

# Query planner
random_page_cost = 1.1  # For SSD
effective_io_concurrency = 200  # For SSD
```

**IVFFlat index tuning:**

For large datasets (>10K vectors), adjust IVFFlat lists:

```sql
-- More lists = better accuracy, slower build time
CREATE INDEX idx_chunks_embedding ON chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 1000);  -- Default is 100
```

**Vacuuming:**

```sql
-- Auto-vacuum settings
ALTER TABLE chunks SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE chunks SET (autovacuum_analyze_scale_factor = 0.05);

-- Manual vacuum
VACUUM ANALYZE chunks;
```

## Monitoring

### SQLite

**Check database size:**

```bash
ls -lh ~/.openclaw/memory/*.sqlite
du -sh ~/.openclaw/memory/
```

**Query statistics:**

```sql
SELECT COUNT(*) as total_chunks FROM chunks;
SELECT COUNT(*) as total_files FROM files;
SELECT COUNT(*) as cached_embeddings FROM embedding_cache;
```

### PostgreSQL

**Connection pool status:**

```javascript
const pool = require("pg").Pool;
console.log(pool.totalCount); // Total connections
console.log(pool.idleCount); // Idle connections
console.log(pool.waitingCount); // Waiting clients
```

**Database size:**

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname LIKE 'agent_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

**Query performance:**

```sql
-- Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 10 slowest queries
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%chunks%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Index usage:**

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname LIKE 'agent_%'
ORDER BY idx_scan DESC;
```

## Troubleshooting

### SQLite Issues

**Error: "database is locked"**

- Cause: Another process is writing to the database
- Solution: Ensure only one OpenClaw process per agent, or enable WAL mode

**Error: "unable to load extension"**

- Cause: sqlite-vec extension not found
- Solution: Install sqlite-vec or disable vector search:
  ```json
  { "store": { "vector": { "enabled": false } } }
  ```

### PostgreSQL Issues

**Error: "password authentication failed"**

- Check password doesn't have special shell characters
- Use connection string format: `postgresql://user:pass@host:port/db`
- Verify `pg_hba.conf` allows MD5/SCRAM authentication

**Error: "permission denied for database"**

- Grant CREATE permission:
  ```sql
  GRANT CREATE ON DATABASE openclaw_router TO openclaw_router;
  ```

**Error: "type 'vector' does not exist"**

- Install pgvector extension:
  ```bash
  sudo apt install postgresql-15-pgvector
  CREATE EXTENSION vector;
  ```

**Error: "could not connect to server"**

- Verify PostgreSQL is running: `systemctl status postgresql`
- Check firewall allows port 5432
- Test connection: `psql -h host -U user -d db`

**Error: "connection pool exhausted"**

- Increase `pool.max` in configuration
- Check for connection leaks in application code
- Monitor active connections:
  ```sql
  SELECT count(*) FROM pg_stat_activity WHERE datname = 'openclaw_router';
  ```

**Slow vector search:**

- Ensure IVFFlat index exists:
  ```sql
  \d+ agent_codex.chunks
  ```
- Rebuild index with more lists:
  ```sql
  DROP INDEX agent_codex.idx_chunks_embedding;
  CREATE INDEX idx_chunks_embedding ON agent_codex.chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1000);
  ```

## Comparison Matrix

| Feature                 | SQLite               | PostgreSQL                   |
| ----------------------- | -------------------- | ---------------------------- |
| **Setup Complexity**    | Zero config          | Requires server setup        |
| **Multi-Agent Support** | Isolated per agent   | Shared knowledge base        |
| **Concurrent Writes**   | Limited (file locks) | Full support                 |
| **Backup**              | Copy .sqlite files   | `pg_dump` or managed backups |
| **Analytics**           | Per-agent only       | Cross-agent queries          |
| **Replication**         | No                   | Yes (streaming, logical)     |
| **HA/Failover**         | No                   | Yes (with replicas)          |
| **Cloud Native**        | File-based           | Connection-based             |
| **Latency**             | ~2-5ms               | ~5-10ms                      |
| **Scalability**         | Good for <10K chunks | Excellent for millions       |
| **Cost**                | Free                 | Managed services have fees   |

## Best Practices

### General

1. **Start with SQLite** - Default works great for most use cases
2. **Switch to PostgreSQL when:**
   - Running 3+ agents that should share knowledge
   - Need enterprise backup/HA
   - Deploying to production
   - Team environment with multiple users

3. **Never commit credentials** - Use environment variables
4. **Backup regularly** - Automate backups for production
5. **Monitor performance** - Track query times and database size

### SQLite Best Practices

- Keep database files under 10GB for optimal performance
- Use WAL mode for concurrent reads
- Backup by copying .sqlite files while agent is stopped
- Store on SSD for best performance

### PostgreSQL Best Practices

- Use managed services (AWS RDS, Supabase) for production
- Enable connection pooling with appropriate max connections
- Set up automated backups with retention policy
- Monitor connection pool usage
- Use schema-level isolation for multi-tenancy
- Regularly VACUUM and ANALYZE tables
- Keep PostgreSQL version up to date
- Use SSL/TLS for remote connections

## Further Reading

- [SQLite Performance Tuning](https://www.sqlite.org/performance.html)
- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [PostgreSQL Connection Pooling](https://node-postgres.com/features/pooling)
