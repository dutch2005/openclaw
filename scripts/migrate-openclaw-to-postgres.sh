#!/bin/bash
#
# OpenClaw SQLite → PostgreSQL Migration Script
# Usage: ./migrate-openclaw-to-postgres.sh
#

set -euo pipefail

echo "🦞 OpenClaw Memory Migration: SQLite → PostgreSQL"
echo ""

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-192.168.1.160}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-openclaw_router}"
POSTGRES_USER="${POSTGRES_USER:-openclaw_router}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

OPENCLAW_DIR="${HOME}/.openclaw"
MEMORY_DIR="${OPENCLAW_DIR}/memory"

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v psql &> /dev/null; then
  echo "❌ PostgreSQL client (psql) not found. Install with:"
  echo "   sudo apt install postgresql-client"
  exit 1
fi

if [ ! -d "$MEMORY_DIR" ]; then
  echo "❌ Memory directory not found: $MEMORY_DIR"
  echo "   No OpenClaw memory databases to migrate."
  exit 1
fi

# Discover agents
AGENTS=($(ls "$MEMORY_DIR"/*.sqlite 2>/dev/null | xargs -n1 basename | sed 's/.sqlite//'))

if [ ${#AGENTS[@]} -eq 0 ]; then
  echo "❌ No SQLite databases found in $MEMORY_DIR"
  exit 1
fi

echo "✅ Found ${#AGENTS[@]} agent database(s): ${AGENTS[*]}"
echo ""

# Test PostgreSQL connection
echo "🔌 Testing PostgreSQL connection..."
export PGPASSWORD="$POSTGRES_PASSWORD"

if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1" &>/dev/null; then
  echo "❌ Cannot connect to PostgreSQL at $POSTGRES_HOST:$POSTGRES_PORT"
  echo "   Check connection settings and ensure PostgreSQL is running."
  exit 1
fi

echo "✅ PostgreSQL connection OK"
echo ""

# Check pgvector extension
echo "🔍 Checking pgvector extension..."
if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT * FROM pg_extension WHERE extname = 'vector'" | grep -q vector; then
  echo "⚠️  pgvector extension not found. Installing..."
  psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "CREATE EXTENSION IF NOT EXISTS vector" || {
    echo "❌ Failed to install pgvector. Install manually:"
    echo "   sudo apt install postgresql-15-pgvector"
    echo "   psql -c 'CREATE EXTENSION vector'"
    exit 1
  }
fi

echo "✅ pgvector extension ready"
echo ""

# Migration summary
echo "📋 Migration Plan:"
for agent in "${AGENTS[@]}"; do
  sqlite_path="$MEMORY_DIR/${agent}.sqlite"
  if ! command -v sqlite3 &> /dev/null; then
    echo "   - Agent: $agent"
    echo "     Source: $sqlite_path"
    echo "     Target: schema agent_${agent}"
    echo ""
    continue
  fi
  size=$(du -h "$sqlite_path" | cut -f1)
  chunks=$(sqlite3 "$sqlite_path" "SELECT COUNT(*) FROM chunks" 2>/dev/null || echo "0")
  echo "   - Agent: $agent"
  echo "     Source: $sqlite_path ($size)"
  echo "     Chunks: $chunks"
  echo "     Target: schema agent_${agent}"
  echo ""
done

read -p "Continue with migration? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Migration cancelled."
  exit 1
fi

# Check for Node.js and required packages
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install Node.js 22+ to continue."
  exit 1
fi

# Create temporary migration script
TEMP_SCRIPT="/tmp/openclaw-migrate-$$.js"
cat > "$TEMP_SCRIPT" << 'EOFJS'
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

async function migrateAgent(agentName) {
  const sqlitePath = path.join(process.env.HOME, '.openclaw', 'memory', `${agentName}.sqlite`);
  const schema = `agent_${agentName}`;

  console.log(`\n🔄 Migrating agent: ${agentName}`);
  console.log(`   SQLite: ${sqlitePath}`);
  console.log(`   PostgreSQL schema: ${schema}`);

  // Open SQLite database
  const sqlite = new Database(sqlitePath, { readonly: true });

  try {
    const client = await pgPool.connect();

    try {
      // Create schema
      console.log(`   Creating schema ${schema}...`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

      // Create tables
      console.log(`   Creating tables...`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.files (
          path TEXT PRIMARY KEY,
          source TEXT NOT NULL DEFAULT 'memory',
          hash TEXT NOT NULL,
          mtime BIGINT NOT NULL,
          size BIGINT NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.chunks (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL REFERENCES ${schema}.files(path) ON DELETE CASCADE,
          source TEXT NOT NULL DEFAULT 'memory',
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          hash TEXT NOT NULL,
          model TEXT NOT NULL,
          text TEXT NOT NULL,
          embedding vector(1536),
          updated_at BIGINT NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.embedding_cache (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          provider_key TEXT NOT NULL,
          hash TEXT NOT NULL,
          embedding vector(1536),
          dims INTEGER,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (provider, model, provider_key, hash)
        )
      `);

      // Migrate meta
      console.log(`   Migrating meta table...`);
      const metaRows = sqlite.prepare("SELECT * FROM meta").all();
      for (const row of metaRows) {
        await client.query(
          `INSERT INTO ${schema}.meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [row.key, row.value]
        );
      }
      console.log(`      ✓ Migrated ${metaRows.length} meta rows`);

      // Migrate files
      console.log(`   Migrating files table...`);
      const fileRows = sqlite.prepare("SELECT * FROM files").all();
      for (const row of fileRows) {
        await client.query(
          `INSERT INTO ${schema}.files (path, source, hash, mtime, size) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (path) DO NOTHING`,
          [row.path, row.source, row.hash, row.mtime, row.size]
        );
      }
      console.log(`      ✓ Migrated ${fileRows.length} file rows`);

      // Migrate chunks (with embeddings)
      console.log(`   Migrating chunks table...`);
      const chunkRows = sqlite.prepare("SELECT * FROM chunks").all();
      let migratedChunks = 0;

      for (const row of chunkRows) {
        // Convert SQLite BLOB embedding to PostgreSQL vector
        let embeddingArray = null;
        if (row.embedding) {
          if (Buffer.isBuffer(row.embedding)) {
            // SQLite stores as BLOB (Float32Array)
            const float32Array = new Float32Array(
              row.embedding.buffer,
              row.embedding.byteOffset,
              row.embedding.byteLength / 4
            );
            embeddingArray = Array.from(float32Array);
          } else if (typeof row.embedding === 'string') {
            // Sometimes stored as JSON string
            embeddingArray = JSON.parse(row.embedding);
          }
        }

        await client.query(
          `INSERT INTO ${schema}.chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            row.path,
            row.source,
            row.start_line,
            row.end_line,
            row.hash,
            row.model,
            row.text,
            embeddingArray ? JSON.stringify(embeddingArray) : null,
            row.updated_at
          ]
        );

        migratedChunks++;
        if (migratedChunks % 100 === 0) {
          process.stdout.write(`\r      Migrated ${migratedChunks}/${chunkRows.length} chunks...`);
        }
      }
      console.log(`\n      ✓ Migrated ${migratedChunks} chunk rows`);

      // Migrate embedding_cache
      console.log(`   Migrating embedding_cache table...`);
      const cacheRows = sqlite.prepare("SELECT * FROM embedding_cache").all();
      let migratedCache = 0;

      for (const row of cacheRows) {
        let embeddingArray = null;
        if (row.embedding) {
          if (Buffer.isBuffer(row.embedding)) {
            const float32Array = new Float32Array(
              row.embedding.buffer,
              row.embedding.byteOffset,
              row.embedding.byteLength / 4
            );
            embeddingArray = Array.from(float32Array);
          } else if (typeof row.embedding === 'string') {
            embeddingArray = JSON.parse(row.embedding);
          }
        }

        await client.query(
          `INSERT INTO ${schema}.embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
           VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
           ON CONFLICT (provider, model, provider_key, hash) DO NOTHING`,
          [row.provider, row.model, row.provider_key, row.hash, embeddingArray ? JSON.stringify(embeddingArray) : null, row.dims, row.updated_at]
        );

        migratedCache++;
      }
      console.log(`      ✓ Migrated ${migratedCache} cache rows`);

      // Create indexes
      console.log(`   Creating indexes...`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chunks_path ON ${schema}.chunks(path)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON ${schema}.chunks(source)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON ${schema}.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON ${schema}.embedding_cache(updated_at)`);

      // Add tsvector column for full-text search
      console.log(`   Creating full-text search index...`);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE ${schema}.chunks
          ADD COLUMN IF NOT EXISTS text_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chunks_text_tsv ON ${schema}.chunks USING gin(text_tsv)`);

      console.log(`   ✅ Migration complete for ${agentName}`);

    } finally {
      client.release();
    }
  } finally {
    sqlite.close();
  }
}

(async () => {
  const agents = process.argv.slice(2);
  for (const agent of agents) {
    try {
      await migrateAgent(agent);
    } catch (err) {
      console.error(`\n❌ Migration failed for ${agent}:`, err.message);
      process.exit(1);
    }
  }
  await pgPool.end();
  console.log('\n🎉 All agents migrated successfully!');
})();
EOFJS

# Check for required Node.js packages
echo "📦 Installing required Node.js packages..."
cd /tmp
if [ ! -d "node_modules/better-sqlite3" ] || [ ! -d "node_modules/pg" ]; then
  npm install better-sqlite3 pg &>/dev/null || {
    echo "❌ Failed to install Node.js dependencies"
    rm -f "$TEMP_SCRIPT"
    exit 1
  }
fi

# Run migration
export POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
node "$TEMP_SCRIPT" "${AGENTS[@]}"

# Cleanup
rm -f "$TEMP_SCRIPT"

echo ""
echo "✅ Migration complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Update ~/.openclaw/openclaw.json to use PostgreSQL:"
echo "      {"
echo "        \"agents\": {"
echo "          \"defaults\": {"
echo "            \"memorySearch\": {"
echo "              \"store\": {"
echo "                \"driver\": \"postgresql\","
echo "                \"postgresql\": {"
echo "                  \"connectionString\": \"postgresql://$POSTGRES_USER:***@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB\","
echo "                  \"schema\": \"agent_{agentId}\""
echo "                }"
echo "              }"
echo "            }"
echo "          }"
echo "        }"
echo "      }"
echo ""
echo "   2. Restart OpenClaw agents"
echo ""
echo "   3. Verify migration:"
echo "      psql -h $POSTGRES_HOST -U $POSTGRES_USER $POSTGRES_DB -c \"\\dn\""
echo ""
echo "   4. (Optional) Backup old SQLite files:"
echo "      mkdir -p ~/.openclaw/memory-backup-sqlite"
echo "      mv ~/.openclaw/memory/*.sqlite ~/.openclaw/memory-backup-sqlite/"
echo ""
