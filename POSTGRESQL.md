# PostgreSQL Support for OpenClaw

This branch adds PostgreSQL support to OpenClaw's memory system, enabling shared knowledge across multiple agents.

## Status: 🚧 Work in Progress

**Completed:**

- ✅ Configuration schema updated to accept PostgreSQL settings
- ✅ Database adapter interface (`db-adapter.ts`)
- ✅ SQLite adapter wrapper (`sqlite-adapter.ts`)
- ✅ PostgreSQL adapter with pgvector (`postgresql-adapter.ts`)
- ✅ Adapter factory (`db-factory.ts`)
- ✅ All 5 agent schemas created in PostgreSQL
- ✅ PreparedStatement interface made async
- ✅ Manager base classes updated for DatabaseAdapter type

**In Progress:**

- 🔄 Converting synchronous database operations to async throughout memory manager hierarchy
- 🔄 Testing with both SQLite and PostgreSQL configurations

**Todo:**

- ⏳ Complete async refactoring of MemoryManagerSyncOps
- ⏳ Update MemoryManagerEmbeddingOps
- ⏳ Update MemoryIndexManager
- ⏳ End-to-end testing
- ⏳ Performance benchmarking

## Architecture

### Files Added/Modified

**New Files:**

- `src/memory/db-adapter.ts` - Database adapter interface
- `src/memory/db-factory.ts` - Factory for creating adapters
- `src/memory/sqlite-adapter.ts` - SQLite adapter implementation
- `src/memory/postgresql-adapter.ts` - PostgreSQL adapter implementation

**Modified Files:**

- `src/config/types.tools.ts` - Added PostgreSQL config types
- `src/config/zod-schema.agent-runtime.ts` - Added PostgreSQL validation
- `src/agents/memory-search.ts` - Updated ResolvedMemorySearchConfig type
- `src/memory/manager.ts` - Updated db type to DatabaseAdapter | DatabaseSync
- `src/memory/manager-sync-ops.ts` - Integrated adapter factory, updated db type
- `src/memory/manager-embedding-ops.ts` - (pending async updates)

### Configuration

Add to `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "store": {
          "driver": "postgresql",
          "postgresql": {
            "connectionString": "postgresql://user:pass@host:5432/database",
            "schema": "agent_{agentId}",
            "pool": {
              "max": 20,
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

The `{agentId}` placeholder in schema name gets replaced with the actual agent ID (e.g., `agent_main`, `agent_codex`).

## PostgreSQL Setup

### 1. Install PostgreSQL and pgvector

```bash
# Install PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Install pgvector extension
sudo apt-get install postgresql-15-pgvector  # or your PG version
```

### 2. Create Database and User

```sql
CREATE DATABASE openclaw_router;
CREATE USER openclaw_router WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE openclaw_router TO openclaw_router;
GRANT CREATE ON DATABASE openclaw_router TO openclaw_router;

-- Enable pgvector extension
\c openclaw_router
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. Initialize Agent Schemas

Run the initialization script:

```javascript
// init-schemas.js
const { Pool } = require("pg");

const agents = ["codex", "sentinel", "pixel", "architect", "main"];
const connectionString = "postgresql://openclaw_router:password@host:5432/openclaw_router";

const pool = new Pool({ connectionString });

async function initSchema(agentId) {
  const schema = `agent_${agentId}`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  // ... (see /tmp/init-postgres-schemas.js for full implementation)
}

async function main() {
  for (const agentId of agents) {
    await initSchema(agentId);
  }
  await pool.end();
}

main();
```

## Keeping PostgreSQL Support Across Updates

### Option 1: Maintain Fork (Current Approach)

This repository is a fork with PostgreSQL support. To update:

```bash
# Add upstream OpenClaw remote
git remote add upstream https://github.com/anthropics/openclaw.git

# Update from upstream
git fetch upstream
git checkout main
git merge upstream/main

# Rebase PostgreSQL changes
git checkout postgresql-support
git rebase main

# Resolve conflicts if any
# Test thoroughly
# Push updated branch
git push origin postgresql-support --force-with-lease
```

### Option 2: Submit Upstream PR

Once complete, submit a Pull Request to the official OpenClaw repository to merge PostgreSQL support upstream.

### Option 3: Build as Plugin/Extension

If OpenClaw supports plugins, refactor PostgreSQL support as an installable extension that hooks into the memory system.

## Testing

### Test with SQLite (default)

```bash
# No config changes needed - SQLite is default
openclaw --agent main
```

### Test with PostgreSQL

```bash
# Update config as shown above
openclaw --agent main

# Verify connection
psql -h host -U openclaw_router -d openclaw_router -c "\dn" | grep agent_
```

### Verify Shared Knowledge

1. Start agent `main`, create some memories
2. Start agent `codex`, verify it can access shared knowledge
3. Check PostgreSQL directly:

```sql
\c openclaw_router
SET search_path TO agent_main;
SELECT COUNT(*) FROM chunks;
```

## Dependencies Added

- `pg@8.13.1` - PostgreSQL client
- `@types/pg@^8.16.0` - TypeScript types (dev)

## Performance Considerations

- **Connection Pooling:** Max 20 connections per agent (configurable)
- **Schema Isolation:** Each agent has its own schema for data separation
- **Vector Search:** Uses pgvector's IVFFlat index (100 lists)
- **Full-Text Search:** Uses PostgreSQL's tsvector with GIN index

## Migration from SQLite to PostgreSQL

⚠️ **Not yet implemented** - Migration tool to copy existing SQLite data to PostgreSQL schemas.

Planned features:

- Export SQLite embeddings and chunks
- Import into PostgreSQL with proper schema mapping
- Verify data integrity
- Zero-downtime migration option

## Troubleshooting

### Connection Errors

```
Error: password authentication failed
```

- Verify password doesn't have special shell characters
- Use connection string format instead of separate params
- Check PostgreSQL `pg_hba.conf` allows MD5/SCRAM authentication

### Schema Permission Errors

```
ERROR:  permission denied for database openclaw_router
```

Grant CREATE permission:

```sql
GRANT CREATE ON DATABASE openclaw_router TO openclaw_router;
```

### Vector Extension Missing

```
ERROR:  type "vector" does not exist
```

Install pgvector extension:

```bash
sudo apt-get install postgresql-15-pgvector
CREATE EXTENSION vector;
```

## Branch Information

- **Branch:** `postgresql-support`
- **Base:** OpenClaw v2026.2.16
- **Remote:** https://github.com/dutch2005/openclaw
- **Created:** 2026-02-17

## Maintenance

To preserve this work across OpenClaw updates:

1. ✅ Changes are on dedicated `postgresql-support` branch
2. ✅ Branch pushed to remote repository
3. ✅ Documentation in this file
4. ⏳ Regular rebasing against upstream main
5. ⏳ Automated tests to catch breaking changes

## Contact

For questions or issues with PostgreSQL support, see the main OpenClaw repository or this fork's issue tracker.
