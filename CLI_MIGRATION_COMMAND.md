# OpenClaw CLI Migration Command

## Overview

Added `openclaw memory migrate` CLI command for migrating SQLite memory databases to PostgreSQL directly from the command line.

## Usage

### Basic Migration

```bash
# Set password via environment variable (recommended)
export POSTGRES_PASSWORD=your_password

# Migrate all agents
openclaw memory migrate \
  --to postgresql \
  --host localhost \
  --database openclaw \
  --user openclaw
```

### Migrate Specific Agent

```bash
openclaw memory migrate \
  --to postgresql \
  --host 192.168.1.160 \
  --database openclaw_router \
  --user openclaw_router \
  --agent codex
```

### Dry Run (Preview)

```bash
openclaw memory migrate \
  --to postgresql \
  --host localhost \
  --database openclaw \
  --user openclaw \
  --dry-run
```

### All Options

```bash
openclaw memory migrate \
  --to postgresql \                    # Target driver (required)
  --host localhost \                   # PostgreSQL host (required)
  --database openclaw \                # Database name (required)
  --user openclaw \                    # Username (required)
  --port 5432 \                        # Port (default: 5432)
  --password pass \                    # Password (or use POSTGRES_PASSWORD env var)
  --schema agent_{agentId} \          # Schema pattern (default: agent_{agentId})
  --agent codex \                      # Specific agent (default: all agents)
  --dry-run \                          # Preview only
  --verbose                            # Verbose output
```

## Features

### ✅ Automatic Validation

- Tests PostgreSQL connection before migration
- Verifies pgvector extension is installed
- Checks for SQLite database files
- Validates all prerequisites

### ✅ Progress Reporting

- Real-time progress for large migrations
- Shows row counts for each table
- Estimates time remaining
- Clear success/error messages

### ✅ Data Integrity

- Converts SQLite BLOB embeddings to PostgreSQL vector format
- Preserves all metadata, files, chunks, and embedding cache
- Creates proper indexes (IVFFlat for vector search)
- Uses transactions for safety

### ✅ Flexible Options

- Migrate all agents or specific agent
- Dry-run mode to preview migration
- Custom schema naming patterns
- Verbose mode for debugging

## Examples

### Example 1: Local PostgreSQL

```bash
# Setup local PostgreSQL
sudo apt install postgresql postgresql-15-pgvector
sudo -u postgres psql

# In psql:
CREATE DATABASE openclaw;
CREATE USER openclaw WITH PASSWORD 'mypassword';
GRANT ALL PRIVILEGES ON DATABASE openclaw TO openclaw;
\c openclaw
CREATE EXTENSION vector;
GRANT CREATE ON DATABASE openclaw TO openclaw;
\q

# Migrate
export POSTGRES_PASSWORD=mypassword
openclaw memory migrate --to postgresql --host localhost --database openclaw --user openclaw
```

### Example 2: Remote PostgreSQL

```bash
# Migrate to remote database
export POSTGRES_PASSWORD=secure_password
openclaw memory migrate \
  --to postgresql \
  --host 192.168.1.160 \
  --port 5432 \
  --database openclaw_router \
  --user openclaw_router
```

### Example 3: Preview Migration

```bash
# Dry run to see what would be migrated
openclaw memory migrate \
  --to postgresql \
  --host localhost \
  --database openclaw \
  --user openclaw \
  --dry-run

# Output:
# Testing PostgreSQL connection...
# ✅ Connected to PostgreSQL 16.11
# ✅ pgvector extension available
#
# 🔍 DRY RUN MODE - No changes will be made
#
# 📦 Migrating agent: codex
#    Source: ~/.openclaw/memory/codex.sqlite
#    Target schema: agent_codex
#    Rows to migrate:
#       - meta: 5
#       - files: 42
#       - chunks: 1247
#       - embedding_cache: 892
```

### Example 4: Migrate Single Agent

```bash
# Migrate only the 'codex' agent
export POSTGRES_PASSWORD=password
openclaw memory migrate \
  --to postgresql \
  --host localhost \
  --database openclaw \
  --user openclaw \
  --agent codex
```

### Example 5: Verbose Mode

```bash
# See detailed progress
openclaw memory migrate \
  --to postgresql \
  --host localhost \
  --database openclaw \
  --user openclaw \
  --verbose
```

## Output Example

```
Testing PostgreSQL connection...
✅ Connected to PostgreSQL 16.11
✅ pgvector extension available

📦 Migrating agent: codex
   Source: ~/.openclaw/memory/codex.sqlite
   Target schema: agent_codex

Creating schema...
   ✅ Migrated 5 meta rows
   ✅ Migrated 42 file rows
Migrating chunks table... ━━━━━━━━━━━━━━━━ 1247/1247 100%
   ✅ Migrated 1247 chunk rows
Migrating embedding_cache table... ━━━━━━━━━━━━━━━━ 892/892 100%
   ✅ Migrated 892 cache rows
Creating indexes...
   ✅ Indexes created

✅ Migration complete for codex

📦 Migrating agent: sentinel
   Source: ~/.openclaw/memory/sentinel.sqlite
   Target schema: agent_sentinel
...

🎉 All agents migrated successfully!

Next steps:
1. Update your configuration to use PostgreSQL (see docs/gateway/database-configuration.md)
2. Verify with: openclaw memory status --agent codex
3. (Optional) Backup SQLite files before deleting
```

## Help

```bash
# View help
openclaw memory migrate --help

# Output:
# Usage: openclaw memory migrate [options]
#
# Migrate memory databases from SQLite to PostgreSQL
#
# Options:
#   --to <driver>          Target database driver (currently only 'postgresql')
#   --host <host>          PostgreSQL host
#   --database <database>  PostgreSQL database name
#   --user <user>          PostgreSQL username
#   --port <port>          PostgreSQL port (default: "5432")
#   --password <password>  PostgreSQL password (or set POSTGRES_PASSWORD env var)
#   --schema <schema>      Schema name pattern (default: agent_{agentId}) (default: "agent_{agentId}")
#   --agent <id>           Agent id to migrate (default: all agents)
#   --dry-run              Preview migration without making changes (default: false)
#   --verbose              Verbose logging (default: false)
#   -h, --help             display help for command
#
# Examples:
#   openclaw memory migrate --to postgresql --host localhost --database openclaw --user openclaw
#     Migrate all agents to PostgreSQL
#
#   openclaw memory migrate --to postgresql --host 192.168.1.160 --database openclaw_router --user openclaw_router --agent codex
#     Migrate specific agent
#
#   openclaw memory migrate --to postgresql --host localhost --database openclaw --user openclaw --dry-run
#     Preview migration
#
# Note: PostgreSQL password can be set via POSTGRES_PASSWORD environment variable or --password flag.
#
# Docs: docs.openclaw.ai/cli/memory/migrate
```

## Error Handling

The command provides clear error messages:

### Missing Password

```
PostgreSQL password required.
Set via --password flag or POSTGRES_PASSWORD environment variable.
```

### Missing pgvector Extension

```
❌ pgvector extension not found
   Install with: CREATE EXTENSION vector;
```

### Connection Failed

```
Migration failed: connect ECONNREFUSED 127.0.0.1:5432
```

### Missing SQLite Database

```
⚠️  No SQLite database found for agent: codex
   Expected: ~/.openclaw/memory/codex.sqlite
```

## Comparison with Bash Script

### CLI Command vs Bash Script

| Feature            | CLI Command                     | Bash Script                                    |
| ------------------ | ------------------------------- | ---------------------------------------------- |
| **Installation**   | Built into OpenClaw             | Requires separate script                       |
| **Usage**          | `openclaw memory migrate ...`   | `bash scripts/migrate-openclaw-to-postgres.sh` |
| **Progress**       | Integrated progress bars        | Console output                                 |
| **Error handling** | OpenClaw error formatting       | Basic error messages                           |
| **Dry run**        | `--dry-run` flag                | Not available                                  |
| **Single agent**   | `--agent codex`                 | Migrates all agents                            |
| **Help**           | `--help` flag                   | Comments in script                             |
| **Cross-platform** | Works everywhere OpenClaw works | Bash only (Linux/Mac)                          |

### When to Use Each

**Use CLI Command (`openclaw memory migrate`):**

- ✅ Most common use case
- ✅ Want integrated progress reporting
- ✅ Need dry-run capability
- ✅ Migrating single agent
- ✅ Using Windows
- ✅ Want consistent UX with other OpenClaw commands

**Use Bash Script (`scripts/migrate-openclaw-to-postgres.sh`):**

- ✅ Need to run before installing OpenClaw CLI
- ✅ Automating in CI/CD pipeline
- ✅ Want standalone migration tool
- ✅ Prefer shell scripts

## Integration with OpenClaw

The CLI command is fully integrated with OpenClaw:

1. **Config-aware**: Uses OpenClaw configuration to find agents and databases
2. **Style-consistent**: Matches OpenClaw CLI formatting and colors
3. **Error-handling**: Uses OpenClaw error formatting
4. **Progress**: Uses OpenClaw progress bars
5. **Help**: Integrated with OpenClaw help system

## Next Steps After Migration

After running the migration:

1. **Update Configuration**:

   ```json
   {
     "agents": {
       "defaults": {
         "memorySearch": {
           "store": {
             "driver": "postgresql",
             "postgresql": {
               "connectionString": "postgresql://user:pass@host:5432/db",
               "schema": "agent_{agentId}"
             }
           }
         }
       }
     }
   }
   ```

2. **Verify Migration**:

   ```bash
   openclaw memory status --agent codex
   ```

3. **Test Search**:

   ```bash
   openclaw memory search "test query" --agent codex
   ```

4. **Backup SQLite** (optional):
   ```bash
   mkdir -p ~/.openclaw/memory-backup
   mv ~/.openclaw/memory/*.sqlite ~/.openclaw/memory-backup/
   ```

## Troubleshooting

### Connection Refused

```bash
# Check PostgreSQL is running
systemctl status postgresql

# Check firewall
sudo ufw allow 5432

# Test connection manually
psql -h localhost -U openclaw -d openclaw
```

### Extension Not Found

```sql
-- As superuser
CREATE EXTENSION vector;

-- Grant permissions
GRANT CREATE ON DATABASE openclaw TO openclaw;
```

### Module Not Found (better-sqlite3)

```bash
npm install better-sqlite3
```

### Module Not Found (pg)

```bash
npm install pg
```

## Documentation

For more information, see:

- **Database Configuration**: `docs/gateway/database-configuration.md`
- **Migration Guide**: Section "Migration from SQLite to PostgreSQL"
- **Performance Analysis**: `PERFORMANCE_ANALYSIS.md`
- **Bash Script**: `scripts/migrate-openclaw-to-postgres.sh`

## Summary

The `openclaw memory migrate` command provides a user-friendly, integrated way to migrate OpenClaw memory databases from SQLite to PostgreSQL, with progress reporting, error handling, and dry-run capabilities.

**Key Benefits:**

- ✅ Built into OpenClaw CLI
- ✅ No separate scripts needed
- ✅ Integrated progress bars
- ✅ Dry-run mode
- ✅ Single agent migration
- ✅ Cross-platform
- ✅ Consistent with OpenClaw UX
