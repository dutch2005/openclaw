# OpenClaw Configuration Examples

This directory contains example configuration files for different deployment scenarios.

## Files

### 1. `sqlite-single-agent.json`

**Use case:** Single agent deployment with SQLite (default)

**Features:**

- SQLite database (zero configuration)
- Per-agent database files
- Vector search enabled with sqlite-vec
- Hybrid search (vector + full-text)

**Setup:**

```bash
cp examples/configs/sqlite-single-agent.json ~/.openclaw/openclaw.json
openclaw agent main
```

---

### 2. `postgresql-multi-agent.json`

**Use case:** Multiple agents sharing knowledge via PostgreSQL

**Features:**

- PostgreSQL database with shared knowledge
- 5 pre-configured agents (codex, sentinel, pixel, architect, main)
- Schema-per-agent isolation
- Connection pooling
- pgvector for vector search

**Prerequisites:**

```bash
# Install PostgreSQL and pgvector
sudo apt install postgresql postgresql-15-pgvector

# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE openclaw;
CREATE USER openclaw WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE openclaw TO openclaw;
\c openclaw
CREATE EXTENSION vector;
GRANT CREATE ON DATABASE openclaw TO openclaw;
EOF
```

**Setup:**

```bash
# Update password in config
cp examples/configs/postgresql-multi-agent.json ~/.openclaw/openclaw.json
nano ~/.openclaw/openclaw.json  # Update connectionString password

# Start agents
openclaw agent codex
openclaw agent sentinel
openclaw agent pixel
```

---

### 3. `postgresql-production.json`

**Use case:** Production deployment with all optimizations

**Features:**

- PostgreSQL with production-grade settings
- Increased connection pool (max: 20)
- Embedding cache enabled (10K entries)
- Advanced hybrid search with MMR and temporal decay
- Optimized query settings
- Auto-sync on session start
- File watching enabled

**Setup:**

```bash
# Set password via environment variable
export POSTGRESQL_PASSWORD=your_secure_password

# Copy and update config
cp examples/configs/postgresql-production.json ~/.openclaw/openclaw.json

# Update host, database, user in config
nano ~/.openclaw/openclaw.json

# Start agent
openclaw agent main
```

**Recommended PostgreSQL settings** (`postgresql.conf`):

```ini
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 128MB
max_connections = 100
wal_buffers = 16MB
```

---

### 4. `postgresql-docker.json`

**Use case:** Docker Compose deployment

**Features:**

- PostgreSQL hostname: `postgres` (Docker service name)
- Optimized for container networking
- Connection pooling for multiple agents

**Docker Compose setup:**

Create `docker-compose.yml`:

```yaml
version: "3.8"

services:
  postgres:
    image: ankane/pgvector:latest
    environment:
      POSTGRES_DB: openclaw
      POSTGRES_USER: openclaw
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  openclaw:
    image: openclaw/openclaw:latest
    depends_on:
      - postgres
    environment:
      OPENCLAW_CONFIG: /config/openclaw.json
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./examples/configs/postgresql-docker.json:/config/openclaw.json
    command: openclaw agent main

volumes:
  postgres_data:
```

**Setup:**

```bash
# Set password
export POSTGRES_PASSWORD=your_secure_password

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f openclaw
```

---

## Environment Variables

All configs support environment variable overrides:

```bash
# Override database driver
export OPENCLAW_DB_DRIVER=postgresql

# Override PostgreSQL connection
export OPENCLAW_POSTGRESQL_URL=postgresql://user:pass@host:5432/db

# Override SQLite path
export OPENCLAW_SQLITE_PATH=~/.openclaw/memory/{agentId}.sqlite
```

## Configuration Options Reference

### SQLite Options

| Option                 | Type    | Default                               | Description                 |
| ---------------------- | ------- | ------------------------------------- | --------------------------- |
| `driver`               | string  | `"sqlite"`                            | Database driver             |
| `path`                 | string  | `~/.openclaw/memory/{agentId}.sqlite` | Database file path          |
| `vector.enabled`       | boolean | `true`                                | Enable sqlite-vec extension |
| `vector.extensionPath` | string  | `null`                                | Custom path to sqlite-vec   |

### PostgreSQL Options

| Option                         | Type   | Default             | Description            |
| ------------------------------ | ------ | ------------------- | ---------------------- |
| `driver`                       | string | -                   | Set to `"postgresql"`  |
| `connectionString`             | string | -                   | Full connection string |
| `host`                         | string | -                   | PostgreSQL host        |
| `port`                         | number | `5432`              | PostgreSQL port        |
| `database`                     | string | -                   | Database name          |
| `user`                         | string | -                   | Username               |
| `password`                     | string | -                   | Password (use env var) |
| `schema`                       | string | `"agent_{agentId}"` | Schema name            |
| `pool.max`                     | number | `10`                | Max connections        |
| `pool.idleTimeoutMillis`       | number | `30000`             | Idle timeout           |
| `pool.connectionTimeoutMillis` | number | `5000`              | Connection timeout     |
| `vector.extension`             | string | `"pgvector"`        | Vector extension       |
| `vector.dimensions`            | number | `1536`              | Embedding dimensions   |

## Choosing the Right Configuration

### Use SQLite (`sqlite-single-agent.json`) when:

- ✅ Single agent deployment
- ✅ Personal/development use
- ✅ No need for shared knowledge
- ✅ Want simplicity
- ✅ Lowest latency priority

### Use PostgreSQL (`postgresql-*`) when:

- ✅ Multiple agents (3+)
- ✅ Shared knowledge needed
- ✅ Production deployment
- ✅ Need backups/HA
- ✅ Team environment
- ✅ Cloud/Docker deployment

### Configuration Selection Guide

| Scenario                 | Config File                   | Reason                  |
| ------------------------ | ----------------------------- | ----------------------- |
| **Local dev (1 agent)**  | `sqlite-single-agent.json`    | Simplest, fastest setup |
| **Local dev (5 agents)** | `postgresql-multi-agent.json` | Shared knowledge        |
| **Production**           | `postgresql-production.json`  | Optimized settings      |
| **Docker/K8s**           | `postgresql-docker.json`      | Container-friendly      |

## Migration Between Configs

### SQLite → PostgreSQL

```bash
# 1. Start with SQLite config
cp examples/configs/sqlite-single-agent.json ~/.openclaw/openclaw.json

# 2. Run agent and generate some memory
openclaw agent main

# 3. Migrate to PostgreSQL
export POSTGRES_HOST=localhost
export POSTGRES_DB=openclaw
export POSTGRES_USER=openclaw
export POSTGRES_PASSWORD=password
bash scripts/migrate-openclaw-to-postgres.sh

# 4. Switch to PostgreSQL config
cp examples/configs/postgresql-multi-agent.json ~/.openclaw/openclaw.json
nano ~/.openclaw/openclaw.json  # Update connection details

# 5. Restart agent
openclaw agent main
```

## Troubleshooting

### SQLite: "database is locked"

- Only one agent process per database file
- Or enable WAL mode (done automatically)

### PostgreSQL: "connection refused"

- Check PostgreSQL is running: `systemctl status postgresql`
- Verify host/port in config
- Check firewall: `sudo ufw allow 5432`

### PostgreSQL: "type 'vector' does not exist"

- Install pgvector: `sudo apt install postgresql-15-pgvector`
- Enable extension: `CREATE EXTENSION vector;`

### PostgreSQL: "permission denied for database"

- Grant CREATE: `GRANT CREATE ON DATABASE openclaw TO openclaw;`

## Further Reading

- [Database Configuration Guide](../../docs/gateway/database-configuration.md)
- [Performance Analysis](../../PERFORMANCE_ANALYSIS.md)
- [Migration Script](../../scripts/migrate-openclaw-to-postgres.sh)
